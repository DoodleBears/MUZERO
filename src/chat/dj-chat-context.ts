import type { MuzeroDB } from "@/db/muzero-db";
import { getPlayQueue, getSession, getTrack } from "@/db/repositories";

/**
 * A compact snapshot of what the listener is playing right now — the active 歌单
 * (set) and current track, each with its id — injected into the system prompt
 * every turn (see {@link createDjChatTransport}). It means the DJ always knows the
 * current context and can act on it (curate into the set, switch the track,
 * continue the vibe) without burning a `now_playing_get` tool call. Empty-safe.
 */
export async function buildNowPlayingContext(db: MuzeroDB): Promise<string> {
  const queue = await getPlayQueue(db);
  const total = queue.entries.length;
  if (total === 0) return "Now playing: nothing — the play queue is empty.";

  const index = Math.min(Math.max(queue.currentIndex, 0), total - 1);
  const currentId = queue.entries[index]?.trackId;
  const [track, set] = await Promise.all([
    currentId ? getTrack(currentId, db) : Promise.resolve(undefined),
    queue.contextSetId ? getSession(queue.contextSetId, db) : Promise.resolve(undefined),
  ]);

  const lines = ["Now playing (live context — you can reference these ids directly):"];
  if (set) {
    lines.push(
      `- Playing-from set (歌单): "${set.name.trim() || "Untitled set"}" (id: ${set.id}, ${set.trackIds.length} tracks).`,
    );
  }
  if (track) {
    lines.push(
      `- Current track: "${track.title.trim() || "Untitled"}" (id: ${track.id}), position ${index + 1} of ${total} in the queue.`,
    );
  } else {
    lines.push(`- Queue has ${total} tracks; currently at position ${index + 1}.`);
  }
  return lines.join("\n");
}
