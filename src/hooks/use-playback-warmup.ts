import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { playbackCacheLimitBytes } from "@/player/playback-cache";
import { PLAYBACK_PRELOAD_AHEAD, warmPlaybackPreload } from "@/player/playback-preload";
import { usePlayerStore } from "@/stores/player-store";

const PLAYBACK_WARMUP_DELAY_MS = 180;

export function usePlaybackWarmup(): void {
  const settings = useSettings();
  const { currentIndex, queue, repeat, shuffle } = usePlayerStore(
    useShallow((s) => ({
      currentIndex: s.currentIndex,
      queue: s.queue,
      repeat: s.repeat,
      shuffle: s.shuffle,
    })),
  );
  const coverCropped = settings.coverCropped ?? true;
  const cacheMaxBytes = playbackCacheLimitBytes(settings);
  const warmBacklight = settings.nowPlayingCoverEffectMode === "backlight";
  const playbackModeKey = `${repeat}:${shuffle}`;

  useEffect(() => {
    void playbackModeKey;
    if (currentIndex < 0 || currentIndex >= queue.length) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const state = usePlayerStore.getState();
      const current = state.queue[state.currentIndex];
      const previous = state.peekTrack("prev");
      const upcoming = state.peekUpcomingTracks(PLAYBACK_PRELOAD_AHEAD);
      const coverTracks = [current, previous, ...upcoming].filter((track): track is Track =>
        Boolean(track),
      );
      // Warm media for BOTH directions: upcoming (next, prioritized) + previous. Without
      // the previous track's audio warmed, a back-nav / prev-swipe cold-reads the blob on
      // the switch frame (only its cover was warmed). Forward cold-switch is already near-
      // zero after the OPFS root-handle cache; this closes the prev-direction gap.
      const mediaTracks = [...upcoming, previous].filter((track): track is Track => Boolean(track));

      void warmPlaybackPreload(
        { coverTracks, mediaTracks },
        {
          cacheMaxBytes,
          coverCropped,
          signal: controller.signal,
          warmBacklight,
        },
      );
    }, PLAYBACK_WARMUP_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentIndex, queue, playbackModeKey, cacheMaxBytes, coverCropped, warmBacklight]);
}
