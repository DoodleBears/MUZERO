import type { StreamSourceId, Track } from "@/db/types";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { parseBareStreamId, parseStreamLink, type StreamLinkRef } from "@/streamsrc/stream-link";

const BILI_ID_WITH_SEPARATED_CID_RE = /^(BV[0-9A-Za-z]{8,}|av\d+)\s+(\d+)$/i;
const VIDEO_SOURCES = new Set<StreamSourceId>(["bili", "youtube"]);

export type VideoRequestRejectReason =
  | "not-a-video-ref"
  | "unsupported-source"
  | "unresolved"
  | "too-long";

export type VideoRequestPlan =
  | { kind: "play-local"; track: Track }
  | { kind: "download-online"; ref: StreamLinkRef; hit: StreamSearchHit }
  | {
      kind: "rejected";
      reason: VideoRequestRejectReason;
      durationSec?: number;
      maxSec?: number;
    };

export interface ResolvePartRefDeps {
  fetchFirstPartExternalId?: (externalId: string) => Promise<string | undefined>;
}

export interface PlanVideoRequestDeps extends ResolvePartRefDeps {
  maxDurationSec?: number;
  findLocal: (source: StreamSourceId, externalId: string) => Promise<Track | undefined>;
  fetchHit: (ref: StreamLinkRef) => Promise<StreamSearchHit | undefined>;
}

export function normalizeVideoRequestBody(body: string): string {
  const trimmed = body.trim();
  const match = trimmed.match(BILI_ID_WITH_SEPARATED_CID_RE);
  return match ? `${match[1]}#${match[2]}` : trimmed;
}

export function withinRequestDurationLimit(
  durationSec: number | undefined,
  maxSec?: number,
): boolean {
  if (!Number.isFinite(durationSec)) return true;
  if (!Number.isFinite(maxSec) || (maxSec ?? 0) <= 0) return true;
  return (durationSec as number) <= (maxSec as number);
}

export async function resolvePartRef(
  ref: StreamLinkRef,
  deps: ResolvePartRefDeps,
): Promise<StreamLinkRef> {
  if (ref.source !== "bili" || ref.kind !== "song" || ref.id.includes("#")) return ref;
  const firstPart = await deps.fetchFirstPartExternalId?.(ref.id);
  return firstPart ? { ...ref, id: firstPart } : ref;
}

export async function planVideoRequest(
  body: string,
  deps: PlanVideoRequestDeps,
): Promise<VideoRequestPlan> {
  const normalized = normalizeVideoRequestBody(body);
  const parsed = parseStreamLink(normalized) ?? parseBareStreamId(normalized);
  if (parsed?.kind !== "song") return { kind: "rejected", reason: "not-a-video-ref" };
  if (!VIDEO_SOURCES.has(parsed.source)) {
    return { kind: "rejected", reason: "unsupported-source" };
  }

  const ref = await resolvePartRef(parsed, deps);
  const local = await deps.findLocal(ref.source, ref.id);
  if (local) return { kind: "play-local", track: local };

  const hit = await deps.fetchHit(ref);
  if (!hit) return { kind: "rejected", reason: "unresolved" };
  if (!withinRequestDurationLimit(hit.durationSec, deps.maxDurationSec)) {
    return {
      kind: "rejected",
      reason: "too-long",
      durationSec: hit.durationSec,
      maxSec: deps.maxDurationSec,
    };
  }
  return { kind: "download-online", ref, hit };
}
