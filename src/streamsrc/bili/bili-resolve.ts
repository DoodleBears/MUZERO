/**
 * Bilibili playurl → playable audio selection — pure. `/x/player/wbi/playurl`
 * (with `fnval` enabling DASH) returns separate adaptive audio tracks under
 * `dash.audio[]` (normal), `dash.dolby.audio[]`, and `dash.flac.audio` (lossless /
 * Hi-Res). We flatten them into one tagged list, pick by the user's quality
 * preference with a graceful downgrade/upgrade, and prioritize CDN mirrors.
 *
 * No network here — the caller fetches `data`, this decides what to play. CDN URLs
 * still need a `Referer: https://www.bilibili.com` header at GET time (the desktop
 * media proxy injects it), but choosing the URL is pure.
 */

export type BiliQualityKey = "dolby" | "hires" | "lossless" | "high" | "medium" | "low";

export type BiliQualityTag = "dolby" | "hires" | "lossless" | "normal";

export interface BiliAudioStream {
  id: number;
  /** baseUrl + backupUrls, CDN-prioritized and deduped. First entry is preferred. */
  urls: string[];
  bandwidth: number;
  bitrateKbps: number;
  mimeType?: string;
  codecs?: string;
  qualityTag: BiliQualityTag;
}

// Hi-Res FLAC vs plain lossless is a bitrate call (NeriPlayer uses the same split).
const HIRES_MIN_KBPS = 1000;
const HIGH_MIN_KBPS = 180;
const MEDIUM_MIN_KBPS = 120;

interface RawAudio {
  id?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
  bandwidth?: number;
  mimeType?: string;
  codecs?: string;
}

function toStream(raw: RawAudio, tag: BiliQualityTag): BiliAudioStream | null {
  const base = raw.baseUrl ?? raw.base_url ?? "";
  if (!base) return null;
  const backups = raw.backupUrl ?? raw.backup_url ?? [];
  const bandwidth = raw.bandwidth ?? 0;
  const bitrateKbps = Math.round(bandwidth / 1000);
  const resolvedTag =
    tag === "hires" ? (bitrateKbps >= HIRES_MIN_KBPS ? "hires" : "lossless") : tag;
  return {
    id: raw.id ?? 0,
    urls: prioritizeBiliUrls(base, backups),
    bandwidth,
    bitrateKbps,
    mimeType: raw.mimeType,
    codecs: raw.codecs,
    qualityTag: resolvedTag,
  };
}

/** Flatten the DASH audio variants from a playurl `data` object into tagged streams. */
export function parseDashAudio(data: unknown): BiliAudioStream[] {
  const dash = (data as { dash?: Record<string, unknown> } | null)?.dash;
  if (!dash) return [];
  const out: BiliAudioStream[] = [];

  for (const raw of (dash.audio as RawAudio[] | undefined) ?? []) {
    const s = toStream(raw, "normal");
    if (s) out.push(s);
  }
  const dolby = (dash.dolby as { audio?: RawAudio[] } | undefined)?.audio ?? [];
  for (const raw of dolby) {
    const s = toStream(raw, "dolby");
    if (s) out.push(s);
  }
  const flac = (dash.flac as { audio?: RawAudio } | undefined)?.audio;
  if (flac) {
    const s = toStream(flac, "hires"); // toStream demotes to "lossless" if < 1000 kbps
    if (s) out.push(s);
  }
  return out;
}

const DOWNGRADE_ORDER: BiliQualityKey[] = ["dolby", "hires", "lossless", "high", "medium", "low"];

function matchesTier(stream: BiliAudioStream, key: BiliQualityKey): boolean {
  switch (key) {
    case "dolby":
      return stream.qualityTag === "dolby";
    case "hires":
      return stream.qualityTag === "hires";
    case "lossless":
      return stream.qualityTag === "lossless";
    case "high":
      return stream.qualityTag === "normal" && stream.bitrateKbps >= HIGH_MIN_KBPS;
    case "medium":
      return (
        stream.qualityTag === "normal" &&
        stream.bitrateKbps >= MEDIUM_MIN_KBPS &&
        stream.bitrateKbps < HIGH_MIN_KBPS
      );
    case "low":
      return stream.qualityTag === "normal" && stream.bitrateKbps < MEDIUM_MIN_KBPS;
  }
}

function bestOfTier(streams: BiliAudioStream[], key: BiliQualityKey): BiliAudioStream | null {
  const matches = streams.filter((s) => matchesTier(s, key));
  if (!matches.length) return null;
  return matches.reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
}

/**
 * Pick the stream matching `preferred`, else walk DOWN the quality ladder, else
 * walk UP, else the highest-bandwidth stream. Returns null only when there are none.
 */
export function selectAudioByPreference(
  streams: BiliAudioStream[],
  preferred: BiliQualityKey,
): BiliAudioStream | null {
  if (!streams.length) return null;
  const start = DOWNGRADE_ORDER.indexOf(preferred);
  for (let i = start; i < DOWNGRADE_ORDER.length; i += 1) {
    const hit = bestOfTier(streams, DOWNGRADE_ORDER[i]);
    if (hit) return hit;
  }
  for (let i = start - 1; i >= 0; i -= 1) {
    const hit = bestOfTier(streams, DOWNGRADE_ORDER[i]);
    if (hit) return hit;
  }
  return [...streams].reduce((a, b) => (b.bandwidth > a.bandwidth ? b : a));
}

// upos mirrors are the most reliable; mountaintoys is a last-resort fallback CDN.
function hostRank(url: string): number {
  if (/upos-[a-z]+-/.test(url)) return 0;
  if (url.includes("upos")) return 1;
  if (url.includes("mountaintoys")) return 3;
  return 2;
}

/** Order `[base, ...backups]` by CDN preference; dedupe and drop empties. */
export function prioritizeBiliUrls(primary: string, backups: readonly string[]): string[] {
  const all = [primary, ...backups].filter((u) => u && u.length > 0);
  const unique = [...new Set(all)];
  return unique
    .map((url, i) => ({ url, i }))
    .sort((a, b) => hostRank(a.url) - hostRank(b.url) || a.i - b.i)
    .map((x) => x.url);
}
