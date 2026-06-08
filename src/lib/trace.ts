import { useSyncExternalStore } from "react";

export type TraceLevel = "debug" | "info" | "warn" | "error";

export interface TraceEntry {
  id: number;
  at: number;
  level: TraceLevel;
  scope: string;
  message: string;
  data?: unknown[];
}

const MAX_ENTRIES = 300;
let nextId = 1;
let entries: TraceEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): TraceEntry[] {
  return entries;
}

export function traceEvent(
  level: TraceLevel,
  scope: string,
  message: string,
  ...data: unknown[]
): void {
  entries = [
    ...entries,
    {
      id: nextId++,
      at: Date.now(),
      level,
      scope,
      message,
      data: data.length > 0 ? data : undefined,
    },
  ].slice(-MAX_ENTRIES);
  emit();
}

export function clearTrace(): void {
  entries = [];
  emit();
}

export function useTraceEntries(): TraceEntry[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function formatTraceEntries(items: TraceEntry[] = entries): string {
  return items.map(formatTraceEntry).join("\n");
}

function formatTraceEntry(entry: TraceEntry): string {
  const at = new Date(entry.at).toISOString();
  const data = entry.data?.length ? ` ${entry.data.map(formatValue).join(" ")}` : "";
  return `${at} ${entry.level.toUpperCase()} [${entry.scope}] ${entry.message}${data}`;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`.trim();
  if (value instanceof Event) return value.type;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, jsonReplacer);
  } catch {
    return String(value);
  }
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Event) return { type: value.type };
  if (value instanceof Element) {
    return {
      tagName: value.tagName,
      id: value.id || undefined,
      className: typeof value.className === "string" ? value.className || undefined : undefined,
    };
  }
  return value;
}
