/**
 * Pure InnerTube mapping for YouTube playback — the request body for
 * `/youtubei/v1/player` and the parse of its response into a playability verdict +
 * formats. No IO (mirrors `lrclib-map`/`bili-resolve`): the source shell POSTs these
 * over the proxy and runs the sig solver / PoToken around them.
 *
 * Client presets are the platform's well-known public constants; clientVersion drifts
 * over time, so it's a field on {@link InnertubeClient} (updatable, no logic change).
 */

import type { YoutubeFormat } from "./youtube-formats";

export interface InnertubeClient {
  clientName: string;
  clientVersion: string;
  /** Numeric id for the `X-Youtube-Client-Name` header. */
  clientId: number;
  /** Public InnerTube API key for this client (sent as `?key=`). */
  apiKey: string;
}

// Well-known public InnerTube keys (not secrets — embedded in YouTube's own pages).
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const WEB_REMIX_KEY = "AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30";

/**
 * The clients we use. `web` drives SEARCH (its response carries `videoRenderer`
 * nodes the parser walks); `webRemix` (YouTube Music) + `tv` drive the PLAYER for
 * audio formats. Versions are constants the solver-asset updater can refresh.
 */
export const YT_CLIENTS: Record<"web" | "webRemix" | "tv", InnertubeClient> = {
  web: { clientName: "WEB", clientVersion: "2.20240726.00.00", clientId: 1, apiKey: WEB_KEY },
  webRemix: {
    clientName: "WEB_REMIX",
    clientVersion: "1.20240403.01.00",
    clientId: 67,
    apiKey: WEB_REMIX_KEY,
  },
  tv: {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    clientId: 85,
    apiKey: WEB_KEY,
  },
};

export interface PlayerRequestInput {
  videoId: string;
  client: InnertubeClient;
  hl?: string;
  gl?: string;
  /** From the player.js — pins the request to the sig algorithm version. */
  signatureTimestamp?: number;
  /** Guest session id (bootstrap) — improves availability for anonymous requests. */
  visitorData?: string;
  /** BotGuard proof-of-origin token (Phase 4 PoToken). */
  poToken?: string;
}

/** Build the `/youtubei/v1/player` POST body. */
export function buildPlayerRequestBody(input: PlayerRequestInput): Record<string, unknown> {
  const client: Record<string, unknown> = {
    clientName: input.client.clientName,
    clientVersion: input.client.clientVersion,
    hl: input.hl ?? "en",
    gl: input.gl ?? "US",
  };
  if (input.visitorData) client.visitorData = input.visitorData;
  const body: Record<string, unknown> = {
    context: { client },
    videoId: input.videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  if (input.signatureTimestamp != null) {
    body.playbackContext = {
      contentPlaybackContext: { signatureTimestamp: input.signatureTimestamp },
    };
  }
  if (input.poToken) {
    body.serviceIntegrityDimensions = { poToken: input.poToken };
  }
  return body;
}

export type PlayerStatus = "ok" | "login-required" | "unplayable" | "age-restricted" | "error";

export interface PlayerDetails {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: number;
  thumbnailUrl?: string;
}

export interface PlayerResult {
  status: PlayerStatus;
  reason?: string;
  /** adaptiveFormats ++ progressive formats. */
  formats: YoutubeFormat[];
  details?: PlayerDetails;
  /** streamingData.expiresInSeconds — when the URLs stop working. */
  expiresInSeconds?: number;
}

function mapStatus(raw: string | undefined): PlayerStatus {
  switch (raw) {
    case "OK":
      return "ok";
    case "LOGIN_REQUIRED":
      return "login-required";
    case "AGE_CHECK_REQUIRED":
    case "CONTENT_CHECK_REQUIRED":
      return "age-restricted";
    case "UNPLAYABLE":
      return "unplayable";
    default:
      return "error";
  }
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Parse `/player` JSON into a verdict + formats. */
export function parsePlayerResponse(json: unknown): PlayerResult {
  const j = json as {
    playabilityStatus?: { status?: string; reason?: string };
    streamingData?: {
      adaptiveFormats?: YoutubeFormat[];
      formats?: YoutubeFormat[];
      expiresInSeconds?: string | number;
    };
    videoDetails?: {
      videoId?: string;
      title?: string;
      author?: string;
      lengthSeconds?: string | number;
      thumbnail?: { thumbnails?: Array<{ url?: string }> };
    };
  } | null;

  const sd = j?.streamingData;
  const formats: YoutubeFormat[] = [...(sd?.adaptiveFormats ?? []), ...(sd?.formats ?? [])];
  const vd = j?.videoDetails;
  const thumbs = vd?.thumbnail?.thumbnails ?? [];
  return {
    status: mapStatus(j?.playabilityStatus?.status),
    reason: j?.playabilityStatus?.reason,
    formats,
    details: vd
      ? {
          videoId: vd.videoId,
          title: vd.title,
          author: vd.author,
          lengthSeconds: num(vd.lengthSeconds),
          thumbnailUrl: thumbs[thumbs.length - 1]?.url,
        }
      : undefined,
    expiresInSeconds: num(sd?.expiresInSeconds),
  };
}
