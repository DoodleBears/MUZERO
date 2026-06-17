import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/muzero-db";
import { getTrack } from "@/db/repositories";
import type { Track } from "@/db/types";

/**
 * Reactive single-row read of one track by id.
 *
 * `db.tracks.get(id)` reads exactly one primary key, so Dexie only re-fires this
 * liveQuery when THAT row is written — a write to any other track does nothing here.
 * That makes it the windowed, virtualization-aligned content read for list rows: a
 * visible row subscribes to just its own id, so editing one track re-renders only
 * its row (and never refetches the whole list — the scenario-4 fan-out this PRD
 * kills). Pass `undefined` to subscribe to nothing (e.g. a non-reactive list).
 *
 * Returns `undefined` until the row resolves (or if `id` is missing / not found) —
 * callers fall back to a base snapshot row, so the list still shows order + content
 * immediately and only sharpens to the live row a tick later.
 */
export function useTrack(id: string | undefined): Track | undefined {
  return useLiveQuery(() => (id ? getTrack(id, db) : Promise.resolve(undefined)), [id], undefined);
}
