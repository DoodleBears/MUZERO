import { ArrowLeft, Clock, Disc3, Play, User } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { CoverImage } from "@/components/ui/cover-image";
import type { Track } from "@/db/types";
import { useBackGesture } from "@/hooks/use-back-gesture";
import { useTrackCoverUrl } from "@/hooks/use-media";
import type { EntityStat } from "@/lib/library-stats";
import { cn, formatDuration, formatListenTime } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";
import { EntityCoverButton } from "./entity-cover-button";
import { TrackListSection } from "./track-list-section";

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
  entityKey,
  title,
  subtitle,
  coverTrack,
  tracks,
  albums,
  stat,
  onOpenAlbum,
  onBack,
}: {
  kind: "artist" | "album";
  /** Entity projection key; omitted for pseudo-buckets (no editable cover). */
  entityKey?: string;
  title: string;
  subtitle: string;
  coverTrack: Track | undefined;
  tracks: Track[];
  albums?: EntityStripItem[];
  stat?: EntityStat;
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
  // Total runtime of this entity's tracks (the album/artist length), distinct
  // from the cumulative listen-time stat below.
  const totalDurationSec = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0),
    [tracks],
  );

  // Go back a level via A/← or a trackpad left→right swipe (mirrors the button).
  useBackGesture(onBack);

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
        {entityKey ? (
          <EntityCoverButton
            entityKey={entityKey}
            kind={kind}
            coverTrack={coverTrack}
            round={round}
          />
        ) : (
          <CoverImage
            url={coverUrl}
            thumbhash={coverTrack?.coverThumbhash}
            rounded={round}
            placeholder={<Placeholder className="size-7 text-muted-foreground" />}
            className={cn("size-20 shrink-0", !round && "rounded-xl")}
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-semibold text-lg">{title}</h1>
          <p className="truncate text-muted-foreground text-sm">{subtitle}</p>
          <p className="flex items-center gap-2 text-muted-foreground text-xs">
            <span className="tabular-nums">
              {t("gallery.count", { count: tracks.length })}
              {totalDurationSec > 0 && ` · ${formatDuration(totalDurationSec)}`}
            </span>
            {stat && stat.listenedSec > 0 && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {formatListenTime(stat.listenedSec)}
              </span>
            )}
            {stat && stat.playCount > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Play className="size-3" />
                {stat.playCount}
              </span>
            )}
          </p>
        </div>
      </div>

      {albums && albums.length > 0 && onOpenAlbum && (
        <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto" data-no-swipe-back>
          {albums.map((album) => (
            <AlbumStripCard key={album.key} album={album} onOpen={() => onOpenAlbum(album.key)} />
          ))}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <TrackListSection
          tracks={tracks}
          selectedTrackId={selectedTrack?.id}
          onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
          onPlay={(track) => void playTrack(track)}
          emptyHint={t("gallery.tracksEmpty")}
          listClassName="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
        />
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
      <CoverImage
        url={coverUrl}
        thumbhash={album.coverTrack?.coverThumbhash}
        placeholder={<Disc3 className="text-muted-foreground" />}
        className="aspect-square w-full rounded-md"
      />
      <span className="block truncate text-xs">{album.label}</span>
    </button>
  );
}
