import { useEffect, useMemo } from "react";
import type { Tab } from "@/components/nav/dock-nav";
import { useSettings } from "@/hooks/use-app-data";
import { isTypingTarget } from "@/lib/dom-keys";
import {
  createShortcutActionRunnerContext,
  isShortcutActionRunnable,
  openShortcutLyricsPanel,
  openShortcutVisualizerPanel,
  runShortcutAction,
  type ShortcutActionRunnerContext,
} from "@/shortcuts/actions";
import {
  currentPlatform,
  gestureFromEvent,
  matchAction,
  mergeBindings,
  sanitizeOverrides,
} from "@/shortcuts/engine";
import type { ShortcutScope } from "@/shortcuts/registry";
import { useNavStore } from "@/stores/nav-store";
import { useUiStore } from "@/stores/ui-store";

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

/**
 * Actions whose key, when HELD past {@link HOLD_DELAY_MS} (not tapped), opens a
 * Now-Playing settings panel — the keyboard twin of long-pressing the lyrics /
 * visualizer icon buttons. Keyed by the matched action id, so it follows a user's
 * rebind of C / V. The tap action still fires on a quick press-and-release.
 */
const HOLD_HANDLERS: Record<string, (ctx: ShortcutActionRunnerContext) => void> = {
  "lyrics.toggleStage": openShortcutLyricsPanel,
  "visualizer.cycleMode": openShortcutVisualizerPanel,
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
    const actionCtx = createShortcutActionRunnerContext(setTab);
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
          HOLD_HANDLERS[actionId]?.(actionCtx);
        }, HOLD_DELAY_MS);
        holding.set(e.code, entry);
        return;
      }

      if (!isShortcutActionRunnable(actionId)) return; // handled elsewhere (search overlay, gallery)
      // Let a focused button/link handle Space/Enter itself (no double-trigger).
      if (
        (e.key === " " || e.key === "Enter") &&
        e.target instanceof HTMLElement &&
        (e.target.tagName === "BUTTON" || e.target.tagName === "A")
      ) {
        return;
      }
      e.preventDefault();
      runShortcutAction(actionId, actionCtx);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const entry = holding.get(e.code);
      if (!entry) return;
      holding.delete(e.code);
      window.clearTimeout(entry.timer);
      if (entry.fired) return; // the hold already opened the panel → suppress the tap
      runShortcutAction(entry.actionId, actionCtx); // released early → it was a tap
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
