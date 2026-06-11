/**
 * YouTube playback resolution — orchestrates the InnerTube `/player` call across a
 * client fallback chain (WEB_REMIX → TV) and assembles the final audio URL. Kept
 * injectable (http + bootstrap + cipher solvers) so the multi-client logic is unit-
 * testable with stubs; the runtime supplies the real solvers (hidden BrowserWindow)
 * and bootstrap (visitorData / signatureTimestamp / PoToken).
 *
 * A client that returns LOGIN_REQUIRED / age-gate is retried with the next client
 * (TV embedded often serves what WEB_REMIX won't); only when all clients fail do we
 * surface the verdict.
 */

import type { StreamHttp } from "../http";
import type { CipherSolvers } from "./youtube-cipher";
import { resolveFormatUrl } from "./youtube-cipher";
import { type AudioCodec, audioMimeFor, pickAdaptiveAudio } from "./youtube-formats";
import {
  buildPlayerRequestBody,
  type InnertubeClient,
  type PlayerDetails,
  parsePlayerResponse,
  YT_CLIENTS,
} from "./youtube-innertube";

const PLAYER_BASE = "https://www.youtube.com/youtubei/v1/player";
const ORIGIN = "https://www.youtube.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Runtime-provided session bits the `/player` request needs (all optional). */
export interface YoutubeBootstrap {
  visitorData?: string;
  signatureTimestamp?: number;
  poToken?: string;
}

export interface YoutubeResolveDeps {
  http: StreamHttp;
  /** Fetch the current session bootstrap (cached by the runtime). */
  getBootstrap: () => Promise<YoutubeBootstrap>;
  /** sig/n descramblers from the player.js solver (hidden window in prod). */
  solvers: CipherSolvers;
  getCookie?: () => string | undefined;
  /** Client fallback order; defaults to WEB_REMIX → TV. */
  clients?: InnertubeClient[];
  hl?: string;
  gl?: string;
}

export type YoutubePlayback =
  | {
      kind: "ok";
      url: string;
      mime: string;
      codec: AudioCodec;
      expiresInSeconds?: number;
      details?: PlayerDetails;
    }
  | { kind: "login-required" }
  | { kind: "unavailable"; reason: string };

const DEFAULT_CLIENTS: InnertubeClient[] = [YT_CLIENTS.webRemix, YT_CLIENTS.tv];

/** Resolve a videoId to a playable audio URL, trying each client until one serves. */
export async function resolveYoutubeAudio(
  videoId: string,
  deps: YoutubeResolveDeps,
  signal?: AbortSignal,
): Promise<YoutubePlayback> {
  let boot: YoutubeBootstrap;
  try {
    boot = await deps.getBootstrap();
  } catch (err) {
    // Bootstrap (player.js fetch / parse) failed — surface it as unavailable so the
    // player shows a toast instead of an uncaught promise rejection.
    return { kind: "unavailable", reason: err instanceof Error ? err.message : String(err) };
  }
  const clients = deps.clients ?? DEFAULT_CLIENTS;
  let lastVerdict: YoutubePlayback = { kind: "unavailable", reason: "no clients" };

  for (const client of clients) {
    const body = buildPlayerRequestBody({
      videoId,
      client,
      hl: deps.hl,
      gl: deps.gl,
      signatureTimestamp: boot.signatureTimestamp,
      visitorData: boot.visitorData,
      poToken: boot.poToken,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "User-Agent": USER_AGENT,
      "X-Youtube-Client-Name": String(client.clientId),
      "X-Youtube-Client-Version": client.clientVersion,
    };
    const cookie = deps.getCookie?.();
    if (cookie) headers.Cookie = cookie;

    let parsed: ReturnType<typeof parsePlayerResponse>;
    try {
      const res = await deps.http({
        url: `${PLAYER_BASE}?key=${client.apiKey}&prettyPrint=false`,
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      parsed = parsePlayerResponse(JSON.parse(await res.text()));
    } catch (err) {
      lastVerdict = {
        kind: "unavailable",
        reason: err instanceof Error ? err.message : String(err),
      };
      continue;
    }

    if (parsed.status === "login-required" || parsed.status === "age-restricted") {
      lastVerdict = { kind: "login-required" };
      continue; // a different client may serve it
    }
    if (parsed.status !== "ok") {
      lastVerdict = { kind: "unavailable", reason: parsed.reason ?? parsed.status };
      continue;
    }
    const picked = pickAdaptiveAudio(parsed.formats);
    if (!picked) {
      lastVerdict = { kind: "unavailable", reason: "no audio format" };
      continue;
    }
    const url = await resolveFormatUrl(picked.format, deps.solvers);
    if (!url) {
      lastVerdict = { kind: "unavailable", reason: "unresolved stream url" };
      continue;
    }
    return {
      kind: "ok",
      url,
      mime: audioMimeFor(picked.format),
      codec: picked.codec,
      expiresInSeconds: parsed.expiresInSeconds,
      details: parsed.details,
    };
  }
  return lastVerdict;
}
