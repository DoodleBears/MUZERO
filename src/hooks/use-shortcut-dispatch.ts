import { useEffect, useMemo } from "react";
import type { Tab } from "@/components/nav/dock-nav";
import { getSettings, getTrack, saveSettings, setTrackLiked } from "@/db/repositories";
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
import { useLyricsPanelStore } from "@/stores/lyrics-panel-store";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { nextVisualizerPlacementPatch, resolveVisualizerPlacement } from "@/visualizer/placement";
import { resolveVisualizerStyle } from "@/visualizer/registry";

const VOLUME_STEP = 0.05;
const SEEK_STEP = 5;
/** Key-hold threshold — matches the icon buttons' `useLongPress` default. */
const HOLD_DELAY_MS = 500;

/**
 * The window keydown dispatcher resolves transport/global actions plus the
 * player-owned surfaces it can safely derive from shell state. Library/inspector
 * surfaces run their own capture-phase handlers and preempt this bubble-phase one,
 * so bare arrows stay "move/open/back" inside lists while Now Playing can own
 * ←/→ for previous/next.
 */
export function resolveDispatchScopes(tab: Tab, queueOpen: boolean): ReadonlySet<ShortcutScope> {
  const scopes = new Set<ShortcutScope>(["global"]);
  if (tab === "now") scopes.add("now");
  if (tab === "queue" || queueOpen) scopes.add("queue");
  return scopes;
}

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

async function toggleCurrentTrackLike(): Promise<void> {
  const s = usePlayerStore.getState();
  const current = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
  if (!current) return;
  const track = await getTrack(current.id);
  await setTrackLiked(current.id, !(track?.liked ?? current.liked));
}

/** Persisted toggle of the lyrics/memory right-rail mode (C). Read-modify-write on settings. */
async function toggleLyricsVisible(): Promise<void> {
  const s = await getSettings();
  const lyricsVisible = !(s.nowPlayingRightRailCollapsed ?? false);
  await saveSettings({
    lyricsStageOpen: !lyricsVisible,
    nowPlayingRightRailCollapsed: lyricsVisible,
  });
}

/** Advance the visualizer placement off→background→idle→off (V). */
async function cycleVisualizerPlacement(): Promise<void> {
  await saveSettings(nextVisualizerPlacementPatch(await getSettings()));
}

/** Hold-C: open the Now-Playing lyrics tuning panel (twin of long-pressing its button). */
function openLyricsPanel(): void {
  useLyricsPanelStore.getState().setOpen(true);
}

/**
 * Hold-V: open the visualizer tuning panel and — mirroring the icon button's
 * long-press — switch the visualizer on as a Now-Playing background if it's off.
 * `setOpen` runs first (synchronous) so the panel appears without waiting on the DB.
 */
function openVisualizerPanel(): void {
  useVisualizerPanelStore.getState().setOpen(true);
  void enableVisualizerIfOff();
}
async function enableVisualizerIfOff(): Promise<void> {
  const s = await getSettings();
  if (resolveVisualizerPlacement(s) !== "off") return;
  const style = resolveVisualizerStyle(s.visualizerStyle);
  await saveSettings({
    visualizerStyle: style === "off" ? "bars" : style,
    visualizerAsBackground: true,
    visualizerIdleOnly: false,
  });
}

/**
 * Actions whose key, when HELD past {@link HOLD_DELAY_MS} (not tapped), opens a
 * Now-Playing settings panel — the keyboard twin of long-pressing the lyrics /
 * visualizer icon buttons. Keyed by the matched action id, so it follows a user's
 * rebind of C / V. The tap action still fires on a quick press-and-release.
 */
const HOLD_HANDLERS: Record<string, () => void> = {
  "lyrics.toggleStage": openLyricsPanel,
  "visualizer.cycleMode": openVisualizerPanel,
};

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
  "playback.like": () => void toggleCurrentTrackLike(),
  "playback.toggleFullscreen": () => void toggleDocumentFullscreen(),
  "nav.tabNow": (ctx) => transitionState(() => ctx.setTab("now")),
  "nav.tabLibrary": (ctx) => transitionState(() => ctx.setTab("search")),
  "nav.tabSettings": (ctx) => transitionState(() => ctx.setTab("settings")),
  "queue.toggle": () => useUiStore.getState().toggleQueue(),
  "lyrics.toggleStage": () => void toggleLyricsVisible(),
  "visualizer.cycleMode": () => void cycleVisualizerPlacement(),
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
  const tab = useNavStore((s) => s.tab);
  const setTab = useNavStore((s) => s.setTab);
  const queueOpen = useUiStore((s) => s.queueOpen);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, currentPlatform())),
    [overrides],
  );
  const activeScopes = useMemo(() => resolveDispatchScopes(tab, queueOpen), [tab, queueOpen]);

  useEffect(() => {
    // Physical keys (by `code`) currently held that have a hold-twin: the tap
    // fires on release, the hold-twin once the key is held past HOLD_DELAY_MS.
    const holding = new Map<string, { actionId: string; timer: number; fired: boolean }>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.defaultPrevented) return;
      const actionId = matchAction(gestureFromEvent(e), activeScopes, bindings, currentPlatform());
      if (!actionId) return;

      // Hold-capable action (C / V): defer the tap and arm the hold-twin, so a
      // quick press toggles/cycles while a press-and-hold opens the settings panel.
      if (HOLD_HANDLERS[actionId]) {
        e.preventDefault();
        if (e.repeat || holding.has(e.code)) return; // ignore OS auto-repeat / re-entry
        const entry = { actionId, fired: false, timer: 0 };
        entry.timer = window.setTimeout(() => {
          entry.fired = true;
          HOLD_HANDLERS[actionId]?.();
        }, HOLD_DELAY_MS);
        holding.set(e.code, entry);
        return;
      }

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

    const onKeyUp = (e: KeyboardEvent) => {
      const entry = holding.get(e.code);
      if (!entry) return;
      holding.delete(e.code);
      window.clearTimeout(entry.timer);
      if (entry.fired) return; // the hold already opened the panel → suppress the tap
      GLOBAL_HANDLERS[entry.actionId]?.({ setTab }); // released early → it was a tap
    };

    // A held key whose window loses focus never gets a keyup — drop pending timers
    // so the panel doesn't spring open after the user has tabbed away.
    const cancelAll = () => {
      for (const entry of holding.values()) window.clearTimeout(entry.timer);
      holding.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", cancelAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", cancelAll);
      cancelAll();
    };
  }, [activeScopes, bindings, setTab]);
}
