import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { GripVertical } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CoverImage } from "@/components/ui/cover-image";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { resolveDropTarget } from "./reorder-drop";

/** Fixed row height so the virtualizer needs no per-row measurement. */
const REORDER_ROW_HEIGHT = 56;

/** Where the drop-indicator line sits relative to the hovered row. */
type DropEdge = "top" | "bottom";

/**
 * Drag-to-reorder list used in a set's multi-select mode (drag-reorder PRD §5/§Phase 4).
 * Self-contained (a compact row, NOT the heavy `TrackRow`) so it stays decoupled from
 * the library row's churn, and VIRTUALIZED (react-virtual) so a several-hundred-track
 * set stays light in reorder mode. @dnd-kit sortable: dragging any SELECTED row moves
 * the whole selection as one block (relative order kept); dragging an unselected row
 * moves just that row. A direction-aware indicator line marks the drop point; the
 * floating overlay shows how many tracks travel. Reorder is only mounted in "manual
 * order" (no sort/filter/search), so `tracks` is the true curated order.
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
  const ids = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; edge: DropEdge } | null>(null);

  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: tracks.length,
    estimateSize: () => REORDER_ROW_HEIGHT,
    getItemKey: (index) => tracks[index]?.id ?? index,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });

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

  function onDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      setDropAt(null);
      return;
    }
    const activeIndex = ids.indexOf(String(active.id));
    const overIndex = ids.indexOf(String(over.id));
    // Dragging downward lands the block AFTER the hovered row; upward, BEFORE it.
    setDropAt({ id: String(over.id), edge: activeIndex < overIndex ? "bottom" : "top" });
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setDropAt(null);
    onDragActiveChange?.(false);
    const { active, over } = event;
    if (!over) return;
    const block = blockFor(String(active.id));
    const { insertBeforeId } = resolveDropTarget(ids, block, String(active.id), String(over.id));
    onReorder(block, insertBeforeId);
  }

  function onDragCancel() {
    setActiveId(null);
    setDropAt(null);
    onDragActiveChange?.(false);
  }

  const activeTrack = activeId ? tracks.find((track) => track.id === activeId) : undefined;
  const activeBlockSize = activeId ? blockFor(activeId).length : 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={(event: DragStartEvent) => {
        setActiveId(String(event.active.id));
        onDragActiveChange?.(true);
      }}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={parentRef} className={cn("min-h-0 flex-1 overflow-y-auto", className)}>
          <div
            style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualItem) => {
              const track = tracks[virtualItem.index];
              if (!track) return null;
              return (
                <SortableReorderRow
                  key={virtualItem.key}
                  track={track}
                  start={virtualItem.start}
                  checked={selectedIds.has(track.id)}
                  dropEdge={dropAt?.id === track.id ? dropAt.edge : null}
                  dragLabel={t("reorder.dragHandle")}
                  onToggle={(shiftKey) => onToggleSelect(track.id, { shiftKey })}
                />
              );
            })}
          </div>
        </div>
      </SortableContext>
      <DragOverlay>
        {activeTrack ? (
          <ReorderRowBody
            track={activeTrack}
            checked={selectedIds.has(activeTrack.id)}
            overlay
            badge={
              activeBlockSize > 1 ? t("reorder.movingCount", { count: activeBlockSize }) : undefined
            }
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function SortableReorderRow({
  track,
  start,
  checked,
  dropEdge,
  dragLabel,
  onToggle,
}: {
  track: Track;
  /** Absolute offset from the virtualizer. */
  start: number;
  checked: boolean;
  dropEdge: DropEdge | null;
  dragLabel: string;
  onToggle: (shiftKey: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transition, isDragging } =
    useSortable({ id: track.id });

  return (
    <li
      ref={setNodeRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: REORDER_ROW_HEIGHT,
        transform: `translateY(${start}px)`,
        transition,
      }}
      className={cn("list-none", isDragging && "opacity-40")}
    >
      {/* Direction-aware drop indicator: the block lands at this line. */}
      {dropEdge ? (
        <span
          aria-hidden
          className={cn(
            "absolute inset-x-2 h-0.5 rounded-full bg-primary",
            dropEdge === "top" ? "-top-px" : "-bottom-px",
          )}
        />
      ) : null}
      <div className="flex h-full items-center gap-1">
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
