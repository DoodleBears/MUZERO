/**
 * YouTube StreamSourceProvider — search via InnerTube `/search` (no signature needed)
 * + resolve via the {@link resolveYoutubeAudio} client chain. The sig/n/PoToken
 * runtime is INJECTED (`deps.runtime`): present on Electron (hidden BrowserWindow
 * solver), absent elsewhere → resolve reports it's desktop-only while search still
 * works. This keeps the provider unit-testable with stubs (CLAUDE.md rule 5).
 */

import type { DiagnosticContext } from "@/lib/diagnostics";
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { createDiagnosticLogger, log } from "@/lib/logger";
import type { StreamHttp } from "../http";
import type {
  PlayableVideoTrack,
  StreamPlaylist,
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
  StreamVideoResolveOptions,
  StreamVideoResolveResult,
  VideoQualityOption,
} from "../provider";
import type { VideoCodecKind } from "./youtube-formats";
import { YT_CLIENTS } from "./youtube-innertube";
import type { YoutubePlayback } from "./youtube-resolve";
import { buildSearchRequestBody, parseSearchResults } from "./youtube-search";

// Search uses the WEB client (its response carries `videoRenderer` nodes the parser
// walks — YouTube Music's WEB_REMIX would return `musicResponsiveListItemRenderer`).
const SEARCH_URL = `https://www.youtube.com/youtubei/v1/search?key=${YT_CLIENTS.web.apiKey}&prettyPrint=false`;
const REFERER = "https://www.youtube.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MEDIA_HEADERS = {
  Accept: "*/*",
  Origin: REFERER,
  Referer: REFERER,
  DNT: "?1",
};
const youtubeLog = createDiagnosticLogger("stream.youtube");

type YoutubeTrace = Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;

/** A resolved YouTube video-only track (paired with audio + muxed at download time). */
export type YoutubeVideoPlayback =
  | {
      kind: "ok";
      /** Downloaded bytes (youtubei's range fetcher; a plain GET of the URL 400s). */
      blob: Blob;
      mime: string;
      codec: VideoCodecKind;
      width?: number;
      height?: number;
      fps?: number;
      expiresInSeconds?: number;
    }
  | { kind: "login-required" }
  | { kind: "unavailable"; reason: string };

/** A selectable YouTube video quality (source-local shape; mapped to VideoQualityOption). */
export interface YoutubeVideoQuality {
  key: string;
  label: string;
  height: number;
  fps?: number;
  codec: VideoCodecKind;
  bandwidth?: number;
}

/** The Electron-only runtime (youtubei.js) that resolves a videoId to a playable URL. */
export interface YoutubeRuntime {
  resolveAudio: (videoId: string, opts?: { trace?: YoutubeTrace }) => Promise<YoutubePlayback>;
  /** Resolve a video-only track at a target height (download). Absent → no video support. */
  resolveVideo?: (
    videoId: string,
    opts?: { maxHeight?: number; trace?: YoutubeTrace },
  ) => Promise<YoutubeVideoPlayback>;
  /** List selectable video qualities for the download picker. */
  listVideoQualities?: (
    videoId: string,
    opts?: { trace?: YoutubeTrace },
  ) => Promise<YoutubeVideoQuality[]>;
  /** Lightweight metadata (title/author/official thumbnail/duration) for a videoId. */
  resolveMeta?: (videoId: string) => Promise<{
    title: string;
    author?: string;
    coverUrl?: string;
    durationSec?: number;
  } | null>;
  /** Fetch a playlist's name/cover + items (regular YouTube or YouTube Music, paged). */
  getPlaylist?: (playlistId: string) => Promise<{
    name: string;
    coverUrl?: string;
    items: Array<{
      videoId: string;
      title: string;
      author?: string;
      durationSec?: number;
      coverUrl?: string;
    }>;
  } | null>;
}

