"use client";

import { Image as ImageIcon, ImagePlus, ListMusic, Video } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { TrackAddToSetDialog } from "@/components/library/track-add-to-set";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { BookmarkPlusIcon } from "@/components/ui/bookmark-plus";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { setTrackCover } from "@/db/repositories";
import type { CropRect, SetDisplayMode } from "@/db/types";
import { IMAGE_ACCEPT } from "@/lib/file-drop";
import { dispatchJumpTarget } from "@/lib/jump-to-source";
import { resolvePlayingSource } from "@/lib/playing-source";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";

const DISPLAY_MODE_OPTIONS: { id: SetDisplayMode; icon: typeof Video }[] = [
  { id: "video", icon: Video },
  { id: "cover", icon: ImageIcon },
];
const LONG_PRESS_MENU_MS = 520;
const LONG_PRESS_MOVE_PX = 8;

export interface TrackContextMenuLabels {
  addToSet: string;
  coverInput: string;
  displayMode: string;
  displayModes: Record<SetDisplayMode, string>;
  jumpToSource?: string;
  menu: string;
  pickCover: string;
}

interface TrackContextMenuTrack {
  coverBlobId?: string;
  id: string;
  title: string;
}

interface TrackContextMenuProps {
  children: ReactNode;
  canJumpToSource?: boolean;
  className?: string;
  displayMode?: SetDisplayMode;
  labels: TrackContextMenuLabels;
  onCoverFileSelect?: (file: File) => void;
  onDisplayModeChange?: (mode: SetDisplayMode) => void;
  onJumpToSource?: () => void;
  track?: TrackContextMenuTrack;
}

export function TrackContextMenu({
  children,
  canJumpToSource = false,
  className,
  displayMode = "video",
  labels,
  onCoverFileSelect,
  onDisplayModeChange,
  onJumpToSource,
  track,
}: TrackContextMenuProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const [addToSetOpen, setAddToSetOpen] = useState(false);

  function selectCover(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCoverFileSelect?.(file);
  }

  function clearLongPress() {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }

  function scheduleLongPress(event: ReactPointerEvent<HTMLElement>) {
    if (!track || event.pointerType === "mouse") return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressStart.current = { x: event.clientX, y: event.clientY };
    const target = event.target instanceof Element ? event.target : event.currentTarget;
    const { clientX, clientY } = event;
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressTriggered.current = true;
      const view = target.ownerDocument.defaultView ?? window;
      target.dispatchEvent(
        new view.MouseEvent("contextmenu", {
          bubbles: true,
          button: 2,
          cancelable: true,
          clientX,
          clientY,
        }),
      );
    }, LONG_PRESS_MENU_MS);
  }

  function maybeCancelLongPress(event: ReactPointerEvent<HTMLElement>) {
    const start = longPressStart.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_PX) {
      clearLongPress();
    }
  }

  function suppressLongPressClick(event: ReactMouseEvent<HTMLElement>) {
    if (!longPressTriggered.current) return;
    longPressTriggered.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger
          className={cn("min-w-0", className)}
          data-no-drag
          onClickCapture={suppressLongPressClick}
          onContextMenuCapture={clearLongPress}
          onPointerCancelCapture={clearLongPress}
          onPointerDownCapture={scheduleLongPress}
          onPointerMoveCapture={maybeCancelLongPress}
          onPointerUpCapture={clearLongPress}
        >
          {children}
        </ContextMenuTrigger>
        {track && (
          <ContextMenuContent aria-label={labels.menu} className="w-56">
            <ContextMenuLabel className="truncate text-foreground">{track.title}</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => setAddToSetOpen(true)}>
              <BookmarkPlusIcon aria-hidden="true" />
              {labels.addToSet}
            </ContextMenuItem>
            {labels.jumpToSource && onJumpToSource && (
              <ContextMenuItem disabled={!canJumpToSource} onClick={onJumpToSource}>
                <ListMusic aria-hidden="true" />
                {labels.jumpToSource}
              </ContextMenuItem>
            )}
            <ContextMenuItem disabled={!onCoverFileSelect} onClick={() => fileRef.current?.click()}>
              <ImagePlus aria-hidden="true" />
              {labels.pickCover}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuLabel>{labels.displayMode}</ContextMenuLabel>
            <ContextMenuRadioGroup
              value={displayMode}
              onValueChange={(value) => onDisplayModeChange?.(value as SetDisplayMode)}
            >
              {DISPLAY_MODE_OPTIONS.map(({ id, icon: Icon }) => (
                <ContextMenuRadioItem key={id} value={id}>
                  <Icon aria-hidden="true" />
                  {labels.displayModes[id]}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuContent>
        )}
      </ContextMenu>
      <input
        accept={IMAGE_ACCEPT}
        aria-label={labels.coverInput}
        hidden
        onChange={selectCover}
        ref={fileRef}
        type="file"
      />
      {track && (
        <TrackAddToSetDialog
          onOpenChange={setAddToSetOpen}
          open={addToSetOpen}
          title={labels.addToSet}
          trackId={track.id}
        />
      )}
    </>
  );
}

export function CurrentTrackContextMenu({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const current = usePlayerStore(
    useShallow((s) => {
      const track = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      return track
        ? { coverBlobId: track.coverBlobId, id: track.id, title: track.title }
        : undefined;
    }),
  );
  const displayMode = usePlayerStore((s) => s.displayMode);
  const setDisplayMode = usePlayerStore((s) => s.setDisplayMode);
  const jumpTarget = usePlayerStore(
    useShallow((s) =>
      resolvePlayingSource({
        activeSessionId: s.activeSessionId,
        currentIndex: s.currentIndex,
        queue: s.queue,
        queueSource: s.queueSource,
      }),
    ),
  );
  const [pendingCover, setPendingCover] = useState<{ file: File; trackId: string } | null>(null);

  function saveCover(crop: CropRect) {
    if (!pendingCover) return;
    void setTrackCover({
      blob: pendingCover.file,
      crop,
      mime: pendingCover.file.type || "image/jpeg",
      trackId: pendingCover.trackId,
    });
    setPendingCover(null);
  }

  return (
    <>
      <TrackContextMenu
        className={className}
        displayMode={displayMode}
        labels={{
          addToSet: t("track.addToSet"),
          coverInput: t("annotation.addCover"),
          displayMode: t("nowPlaying.displayMode"),
          displayModes: {
            cover: t("displayMode.cover"),
            video: t("displayMode.video"),
          },
          jumpToSource: t("nav.jumpToSource"),
          menu: t("nowPlaying.trackMenu"),
          pickCover: current?.coverBlobId ? t("annotation.changeCover") : t("annotation.addCover"),
        }}
        canJumpToSource={jumpTarget !== null}
        onCoverFileSelect={(file) => {
          if (current) setPendingCover({ file, trackId: current.id });
        }}
        onDisplayModeChange={(mode) => void setDisplayMode(mode)}
        onJumpToSource={() => {
          if (!jumpTarget) return;
          transitionState(() => dispatchJumpTarget(jumpTarget));
        }}
        track={current}
      >
        {children}
      </TrackContextMenu>
      {pendingCover && (
        <CoverCropDialog
          file={pendingCover.file}
          onCancel={() => setPendingCover(null)}
          onConfirm={saveCover}
        />
      )}
    </>
  );
}
