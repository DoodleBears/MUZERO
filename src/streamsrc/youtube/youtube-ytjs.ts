/**
 * YouTube runtime backed by youtubei.js. Our hand-rolled InnerTube `/player` request
 * proved brittle (YouTube rejects stale client versions with "no longer supported"),
 * so the whole resolve goes through youtubei's YouTube **Music** client
 * (`yt.music.getInfo`) — it keeps client versions current and deciphers (sig + n)
 * with player.js's own functions via its browser-build JS evaluator (the renderer
 * has it; the node platform doesn't).
 *
 * **PoToken**: the deciphered guest URL is only honored by googlevideo when it carries
 * a `pot=` (Proof-of-Origin) bound to the session's `visitorData`. Without it the URL
 * 403s no matter which TLS stack / IP fetches it (we chased TLS-fingerprint and proxy
 * red herrings before finding this — pear-desktop mints one too). We mint it with
 * BotGuard via bgutils-js, running its interpreter against the renderer's REAL DOM
 * (no happy-dom shim needed, unlike a node/main-process host), then set it on the
 * player so `Format.decipher` appends `pot=` to every URL.
 *
 * All youtubei + BotGuard fetches go through the muzfetch proxy (`getAppFetch`), so
 * this only works where that proxy exists (Electron) — same as the rest of the source.
 */

import { BG, type BgConfig } from "bgutils-js";
import { Innertube, Platform } from "youtubei.js";
import type { DiagnosticContext } from "@/lib/diagnostics";
import { createDiagnosticLogger, log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { aliasRestrictedHeaders } from "../stream-http";
import type { AudioCodec } from "./youtube-formats";
import type { YoutubeRuntime } from "./youtube-source";

// youtubei.js v17 ships NO JS evaluator (its default throws) — the caller must
// provide one so it can run player.js's extracted sig/n functions. `data.output`
// is a self-contained function body ending in `return process(…)` → { sig, n }.
// Runs in the renderer realm (the same code youtube.com runs in every tab). Set
// once at import; verified end-to-end (deciphered URL → 206 audio bytes).
Platform.shim.eval = (data: { output: string }) => new Function(data.output)();

// The standard YouTube web BotGuard request key (same constant youtube.com uses).
const BG_REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const youtubeLog = createDiagnosticLogger("stream.youtube");
type YoutubeTrace = Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;

let innertubePromise: Promise<Innertube> | null = null;
let botGuardChallengePromise: Promise<Awaited<ReturnType<typeof BG.Challenge.create>>> | null =
  null;

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers));
}

function createYoutubeFetch(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => {
    const request = input instanceof Request ? input : null;
    const headers = {
      ...headersToRecord(request?.headers),
      ...headersToRecord(init?.headers),
    };
    return fetchImpl(request?.url ?? String(input), {
      ...init,
      method: init?.method ?? request?.method,
      headers: aliasRestrictedHeaders(headers),
    });
  };
}

function createBgConfig(identifier: string, fetchImpl: typeof fetch): BgConfig {
  return {
    // BotGuard runs in the renderer's real window/document; its challenge fetch
    // (jnn-pa.googleapis.com) routes through the muzfetch proxy like everything else.
    fetch: (input, init) => fetchImpl(input as RequestInfo, init),
    globalObj: globalThis,
    identifier,
    requestKey: BG_REQUEST_KEY,
  };
}

async function getBotGuardChallenge(fetchImpl: typeof fetch, seedIdentifier: string) {
  if (!botGuardChallengePromise) {
    botGuardChallengePromise = (async () => {
      const challenge = await BG.Challenge.create(createBgConfig(seedIdentifier, fetchImpl));
      const interpreter =
        challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
      if (!interpreter) throw new Error("BotGuard returned no interpreter");
      // Define the BotGuard VM global on the renderer realm once; subsequent token
      // mints can reuse the same program/global with a different content binding.
      new Function(interpreter)();
      return challenge;
    })().catch((err) => {
      botGuardChallengePromise = null;
      throw err;
    });
  }
  return botGuardChallengePromise;
}

