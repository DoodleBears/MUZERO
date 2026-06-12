import type { SetDisplayMode } from "@/db/types";
import type { RepeatMode } from "@/player/queue";
import type { TrayActionId } from "./actions";

export interface TrayLabels {
  appName: string;
  currentPrefix: string;
  noTrack: string;
  previous: string;
  play: string;
  pause: string;
  next: string;
  like: string;
  unlike: string;
  repeat: string;
  repeatOff: string;
  repeatAll: string;
  repeatOne: string;
  displayMode: string;
  displayVideo: string;
  displayCover: string;
  openApp: string;
  openNowPlaying: string;
  settings: string;
  exit: string;
}

export interface TrayTrackSnapshot {
  id: string;
  title: string;
  subtitle?: string;
  liked: boolean;
}

export interface TraySnapshot {
  labels: TrayLabels;
  currentTrack?: TrayTrackSnapshot;
  isPlaying: boolean;
  repeat: RepeatMode;
  displayMode: SetDisplayMode;
}

export type TrayMenuItem =
  | {
      type: "normal";
      id: string;
      label: string;
      action: TrayActionId;
      enabled: boolean;
    }
  | {
      type: "checkbox";
      id: string;
      label: string;
      action: TrayActionId;
      enabled: boolean;
      checked: boolean;
    }
  | {
      type: "submenu";
      id: string;
      label: string;
      items: TrayMenuItem[];
    }
  | {
      type: "separator";
      id: string;
    };

export interface TrayMenuModel {
  tooltip: string;
  items: TrayMenuItem[];
}

export function buildTrayMenuModel(snapshot: TraySnapshot): TrayMenuModel {
  const { currentTrack, labels } = snapshot;
  const hasCurrentTrack = Boolean(currentTrack);
  const currentLabel = currentTrack
    ? `${labels.currentPrefix}: ${joinTitleSubtitle(currentTrack.title, currentTrack.subtitle)}`
    : labels.noTrack;

  return {
    tooltip: currentTrack ? `${labels.appName} - ${currentTrack.title}` : labels.appName,
    items: [
      normal("current", currentLabel, "nav.now", hasCurrentTrack),
      separator("after-current"),
      normal("previous", labels.previous, "playback.prev", hasCurrentTrack),
      normal("playback", snapshot.isPlaying ? labels.pause : labels.play, "playback.toggle", {
        enabled: hasCurrentTrack,
      }),
      normal("next", labels.next, "playback.next", hasCurrentTrack),
      checkbox(
        "like",
        currentTrack?.liked ? labels.unlike : labels.like,
        "track.toggleLike",
        currentTrack?.liked ?? false,
        hasCurrentTrack,
      ),
      separator("after-playback"),
      submenu("repeat", labels.repeat, [
        checkbox("repeat-off", labels.repeatOff, "playback.repeat.off", snapshot.repeat === "off"),
        checkbox("repeat-all", labels.repeatAll, "playback.repeat.all", snapshot.repeat === "all"),
        checkbox("repeat-one", labels.repeatOne, "playback.repeat.one", snapshot.repeat === "one"),
      ]),
      submenu("display-mode", labels.displayMode, [
        checkbox(
          "display-video",
          labels.displayVideo,
          "display.mode.video",
          snapshot.displayMode === "video",
        ),
        checkbox(
          "display-cover",
          labels.displayCover,
          "display.mode.cover",
          snapshot.displayMode === "cover",
        ),
      ]),
      separator("after-options"),
      normal("open", labels.openApp, "window.show"),
      normal("open-now", labels.openNowPlaying, "nav.now"),
      normal("settings", labels.settings, "nav.settings"),
      separator("after-open"),
      normal("exit", labels.exit, "app.quit"),
    ],
  };
}

function joinTitleSubtitle(title: string, subtitle?: string): string {
  const trimmedSubtitle = subtitle?.trim();
  return trimmedSubtitle ? `${title} - ${trimmedSubtitle}` : title;
}

function normal(
  id: string,
  label: string,
  action: TrayActionId,
  options?: boolean | { enabled?: boolean },
): TrayMenuItem {
  const enabled = typeof options === "boolean" ? options : (options?.enabled ?? true);
  return { type: "normal", id, label, action, enabled };
}

function checkbox(
  id: string,
  label: string,
  action: TrayActionId,
  checked: boolean,
  enabled = true,
): TrayMenuItem {
  return { type: "checkbox", id, label, action, checked, enabled };
}

function submenu(id: string, label: string, items: TrayMenuItem[]): TrayMenuItem {
  return { type: "submenu", id, label, items };
}

function separator(id: string): TrayMenuItem {
  return { type: "separator", id };
}
