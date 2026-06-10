/**
 * YouTube StreamSourceProvider — search via InnerTube `/search` (no signature needed)
 * + resolve via the {@link resolveYoutubeAudio} client chain. The sig/n/PoToken
 * runtime is INJECTED (`deps.runtime`): present on Electron (hidden BrowserWindow
 * solver), absent elsewhere → resolve reports it's desktop-only while search still
 * works. This keeps the provider unit-testable with stubs (CLAUDE.md rule 5).
 */

import type { StreamHttp } from "../http";
import type {
  StreamResolveOptions,
  StreamResolveResult,
  StreamSearchHit,
  StreamSearchOptions,
  StreamSourceProvider,
} from "../provider";
import type { CipherSolvers } from "./youtube-cipher";
import { YT_CLIENTS } from "./youtube-innertube";
import { resolveYoutubeAudio, type YoutubeBootstrap } from "./youtube-resolve";
import { buildSearchRequestBody, parseSearchResults } from "./youtube-search";

const SEARCH_URL = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false";
const REFERER = "https://www.youtube.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** The Electron-only runtime that supplies the things only a JS engine can compute. */
export interface YoutubeRuntime {
  getBootstrap: () => Promise<YoutubeBootstrap>;
  solvers: CipherSolvers;
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
      Origin: REFERER,
      "User-Agent": USER_AGENT,
      "X-Youtube-Client-Name": String(YT_CLIENTS.webRemix.clientId),
      "X-Youtube-Client-Version": YT_CLIENTS.webRemix.clientVersion,
    };
    const cookie = deps.getCookie?.();
    if (cookie) h.Cookie = cookie;
    return h;
  }

  async function search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]> {
    const body = buildSearchRequestBody(query, YT_CLIENTS.webRemix);
    const res = await deps.http({
      url: SEARCH_URL,
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    try {
      return parseSearchResults(JSON.parse(await res.text()), opts?.limit ?? 30);
    } catch {
      return [];
    }
  }

  async function resolve(
    externalId: string,
    opts?: StreamResolveOptions,
  ): Promise<StreamResolveResult> {
    if (!deps.runtime) {
      return { kind: "error", message: "YouTube playback needs the desktop runtime" };
    }
    const playback = await resolveYoutubeAudio(
      externalId,
      {
        http: deps.http,
        getBootstrap: deps.runtime.getBootstrap,
        solvers: deps.runtime.solvers,
        getCookie: deps.getCookie,
      },
      opts?.signal,
    );
    switch (playback.kind) {
      case "ok":
        return {
          kind: "ok",
          stream: {
            mediaUrl: playback.url,
            headers: { Referer: REFERER, "User-Agent": USER_AGENT },
            mime: playback.mime,
            durationSec: playback.details?.lengthSeconds,
            expiresAt: playback.expiresInSeconds
              ? deps.now() + playback.expiresInSeconds * 1000
              : undefined,
            quality: playback.codec,
          },
        };
      case "login-required":
        return { kind: "requires-login" };
      default:
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
