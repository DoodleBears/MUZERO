import type { MuzeroDB } from "@/db/muzero-db";
import { getPlayQueue, getSession, getTrack, listSessions } from "@/db/repositories";
import { type DjChatLocalIdRegistry, encodeSetRef, encodeTrackRef } from "./dj-chat-local-ids";

/**
 * A compact snapshot of what the listener is playing right now — the active 歌单
 * (set) and current track, each with its id — injected into the system prompt
 * every turn (see {@link createDjChatTransport}). It means the DJ always knows the
 * current context and can act on it (curate into the set, switch the track,
 * continue the vibe) without burning a `now_playing_get` tool call. Empty-safe.
 */
export async function buildNowPlayingContext(
  db: MuzeroDB,
  localIds?: DjChatLocalIdRegistry,
): Promise<string> {
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
    const setRef = localIds ? encodeSetRef(set.id, localIds) : set.id;
    lines.push(
      `- Playing-from set (歌单): "${set.name.trim() || "Untitled set"}" (id: ${setRef}, ${set.trackIds.length} tracks).`,
    );
  }
  if (track) {
    const trackRef = localIds
      ? encodeTrackRef(track.id, localIds, set ? { setId: set.id } : undefined)
      : track.id;
    lines.push(
      `- Current track: "${track.title.trim() || "Untitled"}" (id: ${trackRef}), position ${index + 1} of ${total} in the queue.`,
    );
  } else {
    lines.push(`- Queue has ${total} tracks; currently at position ${index + 1}.`);
  }
  return lines.join("\n");
}

/** How many sets to list inline before pointing the DJ at `set_list` for the rest. */
export const SETS_CONTEXT_LIMIT = 40;

/**
 * A compact list of the listener's existing 歌单 (name + id + track count), injected
 * each turn so the DJ can REUSE a matching set instead of creating a near-duplicate
 * (and can reference set ids without a `set_list` call). Newest-updated first,
 * capped to {@link SETS_CONTEXT_LIMIT}. Empty string when there are no sets.
 */
export async function buildSetsContext(
  db: MuzeroDB,
  localIds?: DjChatLocalIdRegistry,
  limit: number = SETS_CONTEXT_LIMIT,
): Promise<string> {
  const sessions = await listSessions(db);
  if (sessions.length === 0) return "";
  const lines = [
    "Your existing sets (歌单) — reuse a matching one (set_add_tracks) before creating a duplicate:",
  ];
  for (const session of sessions.slice(0, limit)) {
    const ref = localIds ? encodeSetRef(session.id, localIds) : session.id;
    lines.push(
      `- "${session.name.trim() || "Untitled set"}" (id: ${ref}, ${session.trackIds.length} tracks)`,
    );
  }
  if (sessions.length > limit) {
    lines.push(`- …and ${sessions.length - limit} more — use set_list to see the rest.`);
  }
  return lines.join("\n");
}
