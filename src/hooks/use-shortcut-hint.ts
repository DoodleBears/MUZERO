import { useCallback, useMemo } from "react";
import { useSettings } from "@/hooks/use-app-data";
import type { HintAction } from "@/lib/player-hints";
import {
  actionBindingChips,
  currentPlatform,
  mergeBindings,
  sanitizeOverrides,
} from "@/shortcuts/engine";
import type { ShortcutScope } from "@/shortcuts/registry";

const HINT_ACTION_TO_ID: Record<Exclude<HintAction, "volume">, string> = {
  play: "playback.toggle",
  prev: "playback.prev",
  next: "playback.next",
  repeat: "playback.cycleRepeat",
  shuffle: "playback.toggleShuffle",
  queue: "queue.toggle",
  like: "playback.like",
  lyrics: "lyrics.toggleStage",
  visualizer: "visualizer.cycleMode",
  memory: "memory.quickAdd",
};

/**
 * Returns `(action, options?) => string[]` — the Kbd caps of a transport tooltip,
 * read from the configurable registry so hints reflect the user's rebinds (live
 * via `useSettings`). Shows the FIRST binding per action within the optional
 * scope; "volume" shows the up + down chords side by side (not a chord).
 */
export function useShortcutHint(): (
  action: HintAction,
  options?: { scope?: ShortcutScope },
) => string[] {
  const overrides = useSettings().shortcutOverrides;
  const platform = useMemo(() => currentPlatform(), []);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, platform)),
    [overrides, platform],
  );
  return useCallback(
    (action: HintAction, options?: { scope?: ShortcutScope }) => {
      if (action === "volume") {
        const up =
          actionBindingChips("playback.volumeUp", bindings, platform, options?.scope)[0] ?? [];
        const down =
          actionBindingChips("playback.volumeDown", bindings, platform, options?.scope)[0] ?? [];
        return [...up, ...down];
      }
      return (
        actionBindingChips(HINT_ACTION_TO_ID[action], bindings, platform, options?.scope)[0] ?? []
      );
    },
    [bindings, platform],
  );
}
