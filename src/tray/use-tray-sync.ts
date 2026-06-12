import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { Tab } from "@/components/nav/dock-nav";
import { db } from "@/db/muzero-db";
import { setTrackLiked } from "@/db/repositories";
import type { SetDisplayMode, Track } from "@/db/types";
import { type DesktopBridge, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import type { RepeatMode } from "@/player/queue";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { dispatchTrayAction, type TrayActionContext, type TrayCurrentTrackState } from "./actions";
import { buildTrayMenuModel, type TrayLabels } from "./menu-model";
import { buildTraySnapshotFromPlayback } from "./snapshot";

interface TrayPlayerActions {
  togglePlay: () => void;
  prev: () => Promise<void>;
  next: () => Promise<void>;
  setRepeat: (mode: RepeatMode) => void;
  setDisplayMode: (mode: SetDisplayMode) => Promise<void>;
}

export interface CreateTrayActionContextDeps {
  bridge: Pick<DesktopBridge, "windowControls">;
  getCurrentTrack: () => TrayCurrentTrackState | null;
  getPlayer: () => TrayPlayerActions;
  setTab: (tab: Tab) => void;
  setTrackLiked: (trackId: string, liked: boolean) => Promise<void> | void;
}

export function useTraySync() {
  const { t } = useTranslation();
  const bridge = useMemo(() => resolveDesktopBridge(), []);
  const tray = bridge.tray;
  const labels = useMemo<TrayLabels>(
    () => ({
      appName: "MUZERO",
      currentPrefix: t("tray.currentPrefix"),
      noTrack: t("tray.noTrack"),
      previous: t("player.previous"),
      play: t("player.play"),
      pause: t("player.pause"),
      next: t("player.next"),
      like: t("tray.like"),
      unlike: t("tray.unlike"),
      repeat: t("player.repeatLabel"),
      repeatOff: t("settings.repeatOff"),
      repeatAll: t("settings.repeatAll"),
      repeatOne: t("settings.repeatOne"),
      displayMode: t("tray.displayMode"),
      displayVideo: t("displayMode.video"),
      displayCover: t("displayMode.cover"),
      openApp: t("tray.openApp"),
      openNowPlaying: t("tray.openNowPlaying"),
      settings: t("nav.settings"),
      exit: t("tray.exit"),
    }),
    [t],
  );
  const playback = usePlayerStore(
    useShallow((state) => {
      const currentTrack =
        state.currentIndex >= 0
          ? (state.queue[state.currentIndex] as Track | undefined)
          : undefined;
      return {
        currentTrack,
        displayMode: state.displayMode,
        isPlaying: state.isPlaying,
        repeat: state.repeat,
      };
    }),
  );
  const liked =
    useLiveQuery(
      async () =>
        playback.currentTrack ? (await db.tracks.get(playback.currentTrack.id))?.liked : undefined,
      [playback.currentTrack?.id],
      playback.currentTrack?.liked,
    ) ?? playback.currentTrack?.liked;
  const currentRef = useRef<TrayCurrentTrackState | null>(null);

  useEffect(() => {
    currentRef.current = playback.currentTrack
      ? {
          id: playback.currentTrack.id,
          liked: liked ?? playback.currentTrack.liked,
        }
      : null;
  }, [liked, playback.currentTrack]);

  useEffect(() => {
    if (!tray) return;
    const snapshot = buildTraySnapshotFromPlayback({
      labels,
      currentTrack: playback.currentTrack,
      liked,
      isPlaying: playback.isPlaying,
      repeat: playback.repeat,
      displayMode: playback.displayMode,
    });
    const model = buildTrayMenuModel(snapshot);
    void tray.update(model).catch((error: unknown) => {
      log.warn("tray", "failed to update native tray menu", error);
    });
  }, [labels, liked, playback, tray]);

  useEffect(() => {
    if (!tray?.onAction) return;
    const context = createTrayActionContext({
      bridge,
      getCurrentTrack: () => currentRef.current,
      getPlayer: () => usePlayerStore.getState(),
      setTab: (tab) => useNavStore.getState().setTab(tab),
      setTrackLiked,
    });
    return tray.onAction((actionId) => {
      void dispatchTrayAction(actionId, context).catch((error: unknown) => {
        log.warn("tray", "failed to dispatch native tray action", error);
      });
    });
  }, [bridge, tray]);
}

export function createTrayActionContext(deps: CreateTrayActionContextDeps): TrayActionContext {
  return {
    showWindow: () => deps.bridge.windowControls?.showFromTray?.(),
    quitApp: () => deps.bridge.windowControls?.quitApp?.(),
    setTab: deps.setTab,
    togglePlay: () => deps.getPlayer().togglePlay(),
    prev: () => deps.getPlayer().prev(),
    next: () => deps.getPlayer().next(),
    setRepeat: (mode) => deps.getPlayer().setRepeat(mode),
    setDisplayMode: (mode) => deps.getPlayer().setDisplayMode(mode),
    getCurrentTrack: deps.getCurrentTrack,
    setTrackLiked: deps.setTrackLiked,
  };
}
