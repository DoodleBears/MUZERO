import { useSyncExternalStore } from "react";
import {
  type DiagnosticContext,
  type DiagnosticEntry,
  type DiagnosticLevel,
  sanitizeDiagnosticData,
} from "@/lib/diagnostics";

export type TraceLevel = DiagnosticLevel;

export interface TraceEntry extends Omit<DiagnosticEntry, "event" | "context"> {
  id: number;
  at: number;
  level: TraceLevel;
  scope: string;
  event?: string;
  message: string;
  context?: DiagnosticContext;
  data?: unknown[];
}

const MAX_ENTRIES = 300;
let nextId = 1;
// Circular buffer: O(1) append. Every log.* call in src/** lands here (the
// console is only a dev mirror), so the previous copy-per-append
// (`[...entries].slice(-300)`) made each log line an O(300) allocation during
// write bursts (memory-perf-audit PRD F-L2). The immutable array consumers
// need is materialized lazily — once per append *generation*, and only when
// someone actually reads (panels closed → zero copies).
const ring: (TraceEntry | undefined)[] = new Array(MAX_ENTRIES);
let ringHead = 0;
let ringSize = 0;
let snapshotCache: TraceEntry[] | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Subscribe to ring appends (exported for non-React consumers; see useTraceEntries). */
export function subscribeTrace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): TraceEntry[] {
  if (snapshotCache) return snapshotCache;
  const out: TraceEntry[] = new Array(ringSize);
  for (let i = 0; i < ringSize; i++) {
    out[i] = ring[(ringHead + i) % MAX_ENTRIES] as TraceEntry;
  }
  snapshotCache = out;
  return out;
}

export function traceEvent(
  level: TraceLevel,
  scope: string,
  message: string,
  ...data: unknown[]
): void {
  appendTraceEntry({
    level,
    scope,
    message,
    data: data.length > 0 ? data.map((value) => sanitizeDiagnosticData(value)) : undefined,
  });
}

export function traceDiagnosticEvent(
  level: TraceLevel,
  scope: string,
  event: string,
  message: string,
  context?: DiagnosticContext,
): void {
  appendTraceEntry({
    level,
    scope,
    event,
    message,
    context: context ? (sanitizeDiagnosticData(context) as DiagnosticContext) : undefined,
  });
}

function appendTraceEntry(entry: Omit<TraceEntry, "id" | "at">): void {
  const full: TraceEntry = {
    id: nextId++,
    at: Date.now(),
    ...entry,
  };
  if (ringSize < MAX_ENTRIES) {
    ring[(ringHead + ringSize) % MAX_ENTRIES] = full;
    ringSize += 1;
  } else {
    ring[ringHead] = full;
    ringHead = (ringHead + 1) % MAX_ENTRIES;
  }
  snapshotCache = null;
  emit();
}

export function clearTrace(): void {
  ring.fill(undefined);
  ringHead = 0;
  ringSize = 0;
  snapshotCache = null;
  emit();
}

export function getTraceEntries(): TraceEntry[] {
  return snapshot();
}

export function useTraceEntries(): TraceEntry[] {
  return useSyncExternalStore(subscribeTrace, snapshot, snapshot);
}

export function formatTraceEntries(items: TraceEntry[] = snapshot()): string {
  return items.map(formatTraceEntry).join("\n");
}

function formatTraceEntry(entry: TraceEntry): string {
  const at = new Date(entry.at).toISOString();
  const data = entry.data?.length ? ` ${entry.data.map(formatValue).join(" ")}` : "";
  const event = entry.event ? ` ${entry.event}` : "";
  const context = entry.context ? ` ${formatContext(entry.context)}` : "";
  return `${at} ${entry.level.toUpperCase()} [${entry.scope}]${event} ${entry.message}${context}${data}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(sanitizeDiagnosticData(value));
  } catch {
    return String(value);
  }
}

function formatContext(context: DiagnosticContext): string {
  const parts = [
    context.traceId ? `trace=${context.traceId}` : null,
    context.trackId ? `track=${context.trackId}` : null,
    context.sessionId ? `session=${context.sessionId}` : null,
    context.sourceId ? `source=${context.sourceId}` : null,
    context.videoId ? `video=${context.videoId}` : null,
    context.category ? `category=${context.category}` : null,
    context.phase ? `phase=${context.phase}` : null,
    context.errorKind ? `errorKind=${context.errorKind}` : null,
    context.httpStatus ? `status=${context.httpStatus}` : null,
    context.requestHost ? `host=${context.requestHost}` : null,
    context.requestPathHash ? `path=${context.requestPathHash}` : null,
    typeof context.hasPot === "boolean" ? `hasPot=${context.hasPot}` : null,
    typeof context.hasCpn === "boolean" ? `hasCpn=${context.hasCpn}` : null,
    typeof context.hasSig === "boolean" ? `hasSig=${context.hasSig}` : null,
    typeof context.hasNParam === "boolean" ? `hasN=${context.hasNParam}` : null,
    typeof context.playerPoToken === "boolean" ? `playerPoToken=${context.playerPoToken}` : null,
    context.poTokenBinding ? `poTokenBinding=${context.poTokenBinding}` : null,
    context.safeQuery && Object.keys(context.safeQuery).length
      ? `safeQuery=${formatValue(context.safeQuery)}`
      : null,
    context.controlId ? `control=${context.controlId}` : null,
  ].filter(Boolean);
  return parts.join(" ");
}
