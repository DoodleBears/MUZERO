/**
 * Bilibili playurl → playable VIDEO track selection — pure. Mirrors the audio picker
 * in {@link ./bili-resolve} but keyed on resolution. `/x/player/wbi/playurl` (with a
 * richer `fnval`, e.g. 4048) returns separate adaptive video tracks under
 * `dash.video[]`; a single resolution (qn `id`) is commonly offered in multiple codecs
 * (AVC / HEVC / AV1). We flatten them, tag the codec, pick by a target height with a
 * codec preference tie-break, and reuse the audio picker's CDN prioritization.
 *
 * No network here — the caller fetches `data`, this decides what to download. CDN URLs
 * still need a `Referer: https://www.bilibili.com` header at GET time (the desktop media
 * proxy injects it), but choosing the URL is pure.
 *
 * Codec preference defaults to AVC-first: that is a **container-compatibility** choice
 * (AVC + AAC copy cleanly into mp4 and always play in Chromium), NOT a quality ranking —
 * callers can override `codecPreference`. See the video-download PRD §4.1.
 */

import { prioritizeBiliUrls } from "./bili-resolve";

export type BiliVideoCodec = "avc" | "hevc" | "av1" | "other";

export interface BiliVideoStream {
  /** Bilibili quality code (qn): 16=360P, 64=720P, 80=1080P, 120=4K… */
  id: number;
  /** baseUrl + backupUrls, CDN-prioritized and deduped. First entry is preferred. */
  urls: string[];
  bandwidth: number;
  bitrateKbps: number;
  width?: number;
  height?: number;
  /** Rounded frames-per-second (Bilibili reports e.g. "59.940"). */
  frameRate?: number;
  mimeType?: string;
  codecs?: string;
  codec: BiliVideoCodec;
}

interface RawVideo {
  id?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  mimeType?: string;
  codecs?: string;
  codecid?: number;
  width?: number;
  height?: number;
  frameRate?: string | number;
  frame_rate?: string | number;
}

/** Classify a DASH video track's codec from its `codecs` string (falls back to codecid). */
export function videoCodecOf(codecs: string | undefined, codecid?: number): BiliVideoCodec {
  const c = (codecs ?? "").toLowerCase();
  if (c.startsWith("avc") || c.startsWith("h264")) return "avc";
  if (c.startsWith("hev") || c.startsWith("hvc") || c.startsWith("h265")) return "hevc";
  if (c.startsWith("av01") || c.startsWith("av1")) return "av1";
  // codecid: 7=AVC, 12=HEVC, 13=AV1 (Bilibili convention) — used when `codecs` is absent.
  if (codecid === 7) return "avc";
  if (codecid === 12) return "hevc";
  if (codecid === 13) return "av1";
  return "other";
}

function toFrameRate(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function toStream(raw: RawVideo): BiliVideoStream | null {
  const base = raw.baseUrl ?? raw.base_url ?? "";
  if (!base) return null;
  const backups = raw.backupUrl ?? raw.backup_url ?? [];
  const bandwidth = raw.bandwidth ?? 0;
  return {
    id: raw.id ?? 0,
    urls: prioritizeBiliUrls(base, backups),
    bandwidth,
    bitrateKbps: Math.round(bandwidth / 1000),
    width: raw.width,
    height: raw.height,
    frameRate: toFrameRate(raw.frameRate ?? raw.frame_rate),
    mimeType: raw.mimeType,
    codecs: raw.codecs,
    codec: videoCodecOf(raw.codecs, raw.codecid),
  };
}

/** Flatten the DASH video variants from a playurl `data` object into tagged streams. */
export function parseDashVideo(data: unknown): BiliVideoStream[] {
  const dash = (data as { dash?: Record<string, unknown> } | null)?.dash;
  if (!dash) return [];
  const out: BiliVideoStream[] = [];
  for (const raw of (dash.video as RawVideo[] | undefined) ?? []) {
    const s = toStream(raw);
    if (s) out.push(s);
  }
  return out;
}

const DEFAULT_CODEC_PREFERENCE: BiliVideoCodec[] = ["avc", "hevc", "av1", "other"];

export interface SelectVideoOptions {
  /** Cap the resolution (height in px). Omit/undefined = pick the highest available. */
  maxHeight?: number;
  /** Tie-break order among same-height variants. Defaults to AVC-first (mp4 copy). */
  codecPreference?: BiliVideoCodec[];
}

function heightOf(s: BiliVideoStream): number {
  return s.height ?? 0;
}

/**
 * Pick the best video track for a target height: prefer the highest height ≤ `maxHeight`
 * (downgrade from the cap); if everything is above the cap, take the lowest height
 * (minimal upgrade); with no cap, take the highest. Within the chosen height, order by
 * `codecPreference` then by highest bandwidth. Returns null only when there are none.
 */
export function selectVideoByResolution(
  streams: BiliVideoStream[],
  opts: SelectVideoOptions = {},
): BiliVideoStream | null {
  if (!streams.length) return null;
  const { maxHeight, codecPreference = DEFAULT_CODEC_PREFERENCE } = opts;

  const heights = [...new Set(streams.map(heightOf))].sort((a, b) => a - b);
  let targetHeight: number;
  if (maxHeight === undefined) {
    targetHeight = heights[heights.length - 1];
  } else {
    const eligible = heights.filter((h) => h <= maxHeight);
    targetHeight = eligible.length ? eligible[eligible.length - 1] : heights[0];
  }

  const codecRank = (codec: BiliVideoCodec): number => {
    const i = codecPreference.indexOf(codec);
    return i === -1 ? codecPreference.length : i;
  };

  return streams
    .filter((s) => heightOf(s) === targetHeight)
    .sort((a, b) => codecRank(a.codec) - codecRank(b.codec) || b.bandwidth - a.bandwidth)[0];
}
