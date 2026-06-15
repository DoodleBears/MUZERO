import type { Tab } from "@/components/nav/dock-nav";
import { getSettings, getTrack, saveSettings, setTrackLiked } from "@/db/repositories";
import type { AppSettings } from "@/db/types";
import { log } from "@/lib/logger";
import { tabForCycleShortcut } from "@/lib/shortcuts";
import { transitionState } from "@/lib/view-transition-react";
import type { RepeatMode } from "@/player/queue";
import { nextRepeatMode } from "@/player/transport";
import { useLyricsPanelStore } from "@/stores/lyrics-panel-store";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";
import { useVisualizerPanelStore } from "@/stores/visualizer-panel-store";
import { nextVisualizerPlacementPatch, resolveVisualizerPlacement } from "@/visualizer/placement";
import { resolveVisualizerStyle } from "@/visualizer/registry";
import { createTransportThrottle, TRANSPORT_SWITCH_MIN_INTERVAL_MS } from "./transport-throttle";

const VOLUME_STEP = 0.05;
const SEEK_STEP = 5;

// Holding the next/prev key repeats at the OS rate (~30/s). Cap it so the cover +
// background pipeline keeps up (no desync, no decode churn) and each cover is
// actually readable — leading edge keeps a single press instant, trailing edge
// makes the release always land. See transport-throttle.
const transportSwitchThrottle = createTransportThrottle(TRANSPORT_SWITCH_MIN_INTERVAL_MS, {
  now: () => Date.now(),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (id) => window.clearTimeout(id),
});

type ShortcutSettings = Partial<AppSettings>;

interface ShortcutTrackSnapshot {
  id: string;
  liked?: boolean;
}

export interface ShortcutPlayerActionState {
  togglePlay: () => void;
  next: () => void | Promise<void>;
  prev: () => void | Promise<void>;
  seek: (sec: number) => void;
  setVolume: (volume: number) => void;
  setRepeat: (mode: RepeatMode) => void;
  setShuffle: (on: boolean) => void;
  positionSec: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  currentIndex: number;
  queue: readonly ShortcutTrackSnapshot[];
}

export interface ShortcutActionRunnerContext {
  getPlayerState: () => ShortcutPlayerActionState;
  getTab: () => Tab;
  setTab: (tab: Tab) => void;
  transitionState: (fn: () => void) => void;
  toggleQueue: () => void;
  getSettings: () => Promise<ShortcutSettings>;
  saveSettings: (patch: Partial<AppSettings>) => Promise<unknown>;
  getTrack: (id: string) => Promise<{ liked?: boolean } | undefined>;
  setTrackLiked: (id: string, liked: boolean) => Promise<unknown>;
  setLyricsPanelOpen: (open: boolean) => void;
  setVisualizerPanelOpen: (open: boolean) => void;
  toggleDocumentFullscreen: () => void | Promise<void>;
}

type ShortcutActionHandler = (ctx: ShortcutActionRunnerContext) => void;

export function createShortcutActionRunnerContext(
  setTab: (tab: Tab) => void,
): ShortcutActionRunnerContext {
  return {
    getPlayerState: usePlayerStore.getState,
    getTab: () => useNavStore.getState().tab,
    setTab,
    transitionState,
    toggleQueue: () => useUiStore.getState().toggleQueue(),
    getSettings,
    saveSettings,
    getTrack,
    setTrackLiked,
    setLyricsPanelOpen: (open) => useLyricsPanelStore.getState().setOpen(open),
    setVisualizerPanelOpen: (open) => useVisualizerPanelStore.getState().setOpen(open),
    toggleDocumentFullscreen,
  };
}

export function isShortcutActionRunnable(actionId: string): boolean {
  return actionId in SHORTCUT_ACTION_HANDLERS;
}

/** All dispatchable shortcut action ids (used by the dev control endpoint's /actions). */
export function listShortcutActionIds(): string[] {
  return Object.keys(SHORTCUT_ACTION_HANDLERS);
}

export function runShortcutAction(actionId: string, ctx: ShortcutActionRunnerContext): boolean {
  const handler = SHORTCUT_ACTION_HANDLERS[actionId];
  if (!handler) return false;
  handler(ctx);
  return true;
}

export function openShortcutLyricsPanel(ctx: ShortcutActionRunnerContext): void {
  ctx.setLyricsPanelOpen(true);
}

