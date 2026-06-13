import type { Track } from "@/db/types";
import { arePerfCountersEnabled, bumpPerfCounter, notePerfWork } from "@/lib/perf-counters";
import { traceEvent } from "@/lib/trace";

export type CoverRenderSurface =
  | "background"
  | "cover"
  | "coverflow"
  | "entity"
  | "now-playing"
  | "row"
  | "search"
  | "settings";

export type CoverRenderCacheEvent = "cache-hit" | "cache-miss";
export type CoverSourceKind = "local-cover" | "remote-cover";

export interface CoverRenderTraceContext {
  sourceKind?: CoverSourceKind;
  trackId?: Track["id"];
  sourceKey?: string | null;
  cropped?: boolean;
  bytes?: number;
  mime?: string;
}

export function noteCoverRenderCache(
  event: CoverRenderCacheEvent,
  surface: CoverRenderSurface,
  context: CoverRenderTraceContext = {},
): void {
  if (!arePerfCountersEnabled()) return;
  bumpPerfCounter(`cover.render.${surface}.${event}`);
  traceEvent("debug", "cover.render", event, {
    ...context,
    surface,
  });
}

export function noteCoverWork(
  name: string,
  startedAt: number,
  context?: Record<string, unknown>,
): void {
  if (!arePerfCountersEnabled()) return;
  notePerfWork(name, performance.now() - startedAt, context);
}
