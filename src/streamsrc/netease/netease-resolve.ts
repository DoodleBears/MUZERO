/**
 * Parse NetEase `/api/song/enhance/player/url/v1` (eapi) responses into a playback
 * verdict — pure. The endpoint answers with a `code` + a `data` object/array whose
 * `url` may be blank (VIP / region-locked / removed), a `freeTrialInfo` marking a
 * 30s preview clip, and a `fee` flag. The network layer turns this verdict into a
 * media load, a login prompt, or a "can't play here" toast.
 */

export const NETEASE_PLAYER_URL_PATH = "/api/song/enhance/player/url/v1";

export type NeteaseQuality =
  | "standard"
  | "higher"
  | "exhigh"
  | "lossless"
  | "hires"
  | "jyeffect"
  | "sky"
  | "jymaster";

/** eapi request params for one song at a quality level (encodeType hints FLAC). */
export function neteasePlaybackBody(songId: number | string, level: NeteaseQuality | string) {
  return { ids: `[${songId}]`, level, encodeType: "flac" };
}

export type NeteasePlaybackResult =
  | { kind: "success"; url: string; type?: string; sizeBytes?: number; preview: boolean }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: "vip" | "unavailable" }
  | { kind: "failure"; reason: string };

function cleanString(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed === "" || trimmed.toLowerCase() === "null" ? "" : trimmed;
}

function httpsUpgrade(url: string): string {
  return url.startsWith("http://") ? `https://${url.slice("http://".length)}` : url;
}

function extractData(root: Record<string, unknown>): Record<string, unknown> | null {
  const data = root.data;
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  if (data && typeof data === "object") return data as Record<string, unknown>;
  return null;
}

/** Turn a raw response (object or JSON string) into a playback verdict. */
export function parseNeteasePlayback(raw: string | object): NeteasePlaybackResult {
  let root: Record<string, unknown>;
  try {
    root = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
  } catch {
    return { kind: "failure", reason: "invalid-json" };
  }

  const code = typeof root.code === "number" ? root.code : -1;
  if (code === 301) return { kind: "requires-login" };

  const data = extractData(root);
  if (!data) return { kind: "failure", reason: code === 200 ? "no-data" : `code-${code}` };

  const url = httpsUpgrade(cleanString(data.url));
  if (url) {
    const type = cleanString(data.type) || undefined;
    const sizeBytes = typeof data.size === "number" && data.size > 0 ? data.size : undefined;
    return { kind: "success", url, type, sizeBytes, preview: data.freeTrialInfo != null };
  }

  // url null + a fee OR a free-trial privilege = VIP/paid: anonymous gets no stream,
  // it needs a logged-in (subscribed) session. NetEase signals VIP via either `fee`
  // or a `freeTrialPrivilege` object (newer responses use the latter even with fee 0).
  const fee = typeof data.fee === "number" ? data.fee : 0;
  if (fee > 0 || data.freeTrialPrivilege != null) return { kind: "no-permission", reason: "vip" };
  if (code === 404) return { kind: "no-permission", reason: "unavailable" };
  return { kind: "failure", reason: "no-url" };
}