export function openShortcutVisualizerPanel(ctx: ShortcutActionRunnerContext): void {
  ctx.setVisualizerPanelOpen(true);
  void enableVisualizerIfOff(ctx);
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

async function toggleCurrentTrackLike(ctx: ShortcutActionRunnerContext): Promise<void> {
  const s = ctx.getPlayerState();
  const current = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
  if (!current) return;
  const track = await ctx.getTrack(current.id);
  await ctx.setTrackLiked(current.id, !(track?.liked ?? current.liked ?? false));
}

/** Persisted toggle of the lyrics/memory right-rail mode (C). Read-modify-write on settings. */
async function toggleLyricsVisible(ctx: ShortcutActionRunnerContext): Promise<void> {
  const s = await ctx.getSettings();
  const lyricsVisible = !(s.nowPlayingRightRailCollapsed ?? false);
  await ctx.saveSettings({
    lyricsStageOpen: !lyricsVisible,
    nowPlayingRightRailCollapsed: lyricsVisible,
  });
}

/** Advance the visualizer placement off->background->idle->off (V). */
async function cycleVisualizerPlacement(ctx: ShortcutActionRunnerContext): Promise<void> {
  await ctx.saveSettings(nextVisualizerPlacementPatch((await ctx.getSettings()) as AppSettings));
}

async function enableVisualizerIfOff(ctx: ShortcutActionRunnerContext): Promise<void> {
  const s = await ctx.getSettings();
  if (resolveVisualizerPlacement(s as AppSettings) !== "off") return;
  const style = resolveVisualizerStyle(s.visualizerStyle);
  await ctx.saveSettings({
    visualizerStyle: style === "off" ? "bars" : style,
    visualizerAsBackground: true,
    visualizerIdleOnly: false,
    visualizerLyricsOnlyIdle: false,
  });
}

/** Imperative handler per shortcut action id. Reads state fresh per invocation. */
const SHORTCUT_ACTION_HANDLERS: Record<string, ShortcutActionHandler> = {
  "playback.toggle": (ctx) => ctx.getPlayerState().togglePlay(),
  "playback.next": (ctx) => transportSwitchThrottle(() => void ctx.getPlayerState().next()),
  "playback.prev": (ctx) => transportSwitchThrottle(() => void ctx.getPlayerState().prev()),
  "playback.seekForward": (ctx) => {
    const s = ctx.getPlayerState();
    s.seek(s.positionSec + SEEK_STEP);
  },
  "playback.seekBack": (ctx) => {
    const s = ctx.getPlayerState();
    s.seek(Math.max(0, s.positionSec - SEEK_STEP));
  },
  "playback.volumeUp": (ctx) => {
    const s = ctx.getPlayerState();
    s.setVolume(Math.min(1, s.volume + VOLUME_STEP));
  },
  "playback.volumeDown": (ctx) => {
    const s = ctx.getPlayerState();
    s.setVolume(Math.max(0, s.volume - VOLUME_STEP));
  },
  "playback.cycleRepeat": (ctx) => {
    const s = ctx.getPlayerState();
    s.setRepeat(nextRepeatMode(s.repeat));
  },
  "playback.toggleShuffle": (ctx) => {
    const s = ctx.getPlayerState();
    s.setShuffle(!s.shuffle);
  },
  "playback.like": (ctx) => void toggleCurrentTrackLike(ctx),
  "playback.toggleFullscreen": (ctx) => void ctx.toggleDocumentFullscreen(),
  "nav.tabNow": (ctx) => ctx.transitionState(() => ctx.setTab("now")),
  "nav.tabLibrary": (ctx) => ctx.transitionState(() => ctx.setTab("search")),
  "nav.tabSettings": (ctx) => ctx.transitionState(() => ctx.setTab("settings")),
  "nav.tabNext": (ctx) =>
    ctx.transitionState(() => ctx.setTab(tabForCycleShortcut(ctx.getTab(), 1))),
  "nav.tabPrev": (ctx) =>
    ctx.transitionState(() => ctx.setTab(tabForCycleShortcut(ctx.getTab(), -1))),
  "queue.toggle": (ctx) => ctx.toggleQueue(),
  "lyrics.toggleStage": (ctx) => void toggleLyricsVisible(ctx),
  "visualizer.cycleMode": (ctx) => void cycleVisualizerPlacement(ctx),
};
