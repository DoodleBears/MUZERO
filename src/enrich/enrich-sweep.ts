/**
 * Library enrichment sweep — a background queue that backfills genre for every eligible
 * track the user never played, so imported songs get enriched proactively (not only when
 * they reach the Now-Playing stage). Mirrors the "process once, negative-cache the miss,
 * never reprocess unless manually cleared" discipline of lyrics auto-fetch.
 *
 * NO persistent job table (unlike downloads): the `enrichments` table IS the durable state —
 * a track with any enrichment row (found OR notFound) is "done". So the work-list is simply
 * "eligible tracks with no enrichment row", re-derivable from the DB on every launch → the
 * sweep is restart-safe and self-healing for free. Manual "re-enrich" = clear the row (it
 * re-enters the work-list). Module-scope singleton (not store state) so it can't trigger
 * per-frame re-renders (rule 6); its DB writes hit the `enrichments` table only (no list fan-out).
 *
 * Gentle by construction: one track at a time, gated by `autoEnrich`, MusicBrainz rate-limited
 * inside the provider plus an inter-track delay, abortable. A big library trickles over minutes
 * to hours in the background — never blocking playback (network + tiny enrichments writes).
 */

import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { log } from "@/lib/logger";
import { runAutoEnrich } from "./auto-enrich";
import { buildEnrichmentQuery } from "./build-query";
import type { MetadataEnrichmentProvider } from "./provider";
import { resolveEnrichmentProvider } from "./registry";

export interface EnrichSweepStatus {
  running: boolean;
  /** Eligible un-enriched tracks this run set out to process. */
  total: number;
  /** How many have been processed so far. */
  done: number;
  /** total − done. */
  remaining: number;
}

const IDLE: EnrichSweepStatus = { running: false, total: 0, done: 0, remaining: 0 };
/** Defer the boot sweep so it never competes with first paint / startup work. */
const SWEEP_START_DELAY_MS = 20_000;
/** Small gap between tracks on top of the provider's own rate limiting. */
const DEFAULT_INTER_TRACK_DELAY_MS = 1000;

let running = false;
let abort: AbortController | null = null;
let status: EnrichSweepStatus = IDLE;

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Eligible tracks with no enrichment row yet. One streaming pass over `tracks`, holding only
 * the (typically small) work subset — generated tracks and rows missing title/artist are
 * filtered out up front so the sweep never wastes a DB read gating them one by one.
 */
export async function collectEnrichmentWorkList(db: MuzeroDB = defaultDb): Promise<string[]> {
  const enriched = new Set((await db.enrichments.orderBy("trackId").keys()) as string[]);
  const work: string[] = [];
  await db.tracks.each((t) => {
    if (enriched.has(t.id)) return;
    if (t.origin === "generated") return;
    if (buildEnrichmentQuery(t) === null) return;
    work.push(t.id);
  });
  return work;
}

export interface EnrichSweepOptions {
  db?: MuzeroDB;
  getSettings?: () => Promise<AppSettings>;
  resolveProvider?: (s: AppSettings) => MetadataEnrichmentProvider;
  /** Process at most this many (E2E / batched runs). Unbounded when omitted. */
  limit?: number;
  interTrackDelayMs?: number;
  /** Injected delay for deterministic tests; defaults to real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  now?: number;
  onProgress?: (s: EnrichSweepStatus) => void;
}

/**
 * Run one sweep over the current un-enriched work-list. No-op (returns current status) if a
 * sweep is already running or `autoEnrich` is off. Loads each track fresh right before
 * processing (it may have been deleted / already enriched by the now-playing trigger).
 */
export async function runEnrichmentSweep(
  opts: EnrichSweepOptions = {},
): Promise<EnrichSweepStatus> {
  if (running) return status;
  const db = opts.db ?? defaultDb;
  const readSettings = opts.getSettings ?? getSettings;
  const settings = await readSettings();
  if (settings.autoEnrich === false) return status; // respect the visible toggle
  const resolveProvider = opts.resolveProvider ?? resolveEnrichmentProvider;
  const provider = resolveProvider(settings);
  const sleep = opts.sleep ?? realSleep;
  const delay = opts.interTrackDelayMs ?? DEFAULT_INTER_TRACK_DELAY_MS;

  running = true;
  abort = new AbortController();
  const { getTrack } = await import("@/db/repositories");
  try {
    const allWork = await collectEnrichmentWorkList(db);
    const work = opts.limit != null ? allWork.slice(0, opts.limit) : allWork;
    status = { running: true, total: work.length, done: 0, remaining: work.length };
    opts.onProgress?.(status);
    log.info("enrich", "sweep start", { total: work.length });

    for (const trackId of work) {
      if (abort.signal.aborted) break;
      const track = await getTrack(trackId, db);
      if (track) {
        await runAutoEnrich({
          track,
          settings,
          provider,
          signal: abort.signal,
          db,
          now: opts.now,
        });
      }
      const done = status.done + 1;
      status = { running: true, total: status.total, done, remaining: status.total - done };
      opts.onProgress?.(status);
      if (abort.signal.aborted) break;
      if (delay > 0) await sleep(delay);
    }
  } catch (err) {
    log.warn("enrich", "sweep failed", err);
  } finally {
    running = false;
    status = { ...status, running: false };
    opts.onProgress?.(status);
    log.info("enrich", "sweep done", { done: status.done, total: status.total });
  }
  return status;
}

/** Abort an in-progress sweep (settles after the current track). */
export function stopEnrichmentSweep(): void {
  abort?.abort();
}

export function getEnrichmentSweepStatus(): EnrichSweepStatus {
  return status;
}

/**
 * Boot scheduler: kick off a deferred background sweep after startup settles. Gated by
 * `autoEnrich` inside {@link runEnrichmentSweep}. Returns a cleanup that cancels the pending
 * start + stops any running sweep (App.tsx `useEffect`).
 */
export function startEnrichmentSweepScheduler(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    timer = null;
    void runEnrichmentSweep().catch((err) => log.warn("enrich", "boot sweep failed", err));
  }, SWEEP_START_DELAY_MS);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    stopEnrichmentSweep();
  };
}
