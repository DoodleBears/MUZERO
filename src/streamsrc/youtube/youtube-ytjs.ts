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
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { createDiagnosticLogger, log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { aliasRestrictedHeaders } from "../stream-http";
import { videoQualityLabel } from "../video-quality";
import {
  type AudioCodec,
  pickAdaptiveVideo,
  videoCodecOf,
  videoMimeFor,
  type YoutubeVideoFormat,
} from "./youtube-formats";
import type { YoutubeRuntime, YoutubeVideoPlayback, YoutubeVideoQuality } from "./youtube-source";

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

/** Whole-download buffering guard: audio tops out well below this; anything past
 *  it means a wrong format pick or a hostile response (memory-perf-audit PRD F-2). */
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export async function readableStreamToBlob(
  stream: ReadableStream<Uint8Array>,
  mime: string,
  opts: { maxBytes?: number } = {},
): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  const chunks: BlobPart[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          // Stop the source producing before bailing — without cancel() the
          // network keeps streaming into the queue (PRD F-2).
          await reader.cancel().catch(() => {});
          throw new Error(`download exceeds ${maxBytes} byte cap`);
        }
        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        chunks.push(copy.buffer as ArrayBuffer);
      }
    }
  } finally {
    // No-op after a clean close / source error, but releases the network +
    // queued chunks when the loop exits early for any other reason.
    await reader.cancel().catch(() => {});
  }
  return new Blob(chunks, { type: mime });
}

type DecipherableYtjsFormat<TPlayer> = {
  decipher: (player?: TPlayer) => Promise<string>;
};

type YtjsPlayerWithPoToken = {
  po_token?: string | null;
};

type YtjsInfoWithCpn = {
  cpn?: string;
};

export async function decipherYtjsFormatUrl<TPlayer>(
  format: DecipherableYtjsFormat<TPlayer>,
  player: TPlayer,
): Promise<string> {
  return format.decipher(player);
}

export async function withYtjsPlayerPoToken<T>(
  player: YtjsPlayerWithPoToken,
  poToken: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!poToken) return fn();
  const previousPoToken = player.po_token;
  player.po_token = poToken;
  try {
    return await fn();
  } finally {
    player.po_token = previousPoToken;
  }
}

export function appendYoutubeCpn(url: string, cpn: string | undefined): string {
  if (!cpn) return url;
  const parsed = new URL(url);
  if (!parsed.searchParams.has("cpn")) parsed.searchParams.set("cpn", cpn);
  return parsed.toString();
}

/** Minimal youtubei getInfo shape this module reads (decoupled from youtubei's types). */
interface YtMusicInfo {
  playability_status?: { status?: string; reason?: string };
  streaming_data?: { adaptive_formats?: unknown[]; expires?: unknown };
  cpn?: string;
  download: (opts?: {
    type?: string;
    quality?: string;
    itag?: number;
  }) => Promise<ReadableStream<Uint8Array>>;
}

interface YtjsAdaptiveFormat {
  itag: number;
  mime_type: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  quality_label?: string | null;
  has_video?: boolean;
  has_audio?: boolean;
}

const VIDEO_CODEC_RANK: Record<string, number> = { avc: 0, vp9: 1, av1: 2, other: 3 };

interface PreparedYtjsInfo {
  player: YtjsPlayerWithPoToken;
  info: YtMusicInfo;
  cpn: string | undefined;
  contentPoToken: string | null;
}

/** Shared bootstrap for the VIDEO methods: innertube + content PoToken + getInfo + status.
 *  Deliberately separate from resolveAudio so the proven audio path is untouched. */
async function prepareYtjsInfo(
  videoId: string,
): Promise<
  { ok: true; prepared: PreparedYtjsInfo } | { ok: false; verdict: YoutubeVideoPlayback }
