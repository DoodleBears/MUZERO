/**
 * Playback-loading indicator. Surfaces the song-switch load/download
 * ({@link PlayerState.playbackLoading}) as a left-stack toast — the second source of
 * "background media progress" alongside {@link download-indicator} / sync-indicator.
 *
 * Threshold-gated: a load that finishes within {@link PLAYBACK_LOADING_TOAST_THRESHOLD_MS}
 * shows NOTHING (instant local / cached switches stay quiet — the Dock cover spinner is
 * the immediate feedback). A slower load (streamed download-before-play) gets a toast with
 * real byte progress once `playbackLoading.progress` starts advancing.
 *
 * The reconcile lifecycle is pure + injectable (view / t / timer) so it unit-tests with a
 * manual clock; `startPlaybackIndicator` wires the real notify + player-store subscription.
 */

import i18n from "@/i18n/i18n";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import type { PlaybackSourceKind } from "@/streamsrc/source-detect";

/** ~人感知卡顿 量级：低于此的加载不弹通知（避免瞬时切歌噪音）。 */
export const PLAYBACK_LOADING_TOAST_THRESHOLD_MS = 800;

/** The slice of `PlaybackLoadingState` the reconciler reads. */
export interface PlaybackLoadingLike {
  trackId: string;
  title: string;
  sourceKind: PlaybackSourceKind;
  /** 0..1 byte progress of download-before-play, when known. */
  progress?: number;
}

/** Minimal notification surface the reconciler needs (injectable for tests). */
export interface PlaybackIndicatorView {
  loading: (message: string, opts?: { progress?: number }) => string;
  update: (id: string, patch: { message?: string; progress?: number }) => void;
  dismiss: (id: string) => void;
}

export interface PlaybackReconcilerDeps {
  view: PlaybackIndicatorView;
  t: (key: string, opts?: Record<string, unknown>) => string;
  thresholdMs: number;
  setTimer: (cb: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

function labelFor(deps: PlaybackReconcilerDeps, loading: PlaybackLoadingLike): string {
  return loading.sourceKind === "remote"
    ? deps.t("player.loadingRemote", { title: loading.title })
    : deps.t("player.loadingTrack", { title: loading.title });
}

/**
 * Stateful reconciler fed each `playbackLoading` change. Arms a threshold timer on the
 * first non-null tick; if loading clears before it fires → nothing shown. Once shown,
 * updates progress in place and dismisses when loading clears.
 */
export function createPlaybackReconciler(
  deps: PlaybackReconcilerDeps,
): (loading: PlaybackLoadingLike | null) => void {
  let timerId: number | null = null;
  let toastId: string | null = null;
  let pending: PlaybackLoadingLike | null = null;

  return (loading) => {
    if (!loading) {
      // Finished / cancelled — drop a pending timer and/or the shown toast.
      if (timerId !== null) {
        deps.clearTimer(timerId);
        timerId = null;
      }
      if (toastId !== null) {
        deps.view.dismiss(toastId);
        toastId = null;
      }
      pending = null;
      return;
    }

    if (toastId !== null) {
      // Already showing — keep label + progress fresh (progress advancing, or track changed).
      deps.view.update(toastId, { message: labelFor(deps, loading), progress: loading.progress });
      return;
    }

    // Not yet shown: remember the latest snapshot and arm the threshold once.
    pending = loading;
    if (timerId === null) {
      timerId = deps.setTimer(() => {
        timerId = null;
        if (!pending) return;
        toastId = deps.view.loading(labelFor(deps, pending), { progress: pending.progress });
      }, deps.thresholdMs);
    }
  };
}

let started = false;

/** Subscribe playback loading to the notification stack. Idempotent (StrictMode-safe). */
export function startPlaybackIndicator(): void {
  if (started) return;
  started = true;
  const reconcile = createPlaybackReconciler({
    view: notify,
    t: (key, opts) => i18n.t(key as never, opts as never) as unknown as string,
    thresholdMs: PLAYBACK_LOADING_TOAST_THRESHOLD_MS,
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (id) => window.clearTimeout(id),
  });
  usePlayerStore.subscribe((state, prev) => {
    if (state.playbackLoading !== prev.playbackLoading) reconcile(state.playbackLoading);
  });
}
