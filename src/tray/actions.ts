import type { Tab } from "@/components/nav/dock-nav";
import type { SetDisplayMode } from "@/db/types";
import type { RepeatMode } from "@/player/queue";

export const TRAY_ACTION_IDS = [
  "window.show",
  "window.hide",
  "app.quit",
  "nav.now",
  "nav.settings",
  "playback.toggle",
  "playback.prev",
  "playback.next",
  "track.toggleLike",
  "playback.repeat.off",
  "playback.repeat.all",
  "playback.repeat.one",
  "display.mode.video",
  "display.mode.cover",
] as const;

export type TrayActionId = (typeof TRAY_ACTION_IDS)[number];

const TRAY_ACTION_SET = new Set<string>(TRAY_ACTION_IDS);

export function isTrayActionId(value: unknown): value is TrayActionId {
  return typeof value === "string" && TRAY_ACTION_SET.has(value);
}

export interface TrayCurrentTrackState {
  id: string;
  liked: boolean;
}

export interface TrayActionContext {
  showWindow: () => Promise<void> | void;
  quitApp: () => Promise<void> | void;
  setTab: (tab: Tab) => void;
  togglePlay: () => Promise<void> | void;
  prev: () => Promise<void> | void;
  next: () => Promise<void> | void;
  setRepeat: (mode: RepeatMode) => Promise<void> | void;
  setDisplayMode: (mode: SetDisplayMode) => Promise<void> | void;
  getCurrentTrack: () => TrayCurrentTrackState | null;
  setTrackLiked: (trackId: string, liked: boolean) => Promise<void> | void;
}

export async function dispatchTrayAction(
  actionId: unknown,
  context: TrayActionContext,
): Promise<boolean> {
  if (!isTrayActionId(actionId)) return false;

  switch (actionId) {
    case "window.show":
      await context.showWindow();
      return true;
    case "window.hide":
      return true;
    case "app.quit":
      await context.quitApp();
      return true;
    case "nav.now":
      await context.showWindow();
      context.setTab("now");
      return true;
    case "nav.settings":
      await context.showWindow();
      context.setTab("settings");
      return true;
    case "playback.toggle":
      await context.togglePlay();
      return true;
    case "playback.prev":
      await context.prev();
      return true;
    case "playback.next":
      await context.next();
      return true;
    case "track.toggleLike": {
      const current = context.getCurrentTrack();
      if (!current) return false;
      await context.setTrackLiked(current.id, !current.liked);
      return true;
    }
    case "playback.repeat.off":
      await context.setRepeat("off");
      return true;
    case "playback.repeat.all":
      await context.setRepeat("all");
      return true;
    case "playback.repeat.one":
      await context.setRepeat("one");
      return true;
    case "display.mode.video":
      await context.setDisplayMode("video");
      return true;
    case "display.mode.cover":
      await context.setDisplayMode("cover");
      return true;
  }
}