> {
  let yt: Innertube;
  try {
    yt = await getInnertube();
  } catch (err) {
    return {
      ok: false,
      verdict: { kind: "unavailable", reason: `youtubei init failed: ${String(err)}` },
    };
  }
  const visitorData = yt.session.context.client.visitorData;
  const contentPoToken = visitorData
    ? await mintPoToken(videoId, yt.session.http.fetch_function, visitorData)
    : null;
  const info = (await yt.music.getInfo(
    videoId,
    contentPoToken ? { po_token: contentPoToken } : undefined,
  )) as unknown as YtMusicInfo;
  const status = info.playability_status?.status;
  if (status !== "OK") {
    if (status === "LOGIN_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
      return { ok: false, verdict: { kind: "login-required" } };
    }
    return {
      ok: false,
      verdict: {
        kind: "unavailable",
        reason: info.playability_status?.reason ?? status ?? "unplayable",
      },
    };
  }
  if (!yt.session.player) {
    return { ok: false, verdict: { kind: "unavailable", reason: "player not loaded" } };
  }
  return { ok: true, prepared: { player: yt.session.player, info, cpn: info.cpn, contentPoToken } };
}

/** Map video-only adaptive formats to the pure picker's shape. */
function extractVideoFormats(info: YtMusicInfo): YoutubeVideoFormat[] {
  const adaptive = (info.streaming_data?.adaptive_formats ?? []) as YtjsAdaptiveFormat[];
  return adaptive
    .filter((f) => f.has_video && !f.has_audio)
    .map((f) => ({
      itag: Number(f.itag),
      mimeType: f.mime_type,
      bitrate: f.bitrate,
      width: f.width,
      height: f.height,
      fps: f.fps,
      qualityLabel: f.quality_label ?? undefined,
    }));
}

function ytjsExpiresInSeconds(info: YtMusicInfo): number | undefined {
  const expires = info.streaming_data?.expires;
  return expires instanceof Date
    ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 1000))
    : undefined;
}

// --- Playlist normalization (regular YouTube + YouTube Music). youtubei item shapes vary
// across feed types/versions, so these read each field defensively from a loose interface.

interface YtjsThumb {
  url?: string;
  width?: number;
}
interface YtjsPlaylistItem {
  id?: string;
  video_id?: string;
  title?: string | { text?: string };
  author?: { name?: string } | string;
  artists?: Array<{ name?: string }>;
  duration?: { seconds?: number } | number;
  thumbnails?: YtjsThumb[];
  thumbnail?: YtjsThumb[] | { contents?: YtjsThumb[] };
}
interface YtjsPlaylistPage {
  info?: { title?: string | { text?: string }; thumbnails?: YtjsThumb[] };
  title?: string | { text?: string };
  header?: { title?: string | { text?: string } };
  metadata?: { title?: string | { text?: string } };
  items?: YtjsPlaylistItem[];
  videos?: YtjsPlaylistItem[];
  has_continuation?: boolean;
  getContinuation?: () => Promise<YtjsPlaylistPage>;
}
interface NormPlaylistItem {
  videoId: string;
  title: string;
  author?: string;
  durationSec?: number;
  coverUrl?: string;
}

function ytText(v: string | { text?: string } | undefined): string | undefined {
  return typeof v === "string" ? v : v?.text;
}
function ytBestThumb(thumbs: YtjsThumb[] | undefined): string | undefined {
  if (!thumbs?.length) return undefined;
  return thumbs.reduce<YtjsThumb>((a, b) => ((b.width ?? 0) > (a.width ?? 0) ? b : a), thumbs[0])
    .url;
}
function ytDuration(d: YtjsPlaylistItem["duration"]): number | undefined {
  if (typeof d === "number") return d;
  return typeof d?.seconds === "number" ? d.seconds : undefined;
}
function ytAuthor(it: YtjsPlaylistItem): string | undefined {
  if (typeof it.author === "string") return it.author;
  return it.author?.name ?? it.artists?.[0]?.name;
}
function ytItemThumb(it: YtjsPlaylistItem): string | undefined {
  if (Array.isArray(it.thumbnail)) return ytBestThumb(it.thumbnail);
  return ytBestThumb(it.thumbnails) ?? ytBestThumb(it.thumbnail?.contents);
}

const PLAYLIST_ITEM_CAP = 500;
const PLAYLIST_PAGE_CAP = 12;

