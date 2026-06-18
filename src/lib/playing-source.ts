import type { Track } from "@/db/types";
import type { SystemPlaylistId } from "@/lib/system-playlists";
import type { QueueSource } from "@/stores/player-store";
import type { StreamPlaylist } from "@/streamsrc/provider";

export type JumpTarget =
  | { kind: "set"; id: string; anchorTrackId: string }
  | { kind: "system-playlist"; id: SystemPlaylistId; anchorTrackId: string }
  | { kind: "online-playlist"; playlist: StreamPlaylist; anchorTrackId: string };

export function resolvePlayingSource(input: {
  queueSource: QueueSource | undefined;
  activeSessionId: string | null;
  currentIndex: number;
  queue: Track[];
}): JumpTarget | null {
  const track =
    input.currentIndex >= 0 && input.currentIndex < input.queue.length
      ? input.queue[input.currentIndex]
      : undefined;
  if (!input.queueSource || !track) return null;

  switch (input.queueSource.kind) {
    case "set":
      return { kind: "set", id: input.queueSource.setId, anchorTrackId: track.id };
    case "system-playlist":
      return { kind: "system-playlist", id: input.queueSource.id, anchorTrackId: track.id };
    case "online-playlist":
      return {
        kind: "online-playlist",
        playlist: input.queueSource.playlist,
        anchorTrackId: track.id,
      };
  }
}
