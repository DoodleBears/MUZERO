import { useEffect, useMemo } from "react";
import type { Tab } from "@/components/nav/dock-nav";
import { useSettings } from "@/hooks/use-app-data";
import { isTypingTarget } from "@/lib/dom-keys";
import { log } from "@/lib/logger";
import { transitionState } from "@/lib/view-transition-react";
import { nextRepeatMode } from "@/player/transport";
import {
  currentPlatform,
  gestureFromEvent,
  matchAction,
  mergeBindings,
  sanitizeOverrides,
} from "@/shortcuts/engine";
import type { ShortcutScope } from "@/shortcuts/registry";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";

const VOLUME_STEP = 0.05;
const SEEK_STEP = 5;

/**
 * The global keydown dispatcher resolves only `global`-scope actions; the more
 * specific surfaces (`library` / `inspector`) run their own capture-phase handlers
 * and preempt this bubble-phase one (they `stopImmediatePropagation` / set
 * `defaultPrevented`), exactly as before — so bare ↑/↓ stays "move focus" inside a
 * list and "volume" everywhere else without this hook needing to know.
 */
const GLOBAL_SCOPES: ReadonlySet<ShortcutScope> = new Set<ShortcutScope>(["global"]);

async function toggleDocumentFullscreen(): Promise<void> {
  if (!document.fullscreenEnabled) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  } catch (error) {
    log.warn("shortcuts.fullscreen", "Unable to toggle document fullscreen", error);
  }
}

interface DispatchContext {
  setTab: (tab: Tab) => void;
}

/** Imperative handler per global action id. Reads the store fresh per keypress. */
const GLOBAL_HANDLERS: Record<string, (ctx: DispatchContext) => void> = {
  "playback.toggle": () => usePlayerStore.getState().togglePlay(),
  "playback.next": () => void usePlayerStore.getState().next(),
  "playback.prev": () => void usePlayerStore.getState().prev(),
  "playback.seekForward": () => {
    const s = usePlayerStore.getState();
    s.seek(s.positionSec + SEEK_STEP);
  },
  "playback.seekBack": () => {
    const s = usePlayerStore.getState();
    s.seek(Math.max(0, s.positionSec - SEEK_STEP));
  },
  "playback.volumeUp": () => {
    const s = usePlayerStore.getState();
    s.setVolume(Math.min(1, s.volume + VOLUME_STEP));
  },
  "playback.volumeDown": () => {
    const s = usePlayerStore.getState();
    s.setVolume(Math.max(0, s.volume - VOLUME_STEP));
  },
  "playback.cycleRepeat": () => {
    const s = usePlayerStore.getState();
    s.setRepeat(nextRepeatMode(s.repeat));
  },
  "playback.toggleShuffle": () => {
    const s = usePlayerStore.getState();
    s.setShuffle(!s.shuffle);
  },
  "playback.toggleFullscreen": () => void toggleDocumentFullscreen(),
  "nav.tabNow": (ctx) => transitionState(() => ctx.setTab("now")),
  "nav.tabLibrary": (ctx) => transitionState(() => ctx.setTab("search")),
  "nav.tabSettings": (ctx) => transitionState(() => ctx.setTab("settings")),
};

/**
 * Global keyboard-shortcut dispatch — transport + tab navigation, resolved through
 * the configurable registry (so user overrides take effect live). Wired once from
 * App. Reads the player store imperatively per keypress (no re-subscription), never
 * fires while typing or when another handler already consumed the key, and lets a
 * focused button/link own Space/Enter.
 */
export function useShortcutDispatch(): void {
  const overrides = useSettings().shortcutOverrides;
  const setTab = useNavStore((s) => s.setTab);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, currentPlatform())),
    [overrides],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      const actionId = matchAction(gestureFromEvent(e), GLOBAL_SCOPES, bindings, currentPlatform());
      if (!actionId) return;
      const handler = GLOBAL_HANDLERS[actionId];
      if (!handler) return; // a global action handled elsewhere (search overlay, gallery cycle)
      // Let a focused button/link handle Space/Enter itself (no double-trigger).
      if (
        (e.key === " " || e.key === "Enter") &&
        e.target instanceof HTMLElement &&
        (e.target.tagName === "BUTTON" || e.target.tagName === "A")
      ) {
        return;
      }
      e.preventDefault();
      handler({ setTab });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindings, setTab]);
}