/** Walk a playlist's continuation pages (capped) into a flat normalized item list. */
async function collectPlaylist(first: YtjsPlaylistPage): Promise<{
  name: string;
  coverUrl?: string;
  items: NormPlaylistItem[];
}> {
  const items: NormPlaylistItem[] = [];
  let page: YtjsPlaylistPage | undefined = first;
  let guard = 0;
  while (page && guard < PLAYLIST_PAGE_CAP && items.length < PLAYLIST_ITEM_CAP) {
    for (const it of page.items ?? page.videos ?? []) {
      const videoId = it.id ?? it.video_id;
      if (typeof videoId !== "string" || !videoId) continue;
      items.push({
        videoId,
        title: ytText(it.title) ?? videoId,
        author: ytAuthor(it),
        durationSec: ytDuration(it.duration),
        coverUrl: ytItemThumb(it),
      });
      if (items.length >= PLAYLIST_ITEM_CAP) break;
    }
    if (!page.has_continuation || !page.getContinuation) break;
    try {
      page = await page.getContinuation();
    } catch {
      break;
    }
    guard += 1;
  }
  const name =
    ytText(first.info?.title) ??
    ytText(first.title) ??
    ytText(first.header?.title) ??
    ytText(first.metadata?.title) ??
    "Playlist";
  const coverUrl = ytBestThumb(first.info?.thumbnails) ?? items[0]?.coverUrl;
  return { name, coverUrl, items };
}

