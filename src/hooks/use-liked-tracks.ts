import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/muzero-db";
import { likedTrackAtMap, likedTrackIdSet } from "@/db/repositories";

const EMPTY_LIKED = new Set<string>();
const EMPTY_LIKED_AT = new Map<string, number>();

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

/**
 * Live map of trackId → `likedAt` epoch ms (same `trackLikes` side table). Used by the
 * hearted playlist to sort by when each track was hearted; membership-only readers
 * should stick to {@link useLikedTrackIds} (a smaller projection).
 */
export function useLikedTrackAt(): Map<string, number> {
  return useLiveQuery(() => likedTrackAtMap(db), [], EMPTY_LIKED_AT);
}
