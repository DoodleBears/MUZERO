import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { CollapsibleSearch } from "@/components/library/collapsible-search";
import { CoverContextMenu } from "@/components/library/cover-context-menu";
import { EntityDetailView } from "@/components/library/entity-detail";
import { EntityCard, EntityGrid, type LibraryEntityItem } from "@/components/library/entity-grid";
import { FilterChip, SortChip } from "@/components/library/sort-chip";
import { TrackListSection } from "@/components/library/track-list-section";
import {
  VirtualCardGrid,
  type VirtualCardGridHandle,
} from "@/components/library/virtual-card-grid";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CoverImage } from "@/components/ui/cover-image";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsIndicator, TabsList, TabsTab } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AddTracksMenu } from "@/components/upload/add-tracks-menu";
import { db } from "@/db/muzero-db";
import {
  clearSessionCover,
  createSession,
  deleteTracks,
  getSession,
  listAllTracks,
  listSessions,
  memoryNotesByTrack,
  setSessionCover,
  setTrackCover,
  updateSession,
} from "@/db/repositories";
import type { CropRect, DjSession, Track } from "@/db/types";
import { useBackGesture } from "@/hooks/use-back-gesture";
import { useCoverThumbhashBackfill, useTrackCoverUrl } from "@/hooks/use-media";
import { useShortcutMatcher } from "@/hooks/use-shortcut-matcher";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { hasModalDialogOpen, isTypingTarget } from "@/lib/dom-keys";
import { ENTITY_SORT_DEFAULT_DIR, type EntitySort, sortEntities } from "@/lib/entity-gallery";
import { dragHasFiles, filesFromTransfer, IMAGE_ACCEPT } from "@/lib/file-drop";
import {
  type AlbumEntry,
  type ArtistEntry,
  albumsForArtist,
  buildAlbumIndex,
  buildArtistIndex,
  findAlbumForTrack,
  findArtistByName,
} from "@/lib/library-index";
import { rovingIndex } from "@/lib/library-nav";
import { buildTrackStatsMap, deriveEntityStats, statFor } from "@/lib/library-stats";
import { freeTextMatches } from "@/lib/search-core";
import {
  filterSets,
  SET_SORT_DEFAULT_DIR,
  type SetGalleryItem,
  type SetSort,
  type SortDir,
  sortSets,
} from "@/lib/set-gallery";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import {
  filterLikedTracks,
  sortTracks,
  TRACK_SORT_DEFAULT_DIR,
  type TrackSort,
} from "@/lib/track-gallery";
import { searchEntityFacets, searchTracks } from "@/lib/track-search";
import { cn, formatDuration, formatListenTime } from "@/lib/utils";
import { canViewTransition } from "@/lib/view-transition";
import { transitionState } from "@/lib/view-transition-react";
import { orderedSetTrackIds } from "@/player/set-order";
import { useCoverTargetStore } from "@/stores/cover-target-store";
import { useNavStore } from "@/stores/nav-store";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";
import { matchesRemoteSearchTrack } from "@/sync/r2-search-catalog";

type GalleryView = "list" | "grid";
type GalleryMode = "sets" | "tracks" | "albums" | "artists";
const GALLERY_MODES: GalleryMode[] = ["sets", "tracks", "albums", "artists"];
/** Direct-jump shortcut action → gallery tab (bare 1/2/3/4 on the wall). */
const GALLERY_TAB_ACTIONS: ReadonlyArray<readonly [string, GalleryMode]> = [
  ["nav.galleryTabSets", "sets"],
  ["nav.galleryTabTracks", "tracks"],
  ["nav.galleryTabAlbums", "albums"],
  ["nav.galleryTabArtists", "artists"],
];
const SEARCH_PLACEHOLDER_KEY = {
  sets: "gallery.searchSets",
  tracks: "gallery.searchTracks",
  albums: "gallery.searchAlbums",
  artists: "gallery.searchArtists",
} as const satisfies Record<GalleryMode, string>;
const MODE_KEY = "muzero-gallery-mode";
const VIEW_KEY = "muzero-gallery-view";
const EMPTY_MEMORY_NOTES = new Map<string, string[]>();
const TRACK_ROW_SELECTOR = "[data-muzero-track-row]";
/** The single shared `view-transition-name` the tapped wall cover and its detail
 *  cover both wear, so the browser morphs one into the other (only one element
 *  carries it at a time — see `morphKey`). */
const SHARED_COVER_VT = "gallery-cover";

function savedGalleryMode(): GalleryMode {
  if (typeof localStorage === "undefined") return "sets";
  const saved = localStorage.getItem(MODE_KEY);
  return GALLERY_MODES.includes(saved as GalleryMode) ? (saved as GalleryMode) : "sets";
}

