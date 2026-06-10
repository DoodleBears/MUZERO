import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/components/ui/cover-image";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { applyBlockMove, resolveDropTarget } from "./reorder-drop";

/** Row height (Tailwind h-14) — kept in sync between a row and its drop placeholder. */
const ROW_CLASS = "h-14";

/**
 * Drag-to-reorder list used in a set's multi-select mode (drag-reorder PRD §5).
 * Self-contained (a compact row, NOT the heavy `TrackRow`) so it stays decoupled
 * from the library row's churn. @dnd-kit sortable in its canonical form: rows apply
 * the strategy `transform`, so the surrounding rows reflow to open a gap and the
 * dragged row's slot becomes a **dashed-box placeholder** that snaps to the drop
 * position; the floating `DragOverlay` shows the real content (+ an "N tracks" badge
 * for a block move). Dragging any SELECTED row moves the whole selection as one
 * block (relative order kept); dragging an unselected row moves just that row.
 * Reorder is only mounted in "manual order" (no sort/filter/search), so `tracks`
 * is the true curated order.
 */
export function ReorderableTrackList({
  tracks,
  selectedIds,
  onToggleSelect,
  onReorder,
  onDragActiveChange,
  className,
}: {
  /** Tracks in the set's current display (rank) order. */
  tracks: Track[];
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (trackId: string, opts?: { index?: number; shiftKey?: boolean }) => void;
  /** Commit a move: relocate `blockIds` to just before `insertBeforeId` (null = end). */
  onReorder: (blockIds: string[], insertBeforeId: string | null) => void;
  /** Fires true on drag start, false on end/cancel — lets the surface disable batch ops. */
  onDragActiveChange?: (active: boolean) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Optimistic local order: a drop reorders this SYNCHRONOUSLY so the row lands at
  // the dashed-box slot immediately, then the async rank persist reconciles via the
  // `tracks` prop (liveQuery). Without it the @dnd-kit drop animation snaps the
  // overlay back to the old slot before the async update arrives.
  const [order, setOrder] = useState<Track[]>(tracks);
  useEffect(() => {
    setOrder(tracks);
  }, [tracks]);
  const ids = useMemo(() => order.map((track) => track.id), [order]);

  const sensors = useSensors(
    // A small drag threshold so a tap still toggles selection.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Press-and-hold on touch so dragging doesn't fight list scrolling.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The block that moves when `id` is dragged: the whole selection if `id` is part
   *  of it (kept in display order), else just `id`. */
  function blockFor(id: string): string[] {
    if (selectedIds.has(id) && selectedIds.size > 1) {
      return ids.filter((trackId) => selectedIds.has(trackId));
    }
    return [id];
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    onDragActiveChange?.(false);
    const { active, over } = event;
    if (!over) return;
    const block = blockFor(String(active.id));
    const { insertBeforeId } = resolveDropTarget(ids, block, String(active.id), String(over.id));
    // Optimistic: reorder the displayed list now so the drop settles at the slot…
    setOrder((prev) => {
      const nextIds = applyBlockMove(
        prev.map((track) => track.id),
        block,
        insertBeforeId,
      );
      const byId = new Map(prev.map((track) => [track.id, track]));
      return nextIds.map((id) => byId.get(id)).filter((track): track is Track => !!track);
    });
    // …and persist the rank change (liveQuery then reconciles `order` via the effect).
    onReorder(block, insertBeforeId);
  }

  function onDragCancel() {
    setActiveId(null);
    onDragActiveChange?.(false);
  }

  const activeTrack = activeId ? order.find((track) => track.id === activeId) : undefined;
  const activeBlockSize = activeId ? blockFor(activeId).length : 0;
  // A multi-select block is on the move — the other selected rows "lift out".
  const blockDragActive = activeBlockSize > 1;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={(event: DragStartEvent) => {
        setActiveId(String(event.active.id));
        onDragActiveChange?.(true);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={cn("flex min-h-0 flex-col gap-0.5 overflow-y-auto", className)}>
          {order.map((track) => (
            <SortableReorderRow
              key={track.id}
              track={track}
              checked={selectedIds.has(track.id)}
              lifted={blockDragActive && track.id !== activeId && selectedIds.has(track.id)}
              dragLabel={t("reorder.dragHandle")}
              onToggle={(shiftKey) => onToggleSelect(track.id, { shiftKey })}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay>
        {activeTrack ? (
          // Mirror a row's columns (grip + body) so the floating item stays aligned
          // with the list — the grip must remain visible while dragging.
          <div className="flex items-center gap-1">
            <span className="flex h-11 w-8 shrink-0 items-center justify-center text-muted-foreground">
              <GripVertical className="size-4" />
            </span>
            <div className="relative min-w-0 flex-1">
              {/* A "stack" of cards peeking out behind so a block drag reads as many. */}
              {activeBlockSize > 1 ? (
                <>
                  <div
                    aria-hidden
                    className="absolute inset-0 translate-y-2 scale-[0.94] rounded-lg border border-border bg-muted shadow"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 translate-y-1 scale-[0.97] rounded-lg border border-border bg-background shadow"
                  />
                </>
              ) : null}
              <div className="relative">
                <ReorderRowBody
                  track={activeTrack}
                  checked={selectedIds.has(activeTrack.id)}
                  overlay
                  badge={
                    activeBlockSize > 1
                      ? t("reorder.movingCount", { count: activeBlockSize })
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableReorderRow({
  track,
  checked,
  lifted,
  dragLabel,
  onToggle,
}: {
  track: Track;
  checked: boolean;
  /** This row is a selected member of the block being dragged (but not the grabbed
   *  one) — dim it so the whole selection visibly "lifts out" and travels together. */
  lifted: boolean;
  dragLabel: string;
  onToggle: (shiftKey: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("list-none", isDragging && "relative z-10", lifted && "opacity-40")}
    >
      {isDragging ? (
        // The dragged row's slot — a dashed box marking where it (or the block) lands.
        <div
          className={cn(
            "rounded-lg border-2 border-dashed border-primary/60 bg-primary/5",
            ROW_CLASS,
          )}
        />
      ) : (
        <div className={cn("flex items-center gap-1", ROW_CLASS)}>
          <button
            type="button"
            ref={setActivatorNodeRef}
            aria-label={dragLabel}
            className="flex h-11 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
          <button
            type="button"
            onClick={(event) => onToggle(event.shiftKey)}
            className="min-w-0 flex-1 text-left"
          >
            <ReorderRowBody track={track} checked={checked} />
          </button>
        </div>
      )}
    </li>
  );
}

function ReorderRowBody({
  track,
  checked,
  overlay,
  badge,
}: {
  track: Track;
  checked: boolean;
  overlay?: boolean;
  badge?: string;
}) {
  const coverUrl = useTrackCoverUrl(track);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-2 py-1.5",
        checked ? "bg-primary/10" : "hover:bg-muted/50",
        overlay && "bg-background shadow-lg ring-1 ring-border",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-4.5 shrink-0 place-items-center rounded border text-[10px] font-bold",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {checked ? "✓" : ""}
      </span>
      <CoverImage
        url={coverUrl}
        thumbhash={track.coverThumbhash}
        rounded
        className="size-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">{trackSubtitle(track)}</p>
      </div>
      {badge ? (
        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </div>
  );
}
