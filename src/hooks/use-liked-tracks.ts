import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/muzero-db";
import { likedTrackIdSet } from "@/db/repositories";

const EMPTY_LIKED = new Set<string>();

/**
 * Live set of all liked track ids, sourced from the `trackLikes` SIDE table. Toggling
 * a like re-fires ONLY this (tiny — just the liked ids) query, never the play-queue's
 * `getTracksByIds(N)` or the search全表 `listAllTracks` that observe the cold `tracks`
 * table. That is the whole point of moving `liked` off the catalog row: a heart toggle
 * costs O(likes) here instead of O(queue) refetch. PRD 20260617-scalable-track-list.
 */
export function useLikedTrackIds(): Set<string> {
  return useLiveQuery(() => likedTrackIdSet(db), [], EMPTY_LIKED);
}
