/**
 * Pure 播放列表(Play Queue) operations — no DB, no DOM. Operate on a
 * {@link PlayQueueState} (entries + currentIndex) and return a new one, keeping
 * `currentIndex` pointing at the same logical track across edits. The Dexie repo
 * and the player store build on these; exhaustively unit-tested (hard rule #7).
 *
 * The play queue is DECOUPLED from any 歌单(Set): you load a set into it, push
 * tracks ("play next"), remove, reorder. See the data-model PRD.
 */

import type { PlayQueueEntry } from "@/db/types";

export interface PlayQueueState {
  entries: PlayQueueEntry[];
  currentIndex: number;
}

/** Id of the entry the cursor currently points at, if any. */
function currentId(state: PlayQueueState): string | undefined {
  return state.entries[state.currentIndex]?.id;
}

/**
 * Re-derive currentIndex after an edit: follow `keepId` if it survived,
 * otherwise clamp `fallback` into range (-1 when empty).
 */
function reindex(entries: PlayQueueEntry[], keepId: string | undefined, fallback: number): number {
  if (entries.length === 0) return -1;
  if (keepId) {
    const i = entries.findIndex((e) => e.id === keepId);
    if (i >= 0) return i;
  }
  return Math.min(Math.max(0, fallback), entries.length - 1);
}

/** Append entries to the end. The cursor stays on the same track. */
export function appendEntries(state: PlayQueueState, newEntries: PlayQueueEntry[]): PlayQueueState {
  const entries = [...state.entries, ...newEntries];
  return { entries, currentIndex: reindex(entries, currentId(state), state.currentIndex) };
}

/** Insert entries right after the current track (play-next). Appends if idle. */
export function insertNext(state: PlayQueueState, newEntries: PlayQueueEntry[]): PlayQueueState {
  const at = state.currentIndex < 0 ? state.entries.length : state.currentIndex + 1;
  const entries = [...state.entries.slice(0, at), ...newEntries, ...state.entries.slice(at)];
  return { entries, currentIndex: reindex(entries, currentId(state), state.currentIndex) };
}

/**
 * Remove an entry by id. Removing the *current* entry leaves the cursor in place
 * (now pointing at what was next); removing any other follows the current track.
 */
export function removeEntry(state: PlayQueueState, entryId: string): PlayQueueState {
  const removingCurrent = state.entries[state.currentIndex]?.id === entryId;
  const keepId = removingCurrent ? undefined : currentId(state);
  const entries = state.entries.filter((e) => e.id !== entryId);
  return { entries, currentIndex: reindex(entries, keepId, state.currentIndex) };
}

/** Move an entry from index `from` to `to`. The cursor follows its track. */
export function moveEntry(state: PlayQueueState, from: number, to: number): PlayQueueState {
  if (from < 0 || from >= state.entries.length) return state;
  const keepId = currentId(state);
  const entries = [...state.entries];
  const [moved] = entries.splice(from, 1);
  const dest = Math.min(Math.max(0, to), entries.length);
  entries.splice(dest, 0, moved);
  return { entries, currentIndex: reindex(entries, keepId, state.currentIndex) };
}

/** Replace the whole queue, setting the cursor to `currentIndex` (clamped).
 * Pass -1 to keep the queue loaded but idle. */
export function replaceEntries(newEntries: PlayQueueEntry[], currentIndex = 0): PlayQueueState {
  if (newEntries.length === 0 || currentIndex < 0) {
    return { entries: [...newEntries], currentIndex: -1 };
  }
  return { entries: [...newEntries], currentIndex: reindex(newEntries, undefined, currentIndex) };
}

/**
 * The 歌单(Set) tracks not yet fed into the play queue — matched by id, so it's
 * robust to the set's order changing (new tracks are PREPENDED to the top now, no
 * longer appended). Returns them in the set's current order. The store keeps a
 * high-water Set of consumed ids and pushes the unconsumed ones onto the queue.
 */
export function unconsumedTrackIds(setTrackIds: string[], consumed: Set<string>): string[] {
  return setTrackIds.filter((id) => !consumed.has(id));
}

/**
 * Re-derive the player's currentIndex after the queue's track list changes —
 * pinned to the PLAYING track by id, not by position. Deleting other tracks
 * shifts positions but must never change what's playing (and keeps next/prev/
 * repeat correct). If the playing track itself was removed, the cursor stays on
 * the slot it held (now the following track); idle (-1) and empty stay idle.
 */
export function reconcileCurrentIndex(
  trackIds: string[],
  currentTrackId: string | null,
  fallbackIndex: number,
): number {
  if (currentTrackId) {
    const i = trackIds.indexOf(currentTrackId);
    if (i >= 0) return i;
  }
  if (trackIds.length === 0 || fallbackIndex < 0) return -1;
  return Math.min(fallbackIndex, trackIds.length - 1);
}

/**
 * Remove every entry whose trackId ∈ `removed`, keeping the cursor pinned to the
 * PLAYING track by id (so deleting other tracks never changes what plays). If the
 * playing track itself was removed, the cursor falls back to the slot it held
 * (now the following track); an idle (-1) or emptied queue stays idle.
 */
export function removeEntriesByTrackIds(
  state: PlayQueueState,
  removed: ReadonlySet<string>,
): PlayQueueState {
  if (removed.size === 0) return state;
  const playing = state.entries[state.currentIndex];
  const playingRemoved = playing !== undefined && removed.has(playing.trackId);
  const entries = state.entries.filter((e) => !removed.has(e.trackId));
  const currentIndex = reconcileCurrentIndex(
    entries.map((e) => e.trackId),
    playingRemoved ? null : (playing?.trackId ?? null),
    state.currentIndex,
  );
  return { entries, currentIndex };
}
