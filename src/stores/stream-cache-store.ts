import { create } from "zustand";

/**
 * Transient "this streamed track is being downloaded to a local blob right now"
 * state — drives the row's download-button spinner. Module-scoped store (not in
 * player-store) because it's pure ephemeral UI state shared across virtualized
 * rows: a row can unmount/remount while its download runs, so the spinner can't
 * live in row-local React state (CLAUDE.md rule 6). Subscribers select a single
 * boolean by id, so flipping one id only re-renders that row.
 */
interface StreamCacheState {
  /** trackIds whose offline download is currently in flight. */
  downloading: ReadonlySet<string>;
  /** setIds whose "download the whole set" run is currently in flight. */
  bulkSets: ReadonlySet<string>;
}

export const useStreamCacheStore = create<StreamCacheState>(() => ({
  downloading: new Set<string>(),
  bulkSets: new Set<string>(),
}));

/** Add/remove an id from one of the store's ReadonlySet fields (immutable swap). */
function toggleInSet(field: "downloading" | "bulkSets", id: string, active: boolean): void {
  const current = useStreamCacheStore.getState()[field];
  if (active === current.has(id)) return;
  const next = new Set(current);
  if (active) next.add(id);
  else next.delete(id);
  useStreamCacheStore.setState({ [field]: next });
}

/** Mark a track's offline download as started (`active`) or finished. */
export function setStreamDownloading(trackId: string, active: boolean): void {
  toggleInSet("downloading", trackId, active);
}

/** Mark a set's "download all" run as started (`active`) or finished. */
export function setSetBulkDownloading(setId: string, active: boolean): void {
  toggleInSet("bulkSets", setId, active);
}

/** Reactive: is this track's offline download in flight? */
export function useIsStreamDownloading(trackId: string): boolean {
  return useStreamCacheStore((s) => s.downloading.has(trackId));
}

/** Reactive: is this set's "download all" run in flight? */
export function useIsSetBulkDownloading(setId: string): boolean {
  return useStreamCacheStore((s) => s.bulkSets.has(setId));
}
