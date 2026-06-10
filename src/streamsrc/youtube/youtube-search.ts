/**
 * Pure InnerTube search mapping — request body + a recursive extractor for the
 * `/youtubei/v1/search` response. YouTube's response is deeply + variably nested, so
 * rather than walk a fixed path we recursively collect every `videoRenderer` node
 * (robust to layout drift). Each becomes a source-agnostic {@link StreamSearchHit}.
 */

import type { StreamSearchHit } from "../provider";
import {
  buildPlayerRequestBody,
  type InnertubeClient,
  type PlayerRequestInput,
} from "./youtube-innertube";

/** Build the `/search` body — same context shape as `/player`, with the query. */
export function buildSearchRequestBody(
  query: string,
  client: InnertubeClient,
  opts?: Pick<PlayerRequestInput, "hl" | "gl" | "visitorData">,
): Record<string, unknown> {
  // Reuse the player body builder for the context, then swap videoId→query.
  const base = buildPlayerRequestBody({ videoId: "", client, ...opts });
  const {
    videoId: _drop,
    contentCheckOk: _c,
    racyCheckOk: _r,
    ...rest
  } = base as Record<string, unknown>;
  return { ...rest, query };
}

interface RawVideoRenderer {
  videoId?: string;
  title?: { simpleText?: string; runs?: Array<{ text?: string }> };
  lengthText?: { simpleText?: string };
  ownerText?: { runs?: Array<{ text?: string }> };
  longBylineText?: { runs?: Array<{ text?: string }> };
  thumbnail?: { thumbnails?: Array<{ url?: string }> };
}

function runsText(
  node: { simpleText?: string; runs?: Array<{ text?: string }> } | undefined,
): string {
  if (!node) return "";
  if (node.simpleText) return node.simpleText;
  return (node.runs ?? []).map((r) => r.text ?? "").join("");
}

/** "3:45" / "1:02:03" → seconds. */
export function parseDurationText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const parts = text.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function videoRendererToHit(raw: RawVideoRenderer): StreamSearchHit | null {
  if (!raw.videoId) return null;
  const thumbs = raw.thumbnail?.thumbnails ?? [];
  return {
    source: "youtube",
    externalId: raw.videoId,
    title: runsText(raw.title),
    artist: runsText(raw.ownerText) || runsText(raw.longBylineText) || undefined,
    durationSec: parseDurationText(raw.lengthText?.simpleText),
    coverUrl: thumbs[thumbs.length - 1]?.url,
  };
}

/** Recursively collect every `videoRenderer` in the response, in document order. */
export function parseSearchResults(json: unknown, limit = 30): StreamSearchHit[] {
  const hits: StreamSearchHit[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (hits.length >= limit || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const renderer = obj.videoRenderer as RawVideoRenderer | undefined;
    if (renderer) {
      const hit = videoRendererToHit(renderer);
      if (hit && !seen.has(hit.externalId)) {
        seen.add(hit.externalId);
        hits.push(hit);
      }
    }
    for (const value of Object.values(obj)) walk(value);
  };
  walk(json);
  return hits.slice(0, limit);
}
