import { useCallback, useMemo } from "react";
import { useSettings } from "@/hooks/use-app-data";
import type { HintAction } from "@/lib/player-hints";
import {
  actionBindingChips,
  currentPlatform,
  mergeBindings,
  sanitizeOverrides,
} from "@/shortcuts/engine";

const HINT_ACTION_TO_ID: Record<Exclude<HintAction, "volume">, string> = {
  play: "playback.toggle",
  prev: "playback.prev",
  next: "playback.next",
  repeat: "playback.cycleRepeat",
  shuffle: "playback.toggleShuffle",
};

/**
 * Returns `(action) => string[]` — the Kbd caps of a transport tooltip, read from
 * the configurable registry so hints reflect the user's rebinds (live via
 * `useSettings`). Shows the FIRST binding per action; "volume" shows the up + down
 * chords side by side (not a chord).
 */
export function useShortcutHint(): (action: HintAction) => string[] {
  const overrides = useSettings().shortcutOverrides;
  const platform = useMemo(() => currentPlatform(), []);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, platform)),
    [overrides, platform],
  );
  return useCallback(
    (action: HintAction) => {
      if (action === "volume") {
        const up = actionBindingChips("playback.volumeUp", bindings, platform)[0] ?? [];
        const down = actionBindingChips("playback.volumeDown", bindings, platform)[0] ?? [];
        return [...up, ...down];
      }
      return actionBindingChips(HINT_ACTION_TO_ID[action], bindings, platform)[0] ?? [];
    },
    [bindings, platform],
  );
}
