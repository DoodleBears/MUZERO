import type { StreamPlaylist } from "./provider";

export const NETEASE_DAILY_PLAYLIST_ID = "__netease_daily_recommendations__";

export function isNeteaseDailyPlaylist(playlist: Pick<StreamPlaylist, "id" | "source">): boolean {
  return playlist.source === "netease" && playlist.id === NETEASE_DAILY_PLAYLIST_ID;
}
