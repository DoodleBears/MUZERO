"use client";

import { Image as ImageIcon, ImagePlus, Video } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
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
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const DISPLAY_MODE_OPTIONS: { id: SetDisplayMode; icon: typeof Video }[] = [
  { id: "video", icon: Video },
  { id: "cover", icon: ImageIcon },
];

export interface TrackContextMenuLabels {
  coverInput: string;
  displayMode: string;
  displayModes: Record<SetDisplayMode, string>;
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
  className?: string;
  displayMode?: SetDisplayMode;
  labels: TrackContextMenuLabels;
  onCoverFileSelect?: (file: File) => void;
  onDisplayModeChange?: (mode: SetDisplayMode) => void;
  track?: TrackContextMenuTrack;
}

export function TrackContextMenu({
  children,
  className,
  displayMode = "video",
  labels,
  onCoverFileSelect,
  onDisplayModeChange,
  track,
}: TrackContextMenuProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);

  function selectCover(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCoverFileSelect?.(file);
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger className={cn("min-w-0", className)}>{children}</ContextMenuTrigger>
      {track && (
        <ContextMenuContent aria-label={labels.menu} className="w-56">
          <ContextMenuLabel className="truncate text-foreground">{track.title}</ContextMenuLabel>
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
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!onCoverFileSelect} onClick={() => fileRef.current?.click()}>
            <ImagePlus aria-hidden="true" />
            {labels.pickCover}
          </ContextMenuItem>
        </ContextMenuContent>
      )}
      <input
        accept={IMAGE_ACCEPT}
        aria-label={labels.coverInput}
        hidden
        onChange={selectCover}
        ref={fileRef}
        type="file"
      />
    </ContextMenu>
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
          coverInput: t("annotation.addCover"),
          displayMode: t("nowPlaying.displayMode"),
          displayModes: {
            cover: t("displayMode.cover"),
            video: t("displayMode.video"),
          },
          menu: t("nowPlaying.trackMenu"),
          pickCover: current?.coverBlobId ? t("annotation.changeCover") : t("annotation.addCover"),
        }}
        onCoverFileSelect={(file) => {
          if (current) setPendingCover({ file, trackId: current.id });
        }}
        onDisplayModeChange={(mode) => void setDisplayMode(mode)}
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
