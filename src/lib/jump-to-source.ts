import type { JumpTarget } from "@/lib/playing-source";
import { armNowPlayingSourceCoverMorph } from "@/lib/source-cover-transition";
import { transitionState } from "@/lib/view-transition-react";
import { useNavStore } from "@/stores/nav-store";

export interface JumpNavActions {
  openOnlinePlaylist: ReturnType<typeof useNavStore.getState>["openOnlinePlaylist"];
  openSet: ReturnType<typeof useNavStore.getState>["openSet"];
  openSystemPlaylist: ReturnType<typeof useNavStore.getState>["openSystemPlaylist"];
}

export function dispatchJumpTarget(
  target: JumpTarget,
  nav: JumpNavActions = useNavStore.getState(),
): void {
  switch (target.kind) {
    case "set":
      nav.openSet(target.id, target.anchorTrackId);
      break;
    case "system-playlist":
      nav.openSystemPlaylist(target.id, target.anchorTrackId);
      break;
    case "online-playlist":
      nav.openOnlinePlaylist(target.playlist, target.anchorTrackId);
      break;
  }
}

export function jumpToSource(
  target: JumpTarget,
  nav: JumpNavActions = useNavStore.getState(),
  transition: (update: () => void) => void = transitionState,
): void {
  armNowPlayingSourceCoverMorph();
  transition(() => dispatchJumpTarget(target, nav));
}