function normalizeDescription(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

function stripDescriptionNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Total duration (seconds) of an entity's member tracks — the 时长 sort key. */
function entityDurationSec(trackIds: readonly string[], trackById: Map<string, Track>): number {
  let total = 0;
  for (const id of trackIds) total += trackById.get(id)?.durationSec ?? 0;
  return total;
}

const GALLERY_CARD_SELECTOR = "[data-gallery-card]";

/**
 * 歌单 Gallery — a two-level surface. Level 1 browses every set like an album wall
 * (search / filter / sort / list⇄album-grid). Tapping a set opens level 2: that
 * set's virtualized track list, with a back button + "play all". A small play
 * button on each card plays the set directly without entering it.
 */
export function SearchPage() {
  const { t } = useTranslation();
  // Backfill blurred previews for legacy/imported covers in the background.
  useCoverThumbhashBackfill();
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [mode, setMode] = useState<GalleryMode>(savedGalleryMode);
  const [setQuery, setSetQuery] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [albumQuery, setAlbumQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [sort, setSort] = useState<SetSort>("recent");
  const [sortDir, setSortDir] = useState<SortDir>(SET_SORT_DEFAULT_DIR.recent);
  // 全部歌曲 ordering: a single-select sort field + its direction, plus a 红心 filter.
  const [trackSort, setTrackSort] = useState<TrackSort>("created");
  const [trackSortDir, setTrackSortDir] = useState<SortDir>(TRACK_SORT_DEFAULT_DIR.created);
  const [likedOnly, setLikedOnly] = useState(false);
  // 专辑 / 歌手 ordering — one shared sort across both entity walls (like `view`).
  const [entitySort, setEntitySort] = useState<EntitySort>("name");
  const [entitySortDir, setEntitySortDir] = useState<SortDir>(ENTITY_SORT_DEFAULT_DIR.name);
  const [selectedLibraryTrackId, setSelectedLibraryTrackId] = useState<string | null>(null);
  const [selectedArtistKey, setSelectedArtistKey] = useState<string | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const [view, setView] = useState<GalleryView>(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY)) === "grid"
      ? "grid"
      : "list",
  );
  const [deletingSet, setDeletingSet] = useState<DjSession | null>(null);
  const [deletingEntity, setDeletingEntity] = useState<{
    kind: "album" | "artist";
    name: string;
    trackIds: string[];
  } | null>(null);
  // Wall scroll + roving-focus memory: restore the scroll position and re-focus
  // the card we backed out of when returning from a detail (so W/S/↑↓ continues).
  const wallScrollRef = useRef<HTMLDivElement | null>(null);
  // Smooth-scroll the gallery wall; the virtualized grids route their
  // restore/scrollToIndex through this so they don't fight the smoothing.
  const { lenisRef: wallLenisRef } = useSmoothScroll(wallScrollRef);
  // Adopt the wall scroller as STATE (not just a ref) so the virtualized grids
  // re-render with a live scroller the instant the callback ref attaches it.
  // Returning from a detail remounts the scroller and the grid in one commit; a
  // ref the grid reads in a mount-time layout effect lands before the parent ref
  // is set, leaving the virtualizer scroller-less for a frame → an empty wall.
  const [wallScrollEl, setWallScrollEl] = useState<HTMLDivElement | null>(null);
  // Per-mode scroll memory: each wall (sets / albums / artists) remembers its own
  // position, so backing out of a detail — or flipping tabs — lands where you left
  // off instead of snapping to the top of the list.
  const wallScrollTops = useRef<Partial<Record<GalleryMode, number>>>({});
  const returnFocusKeyRef = useRef<string | null>(null);
  // Shared-element cover morph (Chromium/Electron only): the namespaced key (e.g.
  // `album:<key>`) of the cover currently morphing. Both the tapped wall card and
  // its detail cover wear `SHARED_COVER_VT` while they match this, so the browser
  // morphs one into the other; exactly one element carries the name at a time.
  const [morphKey, setMorphKey] = useState<string | null>(null);
  // Handle to the active virtualized wall, so roving keyboard nav can scroll a
  // card that's been virtualized off-screen back into view before focusing it.
  const galleryRef = useRef<VirtualCardGridHandle | null>(null);
  // Library/gallery keys resolve through the configurable registry (so rebinds
  // take effect). Held in a ref so the window listeners stay stable.
  const matches = useShortcutMatcher();
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  const sessions = useLiveQuery(() => listSessions(db), [], []);
  const allTracks = useLiveQuery(() => listAllTracks(db), [], []);
  const remoteTracks = useLiveQuery(() => db.remoteSearchTracks.toArray(), [], []);
  const memoryNotes = useLiveQuery(
    () =>
      allTracks.length > 0
        ? memoryNotesByTrack(
            allTracks.map((track) => track.id),
            db,
          )
        : Promise.resolve(EMPTY_MEMORY_NOTES),
    [allTracks],
    EMPTY_MEMORY_NOTES,
  );
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const play = usePlayerStore((s) => s.play);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const deleteSession = usePlayerStore((s) => s.deleteSession);
  const setUploadTarget = useUploadTargetStore((s) => s.setTarget);
  const setCoverTarget = useCoverTargetStore((s) => s.setCoverTarget);

  // Songs that live ONLY in the set being deleted — shown in the "+ songs" option.
  const deletingExclusiveCount = useMemo(() => {
    if (!deletingSet) return 0;
    const elsewhere = new Set(
      sessions.filter((s) => s.id !== deletingSet.id).flatMap((s) => s.trackIds),
    );
    return deletingSet.trackIds.filter((id) => !elsewhere.has(id)).length;
  }, [deletingSet, sessions]);

  // Route app-wide dropped/pasted media: a set detail → that set; the album wall →
  // a target-set picker. Reset to the default behavior when leaving the gallery.
  useEffect(() => {
    setUploadTarget(selectedSetId ? { kind: "set", setId: selectedSetId } : { kind: "pick" });
    return () => setUploadTarget({ kind: "active" });
  }, [selectedSetId, setUploadTarget]);

  useEffect(() => {
    if (selectedSetId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesRef.current(event, "nav.cycleGalleryMode")) return;
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      event.preventDefault();
      // ` cycles forward through the tabs; Shift+` walks back to the previous one.
      const count = GALLERY_MODES.length;
      const step = event.shiftKey ? -1 : 1;
      const next = GALLERY_MODES[(GALLERY_MODES.indexOf(mode) + step + count) % count];
      setMode(next);
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, selectedSetId]);

  // Bare 1/2/3/4 jump straight to a library tab (sets / songs / albums / artists),
  // at the wall only. Resolved through the registry, so the digits are rebindable.
  useEffect(() => {
    if (selectedSetId || selectedArtistKey || selectedAlbumKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      const hit = GALLERY_TAB_ACTIONS.find(([action]) => matchesRef.current(event, action));
      if (!hit) return;
      event.preventDefault();
      setMode(hit[1]);
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, hit[1]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedSetId, selectedArtistKey, selectedAlbumKey]);

  const trackById = useMemo(() => new Map(allTracks.map((tr) => [tr.id, tr])), [allTracks]);

  // Derived artist/album entities — pure projections over the imported metadata
  // (no stored table); re-project whenever the track liveQuery emits.
  const artistIndex = useMemo(() => buildArtistIndex(allTracks), [allTracks]);
  const albumIndex = useMemo(() => buildAlbumIndex(allTracks), [allTracks]);
  // Per-artist/album listening time — a derived current-truth dimension folded
  // from the per-track playback signal (re-tag re-buckets; see PRD §3.4).
  const playbackStats = useLiveQuery(() => db.trackPlaybackStats.toArray(), [], []);
  const statsByTrackId = useMemo(() => buildTrackStatsMap(playbackStats), [playbackStats]);
  // trackId → last-played epoch ms, for the 最近播放 sort (never-played omitted → 0).
  const lastPlayedByTrack = useMemo(() => {
    const map = new Map<string, number>();
    for (const [trackId, stat] of statsByTrackId) {
      if (stat.lastPlayedAt) map.set(trackId, stat.lastPlayedAt);
    }
    return map;
  }, [statsByTrackId]);
  const artistStats = useMemo(
    () => deriveEntityStats(artistIndex, statsByTrackId),
    [artistIndex, statsByTrackId],
  );
  const albumStats = useMemo(
    () => deriveEntityStats(albumIndex, statsByTrackId),
    [albumIndex, statsByTrackId],
  );
  // Lazily load the transliteration dictionaries (pinyin / kana / romaji) on the
  // main thread; the flag re-runs the inline matchers below once ready so search
  // "snaps in" without retyping. (The ⌘F overlay scans off-thread via its Worker.)
  const transliterationReady = useTransliterationReady();
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const artistItems = useMemo<LibraryEntityItem[]>(() => {
    const enriched = artistIndex
      .map((entry) => {
        const count = t("gallery.count", { count: entry.trackIds.length });
        const stat = statFor(artistStats, entry.key);
        const label = artistDisplayLabel(entry, t);
        return {
          key: entry.key,
          label,
          sublabel:
            stat.listenedSec > 0 ? `${count} · ${formatListenTime(stat.listenedSec)}` : count,
          coverTrackId: entry.coverTrackId,
          // Sort keys (entity-gallery): pseudo-buckets pin last; duration sums members.
          name: label,
          trackCount: entry.trackIds.length,
          durationSec: entityDurationSec(entry.trackIds, trackById),
          lastPlayedAt: stat.lastPlayedAt ?? 0,
          isBucket: Boolean(entry.bucket),
        };
      })
      .filter((item) => freeTextMatches(artistQuery, [item.label]));
    return sortEntities(enriched, entitySort, entitySortDir);
  }, [
    artistIndex,
    artistQuery,
    t,
    artistStats,
    trackById,
    entitySort,
    entitySortDir,
    transliterationReady,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const albumItems = useMemo<LibraryEntityItem[]>(() => {
    const enriched = albumIndex
      .map((entry) => {
        const base =
          entry.bucket === "unknown"
            ? t("gallery.count", { count: entry.trackIds.length })
            : albumArtistDisplayLabel(entry, t);
        const stat = statFor(albumStats, entry.key);
        const label = albumDisplayLabel(entry, t);
        return {
          key: entry.key,
          label,
          sublabel: stat.listenedSec > 0 ? `${base} · ${formatListenTime(stat.listenedSec)}` : base,
          coverTrackId: entry.coverTrackId,
          name: label,
          trackCount: entry.trackIds.length,
          durationSec: entityDurationSec(entry.trackIds, trackById),
          lastPlayedAt: stat.lastPlayedAt ?? 0,
          isBucket: Boolean(entry.bucket),
        };
      })
      .filter((item) => freeTextMatches(albumQuery, [item.label]));
    return sortEntities(enriched, entitySort, entitySortDir);
  }, [
    albumIndex,
    albumQuery,
    t,
    albumStats,
    trackById,
    entitySort,
    entitySortDir,
    transliterationReady,
  ]);
  const selectedArtist = useMemo(
    () => artistIndex.find((entry) => entry.key === selectedArtistKey),
    [artistIndex, selectedArtistKey],
  );
  const selectedAlbum = useMemo(
    () => albumIndex.find((entry) => entry.key === selectedAlbumKey),
    [albumIndex, selectedAlbumKey],
  );

  // Open an artist/album requested from elsewhere (track rows / inspector render
  // outside this page). Resolve against the derived indexes once they're ready;
  // leave the intent pending until the entity exists (the index may still be
  // building from the track liveQuery).
  const pendingEntity = useNavStore((s) => s.pendingLibraryEntity);
  const consumeLibraryEntity = useNavStore((s) => s.consumeLibraryEntity);
  useEffect(() => {
    if (!pendingEntity) return;
    if (pendingEntity.kind === "artist") {
      const entry = findArtistByName(artistIndex, pendingEntity.name);
      if (!entry) return;
      setMode("artists");
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "artists");
      setSelectedSetId(null);
      setSelectedAlbumKey(null);
      setSelectedArtistKey(entry.key);
    } else {
      const entry = findAlbumForTrack(albumIndex, pendingEntity.trackId);
      if (!entry) return;
      setMode("albums");
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "albums");
      setSelectedSetId(null);
      setSelectedArtistKey(null);
      setSelectedAlbumKey(entry.key);
    }
    consumeLibraryEntity();
  }, [pendingEntity, artistIndex, albumIndex, consumeLibraryEntity]);

  // Faceted search: matching artists/albums surfaced above the song list in the
  // tracks ("全部歌曲") mode (honors scoped artist:/album: tokens).
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const trackFacets = useMemo(
    () => searchEntityFacets(artistIndex, albumIndex, trackQuery),
    [artistIndex, albumIndex, trackQuery, transliterationReady],
  );
  const facetArtistItems = useMemo<LibraryEntityItem[]>(
    () =>
      trackFacets.artists.slice(0, 8).map((entry) => ({
        key: entry.key,
        label: artistDisplayLabel(entry, t),
        sublabel: t("gallery.count", { count: entry.trackIds.length }),
        coverTrackId: entry.coverTrackId,
      })),
    [trackFacets, t],
  );
  const facetAlbumItems = useMemo<LibraryEntityItem[]>(
    () =>
      trackFacets.albums.slice(0, 8).map((entry) => ({
        key: entry.key,
        label: albumDisplayLabel(entry, t),
        sublabel: albumArtistDisplayLabel(entry, t),
        coverTrackId: entry.coverTrackId,
      })),
    [trackFacets, t],
  );

  const items = useMemo<SetGalleryItem[]>(
    () =>
      sessions.map((s) => {
        const setTracks = s.trackIds
          .map((id) => trackById.get(id))
          .filter((tr): tr is Track => !!tr);
        const cover = setTracks.find((tr) => tr.coverBlobId);
        return {
          session: s,
          trackCount: s.trackIds.length,
          likedCount: setTracks.filter((tr) => tr.liked).length,
          lastActivityAt: s.updatedAt,
          coverTrackId: cover?.id ?? s.trackIds[0],
          matchesQuery: (trackQuery) => searchTracks(setTracks, trackQuery, memoryNotes).length > 0,
        };
      }),
    [memoryNotes, sessions, trackById],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shown = useMemo(
    () => sortSets(filterSets(items, setQuery), sort, sortDir),
    [items, setQuery, sort, sortDir, transliterationReady],
  );
  // Stable key accessors for the virtualized walls (kept stable so the grid's
  // memoized scroll/focus callbacks don't churn every render).
  const getSetKey = useCallback((item: SetGalleryItem) => item.session.id, []);
  const getEntityKey = useCallback((item: LibraryEntityItem) => item.key, []);
  // The active wall's cards in display order — roving keyboard nav walks these
  // keys (not the DOM) so it can reach cards that virtualization hasn't mounted.
  const galleryKeys = useMemo<string[]>(() => {
    if (mode === "sets") return shown.map((item) => item.session.id);
    if (mode === "albums") return albumItems.map((item) => item.key);
    if (mode === "artists") return artistItems.map((item) => item.key);
    return [];
  }, [mode, shown, albumItems, artistItems]);
  const galleryKeysRef = useRef(galleryKeys);
  galleryKeysRef.current = galleryKeys;
  // Pre-sort + liked-filter, then search: with no query the chosen order shows
  // through; with a query, relevance wins and the sort is the stable tiebreak.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    const sorted = sortTracks(
      filterLikedTracks(allTracks, likedOnly),
      trackSort,
      trackSortDir,
      lastPlayedByTrack,
    );
    return searchTracks(sorted, trackQuery, memoryNotes);
  }, [
    allTracks,
    likedOnly,
    trackSort,
    trackSortDir,
    lastPlayedByTrack,
    memoryNotes,
    trackQuery,
    transliterationReady,
  ]);
  const selectedLibraryTrack = useMemo(
    () => shownTracks.find((track) => track.id === selectedLibraryTrackId) ?? shownTracks[0],
    [selectedLibraryTrackId, shownTracks],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownRemoteTracks = useMemo(
    () =>
      trackQuery.trim()
        ? remoteTracks
            .filter((track) => matchesRemoteSearchTrack(track, trackQuery))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [remoteTracks, trackQuery, transliterationReady],
  );
  const query =
    mode === "sets"
      ? setQuery
      : mode === "tracks"
        ? trackQuery
        : mode === "albums"
          ? albumQuery
          : artistQuery;
  const setQueryForMode = (value: string) => {
    if (mode === "sets") setSetQuery(value);
    else if (mode === "tracks") setTrackQuery(value);
    else if (mode === "albums") setAlbumQuery(value);
    else setArtistQuery(value);
  };

  useEffect(() => {
    if (mode !== "tracks") return;
    if (shownTracks.length === 0) {
      setSelectedLibraryTrackId(null);
      return;
    }
    if (
      !selectedLibraryTrackId ||
      !shownTracks.some((track) => track.id === selectedLibraryTrackId)
    ) {
      setSelectedLibraryTrackId(shownTracks[0].id);
    }
  }, [mode, selectedLibraryTrackId, shownTracks]);

  // Publish the image-paste cover target (see cover-target-store) for the surface
  // on screen: the 全部歌曲 list targets its selected song; set detail and the
  // grids have no per-track target (clear). An artist/album detail publishes its
  // own selection, so leave the store to it. Clear on unmount (tab switch).
  useEffect(() => {
    if (selectedArtist || selectedAlbum) return;
    setCoverTarget(!selectedSetId && mode === "tracks" ? (selectedLibraryTrackId ?? null) : null);
  }, [selectedArtist, selectedAlbum, selectedSetId, mode, selectedLibraryTrackId, setCoverTarget]);
  useEffect(() => () => setCoverTarget(null), [setCoverTarget]);

  function setViewPref(next: GalleryView) {
    setView(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_KEY, next);
  }

  function setModePref(next: GalleryMode) {
    setMode(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, next);
  }

  // Sort chips: re-clicking the active field flips direction; picking a new field
  // selects it at its natural orientation (newest/longest first, names A→Z).
  function onSetSortClick(next: SetSort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setSortDir(SET_SORT_DEFAULT_DIR[next]);
    }
  }

  function onTrackSortClick(next: TrackSort) {
    if (trackSort === next) setTrackSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setTrackSort(next);
      setTrackSortDir(TRACK_SORT_DEFAULT_DIR[next]);
    }
  }

  function onEntitySortClick(next: EntitySort) {
    if (entitySort === next) setEntitySortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setEntitySort(next);
      setEntitySortDir(ENTITY_SORT_DEFAULT_DIR[next]);
    }
  }

  async function playSet(setId: string) {
    await setActiveSession(setId);
    void play();
  }

  async function createNewSet() {
    const s = await createSession({
      name: t("gallery.newSetName"),
      seedPrompt: "",
      config: { autoExtend: false },
    });
    transitionState(() => setSelectedSetId(s.id));
  }

  // The `view-transition-name` for a cover whose namespaced key matches the active
  // morph — applied to the tapped wall card and its detail counterpart so they're
  // the two ends of the same morph; everything else stays unnamed.
  const coverMorphName = (ns: string): string | undefined =>
    morphKey === ns ? SHARED_COVER_VT : undefined;

  // Tag the tapped cover BEFORE the transition snapshots the old DOM, so the
  // browser can pair it with the detail cover that mounts in the update. flushSync
  // forces the name into the DOM synchronously; skipped where native VT is off
  // (the name would be inert) so non-Chromium shells don't pay an extra render.
  function beginCoverMorph(ns: string) {
    if (canViewTransition()) flushSync(() => setMorphKey(ns));
  }

  // Leaving a detail (back, or hopping artist → album): drop the morph name BEFORE
  // the snapshot so the detail cover doesn't animate one-sidedly — the returning
  // wall card is virtualized away at snapshot time, so there's nothing to pair
  // with, and a plain cross-fade reads cleaner than a lone cover scaling out.
  function leaveDetail(update: () => void) {
    if (canViewTransition() && morphKey) flushSync(() => setMorphKey(null));
    transitionState(update);
  }

  // Opening a card remembers it so backing out re-focuses it (W/S/↑↓ continue from
  // there) and restores the wall scroll position on the way back.
  function openSet(id: string) {
    returnFocusKeyRef.current = id;
    beginCoverMorph(`set:${id}`);
    transitionState(() => setSelectedSetId(id));
  }
  function openArtist(key: string) {
    returnFocusKeyRef.current = key;
    beginCoverMorph(`artist:${key}`);
    transitionState(() => setSelectedArtistKey(key));
  }
  function openAlbum(key: string) {
    returnFocusKeyRef.current = key;
    beginCoverMorph(`album:${key}`);
    transitionState(() => setSelectedAlbumKey(key));
  }

  // Wall scroll container: adopt it as state so the grids re-render with a live
  // scroller the instant it attaches. Scroll-position restore is owned by the grid
  // (`restoreScrollTop`), which waits until its row estimate is known so a deep
  // offset isn't clamped against a not-yet-measured page. Re-focusing the card we
  // came from is owned by the grid too (`initialFocusKey`).
  const attachWall = useCallback((node: HTMLDivElement | null) => {
    wallScrollRef.current = node;
    setWallScrollEl(node);
  }, []);

  // Scroll a wall card into view (it may be virtualized away) and focus it.
  const focusGalleryCard = useCallback((key: string | undefined) => {
    if (!key) return;
    galleryRef.current?.scrollToKey(key);
    const sel = `[data-gallery-card-key="${CSS.escape(key)}"]`;
    const existing = wallScrollRef.current?.querySelector<HTMLElement>(sel);
    if (existing) {
      existing.focus();
      existing.scrollIntoView({ block: "nearest" });
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        wallScrollRef.current?.querySelector<HTMLElement>(sel)?.focus();
      });
    });
  }, []);

  // Roving keyboard focus over the wall's cards (sets/albums/artists grids): W/↑
  // prev, S/↓ next, D/→ open. The 全部歌曲 list keeps its own row nav. Runs in
  // capture so ↑/↓ move focus here rather than changing volume (player shortcuts).
  useEffect(() => {
    const detailOpen = !!selectedSetId || !!selectedArtistKey || !!selectedAlbumKey;
    if (detailOpen || mode === "tracks") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      const match = matchesRef.current;
      const intent: "prev" | "next" | "open" | null = match(event, "library.focusPrev")
        ? "prev"
        : match(event, "library.focusNext")
          ? "next"
          : match(event, "library.open")
            ? "open"
            : null;
      if (!intent) return; // library.back is handled by the detail back-gesture, not the wall
      // Walk the ordered key list (not the DOM): virtualization mounts only the
      // visible cards, so the target may not exist yet — `focusGalleryCard`
      // scrolls it in first.
      const keys = galleryKeysRef.current;
      if (keys.length === 0) return;
      const activeCard =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.closest<HTMLElement>(GALLERY_CARD_SELECTOR)
          : null;
      const activeKey = activeCard?.dataset.galleryCardKey ?? null;
      const activeIndex = activeKey ? keys.indexOf(activeKey) : -1;
      if (intent === "open") {
        if (event.key.toLowerCase() === "enter") return; // focused button clicks natively
        event.preventDefault();
        event.stopImmediatePropagation();
        if (activeCard) activeCard.click();
        else focusGalleryCard(keys[0]);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const fallbackKey = returnFocusKeyRef.current;
      const fallbackIndex = fallbackKey ? keys.indexOf(fallbackKey) : 0;
      const target = rovingIndex(keys.length, activeIndex, intent, Math.max(0, fallbackIndex));
      focusGalleryCard(keys[target]);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [mode, selectedSetId, selectedArtistKey, selectedAlbumKey, focusGalleryCard]);

  function focusTrackSearchResult(direction: "first" | "last") {
    if (mode !== "tracks" || shownTracks.length === 0) return;
    const list = document.querySelector<HTMLElement>('[data-testid="virtual-track-list"]');
    if (list) list.scrollTop = direction === "first" ? 0 : list.scrollHeight;
    const index = direction === "first" ? 0 : shownTracks.length - 1;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLElement>(`${TRACK_ROW_SELECTOR}[data-track-index="${index}"]`)
          ?.focus();
      });
    });
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (mode !== "tracks" || shownTracks.length === 0) return;
    event.preventDefault();
    focusTrackSearchResult(event.key === "ArrowDown" ? "first" : "last");
  }

  // Level 2: a set's track list.
  if (selectedSetId) {
    return (
      <SetDetailView
        setId={selectedSetId}
        trackById={trackById}
        lastPlayed={lastPlayedByTrack}
        coverViewTransitionName={coverMorphName(`set:${selectedSetId}`)}
        onBack={() => leaveDetail(() => setSelectedSetId(null))}
        onPlayAll={() => void playSet(selectedSetId)}
      />
    );
  }

  // Level 2: a derived artist's or album's track list.
  if (selectedArtist) {
    const tracks = selectedArtist.trackIds
      .map((id) => trackById.get(id))
      .filter((tr): tr is Track => !!tr);
    const artistAlbums = albumsForArtist(albumIndex, selectedArtist.trackIds).map((album) => ({
      key: album.key,
      label: albumDisplayLabel(album, t),
      coverTrack: album.coverTrackId ? trackById.get(album.coverTrackId) : undefined,
    }));
    return (
      <EntityDetailView
        kind="artist"
        entityKey={selectedArtist.bucket ? undefined : selectedArtist.key}
        title={artistDisplayLabel(selectedArtist, t)}
        subtitle={t("gallery.albumCount", { count: artistAlbums.length })}
        coverTrack={
          selectedArtist.coverTrackId ? trackById.get(selectedArtist.coverTrackId) : undefined
        }
        tracks={tracks}
        albums={artistAlbums}
        stat={statFor(artistStats, selectedArtist.key)}
        lastPlayed={lastPlayedByTrack}
        memoryNotes={memoryNotes}
        coverViewTransitionName={coverMorphName(`artist:${selectedArtist.key}`)}
        onOpenAlbum={(key) =>
          leaveDetail(() => {
            setSelectedArtistKey(null);
            setSelectedAlbumKey(key);
          })
        }
        onBack={() => leaveDetail(() => setSelectedArtistKey(null))}
      />
    );
  }
  if (selectedAlbum) {
    const tracks = selectedAlbum.trackIds
      .map((id) => trackById.get(id))
      .filter((tr): tr is Track => !!tr);
    return (
      <EntityDetailView
        kind="album"
        entityKey={
          selectedAlbum.bucket || selectedAlbum.isCompilation ? undefined : selectedAlbum.key
        }
        title={albumDisplayLabel(selectedAlbum, t)}
        subtitle={
          selectedAlbum.bucket === "unknown" ? "" : albumArtistDisplayLabel(selectedAlbum, t)
        }
        coverTrack={
          selectedAlbum.coverTrackId ? trackById.get(selectedAlbum.coverTrackId) : undefined
        }
        tracks={tracks}
        stat={statFor(albumStats, selectedAlbum.key)}
        lastPlayed={lastPlayedByTrack}
        memoryNotes={memoryNotes}
        coverViewTransitionName={coverMorphName(`album:${selectedAlbum.key}`)}
        onBack={() => leaveDetail(() => setSelectedAlbumKey(null))}
      />
    );
  }

  // Level 1: the album wall. The mode tabs + search box are a pinned toolbar at the
  // top (just below the floating wordmark); only the content region below scrolls,
  // dissolving under the floating chrome (`chrome-fade`) top and bottom.
  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full flex-col px-4 pt-chrome-top lg:px-6",
        mode === "tracks" ? "max-w-6xl" : "max-w-4xl",
      )}
    >
      {/* Pinned toolbar — the mode tabs + search box stay put while only the content
          below scrolls. No background: it sits cleanly over the page / ambient stage,
          and the scroller's chrome-fade dissolves rows as they reach the top. */}
      <div className="shrink-0">
        <TooltipProvider>
          <Tabs
            value={mode}
            onValueChange={(value) => setModePref(value as GalleryMode)}
            className="mb-3 mx-auto w-fit"
          >
            <TabsList>
              <TabsIndicator />
              <ModeTab value="sets" shortcut="1">
                {t("gallery.modeSets")}
              </ModeTab>
              <ModeTab value="tracks" shortcut="2">
                {t("gallery.modeTracks")}
              </ModeTab>
              <ModeTab value="albums" shortcut="3">
                {t("gallery.modeAlbums")}
              </ModeTab>
              <ModeTab value="artists" shortcut="4">
                {t("gallery.modeArtists")}
              </ModeTab>
            </TabsList>
          </Tabs>
        </TooltipProvider>

        <div className="flex items-center gap-2 px-1">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQueryForMode(e.target.value)}
              placeholder={t(SEARCH_PLACEHOLDER_KEY[mode])}
              className="pl-9"
              data-muzero-search-input
              onKeyDown={onSearchKeyDown}
            />
          </div>
          {mode === "sets" && (
            <Button
              variant="outline"
              onClick={() => void createNewSet()}
              className="h-10 shrink-0 sm:h-10"
            >
              <Plus className="size-4" /> {t("gallery.newSet")}
            </Button>
          )}
          {mode !== "tracks" && <ViewToggleGroup view={view} onChange={setViewPref} />}
        </div>
      </div>

      {/* Content region. Single-column walls (sets / albums / artists) scroll here and
          dissolve under the floating search box via the top `chrome-fade`. Tracks mode
          is a two-pane master/detail instead: this frame does NOT scroll — the list and
          the inspector are each their own bounded scroll column (each with its own top
          fade), so neither pane drives the other's height and the inspector no longer
          gets clipped by the dock. */}
      <div
        ref={attachWall}
        onScroll={(e) => {
          wallScrollTops.current[mode] = e.currentTarget.scrollTop;
        }}
        className={cn(
          "no-scrollbar flex min-h-0 flex-1 flex-col px-1 pt-3",
          // Tracks mode: a clipped, non-scrolling frame so the two panes inside are
          // capped to the viewport and scroll themselves. Other walls scroll here.
          mode === "tracks"
            ? "overflow-hidden pb-0"
            : "chrome-fade overflow-y-auto pb-chrome-bottom [--chrome-fade-top:1.25rem]",
        )}
      >
        {mode === "sets" && (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 px-1">
              <SortChip
                active={sort === "recent"}
                dir={sortDir}
                onClick={() => onSetSortClick("recent")}
              >
                {t("gallery.sortRecent")}
              </SortChip>
              <SortChip
                active={sort === "name"}
                dir={sortDir}
                onClick={() => onSetSortClick("name")}
              >
                {t("gallery.sortName")}
              </SortChip>
              <SortChip
                active={sort === "size"}
                dir={sortDir}
                onClick={() => onSetSortClick("size")}
              >
                {t("gallery.sortSize")}
              </SortChip>
            </div>

            {/* Right-click anywhere on the wall (incl. empty space) to start a new set. */}
            <ContextMenu>
              <ContextMenuTrigger className="block min-h-[40vh]">
                {shown.length === 0 ? (
                  <p className="mt-12 text-center text-sm text-muted-foreground">
                    {t("gallery.empty")}
                  </p>
                ) : (
                  <VirtualCardGrid
                    gridRef={galleryRef}
                    items={shown}
                    view={view}
                    getKey={getSetKey}
                    scrollElement={wallScrollEl}
                    lenisRef={wallLenisRef}
                    restoreScrollTop={wallScrollTops.current.sets}
                    initialFocusKey={returnFocusKeyRef.current}
                    onInitialFocusHandled={() => {
                      returnFocusKeyRef.current = null;
                    }}
                    renderCard={(item) => (
                      <SetCard
                        item={item}
                        coverTrack={
                          item.coverTrackId ? trackById.get(item.coverTrackId) : undefined
                        }
                        view={view}
                        coverViewTransitionName={coverMorphName(`set:${item.session.id}`)}
                        onEnter={() => openSet(item.session.id)}
                        onPlay={() => void playSet(item.session.id)}
                        onRequestDelete={() => setDeletingSet(item.session)}
                      />
                    )}
                  />
                )}
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => void createNewSet()}>
                  <Plus /> {t("gallery.newSet")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </>
        )}
        {deletingSet ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setDeletingSet(null);
            }}
            title={t("set.deleteTitle", { name: deletingSet.name })}
            description={t("set.deleteBody")}
            confirm={{
              label: t("set.deleteOnly"),
              variant: "destructive-outline",
              onConfirm: async () => {
                await deleteSession(deletingSet.id, false);
                notify.success(t("set.deleted"));
              },
            }}
            secondary={
              deletingExclusiveCount > 0
                ? {
                    label: t("set.deleteWithExclusive", { count: deletingExclusiveCount }),
                    variant: "destructive",
                    onConfirm: async () => {
                      const purged = await deleteSession(deletingSet.id, true);
                      notify.success(t("set.deletedWithSongs", { count: purged }));
                    },
                  }
                : undefined
            }
          />
        ) : null}
        {deletingEntity ? (
          <ConfirmDialog
            open
            onOpenChange={(open) => {
              if (!open) setDeletingEntity(null);
            }}
            title={t("entity.deleteTitle", { name: deletingEntity.name })}
            description={t("entity.deleteBody", { count: deletingEntity.trackIds.length })}
            confirm={{
              label: t("entity.deleteConfirm", { count: deletingEntity.trackIds.length }),
              onConfirm: async () => {
                await deleteTracks(deletingEntity.trackIds);
                notify.success(t("select.deleted", { count: deletingEntity.trackIds.length }));
              },
            }}
          />
        ) : null}

        {mode === "tracks" && (
          <div className="flex min-h-0 flex-1 flex-col">
            {shownTracks.length === 0 &&
            shownRemoteTracks.length === 0 &&
            facetArtistItems.length === 0 &&
            facetAlbumItems.length === 0 ? (
              <p className="mt-12 text-center text-sm text-muted-foreground">
                {t("gallery.tracksEmpty")}
              </p>
            ) : (
              <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  {(shownTracks.length > 0 ||
                    facetArtistItems.length > 0 ||
                    facetAlbumItems.length > 0) && (
                    <TrackListSection
                      tracks={shownTracks}
                      selectedTrackId={selectedLibraryTrack?.id}
                      onView={(track) => transitionState(() => setSelectedLibraryTrackId(track.id))}
                      onPlay={(track) => void playTrack(track)}
                      emptyHint={t("gallery.tracksEmpty")}
                      listClassName="chrome-fade no-scrollbar pt-1.5 pb-chrome-bottom [--chrome-fade-top:0.75rem]"
                      className="flex-1"
                      startActions={<AddTracksMenu />}
                      listHeader={
                        <>
                          {/* Sort + 红心 filter, then any search facets — these scroll
                              WITH the rows (rendered inside the list's scroller). */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            <SortChip
                              active={trackSort === "name"}
                              dir={trackSortDir}
                              onClick={() => onTrackSortClick("name")}
                            >
                              {t("gallery.sortName")}
                            </SortChip>
                            <SortChip
                              active={trackSort === "created"}
                              dir={trackSortDir}
                              onClick={() => onTrackSortClick("created")}
                            >
                              {t("gallery.sortCreated")}
                            </SortChip>
                            <SortChip
                              active={trackSort === "updated"}
                              dir={trackSortDir}
                              onClick={() => onTrackSortClick("updated")}
                            >
                              {t("gallery.sortUpdated")}
                            </SortChip>
                            <SortChip
                              active={trackSort === "played"}
                              dir={trackSortDir}
                              onClick={() => onTrackSortClick("played")}
                            >
                              {t("gallery.sortPlayed")}
                            </SortChip>
                            <SortChip
                              active={trackSort === "duration"}
                              dir={trackSortDir}
                              onClick={() => onTrackSortClick("duration")}
                            >
                              {t("gallery.sortDuration")}
                            </SortChip>
                            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                            <FilterChip active={likedOnly} onClick={() => setLikedOnly((v) => !v)}>
                              <Heart className={cn("size-3.5", likedOnly && "fill-current")} />
                              {t("gallery.filterLiked")}
                            </FilterChip>
                          </div>
                          {(facetArtistItems.length > 0 || facetAlbumItems.length > 0) && (
                            <div className="flex flex-col gap-3">
                              {facetArtistItems.length > 0 && (
                                <div>
                                  <p className="mb-1 px-1 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                                    {t("gallery.modeArtists")}
                                  </p>
                                  <EntityGrid
                                    items={facetArtistItems}
                                    kind="artist"
                                    view="list"
                                    trackById={trackById}
                                    onOpen={openArtist}
                                    emptyHint=""
                                  />
                                </div>
                              )}
                              {facetAlbumItems.length > 0 && (
                                <div>
                                  <p className="mb-1 px-1 text-muted-foreground text-xs font-medium uppercase tracking-wide">
                                    {t("gallery.modeAlbums")}
                                  </p>
                                  <EntityGrid
                                    items={facetAlbumItems}
                                    kind="album"
                                    view="list"
                                    trackById={trackById}
                                    onOpen={openAlbum}
                                    emptyHint=""
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      }
                    />
                  )}
                  {shownRemoteTracks.length > 0 && (
                    <div className="flex flex-col gap-1 pb-chrome-bottom">
                      <p className="px-1 text-muted-foreground text-xs">
                        {t("gallery.remoteResults", { count: shownRemoteTracks.length })}
                      </p>
                      {shownRemoteTracks.slice(0, 50).map((track) => (
                        <div
                          key={track.id}
                          className="rounded-md border border-border bg-background/70 px-3 py-2"
                        >
                          <p className="truncate text-sm">{track.title}</p>
                          <p className="truncate text-muted-foreground text-xs">
                            {track.tags.map((tag) => `#${tag}`).join(" ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <TrackInspectorPanel track={selectedLibraryTrack} />
              </div>
            )}
          </div>
        )}

        {mode === "albums" && (
          <>
            <EntitySortRow sort={entitySort} dir={entitySortDir} onSort={onEntitySortClick} />
            {albumItems.length === 0 ? (
              <p className="mt-12 text-center text-muted-foreground text-sm">
                {t("gallery.albumsEmpty")}
              </p>
            ) : (
              <VirtualCardGrid
                gridRef={galleryRef}
                items={albumItems}
                view={view}
                getKey={getEntityKey}
                scrollElement={wallScrollEl}
                lenisRef={wallLenisRef}
                restoreScrollTop={wallScrollTops.current.albums}
                initialFocusKey={returnFocusKeyRef.current}
                onInitialFocusHandled={() => {
                  returnFocusKeyRef.current = null;
                }}
                renderCard={(item) => (
                  <EntityCard
                    item={item}
                    kind="album"
                    view={view}
                    coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                    coverViewTransitionName={coverMorphName(`album:${item.key}`)}
                    onOpen={() => openAlbum(item.key)}
                    onRequestDelete={() => {
                      const entry = albumIndex.find((a) => a.key === item.key);
                      if (!entry) return;
                      setDeletingEntity({
                        kind: "album",
                        name: item.label ?? item.key,
                        trackIds: entry.trackIds,
                      });
                    }}
                  />
                )}
              />
            )}
          </>
        )}

        {mode === "artists" && (
          <>
            <EntitySortRow sort={entitySort} dir={entitySortDir} onSort={onEntitySortClick} />
            {artistItems.length === 0 ? (
              <p className="mt-12 text-center text-muted-foreground text-sm">
                {t("gallery.artistsEmpty")}
              </p>
            ) : (
              <VirtualCardGrid
                gridRef={galleryRef}
                items={artistItems}
                view={view}
                getKey={getEntityKey}
                scrollElement={wallScrollEl}
                lenisRef={wallLenisRef}
                restoreScrollTop={wallScrollTops.current.artists}
                initialFocusKey={returnFocusKeyRef.current}
                onInitialFocusHandled={() => {
                  returnFocusKeyRef.current = null;
                }}
                renderCard={(item) => (
                  <EntityCard
                    item={item}
                    kind="artist"
                    view={view}
                    coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                    coverViewTransitionName={coverMorphName(`artist:${item.key}`)}
                    onOpen={() => openArtist(item.key)}
                  />
                )}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Level 2 — one set's virtualized track list. */
function SetDetailView({
  setId,
  trackById,
  lastPlayed,
  coverViewTransitionName,
  onBack,
  onPlayAll,
}: {
  setId: string;
  trackById: Map<string, Track>;
  /** trackId → last-played epoch ms, for the 最近播放 sort (folded from playback stats). */
  lastPlayed?: ReadonlyMap<string, number>;
  /** `view-transition-name` for the header cover, so it morphs from the set card
   *  the user tapped on the wall (set only when arriving via a cover morph). */
  coverViewTransitionName?: string;
  onBack: () => void;
  onPlayAll: () => void;
}) {
  const { t } = useTranslation();
  const session = useLiveQuery(() => getSession(setId), [setId]);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  // 红心 lives on songs, not sets — so the "liked only" filter is here, inside the
  // playlist, rather than on the set wall.
  const [likedOnly, setLikedOnly] = useState(false);
  // In-set search: collapsed to an icon until opened (see CollapsibleSearch), then
  // filters this set's tracks through the same scorer as the gallery.
  const [query, setQuery] = useState("");
  // Sort defaults to the curated set order (null = no chip active); picking a chip
  // sorts, re-clicking it flips direction. Mirrors the album/artist detail.
  const [sort, setSort] = useState<TrackSort | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function onSortClick(next: TrackSort) {
    if (sort === next) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(next);
      setSortDir(TRACK_SORT_DEFAULT_DIR[next]);
    }
  }

  const tracks = useMemo(
    () =>
      orderedSetTrackIds(session?.trackIds ?? [], session?.trackRanks)
        .map((id) => trackById.get(id))
        .filter((tr): tr is Track => !!tr),
    [session, trackById],
  );
  // Per-track memory notes for this set, so in-set search matches notes too (parity
  // with the gallery's 全部歌曲 search).
  const memoryNotes = useLiveQuery(
    () =>
      tracks.length > 0
        ? memoryNotesByTrack(
            tracks.map((tr) => tr.id),
            db,
          )
        : Promise.resolve(EMPTY_MEMORY_NOTES),
    [tracks],
    EMPTY_MEMORY_NOTES,
  );
  const likedCount = useMemo(() => tracks.filter((tr) => tr.liked).length, [tracks]);
  // Lazily load + observe the transliteration dictionaries so pinyin/kana/romaji
  // matches "snap in" once ready (parity with the gallery's 全部歌曲 search).
  const transliterationReady = useTransliterationReady();
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    const filtered = filterLikedTracks(tracks, likedOnly);
    const ordered = sort ? sortTracks(filtered, sort, sortDir, lastPlayed) : filtered;
    // Empty query returns `ordered` untouched, so the curated/sorted order shows through.
    return searchTracks(ordered, query, memoryNotes);
  }, [likedOnly, tracks, sort, sortDir, lastPlayed, query, memoryNotes, transliterationReady]);
  // Drag-to-reorder is only meaningful when the TRUE curated order is showing — a
  // column sort, liked filter, or search query makes drop positions ambiguous
  // (drag-reorder PRD §5.2). `tracks` then equals `shownTracks` in rank order.
  const isManualOrder = !sort && !likedOnly && query.trim() === "";
  const selectedTrack = useMemo(
    () => shownTracks.find((track) => track.id === selectedTrackId) ?? shownTracks[0],
    [selectedTrackId, shownTracks],
  );
  const totalDurationSec = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.durationSec || 0), 0),
    [tracks],
  );

  // Go back to the wall via A/← or a trackpad left→right swipe (mirrors the button).
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

  // Drop back to "all" if the last liked track is unliked while filtered.
  useEffect(() => {
    if (likedOnly && likedCount === 0) setLikedOnly(false);
  }, [likedOnly, likedCount]);

  // Initialize the editable fields once the set loads (and only on identity
  // change, so later updates / typing don't reset the inputs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync on set id, not on every field change
  useEffect(() => {
    if (session) {
      setName(session.name);
      setDesc(stripDescriptionNewlines(session.description ?? ""));
    }
  }, [session?.id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize the textarea whenever its controlled text changes
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [desc]);

  // Cover: the set's own cover, else the topmost track that has one.
  const coverTrack = useMemo(() => {
    const ids = session?.trackIds ?? [];
    const id = ids.find((tid) => trackById.get(tid)?.coverBlobId) ?? ids[0];
    return id ? trackById.get(id) : undefined;
  }, [session, trackById]);
  const coverUrl = useSetCoverUrl(session?.coverBlobId, coverTrack, session?.coverCrop);
  // A pasted/dropped/picked image, queued for the crop dialog. `prefer` decides
  // which confirm button is primary (Enter): the set-cover thumbnail prefers the
  // set cover; a page-wide paste prefers the selected SONG's cover.
  const [coverChoice, setCoverChoice] = useState<{ file: File; prefer: "song" | "set" } | null>(
    null,
  );

  function openCoverCrop(files: File[], prefer: "song" | "set") {
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) setCoverChoice({ file: img, prefer });
  }
  function commitName() {
    const v = name.trim();
    if (session && v && v !== session.name) void updateSession(setId, { name: v });
  }
  function commitDesc(nextDesc = desc) {
    const v = normalizeDescription(nextDesc);
    setDesc(v);
    if (session && (session.description ?? "") !== v) void updateSession(setId, { description: v });
  }

  // Paste an image while on this set's detail page → open the crop dialog,
  // defaulting to the selected SONG's cover (set cover is the second button).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA"))
        return;
      const img = filesFromTransfer(e.clipboardData).find((f) => f.type.startsWith("image/"));
      if (!img) return;
      e.preventDefault();
      // Stop the bubble before the window-level GlobalDropZone paste listener.
      e.stopPropagation();
      setCoverChoice({ file: img, prefer: "song" });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

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

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex items-start gap-3">
            {/* Cover — left-click/drop/paste to set; right-click to remove a pinned cover */}
            <CoverContextMenu
              hasCover={!!session?.coverBlobId}
              onRemove={() => void clearSessionCover(setId)}
            >
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label={t("gallery.coverHint")}
                title={t("gallery.coverHint")}
                onDragOver={(e) => {
                  if (dragHasFiles(e.dataTransfer?.types)) {
                    e.preventDefault();
                    setDragOver(true);
                  }
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                  openCoverCrop(filesFromTransfer(e.dataTransfer), "set");
                }}
                className={cn(
                  "group relative grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
                  dragOver && "ring-2 ring-primary",
                )}
                style={
                  coverViewTransitionName
                    ? { viewTransitionName: coverViewTransitionName }
                    : undefined
                }
              >
                {coverUrl ? (
                  <img src={coverUrl} alt="" className="size-full object-cover" />
                ) : (
                  <Disc3Icon className="text-muted-foreground" size={28} />
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <ImagePlus className="size-5 text-white" />
                </span>
              </button>
            </CoverContextMenu>
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) openCoverCrop(Array.from(e.target.files), "set");
                e.target.value = "";
              }}
            />

            <div className="min-w-0 flex-1">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder={t("gallery.setName")}
                className="-mx-1 w-full truncate rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus:border-input"
              />
              <textarea
                ref={descRef}
                value={desc}
                onChange={(e) => setDesc(stripDescriptionNewlines(e.target.value))}
                onBlur={(e) => commitDesc(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                placeholder={t("gallery.setDescription")}
                rows={1}
                className="-mx-1 mt-0.5 w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 text-xs leading-5 text-muted-foreground outline-none hover:border-input focus:border-input"
              />
              <p className="px-1 pt-0.5 text-xs text-muted-foreground tabular-nums">
                {t("gallery.count", { count: tracks.length })}
                {totalDurationSec > 0 && ` · ${formatDuration(totalDurationSec)}`}
              </p>
            </div>
          </div>
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
            {likedCount > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
                <FilterChip active={likedOnly} onClick={() => setLikedOnly((v) => !v)}>
                  <Heart className={cn("size-3.5", likedOnly && "fill-current")} />
                  {t("gallery.filterLiked")}
                </FilterChip>
              </>
            )}
          </div>
          <TrackListSection
            setId={setId}
            tracks={shownTracks}
            canReorder={isManualOrder}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
            onPlay={(track) => void playTrack(track)}
            emptyHint={t("gallery.empty")}
            listClassName="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
            className="min-h-0 flex-1"
            startActions={
              <>
                <Button size="sm" onClick={onPlayAll} disabled={tracks.length === 0}>
                  <Play className="size-4" /> {t("gallery.playAll")}
                </Button>
                <AddTracksMenu setId={setId} />
              </>
            }
            endActions={
              <CollapsibleSearch
                value={query}
                onChange={setQuery}
                placeholder={t("gallery.searchInSet")}
              />
            }
          />
        </div>
        <TrackInspectorPanel track={selectedTrack} />
      </div>

      {coverChoice && (
        <SetCoverCropDialog
          setId={setId}
          file={coverChoice.file}
          prefer={coverChoice.prefer}
          selectedTrack={selectedTrack}
          onClose={() => setCoverChoice(null)}
        />
      )}
    </motion.div>
  );
}

/**
 * Crop dialog for a set-detail cover image with two targets: the selected SONG's
 * cover or the SET cover. `prefer` decides which is primary (Enter-confirmable);
 * the song option is hidden when the set has no selectable track.
 */
function SetCoverCropDialog({
  setId,
  file,
  prefer,
  selectedTrack,
  onClose,
}: {
  setId: string;
  file: File;
  prefer: "song" | "set";
  selectedTrack: Track | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const mime = file.type || "image/jpeg";

  async function applySong(crop: CropRect) {
    if (!selectedTrack || saving) return;
    setSaving(true);
    await setTrackCover({ trackId: selectedTrack.id, blob: file, mime, crop });
    onClose();
  }
  async function applySet(crop: CropRect) {
    if (saving) return;
    setSaving(true);
    await setSessionCover({ sessionId: setId, blob: file, mime, crop });
    onClose();
  }

  const songAction = selectedTrack
    ? { label: t("gallery.setAsSongCover"), onConfirm: (c: CropRect) => void applySong(c) }
    : null;
  const setAction = {
    label: t("gallery.setAsSetCover"),
    onConfirm: (c: CropRect) => void applySet(c),
  };
  const primary = prefer === "song" && songAction ? songAction : setAction;
  const secondary = primary === songAction ? setAction : songAction;

  return (
    <CoverCropDialog
      file={file}
      saving={saving}
      confirmLabel={primary.label}
      onConfirm={primary.onConfirm}
      secondary={secondary ?? undefined}
      onCancel={onClose}
    />
  );
}

/**
 * Cover URL for a set: its own cover (`coverBlobId`) when set, else the given
 * fallback track's cover. Shared by the gallery tiles and the detail header so
 * setting a cover reflects everywhere.
 */
function useSetCoverUrl(
  coverBlobId: string | undefined,
  fallbackTrack: Track | undefined,
  coverCrop?: CropRect,
): string | null {
  // Reuse the track cover pipeline (blob resolve + non-destructive square crop)
  // by feeding the set cover through the same shape.
  const setUrl = useTrackCoverUrl(coverBlobId ? { coverBlobId, coverCrop } : undefined);
  const trackUrl = useTrackCoverUrl(fallbackTrack);
  return coverBlobId ? setUrl : trackUrl;
}

/** Localize a derived artist's label — pseudo-buckets resolve to UI copy. */
function artistDisplayLabel(entry: ArtistEntry, t: TFunction): string {
  if (entry.bucket === "generated") return t("gallery.aiGenerated");
  if (entry.bucket === "unknown") return t("gallery.unknownArtist");
  return entry.name;
}

/** Localize a derived album's title — the unknown bucket resolves to UI copy. */
function albumDisplayLabel(entry: AlbumEntry, t: TFunction): string {
  return entry.bucket === "unknown" ? t("gallery.unknownAlbum") : entry.name;
}

/** Localize a derived album's artist line — compilations resolve to "Various Artists". */
function albumArtistDisplayLabel(entry: AlbumEntry, t: TFunction): string {
  if (entry.isCompilation) return t("gallery.variousArtists");
  return entry.artistName ?? t("gallery.unknownArtist");
}

function ViewToggleGroup({
  view,
  onChange,
}: {
  view: GalleryView;
  onChange: (next: GalleryView) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <IconToggle
        active={view === "list"}
        onClick={() => onChange("list")}
        label={t("gallery.viewList")}
      >
        <List className="size-4" />
      </IconToggle>
      <IconToggle
        active={view === "grid"}
        onClick={() => onChange("grid")}
        label={t("gallery.viewGrid")}
      >
        <LayoutGrid className="size-4" />
      </IconToggle>
    </div>
  );
}

/**
 * The 专辑 / 歌手 sort row — name / track count / total duration / last played.
 * Both entity walls share one sort (like the grid⇄list view toggle), so this is
 * rendered identically in each. Reuses the existing gallery sort i18n keys.
 */
function EntitySortRow({
  sort,
  dir,
  onSort,
}: {
  sort: EntitySort;
  dir: SortDir;
  onSort: (next: EntitySort) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 pt-1">
      <SortChip active={sort === "name"} dir={dir} onClick={() => onSort("name")}>
        {t("gallery.sortName")}
      </SortChip>
      <SortChip active={sort === "count"} dir={dir} onClick={() => onSort("count")}>
        {t("gallery.sortSize")}
      </SortChip>
      <SortChip active={sort === "duration"} dir={dir} onClick={() => onSort("duration")}>
        {t("gallery.sortDuration")}
      </SortChip>
      <SortChip active={sort === "played"} dir={dir} onClick={() => onSort("played")}>
        {t("gallery.sortPlayed")}
      </SortChip>
    </div>
  );
}

function ModeTab({
  value,
  shortcut,
  children,
}: {
  value: GalleryMode;
  /** Direct-jump digit (1–4), shown as a hint and bound in the registry (GALLERY_TAB_ACTIONS). */
  shortcut: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <TabsTab value={value}>
            {children}
            <Kbd className="h-4 min-w-4 bg-foreground/10 px-1 text-[10px] text-current opacity-70">
              {shortcut}
            </Kbd>
          </TabsTab>
        }
      />
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          <span>{t("gallery.toggleModeHint")}</span>
          <KbdGroup>
            <Kbd>{shortcut}</Kbd>
            <Kbd>~</Kbd>
          </KbdGroup>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

function IconToggle({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid size-8 place-items-center rounded-md transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}

function SetCard({
  item,
  coverTrack,
  view,
  coverViewTransitionName,
  onEnter,
  onPlay,
  onRequestDelete,
}: {
  item: SetGalleryItem;
  coverTrack: Track | undefined;
  view: GalleryView;
  /** When set, the cover wears this `view-transition-name` so it morphs into the
   *  set-detail cover on open (passed only for the card being opened). */
  coverViewTransitionName?: string;
  onEnter: () => void;
  onPlay: () => void;
  /** Right-click → "Delete set…". Omit to disable the context menu. */
  onRequestDelete?: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useSetCoverUrl(item.session.coverBlobId, coverTrack, item.session.coverCrop);
  // Preview hash matching whichever cover is shown: the set's own, else the
  // fallback track's (mirrors useSetCoverUrl's own/fallback choice).
  const coverThumbhash = item.session.coverBlobId
    ? item.session.coverThumbhash
    : coverTrack?.coverThumbhash;
  const count = t("gallery.count", { count: item.trackCount });

  // The play button overlays the card (sibling, not nested) so a button doesn't
  // nest in a button: tapping it plays the set, tapping elsewhere enters it.
  const playBtn = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      aria-label={t("player.play")}
      className={cn(
        "absolute grid place-items-center rounded-full bg-primary text-primary-foreground shadow-md transition-opacity",
        "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        view === "grid" ? "bottom-3 right-3 size-9" : "right-2 top-1/2 size-8 -translate-y-1/2",
      )}
    >
      <Play className="size-4" />
    </button>
  );

  const inner =
    view === "grid" ? (
      <>
        <button
          type="button"
          onClick={onEnter}
          data-gallery-card
          data-gallery-card-key={item.session.id}
          className="flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CoverImage
            url={coverUrl}
            thumbhash={coverThumbhash}
            placeholder={<Disc3Icon className="text-muted-foreground" size={32} />}
            className="aspect-square w-full rounded-lg"
            style={
              coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined
            }
          >
            {item.likedCount > 0 && (
              <Heart className="absolute right-2 top-2 size-4 fill-primary text-primary" />
            )}
          </CoverImage>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.session.name}</span>
            <span className="block text-xs text-muted-foreground">{count}</span>
          </span>
        </button>
        {playBtn}
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={onEnter}
          data-gallery-card
          data-gallery-card-key={item.session.id}
          className="flex w-full items-center gap-3 rounded-xl p-2 pe-12 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CoverImage
            url={coverUrl}
            thumbhash={coverThumbhash}
            placeholder={<Disc3Icon className="text-muted-foreground" size={20} />}
            className="size-12 shrink-0 rounded-lg"
            style={
              coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.session.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{count}</span>
          </span>
          {item.likedCount > 0 && (
            <Heart className="me-8 size-4 shrink-0 fill-primary text-primary" />
          )}
        </button>
        {playBtn}
      </>
    );

  if (!onRequestDelete) return <div className="group relative">{inner}</div>;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="group relative">{inner}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem className="text-destructive-foreground" onClick={onRequestDelete}>
          <Trash2 /> {t("set.contextDelete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