export function createYtjsRuntime(): YoutubeRuntime {
  return {
    async resolveAudio(videoId: string, opts?: { trace?: YoutubeTrace }) {
      const trace = opts?.trace ? { ...opts.trace, sourceId: "youtube" as const } : undefined;
      traceYoutube("info", "runtime.start", trace, videoId, {
        message: "youtube runtime resolve started",
        phase: "start",
      });
      let yt: Innertube;
      try {
        yt = await getInnertube();
        traceYoutube("info", "runtime.ready", trace, videoId, {
          message: "youtubei runtime ready",
          phase: "success",
          visitorData: Boolean(yt.session.context.client.visitorData),
          playerPoToken: Boolean(yt.session.player?.po_token),
          sessionPoToken: Boolean(yt.session.po_token),
          sts: yt.session.player?.signature_timestamp,
        });
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
        traceYoutube("info", "po_token.start", trace, videoId, {
          message: "youtube video PoToken mint started",
          phase: "start",
          poTokenBinding: "video",
          visitorData: Boolean(visitorData),
        });
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
        traceYoutube("info", "get_info.start", trace, videoId, {
          message: "youtube music getInfo started",
          phase: "start",
          poTokenBinding: contentPoToken ? "video" : undefined,
        });
        const info = await yt.music.getInfo(
          videoId,
          contentPoToken ? { po_token: contentPoToken } : undefined,
        );
        const cpn = (info as YtjsInfoWithCpn).cpn;
        const status = info.playability_status?.status;
        traceYoutube(status === "OK" ? "info" : "warn", "playability.status", trace, videoId, {
          message: status ?? "missing playability status",
          phase: status === "OK" ? "success" : "fail",
          errorKind: status === "OK" ? undefined : "unknown",
          playabilityStatus: status,
        });
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
        const player = yt.session.player;
        const expires = info.streaming_data?.expires;
        const expiresInSeconds =
          expires instanceof Date
            ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 1000))
            : undefined;
        const mime = (format.mime_type ?? "audio/mp4").split(";")[0].trim();
        traceYoutube("info", "format.selected", trace, videoId, {
          message: "youtube audio format selected",
          phase: "success",
          mime,
          itag: format.itag,
          codec: codecOf(format.mime_type),
          bitrate: format.bitrate,
          hasCpn: Boolean(cpn),
        });
        // Blob transport returns the bytes directly and mints NO object URL —
        // an unused one would pin the whole download until reload (PRD F-1).
        let url: string | undefined;
        let transport: "blob" | "direct" = "blob";
        let downloadedBlob: Blob | undefined;
        traceYoutube("info", "po_token.applied", trace, videoId, {
          message: contentPoToken
            ? "youtube video PoToken applied to active player"
            : "youtube using active player PoToken",
          phase: "state",
          poTokenBinding: contentPoToken ? "video" : undefined,
          playerPoToken: Boolean(player.po_token),
          hasCpn: Boolean(cpn),
        });
        try {
          const blob = await withYtjsPlayerPoToken(player, contentPoToken, async () => {
            traceYoutube("info", "download.start", trace, videoId, {
              message: "youtube audio download started",
              phase: "start",
              mime,
              itag: format.itag,
              poTokenBinding: contentPoToken ? "video" : undefined,
              playerPoToken: Boolean(player.po_token),
              hasCpn: Boolean(cpn),
            });
            const stream = await info.download({
              type: "audio",
              quality: "best",
              itag: Number(format.itag),
            });
            return readableStreamToBlob(stream, mime);
          });
          if (blob.size === 0) return { kind: "unavailable", reason: "empty youtube download" };
          downloadedBlob = blob;
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
          traceYoutube("warn", "download.failed", trace, videoId, {
            message: String(err),
            phase: "fail",
            errorKind: "network_error",
          });
          try {
            const directUrl = await withYtjsPlayerPoToken(player, contentPoToken, () =>
              decipherYtjsFormatUrl(format, player),
            );
            url = appendYoutubeCpn(directUrl, cpn);
            transport = "direct";
            const safeUrl = sanitizeUrlForTrace(url);
            traceYoutube("info", "download.fallback_direct", trace, videoId, {
              message: "youtube falling back to direct media url",
              phase: "retry",
              mime,
              itag: format.itag,
              transport,
              requestHost: safeUrl.host ?? undefined,
              requestPathHash: safeUrl.pathHash,
              safeQuery: safeUrl.safeQuery,
              redactions: safeUrl.redactions,
              poTokenBinding: contentPoToken ? "video" : undefined,
              playerPoToken: Boolean(contentPoToken || player.po_token),
              hasPot: hasUrlParam(url, "pot"),
              hasCpn: hasUrlParam(url, "cpn"),
              hasSig: hasAnyUrlParam(url, ["sig", "lsig", "signature"]),
              hasNParam: hasUrlParam(url, "n"),
            });
          } catch (fallbackErr) {
            traceYoutube("error", "download.failed", trace, videoId, {
              message: String(fallbackErr),
              phase: "fail",
              errorKind: "network_error",
            });
            return {
              kind: "unavailable",
              reason: `youtube download failed: ${String(err)}; direct fallback failed: ${String(
                fallbackErr,
              )}`,
            };
          }
        }
        log.info("youtube", "resolved", { videoId, itag: format.itag, mime: format.mime_type });
        traceYoutube("info", "resolve.success", trace, videoId, {
          message: "youtube resolved",
          phase: "success",
          mime,
          itag: format.itag,
          transport,
        });
        return {
          kind: "ok",
          url,
          mime,
          blob: downloadedBlob,
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
    async resolveVideo(videoId, opts): Promise<YoutubeVideoPlayback> {
      const prep = await prepareYtjsInfo(videoId);
      if (!prep.ok) return prep.verdict;
      const { player, info, contentPoToken } = prep.prepared;
      const picked = pickAdaptiveVideo(extractVideoFormats(info), { maxHeight: opts?.maxHeight });
      if (!picked) return { kind: "unavailable", reason: "no video format" };
      const mime = videoMimeFor(picked.format);
      // Download via youtubei's own range fetcher (a plain GET of the deciphered URL 400s);
      // mirrors the proven audio path. PoToken applies for the duration of the stream.
      let blob: Blob;
      try {
        blob = await withYtjsPlayerPoToken(player, contentPoToken, async () => {
          const stream = await info.download({
            type: "video",
            quality: "best",
            itag: picked.format.itag,
          });
          return readableStreamToBlob(stream, mime);
        });
      } catch (err) {
        return { kind: "unavailable", reason: `youtube video download failed: ${String(err)}` };
      }
      if (blob.size === 0) return { kind: "unavailable", reason: "empty youtube video download" };
      log.info("youtube", "resolved video", {
        videoId,
        itag: picked.format.itag,
        height: picked.format.height,
        codec: picked.codec,
        bytes: blob.size,
      });
      return {
        kind: "ok",
        blob,
        mime,
        codec: picked.codec,
        width: picked.format.width,
        height: picked.format.height,
        fps: picked.format.fps,
        expiresInSeconds: ytjsExpiresInSeconds(info),
      };
    },
    async listVideoQualities(videoId): Promise<YoutubeVideoQuality[]> {
      const prep = await prepareYtjsInfo(videoId);
      if (!prep.ok) return [];
      const byHeight = new Map<number, YoutubeVideoFormat>();
      for (const shape of extractVideoFormats(prep.prepared.info)) {
        const h = shape.height ?? 0;
        const cur = byHeight.get(h);
        if (
          !cur ||
          VIDEO_CODEC_RANK[videoCodecOf(shape.mimeType)] <
            VIDEO_CODEC_RANK[videoCodecOf(cur.mimeType)]
        ) {
          byHeight.set(h, shape);
        }
      }
      return [...byHeight.values()]
        .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))
        .map((s) => ({
          key: String(s.height ?? 0),
          label: videoQualityLabel(s.height ?? 0, s.fps),
          height: s.height ?? 0,
          fps: s.fps,
          codec: videoCodecOf(s.mimeType),
          bandwidth: s.bitrate,
        }));
    },
    async resolveMeta(videoId) {
      let yt: Innertube;
      try {
        yt = await getInnertube();
      } catch {
        return null;
      }
      try {
        const info = (await yt.getBasicInfo(videoId)) as unknown as {
          basic_info?: {
            title?: string;
            author?: string;
            duration?: number;
            thumbnail?: Array<{ url?: string; width?: number }>;
          };
        };
        const bi = info.basic_info;
        const best = (bi?.thumbnail ?? []).reduce<{ url?: string; width?: number } | null>(
          (a, b) => ((b.width ?? 0) > (a?.width ?? 0) ? b : a),
          null,
        );
        return {
          title: bi?.title ?? videoId,
          author: bi?.author ?? undefined,
          // basic_info thumbnails are official i.ytimg.com URLs; fall back to the canonical one.
          coverUrl: best?.url ?? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
          durationSec: typeof bi?.duration === "number" ? bi.duration : undefined,
        };
      } catch {
        return { title: videoId, coverUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` };
      }
    },
    async getPlaylist(playlistId) {
      let yt: Innertube;
      try {
        yt = await getInnertube();
      } catch {
        return null;
      }
      // Regular YouTube playlist first; fall back to the YouTube Music playlist shape.
      try {
        const pl = (await yt.getPlaylist(playlistId)) as unknown as YtjsPlaylistPage;
        const out = await collectPlaylist(pl);
        if (out.items.length) return out;
      } catch {
        // fall through to music
      }
      try {
        const mpl = (await yt.music.getPlaylist(playlistId)) as unknown as YtjsPlaylistPage;
        const out = await collectPlaylist(mpl);
        return out.items.length ? out : null;
      } catch {
        return null;
      }
    },
  };
}

function hasUrlParam(url: string, key: string): boolean {
  try {
    return new URL(url).searchParams.has(key);
  } catch {
    return false;
  }
}

function hasAnyUrlParam(url: string, keys: string[]): boolean {
  return keys.some((key) => hasUrlParam(url, key));
}

function traceYoutube(
  level: "info" | "warn" | "error",
  event: string,
  trace: YoutubeTrace | undefined,
  videoId: string,
  context: Partial<DiagnosticContext> & {
    message: string;
    itag?: unknown;
    transport?: "blob" | "direct";
    poTokenBinding?: "video";
    poTokenLength?: number;
    visitorData?: boolean;
    playerPoToken?: boolean;
    sessionPoToken?: boolean;
    sts?: number;
    playabilityStatus?: string;
    codec?: AudioCodec;
    bitrate?: unknown;
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