async function mintPoToken(
  identifier: string,
  fetchImpl: typeof fetch,
  seedIdentifier = identifier,
): Promise<string | null> {
  try {
    const challenge = await getBotGuardChallenge(fetchImpl, seedIdentifier);
    if (!challenge) throw new Error("BotGuard challenge unavailable");
    const { poToken } = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig: createBgConfig(identifier, fetchImpl),
    });
    return poToken ?? null;
  } catch (err) {
    log.warn("youtube", "PoToken mint failed", { identifier, err: String(err) });
    return null;
  }
}

/**
 * Mint a session-bound PoToken and attach it to the player so deciphered URLs carry
 * `pot=`. Best-effort: on any failure we log and leave the token unset (the URL may
 * then 403, but resolve degrades to a skip rather than crashing). Mutates `yt`.
 */
async function attachPoToken(yt: Innertube, fetchImpl: typeof fetch): Promise<void> {
  const visitorData = yt.session.context.client.visitorData;
  if (!visitorData) {
    log.warn("youtube", "no visitorData — skipping PoToken");
    return;
  }
  const poToken = await mintPoToken(visitorData, fetchImpl);
  if (!poToken) return;
  yt.session.po_token = poToken;
  if (yt.session.player) yt.session.player.po_token = poToken;
  log.info("youtube", "PoToken minted", { binding: "visitor", len: poToken.length });
}

/** Lazily create + cache one Innertube (fetches player.js once; supplies the decipher engine). */
async function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const fetch = createYoutubeFetch(await getAppFetch());
      const yt = await Innertube.create({ fetch, retrieve_player: true });
      await attachPoToken(yt, fetch);
      log.info("youtube", "youtubei ready", {
        visitorData: Boolean(yt.session.context.client.visitorData),
        sts: yt.session.player?.signature_timestamp,
        pot: Boolean(yt.session.player?.po_token),
      });
      return yt;
    })().catch((err) => {
      innertubePromise = null; // let the next play retry a failed bootstrap
      log.warn("youtube", "youtubei init failed", { err: String(err) });
      throw err;
    });
  }
  return innertubePromise;
}

function codecOf(mime: string | undefined): AudioCodec {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("mp4a")) return "aac";
  if (m.includes("opus")) return "opus";
  if (m.includes("vorbis")) return "vorbis";
  return "other";
}

async function readableStreamToBlob(
  stream: ReadableStream<Uint8Array>,
  mime: string,
): Promise<Blob> {
  const chunks: BlobPart[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      chunks.push(copy.buffer as ArrayBuffer);
    }
  }
  return new Blob(chunks, { type: mime });
}

