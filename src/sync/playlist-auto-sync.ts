/**
 * Auto-sync for sets bound to an external playlist/favlist (`streamPlaylistRef`). Mirrors the
 * cloud {@link ./auto-sync-scheduler.ts} pattern: a PURE {@link shouldSyncPlaylist} decision
 * (exhaustively unit-tested) + an injectable scheduler so the tick loop runs deterministically
 * in tests. The "last synced" baseline is tracked IN-MEMORY per launch (like the cloud one) so
 * `app-start` fires exactly once per app launch and interval cadences re-baseline at launch —
 * the persisted `DjSession.lastAutoSyncAt` is a display-only record written by the sync runner.
 */
import type { DjSession, PlaylistAutoSyncFrequency } from "@/db/types";

export const PLAYLIST_SYNC_APP_START_DELAY_MS = 30_000;
export const PLAYLIST_SYNC_FAILURE_BACKOFF_BASE_MS = 15 * 60_000;
export const PLAYLIST_SYNC_FAILURE_BACKOFF_MAX_MS = 6 * 60 * 60_000;

const INTERVAL_MS_BY_FREQUENCY = {
  "15min": 15 * 60_000,
  "30min": 30 * 60_000,
  "60min": 60 * 60_000,
} as const satisfies Partial<Record<PlaylistAutoSyncFrequency, number>>;

export interface PlaylistSyncDecisionInput {
  set: Pick<DjSession, "streamPlaylistRef" | "autoSyncFrequency">;
  isRunning: boolean;
  isVisible: boolean;
  isOnline: boolean;
  now: number;
  appStartedAt: number;
  jitterMs: number;
  /** In-memory baseline of the last sync this launch (undefined = not yet synced this launch). */
  lastAutoSyncStartedAt?: number;
  consecutiveFailures?: number;
}

export function shouldSyncPlaylist(input: PlaylistSyncDecisionInput): boolean {
  const frequency = input.set.autoSyncFrequency ?? "manual";
  if (frequency === "manual") return false;
  if (!input.set.streamPlaylistRef) return false;
  if (input.isRunning || !input.isVisible || !input.isOnline) return false;
  if (isInFailureBackoff(input)) return false;

  if (frequency === "app-start") {
    if (input.lastAutoSyncStartedAt != null) return false;
    return input.now >= input.appStartedAt + PLAYLIST_SYNC_APP_START_DELAY_MS + input.jitterMs;
  }

  const interval = INTERVAL_MS_BY_FREQUENCY[frequency];
  if (!interval) return false;
  const last = input.lastAutoSyncStartedAt ?? input.appStartedAt;
  return input.now >= last + interval + input.jitterMs;
}

function isInFailureBackoff(input: PlaylistSyncDecisionInput): boolean {
  const failures = input.consecutiveFailures ?? 0;
  if (failures <= 0 || input.lastAutoSyncStartedAt == null) return false;
  const backoff = Math.min(
    PLAYLIST_SYNC_FAILURE_BACKOFF_BASE_MS * 2 ** failures,
    PLAYLIST_SYNC_FAILURE_BACKOFF_MAX_MS,
  );
  return input.now < input.lastAutoSyncStartedAt + backoff;
}

export interface PlaylistAutoSyncSchedulerDeps {
  appStartedAt?: number;
  intervalMs?: number;
  getSets: () => Promise<DjSession[]>;
  /** True while an interactive (manual) sync of this set is already in flight. */
  isSetRunning: (setId: string) => boolean;
  isVisible: () => boolean;
  isOnline: () => boolean;
  now: () => number;
  jitterMs: (setId: string) => number;
  /** Run the actual sync (fetch playlist → add new items → optional download) for a set. */
  syncSet: (setId: string) => Promise<void>;
  setTimer?: (handler: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
  onError?: (error: unknown) => void;
}

export interface PlaylistAutoSyncScheduler {
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

export function createPlaylistAutoSyncScheduler(
  deps: PlaylistAutoSyncSchedulerDeps,
): PlaylistAutoSyncScheduler {
  const appStartedAt = deps.appStartedAt ?? deps.now();
  const intervalMs = deps.intervalMs ?? 60_000;
  const lastAutoSyncStartedAt = new Map<string, number>();
  const consecutiveFailures = new Map<string, number>();
  /** In-flight re-entrancy guard — a long sync must not be re-fired by the next tick. */
  const running = new Set<string>();
  let timer: number | undefined;

  const tick = async (): Promise<void> => {
    const sets = await deps.getSets();
    const now = deps.now();
    for (const set of sets) {
      if (running.has(set.id)) continue;
      const due = shouldSyncPlaylist({
        set,
        isRunning: deps.isSetRunning(set.id),
        isVisible: deps.isVisible(),
        isOnline: deps.isOnline(),
        now,
        appStartedAt,
        jitterMs: deps.jitterMs(set.id),
        lastAutoSyncStartedAt: lastAutoSyncStartedAt.get(set.id),
        consecutiveFailures: consecutiveFailures.get(set.id),
      });
      if (!due) continue;
      lastAutoSyncStartedAt.set(set.id, now);
      running.add(set.id);
      try {
        await deps.syncSet(set.id);
        consecutiveFailures.delete(set.id);
      } catch (error) {
        consecutiveFailures.set(set.id, (consecutiveFailures.get(set.id) ?? 0) + 1);
        deps.onError?.(error);
      } finally {
        running.delete(set.id);
      }
    }
  };

  return {
    tick,
    start() {
      if (timer != null) return;
      const run = () => void tick().catch((error) => deps.onError?.(error));
      timer = deps.setTimer?.(run, intervalMs) ?? window.setInterval(run, intervalMs);
      run();
    },
    stop() {
      if (timer == null) return;
      const clearTimer = deps.clearTimer ?? window.clearInterval;
      clearTimer(timer);
      timer = undefined;
    },
  };
}
