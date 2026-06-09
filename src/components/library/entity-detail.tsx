import { ArrowLeft, Disc3, User } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";
import { VirtualTrackList } from "./virtual-track-list";

/** A pre-resolved album for the artist-detail albums strip. */
export interface EntityStripItem {
  key: string;
  label: string;
  coverTrack?: Track;
}

/**
 * Read-only detail page for a derived library entity (one artist or one album).
 * Mirrors the set detail layout — header + virtualized track list + inspector —
 * but the header is not editable (artist/album are derived, not stored). Tapping
 * a row plays that track in its own set context via `playTrack`. An artist detail
 * also shows a horizontal strip of the artist's albums.
 */
export function EntityDetailView({
  kind,
  title,
  subtitle,
  coverTrack,
  tracks,
  albums,
  onOpenAlbum,
  onBack,
}: {
  kind: "artist" | "album";
  title: string;
  subtitle: string;
  coverTrack: Track | undefined;
  tracks: Track[];
  albums?: EntityStripItem[];
  onOpenAlbum?: (key: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const coverUrl = useTrackCoverUrl(coverTrack);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const round = kind === "artist";
  const Placeholder = round ? User : Disc3;

  const selectedTrack = useMemo(
    () => tracks.find((track) => track.id === selectedTrackId) ?? tracks[0],
    [selectedTrackId, tracks],
  );

  useEffect(() => {
    if (tracks.length === 0) {
      setSelectedTrackId(null);
      return;
    }
    if (!selectedTrackId || !tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(tracks[0].id);
    }
  }, [selectedTrackId, tracks]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 pt-14 lg:px-6"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={t("gallery.back")}
        className="mb-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
      </button>

      <div className="mb-3 flex items-center gap-3">
        <span
          className={cn(
            "grid size-20 shrink-0 place-items-center overflow-hidden bg-secondary",
            round ? "rounded-full" : "rounded-xl",
          )}
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Placeholder className="size-7 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-lg">{title}</h1>
          <p className="truncate text-muted-foreground text-sm">{subtitle}</p>
          <p className="text-muted-foreground text-xs">
            {t("gallery.count", { count: tracks.length })}
          </p>
        </div>
      </div>

      {albums && albums.length > 0 && onOpenAlbum && (
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
          {albums.map((album) => (
            <AlbumStripCard key={album.key} album={album} onOpen={() => onOpenAlbum(album.key)} />
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="min-h-0">
          <VirtualTrackList
            tracks={tracks}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
            onPlay={(track) => void playTrack(track)}
            emptyHint={t("gallery.tracksEmpty")}
            className="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
          />
        </div>
        <TrackInspectorPanel track={selectedTrack} />
      </div>
    </motion.div>
  );
}

/** One album tile in the artist-detail albums strip. */
function AlbumStripCard({ album, onOpen }: { album: EntityStripItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(album.coverTrack);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("gallery.openEntity", { name: album.label })}
      className="flex w-28 shrink-0 flex-col gap-1 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-md bg-secondary">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <Disc3 className="text-muted-foreground" />
        )}
      </span>
      <span className="block truncate text-xs">{album.label}</span>
    </button>
  );
}
