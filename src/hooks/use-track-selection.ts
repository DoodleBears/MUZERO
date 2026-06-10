import { useCallback, useEffect, useRef, useState } from "react";

/** Options for {@link TrackSelection.toggle} — enables Shift+click range select. */
export interface ToggleOpts {
  /** Row position in the current list (needed for range select). */
  index?: number;
  /** Shift held → select the contiguous range from the anchor to this row. */
  shiftKey?: boolean;
}

export interface TrackSelection {
  /** Whether select mode is on (checkboxes + action bar shown). */
  mode: boolean;
  /** Currently selected track ids. */
  ids: ReadonlySet<string>;
  count: number;
  allSelected: boolean;
  enter: () => void;
  /** Leave select mode and clear the selection. */
  exit: () => void;
  toggle: (id: string, opts?: ToggleOpts) => void;
  toggleAll: () => void;
  clear: () => void;
}

/**
 * Ephemeral multi-select for a track list (page-local, never in Zustand). Pass a
 * memoized `allIds` (stable per render) — the prune effect drops ids that vanish
 * after a delete (the list re-derives via liveQuery) so the count stays honest.
 */
export function useTrackSelection(allIds: string[]): TrackSelection {
  const [mode, setMode] = useState(false);
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  // Anchor row index for Shift+click range select (last plainly-toggled row).
  const anchorRef = useRef<number | null>(null);

  const toggle = useCallback(
    (id: string, opts?: ToggleOpts) => {
      const { index, shiftKey } = opts ?? {};
      if (shiftKey && anchorRef.current !== null && index !== undefined) {
        // Add the contiguous range anchor…index to the selection (anchor stays).
        const lo = Math.min(anchorRef.current, index);
        const hi = Math.max(anchorRef.current, index);
        const range = allIds.slice(lo, hi + 1);
        setIds((prev) => {
          const next = new Set(prev);
          for (const rid of range) next.add(rid);
          return next;
        });
        return;
      }
      if (index !== undefined) anchorRef.current = index;
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [allIds],
  );

  const toggleAll = useCallback(() => {
    setIds((prev) => (prev.size === allIds.length ? new Set() : new Set(allIds)));
  }, [allIds]);

  const clear = useCallback(() => {
    anchorRef.current = null;
    setIds(new Set());
  }, []);
  const enter = useCallback(() => setMode(true), []);
  const exit = useCallback(() => {
    setMode(false);
    anchorRef.current = null;
    setIds(new Set());
  }, []);

  // Drop ids no longer present (post-delete liveQuery refresh). Returns the same
  // Set when nothing changed, so React bails out — no render loop.
  useEffect(() => {
    setIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(allIds);
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [allIds]);

  return {
    mode,
    ids,
    count: ids.size,
    allSelected: ids.size > 0 && ids.size === allIds.length,
    enter,
    exit,
    toggle,
    toggleAll,
    clear,
  };
}