export interface YoutubeSourceDeps {
  http: StreamHttp;
  now: () => number;
  getCookie?: () => string | undefined;
  /** sig/n/PoToken runtime (Electron). Absent → resolve unavailable; search still works. */
  runtime?: YoutubeRuntime;
}

export function createYoutubeSource(deps: YoutubeSourceDeps): StreamSourceProvider {
  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Referer: REFERER,
      "User-Agent": USER_AGENT,
      "X-Youtube-Client-Name": String(YT_CLIENTS.web.clientId),
      "X-Youtube-Client-Version": YT_CLIENTS.web.clientVersion,
    };
    const cookie = deps.getCookie?.();
    if (cookie) h.Cookie = cookie;
    return h;
  }

  async function search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]> {
    const body = buildSearchRequestBody(query, YT_CLIENTS.web);
    const res = await deps.http({
      url: SEARCH_URL,
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    const text = await res.text();
    if (res.status !== 200) {
      log.warn("youtube", "search HTTP error", { status: res.status, head: text.slice(0, 300) });
      return [];
    }
    try {
      const hits = parseSearchResults(JSON.parse(text), opts?.limit ?? 30);
      log.info("youtube", "search", { query, hits: hits.length });
      return hits;
    } catch (err) {
      log.warn("youtube", "search parse failed", { err: String(err), head: text.slice(0, 300) });
      return [];
    }
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    const trace = opts?.trace ? { ...opts.trace, sourceId: "youtube" as const } : undefined;
    traceYoutube("info", "resolve.start", trace, externalId, {
      message: "youtube resolve started",
      phase: "start",
    });
    if (!deps.runtime) {
      traceYoutube("error", "resolve.failed", trace, externalId, {
        message: "YouTube playback needs the desktop runtime",
        phase: "fail",
        errorKind: "unsupported_source",
      });
      return { kind: "error", message: "YouTube playback needs the desktop runtime" };
    }
    const playback = await deps.runtime.resolveAudio(externalId, { trace });
    switch (playback.kind) {
      case "ok": {
        // Blob transport carries the bytes and no url (PRD F-1); direct
        // transport carries the bare CDN url for the media proxy.
        const blobTransport = Boolean(playback.blob);
        const safeUrl = playback.url ? sanitizeUrlForTrace(playback.url) : undefined;
        traceYoutube("info", "resolve.success", trace, externalId, {
          message: "youtube source resolved media",
          phase: "success",
          mime: playback.mime,
          requestHost: safeUrl?.host ?? undefined,
          requestPathHash: safeUrl?.pathHash,
          safeQuery: safeUrl?.safeQuery,
          redactions: safeUrl?.redactions,
          transport: blobTransport ? "blob" : "direct",
          hasHeaders: !blobTransport,
          codec: playback.codec,
          durationSec: playback.details?.lengthSeconds,
        });
        return {
          kind: "ok",
          stream: {
            mediaUrl: playback.url,
            blob: playback.blob,
            // Match youtubei's own media downloader: the googlevideo request needs
            // YouTube's stream headers, and the media element can only send them via
            // the desktop media proxy.
            headers: blobTransport ? undefined : MEDIA_HEADERS,
            mime: playback.mime,
            durationSec: playback.details?.lengthSeconds,
            expiresAt: playback.expiresInSeconds
              ? deps.now() + playback.expiresInSeconds * 1000
              : undefined,
            quality: playback.codec,
          },
        };
      }
      case "login-required":
        log.warn("youtube", "resolve login-required", { videoId: externalId });
        traceYoutube("warn", "resolve.failed", trace, externalId, {
          message: "youtube resolve requires login",
          phase: "fail",
          errorKind: "auth_required",
        });
        return { kind: "requires-login" };
      default:
        log.warn("youtube", "resolve unavailable", {
          videoId: externalId,
          reason: playback.reason,
        });
        traceYoutube("error", "resolve.failed", trace, externalId, {
          message: playback.reason,
          phase: "fail",
          errorKind: "unknown",
        });
        return { kind: "error", message: playback.reason };
    }
  }

  async function resolveVideo(
    externalId: string,
    opts?: StreamVideoResolveOptions,
  ): Promise<StreamVideoResolveResult> {
    if (!deps.runtime?.resolveVideo) {
      return { kind: "error", message: "YouTube video download needs the desktop runtime" };
    }
    const trace = opts?.trace ? { ...opts.trace, sourceId: "youtube" as const } : undefined;
    const playback = await deps.runtime.resolveVideo(externalId, {
      maxHeight: parseMaxHeight(opts?.quality),
      trace,
    });
    if (playback.kind === "login-required") return { kind: "requires-login" };
    if (playback.kind !== "ok") return { kind: "error", message: playback.reason };
    const video: PlayableVideoTrack = {
      // Blob transport: youtubei already downloaded the bytes (range fetcher + PoToken).
      blob: playback.blob,
      mime: playback.mime,
      codec: playback.codec,
      width: playback.width,
      height: playback.height,
      fps: playback.fps,
      expiresAt: playback.expiresInSeconds
        ? deps.now() + playback.expiresInSeconds * 1000
        : undefined,
    };
    return { kind: "ok", video };
  }

  async function listVideoQualities(
    externalId: string,
    opts?: { signal?: AbortSignal },
  ): Promise<VideoQualityOption[]> {
    if (!deps.runtime?.listVideoQualities) return [];
    void opts;
    const qualities = await deps.runtime.listVideoQualities(externalId);
    return qualities.map((q) => ({
      key: q.key,
      label: q.label,
      height: q.height,
      fps: q.fps,
      codec: q.codec,
      bandwidth: q.bandwidth,
    }));
  }

  async function getTracksByIds(
    ids: string[],
    _opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    if (!deps.runtime?.resolveMeta) return [];
    const out: StreamSearchHit[] = [];
    for (const id of ids) {
      const meta = await deps.runtime.resolveMeta(id);
      if (meta) {
        out.push({
          source: "youtube",
          externalId: id,
          title: meta.title,
          artist: meta.author,
          durationSec: meta.durationSec,
          coverUrl: meta.coverUrl,
        });
      }
    }
    return out;
  }

  async function getPlaylistMeta(
    playlistRef: string,
    _opts?: { signal?: AbortSignal },
  ): Promise<StreamPlaylist | null> {
    if (!deps.runtime?.getPlaylist) return null;
    const pl = await deps.runtime.getPlaylist(playlistRef);
    if (!pl) return null;
    return {
      id: playlistRef,
      source: "youtube",
      name: pl.name,
      coverUrl: pl.coverUrl,
      trackCount: pl.items.length,
    };
  }

  async function importPlaylist(
    playlistRef: string,
    _opts?: { signal?: AbortSignal },
  ): Promise<StreamSearchHit[]> {
    if (!deps.runtime?.getPlaylist) return [];
    const pl = await deps.runtime.getPlaylist(playlistRef);
    if (!pl) return [];
    return pl.items.map((it) => ({
      source: "youtube" as const,
      externalId: it.videoId,
      title: it.title,
      artist: it.author,
      durationSec: it.durationSec,
      coverUrl: it.coverUrl,
    }));
  }

  return {
    id: "youtube",
    label: "YouTube",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
    resolveVideo,
    listVideoQualities,
    getTracksByIds,
    getPlaylistMeta,
    importPlaylist,
  };
}

/** Parse a quality key ("1080" / "max" / undefined) into a max-height cap. */
function parseMaxHeight(quality?: string): number | undefined {
  if (!quality || quality === "max") return undefined;
  const n = Number(quality);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function traceYoutube(
  level: "info" | "warn" | "error",
  event: string,
  trace: YoutubeTrace | undefined,
  videoId: string,
  context: Partial<DiagnosticContext> & {
    message: string;
    transport?: "blob" | "direct";
    hasHeaders?: boolean;
    codec?: string;
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
