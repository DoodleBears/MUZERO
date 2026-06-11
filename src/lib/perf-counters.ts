/**
 * Perf-audit counters for the dev/Settings perf HUD (memory-perf-audit PRD,
 * Phase 1). Named counters + a blob-URL census, surfaced as rows in
 * `DevPerfPanel` and (for DB re-queries) as debug entries in the trace ring so
 * copy-trace exports carry them.
 *
 * Everything is gated behind an explicit enable flag set by the HUD on mount —
 * when the panel is not mounted the instrumentation call sites cost one boolean
 * check and allocate nothing (PRD: "默认关闭时零开销").
 */
import { traceEvent } from "@/lib/trace";

let enabled = false;
const counts = new Map<string, number>();

export function setPerfCountersEnabled(on: boolean): void {
  enabled = on;
}

export function arePerfCountersEnabled(): boolean {
  return enabled;
}

/** Increment a named counter. No-op while the HUD is not mounted. */
export function bumpPerfCounter(name: string, delta = 1): void {
  if (!enabled) return;
  counts.set(name, (counts.get(name) ?? 0) + delta);
}

export function readPerfCounter(name: string): number {
  return counts.get(name) ?? 0;
}

export function resetPerfCounters(): void {
  counts.clear();
}

/**
 * Note one execution of a heavyweight DB query (`listAllTracks`-class full-table
 * reads). Counts toward the HUD's `db` row and lands in the trace ring at debug
 * level, so a copy-trace export shows how often a write burst re-ran the query
 * (finding F-3). No-op while the HUD is not mounted.
 */
export function noteDbRequery(query: string): void {
  if (!enabled) return;
  bumpPerfCounter(`db.${query}`);
  traceEvent("debug", "db", `${query} requery`);
}

// ----------------------------------------------------------- blob URL census --

const liveBlobUrls = new Set<string>();
let createdBlobUrls = 0;
let trackerRefs = 0;
let originalCreate: typeof URL.createObjectURL | null = null;
let originalRevoke: typeof URL.revokeObjectURL | null = null;

/** Live (created − revoked) and total-created object URLs while the tracker is on. */
export function blobUrlStats(): { live: number; created: number } {
  return { live: liveBlobUrls.size, created: createdBlobUrls };
}

/**
 * Wrap `URL.createObjectURL` / `URL.revokeObjectURL` with a census so the HUD
 * can show the live object-URL count — the unambiguous leak signal for blob:
 * leaks like F-1. Refcounted (StrictMode double-mounts install twice); the
 * returned uninstaller is idempotent and restores the originals when the last
 * consumer releases. Revokes of URLs created before install are ignored so the
 * live count never goes negative.
 */
export function installBlobUrlTracker(): () => void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return () => {};
  }
  if (trackerRefs === 0) {
    liveBlobUrls.clear();
    createdBlobUrls = 0;
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    originalCreate = create;
    originalRevoke = revoke;
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = create.call(URL, blob);
      liveBlobUrls.add(url);
      createdBlobUrls += 1;
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoke.call(URL, url);
      liveBlobUrls.delete(url);
    }) as typeof URL.revokeObjectURL;
  }
  trackerRefs += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackerRefs -= 1;
    if (trackerRefs > 0) return;
    if (originalCreate) URL.createObjectURL = originalCreate;
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
    originalCreate = null;
    originalRevoke = null;
    liveBlobUrls.clear();
  };
}