export function createYtjsRuntime(): YoutubeRuntime {
  return {
    async resolveAudio(videoId: string, opts?: { trace?: YoutubeTrace }) {
      const trace = opts?.trace ? { ...opts.trace, sourceId: "youtube" as const } : undefined;
      let yt: Innertube;
      try {
        yt = await getInnertube();
      } catch (err) {
        traceYoutube("error", "runtime.unavailable", trace, videoId, {
          message: `youtubei init failed: ${String(err)}`,
          phase: "fail",
          errorKind: "unknown",
        });
        return { kind: "unavailable", reason: `youtubei init failed: ${String(err)}` };
      }
      try {
        const visitorData = yt.session.context.client.visitorData;
        const contentPoToken = visitorData
          ? await mintPoToken(videoId, yt.session.http.fetch_function, visitorData)
          : null;
        if (contentPoToken) {
          log.info("youtube", "PoToken minted", {
            binding: "video",
            videoId,
            len: contentPoToken.length,
          });
          traceYoutube("info", "po_token.minted", trace, videoId, {
            message: "youtube video PoToken minted",
            phase: "success",
            poTokenBinding: "video",
            poTokenLength: contentPoToken.length,
          });
        } else {
          traceYoutube("warn", "po_token.missing", trace, videoId, {
            message: "youtube video PoToken unavailable",
            phase: "fail",
            errorKind: "po_token",
            poTokenBinding: "video",
          });
        }
        const info = await yt.music.getInfo(
          videoId,
          contentPoToken ? { po_token: contentPoToken } : undefined,
        );
        const status = info.playability_status?.status;
        if (status !== "OK") {
          if (status === "LOGIN_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
            traceYoutube("warn", "playability.failed", trace, videoId, {
              message: status,
              phase: "fail",
              errorKind: "auth_required",
            });
            return { kind: "login-required" };
          }
          traceYoutube("error", "playability.failed", trace, videoId, {
            message: info.playability_status?.reason ?? status ?? "unplayable",
            phase: "fail",
            errorKind: "unknown",
          });
          return {
            kind: "unavailable",
            reason: info.playability_status?.reason ?? status ?? "unplayable",
          };
        }
        const format = info.chooseFormat({ type: "audio", quality: "best" });
        if (!yt.session.player) return { kind: "unavailable", reason: "player not loaded" };
        const expires = info.streaming_data?.expires;
        const expiresInSeconds =
          expires instanceof Date
            ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 1000))
            : undefined;
        const mime = (format.mime_type ?? "audio/mp4").split(";")[0].trim();
        let url: string;
        try {
          const stream = await info.download({
            type: "audio",
            quality: "best",
            itag: Number(format.itag),
          });
          const blob = await readableStreamToBlob(stream, mime);
          if (blob.size === 0) return { kind: "unavailable", reason: "empty youtube download" };
          url = URL.createObjectURL(blob);
          log.info("youtube", "downloaded", { videoId, itag: format.itag, bytes: blob.size });
          traceYoutube("info", "download.success", trace, videoId, {
            message: "youtube audio downloaded",
            phase: "success",
            bytes: blob.size,
            mime,
            itag: format.itag,
            transport: "blob",
          });
        } catch (err) {
          log.warn("youtube", "download fallback failed", { videoId, err: String(err) });
          traceYoutube("error", "download.failed", trace, videoId, {
            message: String(err),
            phase: "fail",
            errorKind: "network_error",
          });
          return { kind: "unavailable", reason: `youtube download failed: ${String(err)}` };
        }
        log.info("youtube", "resolved", { videoId, itag: format.itag, mime: format.mime_type });
        traceYoutube("info", "resolve.success", trace, videoId, {
          message: "youtube resolved",
          phase: "success",
          mime,
          itag: format.itag,
          transport: url.startsWith("blob:") ? "blob" : "direct",
        });
        return {
          kind: "ok",
          url,
          mime,
          codec: codecOf(format.mime_type),
          expiresInSeconds,
          details: {
            videoId,
            title: info.basic_info?.title ?? undefined,
            author: info.basic_info?.author ?? undefined,
            lengthSeconds: info.basic_info?.duration ?? undefined,
          },
        };
      } catch (err) {
        log.warn("youtube", "resolveAudio failed", { videoId, err: String(err) });
        traceYoutube("error", "resolve.failed", trace, videoId, {
          message: String(err),
          phase: "fail",
          errorKind: "unknown",
        });
        return { kind: "unavailable", reason: String(err) };
      }
    },
  };
}

function traceYoutube(
  level: "info" | "warn" | "error",
  event: string,
  trace: YoutubeTrace | undefined,
  videoId: string,
  context: Pick<DiagnosticContext, "phase" | "errorKind" | "bytes" | "mime"> & {
    message: string;
    itag?: unknown;
    transport?: "blob" | "direct";
    poTokenBinding?: "video";
    poTokenLength?: number;
  },
): void {
  if (!trace?.traceId) return;
  youtubeLog[level](event, {
    ...trace,
    ...context,
    category: "stream",
    videoId,
  });
}
