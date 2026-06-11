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
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
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

let innertubePromise: Promise<Innertube> | null = null;

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
  try {
    const bgConfig: BgConfig = {
      // BotGuard runs in the renderer's real window/document; its challenge fetch
      // (jnn-pa.googleapis.com) routes through the muzfetch proxy like everything else.
      fetch: (input, init) => fetchImpl(input as RequestInfo, init),
      globalObj: globalThis,
      identifier: visitorData,
      requestKey: BG_REQUEST_KEY,
    };
    const challenge = await BG.Challenge.create(bgConfig);
    const interpreter =
      challenge?.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (!interpreter) {
      log.warn("youtube", "BotGuard returned no interpreter");
      return;
    }
    // Define the BotGuard VM global on the renderer realm, then mint.
    new Function(interpreter)();
    const { poToken } = await BG.PoToken.generate({
      program: challenge.program,
      globalName: challenge.globalName,
      bgConfig,
    });
    yt.session.po_token = poToken;
    if (yt.session.player) yt.session.player.po_token = poToken;
    log.info("youtube", "PoToken minted", { len: poToken?.length });
  } catch (err) {
    log.warn("youtube", "PoToken mint failed", { err: String(err) });
  }
}

/** Lazily create + cache one Innertube (fetches player.js once; supplies the decipher engine). */
async function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const fetch = await getAppFetch();
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

export function createYtjsRuntime(): YoutubeRuntime {
  return {
    async resolveAudio(videoId: string) {
      let yt: Innertube;
      try {
        yt = await getInnertube();
      } catch (err) {
        return { kind: "unavailable", reason: `youtubei init failed: ${String(err)}` };
      }
      try {
        const info = await yt.music.getInfo(videoId);
        const status = info.playability_status?.status;
        if (status !== "OK") {
          if (status === "LOGIN_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
            return { kind: "login-required" };
          }
          return {
            kind: "unavailable",
            reason: info.playability_status?.reason ?? status ?? "unplayable",
          };
        }
        const format = info.chooseFormat({ type: "audio", quality: "best" });
        if (!yt.session.player) return { kind: "unavailable", reason: "player not loaded" };
        const url = await format.decipher(yt.session.player);
        const expires = info.streaming_data?.expires;
        const expiresInSeconds =
          expires instanceof Date
            ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 1000))
            : undefined;
        log.info("youtube", "resolved", { videoId, itag: format.itag, mime: format.mime_type });
        return {
          kind: "ok",
          url,
          mime: (format.mime_type ?? "audio/mp4").split(";")[0].trim(),
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
        return { kind: "unavailable", reason: String(err) };
      }
    },
  };
}
