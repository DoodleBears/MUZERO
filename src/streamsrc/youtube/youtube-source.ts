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
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
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

/** The Electron-only runtime (youtubei.js) that resolves a videoId to a playable URL. */
export interface YoutubeRuntime {
  resolveAudio: (videoId: string, opts?: { trace?: YoutubeTrace }) => Promise<YoutubePlayback>;
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
        const safeUrl = sanitizeUrlForTrace(playback.url);
        traceYoutube("info", "resolve.success", trace, externalId, {
          message: "youtube source resolved media",
          phase: "success",
          mime: playback.mime,
          requestHost: safeUrl.host ?? undefined,
          requestPathHash: safeUrl.pathHash,
          safeQuery: safeUrl.safeQuery,
          redactions: safeUrl.redactions,
          transport: playback.url.startsWith("blob:") ? "blob" : "direct",
          hasHeaders: !playback.url.startsWith("blob:"),
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
            headers: playback.url.startsWith("blob:") ? undefined : MEDIA_HEADERS,
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

  return {
    id: "youtube",
    label: "YouTube",
    requiresLogin: false,
    isAuthed: () => Boolean(deps.getCookie?.()),
    search,
    resolve,
  };
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
