import { Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type BatchAction, BatchActionBar } from "@/components/library/batch-action-bar";
import { ReorderableTrackList } from "@/components/library/reorderable-track-list";
import { TrackListMenu } from "@/components/library/track-list-menu";
import { trackIndexFromEventTarget } from "@/components/library/track-row-target";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  deleteTracks,
  prependTrackIds,
  removeTracksFromSession,
  reorderTracksInSession,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { useLongPress } from "@/hooks/use-long-press";
import { useTrackSelection } from "@/hooks/use-track-selection";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { AddToSetMenu } from "./add-to-set-menu";
import { useListScrollPreservation } from "./use-list-scroll-preservation";

/**
 * A track list with a "Select" toggle, checkbox multi-select, a batch action bar,
 * and context-aware delete. With `setId` (a set view): row trash = remove-from-set
 * (reversible, with Undo); batch offers remove-from-set + permanent delete. Without
 * it (the global 所有歌曲 list): delete is always permanent (with confirmation).
 * Wraps `TrackListMenu` so right-click upload still works.
 */
export function TrackListSection({
  tracks,
  setId,
  onPlay,
  onView,
  selectedTrackId,
  emptyHint,
  listClassName,
  className,
  startActions,
  endActions,
  listHeader,
  canReorder,
}: {
  tracks: Track[];
  /** Set context. Omit for the global library list (permanent delete only). */
  setId?: string;
  /** Allow drag-to-reorder in select mode. Only when showing the true curated
   *  order (no sort/filter/search active) — see SetDetailView `isManualOrder`. */
  canReorder?: boolean;
  onPlay?: (track: Track) => void;
  onView?: (track: Track) => void;
  selectedTrackId?: string;
  emptyHint?: string;
  listClassName?: string;
  className?: string;
  /** Buttons rendered at the left of the toolbar row, sharing it with "Select". */
  startActions?: React.ReactNode;
  /** Content rendered at the right of the toolbar row, after the "Select" toggle. */
  endActions?: React.ReactNode;
  /** When set, this content + the toolbar row scroll WITH the list (rendered inside the
   *  scroll container as its header) instead of staying pinned above it. */
  listHeader?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);
  const sel = useTrackSelection(trackIds);
  // Track ids awaiting a permanent-delete confirmation (null = dialog closed).
  const [pendingPermanent, setPendingPermanent] = useState<string[] | null>(null);
  // True while a reorder drag is in progress — disables the batch action bar so a
  // stray click can't delete/remove mid-drag.
  const [dragActive, setDragActive] = useState(false);

  // Press-and-hold a row to ENTER multi-select (touch-friendly, like a long-press
  // on a photo). Delegated from the section root via `data-track-index`, so it
  // needs no edit to the row component. The trailing click is swallowed below.
  const pressedIndexRef = useRef<number | null>(null);
  const longPress = useLongPress(() => {
    const index = pressedIndexRef.current;
    if (index === null) return;
    const id = tracks[index]?.id;
    if (!id) return;
    sel.enter();
    sel.toggle(id, { index });
  });
  // Only wire long-press OUT of select mode (in select mode a plain tap toggles).
  const longPressProps = sel.mode
    ? {}
    : {
        ...longPress.handlers,
        onPointerDownCapture: (event: React.PointerEvent) => {
          pressedIndexRef.current = trackIndexFromEventTarget(event.target, tracks.length);
        },
        onClickCapture: (event: React.MouseEvent) => {
          // A fired long-press emits a trailing click — drop it so it doesn't also
          // play/select the row.
          if (longPress.consumeClick()) event.stopPropagation();
        },
      };

  // Drag-to-reorder is offered only in a set's select mode AND when the true
  // curated order is showing (no sort/filter/search) — see SetDetailView.
  const showReorder = sel.mode && !!setId && !!canReorder;
  // Entering/leaving select mode swaps the list's scroll container — keep the scroll
  // position across the swap instead of snapping to the top.
  const sectionRef = useListScrollPreservation(showReorder, tracks.length);

  function onReorder(blockIds: string[], insertBeforeId: string | null) {
    if (!setId) return;
    void reorderTracksInSession(setId, blockIds, insertBeforeId);
  }

  function removeFromSet(ids: string[]) {
    if (!setId || ids.length === 0) return;
    void removeTracksFromSession(setId, ids);
    notify.success(t("select.removedFromSet", { count: ids.length }), {
      actions: [{ label: t("common.undo"), onClick: () => void prependTrackIds(setId, ids) }],
    });
  }

  function onDeleteTrack(track: Track) {
    if (setId) removeFromSet([track.id]);
    else setPendingPermanent([track.id]);
  }

  async function confirmPermanent() {
    const ids = pendingPermanent ?? [];
    if (ids.length === 0) return;
    await deleteTracks(ids);
    notify.success(t("select.deleted", { count: ids.length }));
    sel.exit();
  }

  const batchActions: BatchAction[] = setId
    ? [
        { label: t("select.removeFromSet"), onClick: () => removeFromSetThenExit([...sel.ids]) },
        {
          label: t("select.deletePermanently"),
          variant: "destructive",
          icon: <Trash2 />,
          onClick: () => setPendingPermanent([...sel.ids]),
        },
      ]
    : [
        {
          label: t("select.deletePermanently"),
          variant: "destructive",
          icon: <Trash2 />,
          onClick: () => setPendingPermanent([...sel.ids]),
        },
      ];

  function removeFromSetThenExit(ids: string[]) {
    removeFromSet(ids);
    sel.exit();
  }

  const toolbar = (
    <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">{startActions}</div>
      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => (sel.mode ? sel.exit() : sel.enter())}>
          {sel.mode ? t("select.done") : t("select.enter")}
        </Button>
        {endActions}
      </div>
    </div>
  );

  return (
    <div ref={sectionRef} className={cn("flex min-h-0 flex-col", className)} {...longPressProps}>
      {/* Without `listHeader` the toolbar is pinned above the list (set / detail views).
          With it, the header + toolbar move INTO the scroller so they scroll away with
          the rows (the library wall). */}
      {listHeader ? null : toolbar}
      <TrackListMenu
        setId={setId}
        className="min-h-0 flex-1"
        selectMode={sel.mode}
        onToggleSelectMode={() => (sel.mode ? sel.exit() : sel.enter())}
      >
        {showReorder ? (
          <ReorderableTrackList
            tracks={tracks}
            selectedIds={sel.ids}
            onToggleSelect={sel.toggle}
            onReorder={onReorder}
            onDragActiveChange={setDragActive}
            className={listClassName}
          />
        ) : (
          <VirtualTrackList
            tracks={tracks}
            selectedTrackId={selectedTrackId}
            emptyHint={emptyHint}
            className={listClassName}
            header={
              listHeader ? (
                <div className="flex flex-col gap-4">
                  {listHeader}
                  {toolbar}
                </div>
              ) : undefined
            }
            onPlay={onPlay ? (track) => onPlay(track) : undefined}
            onView={onView ? (track) => onView(track) : undefined}
            selectable={sel.mode}
            selectedIds={sel.ids}
            onToggleSelect={sel.toggle}
            onDeleteTrack={onDeleteTrack}
          />
        )}
      </TrackListMenu>
      {sel.mode ? (
        <BatchActionBar
          count={sel.count}
          allSelected={sel.allSelected}
          indeterminate={sel.count > 0 && !sel.allSelected}
          onToggleAll={sel.toggleAll}
          onCancel={sel.exit}
          actions={batchActions}
          extra={<AddToSetMenu trackIds={[...sel.ids]} excludeSetId={setId} onAdded={sel.exit} />}
          disabled={dragActive}
        />
      ) : null}
      <ConfirmDialog
        open={pendingPermanent !== null}
        onOpenChange={(open) => {
          if (!open) setPendingPermanent(null);
        }}
        title={t("track.deleteConfirmTitle")}
        description={t("track.deleteConfirmBody")}
        confirm={{ label: t("select.deletePermanently"), onConfirm: confirmPermanent }}
      />
    </div>
  );
}
