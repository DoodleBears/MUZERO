import { ArrowLeft, Clock, Disc3, Heart, Play, User } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { CoverImage } from "@/components/ui/cover-image";
import type { Track } from "@/db/types";
import { useBackGesture } from "@/hooks/use-back-gesture";
import { useLikedTrackIds } from "@/hooks/use-liked-tracks";
import { useTrackCoverUrl, useTrackThumbnailUrl } from "@/hooks/use-media";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import type { EntityStat } from "@/lib/library-stats";
import type { SortDir } from "@/lib/set-gallery";
import {
  filterLikedTracks,
  sortTracks,
  TRACK_SORT_DEFAULT_DIR,
  type TrackSort,
} from "@/lib/track-gallery";
import { searchTracks } from "@/lib/track-search";
import { cn, formatDuration, formatListenTime } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";
import { CollapsibleSearch } from "./collapsible-search";
import { EntityCoverButton } from "./entity-cover-button";
import { FilterChip, SortChip } from "./sort-chip";
import { TrackListSection } from "./track-list-section";
import { DETAIL_ALPHABET_MIN_TRACKS, useTrackAlphabetLetterOf } from "./use-track-alphabet";

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
  lastPlayed,
  memoryNotes,
  coverViewTransitionName,
  albumCoverViewTransitionName,
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
  /** trackId → last-played epoch ms, for the 最近播放 sort (folded from playback stats). */
  lastPlayed?: ReadonlyMap<string, number>;
  /** trackId → memory notes, so the in-list search matches notes too (gallery parity). */
  memoryNotes?: ReadonlyMap<string, readonly string[]>;
  /** `view-transition-name` for the header cover, so it's the morph counterpart of
   *  the wall card the user tapped (set only when arriving via a cover morph). */
  coverViewTransitionName?: string;
  /** Per-album strip card `view-transition-name` for artist-detail → album-detail morphs. */
  albumCoverViewTransitionName?: (key: string) => string | undefined;
  onOpenAlbum?: (key: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const playTrackInContext = usePlayerStore((s) => s.playTrackInContext);
  const coverUrl = useTrackCoverUrl(coverTrack);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  // Sort defaults to the entity's natural order (album track numbers) — null = no
  // chip active. Picking a chip sorts; re-clicking it flips direction. 红心 filters.
  const [sort, setSort] = useState<TrackSort | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [likedOnly, setLikedOnly] = useState(false);
  const likedIds = useLikedTrackIds();
  // In-set search, collapsed to an icon until opened (see CollapsibleSearch).
  const [query, setQuery] = useState("");
  // Re-run the search once the transliteration dictionaries load (gallery parity).
  const transliterationReady = useTransliterationReady();
  const round = kind === "artist";
  const Placeholder = round ? User : Disc3;

  function onSortClick(next: TrackSort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setSortDir(TRACK_SORT_DEFAULT_DIR[next]);
    }
  }

  // The displayed list: liked-filtered, then sorted only when a chip is active
  // (otherwise the passed-in natural order, e.g. album track numbers, is kept),
  // then searched. Empty query returns the order untouched.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    const filtered = filterLikedTracks(tracks, likedOnly, likedIds);
    const ordered = sort ? sortTracks(filtered, sort, sortDir, lastPlayed) : filtered;
    return searchTracks(ordered, query, memoryNotes);
  }, [
    tracks,
    likedOnly,
    likedIds,
    sort,
    sortDir,
    lastPlayed,
    query,
    memoryNotes,
    transliterationReady,
  ]);

  const alphabetLetterOf = useTrackAlphabetLetterOf(
    sort === "name" &&
      query.trim() === "" &&
      !likedOnly &&
      shownTracks.length > DETAIL_ALPHABET_MIN_TRACKS,
    transliterationReady,
  );
  const selectedTrack = useMemo(
    () => shownTracks.find((track) => track.id === selectedTrackId) ?? shownTracks[0],
    [selectedTrackId, shownTracks],
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
    if (shownTracks.length === 0) {
      setSelectedTrackId(null);
      return;
    }
    if (!selectedTrackId || !shownTracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(shownTracks[0].id);
    }
  }, [selectedTrackId, shownTracks]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="mx-auto flex h-full w-full max-w-6xl flex-col pt-chrome-top"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={t("gallery.back")}
        className="mb-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
      </button>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center gap-3">
            {entityKey ? (
              <EntityCoverButton
                entityKey={entityKey}
                kind={kind}
                coverTrack={coverTrack}
                round={round}
                viewTransitionName={coverViewTransitionName}
              />
            ) : (
              <CoverImage
                url={coverUrl}
                thumbhash={coverTrack?.coverThumbhash}
                rounded={round}
                placeholder={<Placeholder className="size-7 text-muted-foreground" />}
                className="size-20 shrink-0"
                style={
                  coverViewTransitionName
                    ? { viewTransitionName: coverViewTransitionName }
                    : undefined
                }
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
            <div className="no-scrollbar flex gap-2 overflow-x-auto" data-no-swipe-back>
              {albums.map((album) => (
                <AlbumStripCard
                  key={album.key}
                  album={album}
                  coverViewTransitionName={albumCoverViewTransitionName?.(album.key)}
                  onOpen={() => onOpenAlbum(album.key)}
                />
              ))}
            </div>
          )}

          <div className="mb-3 flex shrink-0 flex-wrap items-center gap-1.5">
            <SortChip active={sort === "name"} dir={sortDir} onClick={() => onSortClick("name")}>
              {t("gallery.sortName")}
            </SortChip>
            <SortChip
              active={sort === "created"}
              dir={sortDir}
              onClick={() => onSortClick("created")}
            >
              {t("gallery.sortCreated")}
            </SortChip>
            <SortChip
              active={sort === "updated"}
              dir={sortDir}
              onClick={() => onSortClick("updated")}
            >
              {t("gallery.sortUpdated")}
            </SortChip>
            <SortChip
              active={sort === "played"}
              dir={sortDir}
              onClick={() => onSortClick("played")}
            >
              {t("gallery.sortPlayed")}
            </SortChip>
            <SortChip
              active={sort === "duration"}
              dir={sortDir}
              onClick={() => onSortClick("duration")}
            >
              {t("gallery.sortDuration")}
            </SortChip>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            <FilterChip active={likedOnly} onClick={() => setLikedOnly((v) => !v)}>
              <Heart className={cn("size-3.5", likedOnly && "fill-current")} />
              {t("gallery.filterLiked")}
            </FilterChip>
          </div>

          <TrackListSection
            tracks={shownTracks}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
            onPlay={(track) =>
              void playTrackInContext(track, {
                // A derived entity with a stable projection key is its own context; a
                // pseudo-bucket (no key, e.g. "Unknown artist") falls back to library.
                source: entityKey
                  ? { kind: "entity", entityKind: kind, entityKey, label: title }
                  : { kind: "library" },
                tracks: shownTracks,
              })
            }
            alphabetLetterOf={alphabetLetterOf}
            emptyHint={t("gallery.tracksEmpty")}
            listClassName="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
            className="min-h-0 flex-1"
            endActions={
              <CollapsibleSearch
                value={query}
                onChange={setQuery}
                placeholder={t("gallery.searchSongs")}
              />
            }
          />
        </div>
        <TrackInspectorPanel track={selectedTrack} />
      </div>
    </motion.div>
  );
}

/** One album tile in the artist-detail albums strip. */
function AlbumStripCard({
  album,
  coverViewTransitionName,
  onOpen,
}: {
  album: EntityStripItem;
  coverViewTransitionName?: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackThumbnailUrl(album.coverTrack);
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
        className="aspect-square w-full"
        style={
          coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined
        }
      />
      <span className="block truncate text-xs">{album.label}</span>
    </button>
  );
}
