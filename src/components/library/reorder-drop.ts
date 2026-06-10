/**
 * Pure bridge from a @dnd-kit sortable drag to the `insertBeforeId` anchor that
 * `reorderTracksInSession` expects. Handles a single row or a whole multi-select
 * block (the block keeps its relative order and lands where `active` came to rest).
 * No @dnd-kit / DOM imports → exhaustively unit-tested (drag-reorder PRD §5.2).
 */

function arrayMove<T>(arr: readonly T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export interface DropTarget {
  /** Insert the block immediately before this id; null = drop at the very end. */
  insertBeforeId: string | null;
}

/**
 * `orderedIds` is the set's current display order; `blockIds` is the moving block
 * (always includes `activeId`); `activeId`/`overId` come from @dnd-kit's onDragEnd.
 * Returns the anchor: the first non-block id after `active`'s resting slot, or null
 * (end of list). A drop on itself returns the current follower → planReorder no-ops.
 */
export function resolveDropTarget(
  orderedIds: readonly string[],
  blockIds: readonly string[],
  activeId: string,
  overId: string,
): DropTarget {
  const from = orderedIds.indexOf(activeId);
  const to = orderedIds.indexOf(overId);
  if (from < 0 || to < 0) return { insertBeforeId: null };

  const blockSet = new Set(blockIds);
  const moved = arrayMove(orderedIds, from, to);
  const pos = moved.indexOf(activeId);
  for (let i = pos + 1; i < moved.length; i++) {
    if (!blockSet.has(moved[i])) return { insertBeforeId: moved[i] };
  }
  return { insertBeforeId: null };
}
