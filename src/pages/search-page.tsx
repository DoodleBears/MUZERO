import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  ChevronRight,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { motion } from "motion/react";
import {
  memo,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { SourceAttributionChip } from "@/components/cloud/source-attribution-chip";
import { RenderTraceBoundary } from "@/components/dev/render-trace-boundary";
import { OnlineDiscoverTab } from "@/components/discover/online-discover-tab";
import { OnlinePlaylistDetail } from "@/components/discover/online-playlist-detail";
import { DownloadCenter } from "@/components/downloads/download-center";
import { AlphabetIndex } from "@/components/library/alphabet-index";
import { CollapsibleSearch } from "@/components/library/collapsible-search";
import { CoverContextMenu } from "@/components/library/cover-context-menu";
import { EntityDetailView } from "@/components/library/entity-detail";
import { EntityCard, EntityGrid, type LibraryEntityItem } from "@/components/library/entity-grid";
import { HoverScrollbar } from "@/components/library/hover-scrollbar";
import { OnlinePlaylistSection } from "@/components/library/online-playlist-section";
import { RatingFilterChip } from "@/components/library/rating-filter-chip";
import { FilterChip, SortChip } from "@/components/library/sort-chip";
import {
  type SystemPlaylistCardItem,
  SystemPlaylistCards,
} from "@/components/library/system-playlist-cards";
import { SystemPlaylistDetail } from "@/components/library/system-playlist-detail";
import { TrackListSection } from "@/components/library/track-list-section";
import {
  DETAIL_ALPHABET_MIN_TRACKS,
  useTrackAlphabetLetterOf,
} from "@/components/library/use-track-alphabet";
import {
  VirtualCardGrid,
  type VirtualCardGridHandle,
} from "@/components/library/virtual-card-grid";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { CoverCropDialog } from "@/components/track/cover-crop-dialog";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { Button } from "@/components/ui/button";
import { CloudDownloadIcon } from "@/components/ui/cloud-download";
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
import { LibraryImportEmptyState } from "@/components/upload/library-import-empty-state";
import { db } from "@/db/muzero-db";
import {
  clearSessionCover,
  createSession,
  deleteTracks,
  getSession,
  listAllTracks,
  listSessions,
  listTrackPlaybackStats,
  memoryNotesByTrack,
  setSessionCover,
  setTrackCover,
  updateSession,
} from "@/db/repositories";
import type {
  CropRect,
  DjSession,
  PlaybackEvent,
  SetOrigin,
  StreamSourceId,
  Track,
} from "@/db/types";
import { useBackGesture } from "@/hooks/use-back-gesture";
import { useLikedTrackIds } from "@/hooks/use-liked-tracks";
import { useCoverMetadataBackfill, useGridCoverUrl, useTrackCoverUrl } from "@/hooks/use-media";
import { useOnlinePlaylistCatalog } from "@/hooks/use-online-playlist-catalog";
import { usePausedLiveQuery } from "@/hooks/use-paused-live-query";
import { useShortcutMatcher } from "@/hooks/use-shortcut-matcher";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { buildAlphabetIndex } from "@/lib/alphabet-index";
import { hasStreamingSources } from "@/lib/desktop/bridge";
import { hasModalDialogOpen, isTypingTarget } from "@/lib/dom-keys";
import { ENTITY_SORT_DEFAULT_DIR, type EntitySort, sortEntities } from "@/lib/entity-gallery";
import {
  albumArtistDisplayLabel,
  albumDisplayLabel,
  artistDisplayLabel,
} from "@/lib/entity-labels";
import { dragHasFiles, filesFromTransfer, IMAGE_ACCEPT } from "@/lib/file-drop";
import {
  albumsForArtist,
  buildAlbumIndex,
  buildArtistIndex,
  findAlbumForTrack,
  findArtistByName,
} from "@/lib/library-index";
import { rovingIndex } from "@/lib/library-nav";
import { buildTrackStatsMap, deriveEntityStats, statFor } from "@/lib/library-stats";
import { freeTextMatches } from "@/lib/search-core";
import { transliterateInitial } from "@/lib/search-transliterate";
import {
  filterSets,
  SET_SORT_DEFAULT_DIR,
  type SetGalleryItem,
  type SetSort,
  type SortDir,
  sortSets,
} from "@/lib/set-gallery";
import { resolveSetOrigin, SET_ORIGINS } from "@/lib/set-origin";
import { isMac, modifierSymbol } from "@/lib/shortcuts";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { SOURCE_COVER_MORPH_NAME, sourceCoverMorphNamespace } from "@/lib/source-cover-transition";
import {
  deriveHeartedPlaylist,
  deriveMostPlayedPlaylist,
  deriveRecentlyPlayedPlaylist,
  pickSystemPlaylistCoverTrack,
  SYSTEM_PLAYLISTS,
  type SystemPlaylistId,
  type SystemPlaylistPlayable,
} from "@/lib/system-playlists";
import {
  filterLikedTracks,
  filterTracksByRating,
  type RatingRange,
  sortTracks,
  TRACK_SORT_DEFAULT_DIR,
  type TrackSort,
} from "@/lib/track-gallery";
import { resolveTrackRating } from "@/lib/track-rating";
import {
  buildFacetCandidates,
  type EntityFacets,
  type FacetCandidates,
  searchFacetCandidates,
  searchTracks,
} from "@/lib/track-search";
import { cn, formatDuration, formatListenTime } from "@/lib/utils";
import { canViewTransition } from "@/lib/view-transition";
import { transitionState } from "@/lib/view-transition-react";
import { orderedSetTrackIds } from "@/player/set-order";
import { useCoverTargetStore } from "@/stores/cover-target-store";
import { type FolderImportProgress, useFolderImportStore } from "@/stores/folder-import-store";
import { useNavStore } from "@/stores/nav-store";
import { notify } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import { useIsSetBulkDownloading } from "@/stores/stream-cache-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";
import { filterOnlinePlaylists, STREAM_SOURCE_DISPLAY_NAMES } from "@/streamsrc/playlist-catalog";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { isTrackCacheableToDevice } from "@/streamsrc/source-detect";
import { matchesRemoteSearchTrack } from "@/sync/r2-search-catalog";

type GalleryView = "list" | "grid";
// "online" is the 发现 (Discover) tab — desktop + streaming only (see hasStreamingSources).
// "downloads" is the 下载 tab — always visible, its own virtualized download center.
type GalleryMode = "sets" | "tracks" | "albums" | "artists" | "online" | "downloads";
// Card walls with list/grid + A–Z fast-jump + hover scrollbar. Excludes tracks
// (master/detail), online (Discover's own card gallery), and downloads (its own
// virtualized list) — none of which use the shared wall view toggle.
type GalleryWallMode = Exclude<GalleryMode, "tracks" | "online" | "downloads">;
const GALLERY_MODES: GalleryMode[] = ["sets", "tracks", "albums", "artists", "online", "downloads"];
/** Direct-jump shortcut action → gallery tab (bare 1/2/3/4/5/6 on the wall). */
const GALLERY_TAB_ACTIONS: ReadonlyArray<readonly [string, GalleryMode]> = [
  ["nav.galleryTabSets", "sets"],
  ["nav.galleryTabTracks", "tracks"],
  ["nav.galleryTabAlbums", "albums"],
  ["nav.galleryTabArtists", "artists"],
  ["nav.galleryTabOnline", "online"],
  ["nav.galleryTabDownloads", "downloads"],
];
// Discover has no text search box, so it carries no placeholder (the toolbar search
// row is hidden for it).
const SEARCH_PLACEHOLDER_KEY = {
  sets: "gallery.searchSets",
  tracks: "gallery.searchTracksGlobalHint",
  albums: "gallery.searchAlbums",
  artists: "gallery.searchArtists",
} as const satisfies Record<Exclude<GalleryMode, "online" | "downloads">, string>;

function isFolderImportBusy(progress: FolderImportProgress | null) {
  return (
    progress?.phase === "scanning" ||
    progress?.phase === "importing" ||
    progress?.phase === "covers" ||
    progress?.phase === "completed" ||
    progress?.phase === "cancelled"
  );
}
const MODE_KEY = "muzero-gallery-mode";
const LEGACY_VIEW_KEY = "muzero-gallery-view";
const VIEW_KEYS = {
  sets: "muzero-gallery-view-sets",
  albums: "muzero-gallery-view-albums",
  artists: "muzero-gallery-view-artists",
} as const satisfies Record<GalleryWallMode, string>;
// Sort field + direction per wall, persisted like the mode/view prefs above (benign
// UI preferences, not behavior gates — same class as `muzero-locale`). 全部歌曲 /
// 歌单 / (专辑+歌手 share one).
const TRACK_SORT_KEY = "muzero-gallery-track-sort";
const TRACK_SORT_DIR_KEY = "muzero-gallery-track-sort-dir";
const SET_SORT_KEY = "muzero-gallery-set-sort";
const SET_SORT_DIR_KEY = "muzero-gallery-set-sort-dir";
const SET_SOURCE_FILTER_KEY = "muzero-gallery-set-source-filter";
const SET_SECTION_COLLAPSE_KEY = "muzero-gallery-set-section-collapsed";
const ENTITY_SORT_KEY = "muzero-gallery-entity-sort";
const ENTITY_SORT_DIR_KEY = "muzero-gallery-entity-sort-dir";
type SetSourceFilter = "all" | "local" | "online" | StreamSourceId;
const STREAM_SOURCE_FILTERS = Object.keys(STREAM_SOURCE_DISPLAY_NAMES) as StreamSourceId[];
type SetWallSectionId = "system" | "local" | "online";

function savedSortDir(key: string, fallback: SortDir): SortDir {
  if (typeof localStorage === "undefined") return fallback;
  const saved = localStorage.getItem(key);
  return saved === "asc" || saved === "desc" ? saved : fallback;
}
// Stable empty rows returned when the sets tab isn't active, so `systemPlaylistRows`
// keeps a constant identity (downstream memos don't churn) without deriving.
const EMPTY_SYSTEM_PLAYLIST_ROWS: Record<SystemPlaylistId, SystemPlaylistPlayable[]> = {
  "system:liked": [],
  "system:most": [],
  "system:recent": [],
};
const EMPTY_MEMORY_NOTES = new Map<string, string[]>();
const EMPTY_LIBRARY_ENTITY_ITEMS: LibraryEntityItem[] = [];
const EMPTY_SET_GALLERY_ITEMS: SetGalleryItem[] = [];
const EMPTY_TRACKS: Track[] = [];
const EMPTY_ENTITY_FACETS: EntityFacets = { albums: [], artists: [] };
const EMPTY_FACET_CANDIDATES: FacetCandidates = { albums: [], artists: [] };
// Stable empties returned by the playback-stats / -events liveQueries while the search
// tab is INACTIVE — so they don't subscribe to (and re-render on) the heartbeat-rate
// writes to those tables while hidden (PRD reactivity-render-observability F2).
const EMPTY_PLAYBACK_STATS: Awaited<ReturnType<typeof listTrackPlaybackStats>> = [];
const EMPTY_PLAYBACK_EVENTS: PlaybackEvent[] = [];
const TRACK_ROW_SELECTOR = "[data-muzero-track-row]";
function savedGalleryMode(): GalleryMode {
  if (typeof localStorage === "undefined") return "tracks";
  const saved = localStorage.getItem(MODE_KEY);
  return GALLERY_MODES.includes(saved as GalleryMode) ? (saved as GalleryMode) : "tracks";
}

function isGalleryView(value: string | null): value is GalleryView {
  return value === "grid" || value === "list";
}

function savedGalleryView(mode: GalleryWallMode): GalleryView {
  if (typeof localStorage === "undefined") return "grid";
  const saved = localStorage.getItem(VIEW_KEYS[mode]) ?? localStorage.getItem(LEGACY_VIEW_KEY);
  return isGalleryView(saved) ? saved : "grid";
}

function isGalleryWallMode(mode: GalleryMode): mode is GalleryWallMode {
  return mode !== "tracks" && mode !== "online" && mode !== "downloads";
}

function useDelayedInactiveUnmount(active: boolean, delayMs: number): boolean {
  const [mounted, setMounted] = useState(active);

  useEffect(() => {
    if (active) {
      setMounted(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setMounted(false), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return active || mounted;
}

function savedTrackSort(): TrackSort {
  if (typeof localStorage === "undefined") return "created";
  const saved = localStorage.getItem(TRACK_SORT_KEY);
  return saved && saved in TRACK_SORT_DEFAULT_DIR ? (saved as TrackSort) : "created";
}

function savedTrackSortDir(fallback: SortDir): SortDir {
  return savedSortDir(TRACK_SORT_DIR_KEY, fallback);
}

function savedSetSort(): SetSort {
  if (typeof localStorage === "undefined") return "recent";
  const saved = localStorage.getItem(SET_SORT_KEY);
  return saved && saved in SET_SORT_DEFAULT_DIR ? (saved as SetSort) : "recent";
}

function isStreamSourceId(value: string): value is StreamSourceId {
  return value in STREAM_SOURCE_DISPLAY_NAMES;
}

function savedSetSourceFilter(): SetSourceFilter {
  if (typeof localStorage === "undefined") return "all";
  const saved = localStorage.getItem(SET_SOURCE_FILTER_KEY);
  if (
    saved &&
    (saved === "all" || saved === "local" || saved === "online" || isStreamSourceId(saved))
  ) {
    return saved;
  }
  return "all";
}

function savedSetSectionCollapsed(): Record<SetWallSectionId, boolean> {
  const fallback = { system: false, local: false, online: false };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const parsed = JSON.parse(localStorage.getItem(SET_SECTION_COLLAPSE_KEY) ?? "{}") as Partial<
      Record<SetWallSectionId, boolean>
    >;
    return {
      system: parsed.system ?? false,
      local: parsed.local ?? false,
      online: parsed.online ?? false,
    };
  } catch {
    return fallback;
  }
}

function savedEntitySort(): EntitySort {
  if (typeof localStorage === "undefined") return "name";
  const saved = localStorage.getItem(ENTITY_SORT_KEY);
  return saved && saved in ENTITY_SORT_DEFAULT_DIR ? (saved as EntitySort) : "name";
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
/** The A–Z fast-scroll strip only earns its place on a long, name-sorted library. */
const ALPHABET_INDEX_MIN_TRACKS = 50;
/** Same, for the 歌单/专辑/歌手 card walls (fewer entities than tracks). */
const WALL_ALPHABET_MIN_ITEMS = 30;
const SEARCH_INACTIVE_UNMOUNT_DELAY_MS = 900;
const SEARCH_HEAVY_QUERY_RESUME_DELAY_MS = 1700;
const SEARCH_LIKED_IDS_RESUME_DELAY_MS = 1700;
const SEARCH_PLAYBACK_STATS_DELAY_MS = 2600;
type CommonT = TFunction<"common", undefined>;

/**
 * 歌单 Gallery — a two-level surface. Level 1 browses every set like an album wall
 * (search / filter / sort / list⇄album-grid). Tapping a set opens level 2: that
 * set's virtualized track list, with a back button + "play all". A small play
 * button on each card plays the set directly without entering it.
 */
export function SearchPage({ pageActive }: { pageActive?: boolean } = {}) {
  const { t } = useTranslation();
  const globalSearchShortcut = `${modifierSymbol(isMac())}+F`;
  const navSearchActive = useNavStore((s) => s.tab === "search");
  const searchTabActive = pageActive ?? navSearchActive;
  const searchContentMounted = useDelayedInactiveUnmount(
    searchTabActive,
    SEARCH_INACTIVE_UNMOUNT_DELAY_MS,
  );
  // Backfill blurred previews + visualizer palettes for legacy/imported covers.
  useCoverMetadataBackfill(searchTabActive);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedSetAnchorTrackId, setSelectedSetAnchorTrackId] = useState<string | undefined>();
  const [selectedSystemPlaylistId, setSelectedSystemPlaylistId] = useState<SystemPlaylistId | null>(
    null,
  );
  const [selectedSystemAnchorTrackId, setSelectedSystemAnchorTrackId] = useState<
    string | undefined
  >();
  const [selectedOnlinePlaylist, setSelectedOnlinePlaylist] = useState<StreamPlaylist | null>(null);
  const [mode, setMode] = useState<GalleryMode>(savedGalleryMode);
  // The 发现 (Discover) tab needs the desktop media proxy (Referer/CORS), like the
  // Settings streaming section — hidden on web / when no source is configured.
  const streamingSupported = hasStreamingSources();
  const [setQuery, setSetQuery] = useState("");
  const [setSourceFilter, setSetSourceFilter] = useState<SetSourceFilter>(savedSetSourceFilter);
  const [onlineImportTarget, setOnlineImportTarget] = useState<StreamPlaylist | null>(null);
  const [trackQuery, setTrackQuery] = useState("");
  const [albumQuery, setAlbumQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [sort, setSort] = useState<SetSort>(savedSetSort);
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    savedSortDir(SET_SORT_DIR_KEY, SET_SORT_DEFAULT_DIR[savedSetSort()]),
  );
  // 全部歌曲 ordering: a single-select sort field + its direction, plus a 红心 filter.
  const [trackSort, setTrackSort] = useState<TrackSort>(savedTrackSort);
  const [trackSortDir, setTrackSortDir] = useState<SortDir>(() =>
    savedTrackSortDir(TRACK_SORT_DEFAULT_DIR[savedTrackSort()]),
  );
  const [likedOnly, setLikedOnly] = useState(false);
  // 全部歌曲 rating filter: inclusive star window over the crowd average; null = off.
  const [ratingRange, setRatingRange] = useState<RatingRange | null>(null);
  // 专辑 / 歌手 ordering — one shared sort across both entity walls.
  const [entitySort, setEntitySort] = useState<EntitySort>(savedEntitySort);
  const [entitySortDir, setEntitySortDir] = useState<SortDir>(() =>
    savedSortDir(ENTITY_SORT_DIR_KEY, ENTITY_SORT_DEFAULT_DIR[savedEntitySort()]),
  );
  const [selectedLibraryTrackId, setSelectedLibraryTrackId] = useState<string | null>(null);
  const [selectedArtistKey, setSelectedArtistKey] = useState<string | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const [viewByMode, setViewByMode] = useState<Record<GalleryWallMode, GalleryView>>(() => ({
    sets: savedGalleryView("sets"),
    albums: savedGalleryView("albums"),
    artists: savedGalleryView("artists"),
  }));
  const [deletingSet, setDeletingSet] = useState<DjSession | null>(null);
  // Sets-wall origin filter (AI / human / imported). "all" shows everything.
  const [originFilter, setOriginFilter] = useState<SetOrigin | "all">("all");
  const [collapsedSetSections, setCollapsedSetSections] = useState(savedSetSectionCollapsed);
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
  // its detail cover wear `SOURCE_COVER_MORPH_NAME` while they match this, so the
  // browser morphs one into the other; exactly one element carries the name at a time.
  const [morphKey, setMorphKey] = useState<string | null>(null);
  // Handle to the active virtualized wall, so roving keyboard nav can scroll a
  // card that's been virtualized off-screen back into view before focusing it.
  const galleryRef = useRef<VirtualCardGridHandle | null>(null);
  // Library/gallery keys resolve through the configurable registry (so rebinds
  // take effect). Held in a ref so the window listeners stay stable.
  const matches = useShortcutMatcher();
  const matchesRef = useRef(matches);
  matchesRef.current = matches;

  // The `view-transition-name` for a cover whose namespaced key matches the active
  // morph — applied to the tapped/source cover and its detail counterpart so they're
  // the two ends of the same morph; everything else stays unnamed.
  const coverMorphName = useCallback(
    (ns: string): string | undefined => (morphKey === ns ? SOURCE_COVER_MORPH_NAME : undefined),
    [morphKey],
  );

  // Tag the tapped/source cover BEFORE the transition snapshots the old DOM, so the
  // browser can pair it with the detail cover that mounts in the update. flushSync
  // forces the name into the DOM synchronously; skipped where native VT is off
  // (the name would be inert) so non-Chromium shells don't pay an extra render.
  const beginCoverMorph = useCallback((ns: string) => {
    if (canViewTransition()) flushSync(() => setMorphKey(ns));
  }, []);

  const clearCoverMorphBeforeTransition = useCallback(() => {
    if (canViewTransition() && morphKey) flushSync(() => setMorphKey(null));
  }, [morphKey]);

  const likedIdsImmediate =
    mode === "tracks" ||
    likedOnly ||
    Boolean(selectedSystemPlaylistId || selectedArtistKey || selectedAlbumKey);
  const [likedIdsActive, setLikedIdsActive] = useState(likedIdsImmediate);
  useEffect(() => {
    if (!searchTabActive) {
      setLikedIdsActive(false);
      return undefined;
    }
    if (likedIdsImmediate) {
      setLikedIdsActive(true);
      return undefined;
    }
    const timer = window.setTimeout(
      () => setLikedIdsActive(true),
      SEARCH_LIKED_IDS_RESUME_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [likedIdsImmediate, searchTabActive]);
  const likedIds = useLikedTrackIds(likedIdsActive);

  const folderImportBusy = useFolderImportStore((state) => isFolderImportBusy(state.progress));
  const libraryQueriesActive = searchTabActive && !folderImportBusy;
  const sessions = usePausedLiveQuery(() => listSessions(db), [], libraryQueriesActive, []);
  const allTracksImmediate =
    mode !== "sets" ||
    setQuery.trim() !== "" ||
    Boolean(selectedSetId || selectedSystemPlaylistId || selectedArtistKey || selectedAlbumKey);
  const [allTracksActive, setAllTracksActive] = useState(allTracksImmediate);
  useEffect(() => {
    if (!libraryQueriesActive) {
      setAllTracksActive(false);
      return undefined;
    }
    if (allTracksImmediate) {
      setAllTracksActive(true);
      return undefined;
    }
    const timer = window.setTimeout(
      () => setAllTracksActive(true),
      SEARCH_HEAVY_QUERY_RESUME_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [allTracksImmediate, libraryQueriesActive]);
  // Every tracks write re-runs the full-table query with a fresh array. Coalesce
  // bursts (folder import, DJ refill) so the O(N) consumers below — memory join,
  // artist/album indexes, worker search snapshot — re-run at most once per
  // interval instead of once per write (PRD F-3).
  const allTracksLive = usePausedLiveQuery(() => listAllTracks(db), [], allTracksActive, [], {
    resumeDelayMs: SEARCH_HEAVY_QUERY_RESUME_DELAY_MS,
  });
  // This page stays MOUNTED while hidden (App keeps tabs alive to avoid remount
  // jank). Hidden pages keep their last snapshot, but stop observing `tracks`, so
  // a cover write no longer re-runs a full-table query in the background.
  const allTracks = useThrottledValue(allTracksLive, LIBRARY_QUERY_COALESCE_MS);
  const remoteTracks = usePausedLiveQuery(
    () => db.remoteSearchTracks.toArray(),
    [],
    searchTabActive,
    [],
  );
  const needsMemoryNotes =
    searchTabActive &&
    ((mode === "sets" && setQuery.trim() !== "") ||
      (mode === "tracks" && trackQuery.trim() !== "") ||
      Boolean(selectedArtistKey || selectedAlbumKey));
  const playbackStatsImmediate = Boolean(selectedSystemPlaylistId);
  const [playbackStatsActive, setPlaybackStatsActive] = useState(playbackStatsImmediate);
  useEffect(() => {
    if (!searchTabActive) {
      setPlaybackStatsActive(false);
      return undefined;
    }
    if (playbackStatsImmediate) {
      setPlaybackStatsActive(true);
      return undefined;
    }
    const timer = window.setTimeout(
      () => setPlaybackStatsActive(true),
      SEARCH_PLAYBACK_STATS_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [playbackStatsImmediate, searchTabActive]);
  const memoryNotes = usePausedLiveQuery(
    () =>
      needsMemoryNotes && allTracks.length > 0
        ? memoryNotesByTrack(
            allTracks.map((track) => track.id),
            db,
          )
        : Promise.resolve(EMPTY_MEMORY_NOTES),
    [allTracks, needsMemoryNotes],
    needsMemoryNotes,
    EMPTY_MEMORY_NOTES,
  );
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const playSystemPlaylist = usePlayerStore((s) => s.playSystemPlaylist);
  const play = usePlayerStore((s) => s.play);
  const playTrackInContext = usePlayerStore((s) => s.playTrackInContext);
  const deleteSession = usePlayerStore((s) => s.deleteSession);
  const setUploadTarget = useUploadTargetStore((s) => s.setTarget);
  const setCoverTarget = useCoverTargetStore((s) => s.setCoverTarget);
  const activeWallView = isGalleryWallMode(mode) ? viewByMode[mode] : "list";
  const onlineCatalog = useOnlinePlaylistCatalog(
    streamingSupported &&
      searchTabActive &&
      mode === "sets" &&
      !selectedSetId &&
      !selectedSystemPlaylistId &&
      !selectedOnlinePlaylist,
  );
  const showLocalPlaylists = setSourceFilter === "all" || setSourceFilter === "local";
  const showOnlinePlaylists =
    setSourceFilter === "all" || setSourceFilter === "online" || isStreamSourceId(setSourceFilter);
  const onlineSourceOptions = useMemo(() => {
    const available = new Set(onlineCatalog.playlists.map((playlist) => playlist.source));
    return STREAM_SOURCE_FILTERS.filter(
      (source) => available.has(source) || setSourceFilter === source,
    );
  }, [onlineCatalog.playlists, setSourceFilter]);
  const onlineSourceFilteredPlaylists = useMemo(() => {
    if (!showOnlinePlaylists) return [];
    if (setSourceFilter === "all" || setSourceFilter === "online") return onlineCatalog.playlists;
    return onlineCatalog.playlists.filter((playlist) => playlist.source === setSourceFilter);
  }, [onlineCatalog.playlists, setSourceFilter, showOnlinePlaylists]);
  const visibleOnlinePlaylists = useMemo(
    () => filterOnlinePlaylists(onlineSourceFilteredPlaylists, setQuery),
    [onlineSourceFilteredPlaylists, setQuery],
  );

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
    if (!searchTabActive) {
      setUploadTarget({ kind: "active" });
      return undefined;
    }
    setUploadTarget(selectedSetId ? { kind: "set", setId: selectedSetId } : { kind: "pick" });
    return () => setUploadTarget({ kind: "active" });
  }, [searchTabActive, selectedSetId, setUploadTarget]);

  // Discover is only reachable when streaming is supported; drop it from the cycle /
  // digit jumps and fall back if a persisted "online" mode lands on an unsupported build.
  const availableModes = useMemo(
    () => (streamingSupported ? GALLERY_MODES : GALLERY_MODES.filter((m) => m !== "online")),
    [streamingSupported],
  );
  useEffect(() => {
    if (mode === "online" && !streamingSupported) {
      setMode("tracks");
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "tracks");
    }
  }, [mode, streamingSupported]);

  useEffect(() => {
    if (!searchTabActive) return;
    if (selectedSetId || selectedSystemPlaylistId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesRef.current(event, "nav.cycleGalleryMode")) return;
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      event.preventDefault();
      // ` cycles forward through the tabs; Shift+` walks back to the previous one.
      const count = availableModes.length;
      const step = event.shiftKey ? -1 : 1;
      const next = availableModes[(availableModes.indexOf(mode) + step + count) % count];
      setMode(next);
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [searchTabActive, mode, selectedSetId, selectedSystemPlaylistId, availableModes]);

  // Bare 1/2/3/4 jump straight to a library tab (sets / songs / albums / artists),
  // at the wall only. Resolved through the registry, so the digits are rebindable.
  useEffect(() => {
    if (!searchTabActive) return;
    if (selectedSetId || selectedSystemPlaylistId || selectedArtistKey || selectedAlbumKey) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || hasModalDialogOpen()) return;
      const hit = GALLERY_TAB_ACTIONS.find(([action]) => matchesRef.current(event, action));
      if (!hit) return;
      if (hit[1] === "online" && !streamingSupported) return; // 5 is inert without streaming
      event.preventDefault();
      setMode(hit[1]);
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, hit[1]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedSetId,
    selectedSystemPlaylistId,
    selectedArtistKey,
    selectedAlbumKey,
    streamingSupported,
    searchTabActive,
  ]);

  const trackById = useMemo(() => new Map(allTracks.map((tr) => [tr.id, tr])), [allTracks]);
  const trackByIdRef = useRef(trackById);
  trackByIdRef.current = trackById;

  // Derived artist/album entities — pure projections over the imported metadata
  // (no stored table). Deferred so a coalesced library update paints the lists
  // first and the O(N) re-projection runs at transition priority (PRD F-3).
  const indexSource = useDeferredValue(allTracks);
  const artistIndex = useMemo(() => buildArtistIndex(indexSource), [indexSource]);
  const albumIndex = useMemo(() => buildAlbumIndex(indexSource), [indexSource]);
  // Per-artist/album listening time — a derived current-truth dimension folded
  // from the per-track playback signal (re-tag re-buckets; see PRD §3.4).
  // Playback heartbeats write this table every flush DURING playback — coalesce
  // so sitting on this page while music plays doesn't re-scan per flush (F-4).
  // Gated on the search tab being active: while INACTIVE these return a stable empty
  // and never read the stats/events tables, so heartbeat-rate writes (every playback
  // flush + playCount on switch) don't re-render this hidden page (F2). They re-subscribe
  // + read when you switch to the search tab.
  const playbackStatsLive = usePausedLiveQuery(
    () => listTrackPlaybackStats(db),
    [],
    playbackStatsActive,
    EMPTY_PLAYBACK_STATS,
    { resumeDelayMs: SEARCH_PLAYBACK_STATS_DELAY_MS },
  );
  const playbackEventsLive = usePausedLiveQuery(
    () => db.playbackEvents.toArray(),
    [],
    playbackStatsActive,
    EMPTY_PLAYBACK_EVENTS,
    { resumeDelayMs: SEARCH_PLAYBACK_STATS_DELAY_MS },
  );
  const playbackStats = useThrottledValue(playbackStatsLive, LIBRARY_QUERY_COALESCE_MS);
  const playbackEvents = useThrottledValue(playbackEventsLive, LIBRARY_QUERY_COALESCE_MS);
  // The stats tables are rewritten every playback heartbeat, but the O(N) derivations
  // they feed (entity stats, recency sort, system playlists) are BACKGROUND relative
  // to scrolling the visible list. Defer them so a heartbeat re-derivation runs at
  // transition priority — React keeps it off an active scroll instead of blocking a
  // frame — mirroring `indexSource = useDeferredValue(allTracks)` above.
  const deferredPlaybackStats = useDeferredValue(playbackStats);
  const deferredPlaybackEvents = useDeferredValue(playbackEvents);
  const statsByTrackId = useMemo(
    () => buildTrackStatsMap(deferredPlaybackStats),
    [deferredPlaybackStats],
  );
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
  const needsSetWall = mode === "sets";
  const needsTrackWall = mode === "tracks";
  const needsAlbumWall = mode === "albums";
  const needsArtistWall = mode === "artists";
  const hasSetQuery = needsSetWall && setQuery.trim() !== "";
  const hasTrackFacetQuery = needsTrackWall && trackQuery.trim() !== "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const artistItems = useMemo<LibraryEntityItem[]>(() => {
    if (!needsArtistWall) return EMPTY_LIBRARY_ENTITY_ITEMS;
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
    needsArtistWall,
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
    if (!needsAlbumWall) return EMPTY_LIBRARY_ENTITY_ITEMS;
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
    needsAlbumWall,
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
    if (pendingEntity.kind === "set") {
      if (!sessions.some((session) => session.id === pendingEntity.id)) return;
      beginCoverMorph(sourceCoverMorphNamespace(pendingEntity));
      transitionState(() => {
        setMode("sets");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "sets");
        setSelectedOnlinePlaylist(null);
        setSelectedArtistKey(null);
        setSelectedAlbumKey(null);
        setSelectedSystemPlaylistId(null);
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedSetAnchorTrackId(pendingEntity.anchorTrackId);
        setSelectedSetId(pendingEntity.id);
        consumeLibraryEntity();
      });
      return;
    } else if (pendingEntity.kind === "system-playlist") {
      beginCoverMorph(sourceCoverMorphNamespace(pendingEntity));
      transitionState(() => {
        setMode("sets");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "sets");
        setSelectedOnlinePlaylist(null);
        setSelectedSetId(null);
        setSelectedSetAnchorTrackId(undefined);
        setSelectedArtistKey(null);
        setSelectedAlbumKey(null);
        setSelectedSystemAnchorTrackId(pendingEntity.anchorTrackId);
        setSelectedSystemPlaylistId(pendingEntity.id);
        consumeLibraryEntity();
      });
      return;
    } else if (pendingEntity.kind === "artist") {
      const entry = findArtistByName(artistIndex, pendingEntity.name);
      if (!entry) return;
      transitionState(() => {
        setMode("artists");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "artists");
        setSelectedOnlinePlaylist(null);
        setSelectedSetId(null);
        setSelectedSetAnchorTrackId(undefined);
        setSelectedSystemPlaylistId(null);
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedAlbumKey(null);
        setSelectedArtistKey(entry.key);
        consumeLibraryEntity();
      });
      return;
    } else if (pendingEntity.kind === "album") {
      const entry = findAlbumForTrack(albumIndex, pendingEntity.trackId);
      if (!entry) return;
      transitionState(() => {
        setMode("albums");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "albums");
        setSelectedOnlinePlaylist(null);
        setSelectedSetId(null);
        setSelectedSetAnchorTrackId(undefined);
        setSelectedSystemPlaylistId(null);
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedArtistKey(null);
        setSelectedAlbumKey(entry.key);
        consumeLibraryEntity();
      });
      return;
    } else if (pendingEntity.kind === "downloads") {
      transitionState(() => {
        setMode("downloads");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "downloads");
        setSelectedOnlinePlaylist(null);
        setSelectedSetId(null);
        setSelectedSetAnchorTrackId(undefined);
        setSelectedSystemPlaylistId(null);
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedArtistKey(null);
        setSelectedAlbumKey(null);
        consumeLibraryEntity();
      });
      return;
    } else {
      beginCoverMorph(sourceCoverMorphNamespace(pendingEntity));
      transitionState(() => {
        setMode("online");
        if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, "online");
        setSelectedSetId(null);
        setSelectedSetAnchorTrackId(undefined);
        setSelectedSystemPlaylistId(null);
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedArtistKey(null);
        setSelectedAlbumKey(null);
        setSelectedOnlinePlaylist(pendingEntity.playlist);
        consumeLibraryEntity();
      });
      return;
    }
  }, [pendingEntity, sessions, artistIndex, albumIndex, consumeLibraryEntity, beginCoverMorph]);

  // Faceted search: matching artists/albums surfaced above the song list in the
  // tracks ("全部歌曲") mode (honors scoped artist:/album: tokens).
  // Precompute transliteration variants only when a track query can show facets;
  // the old wrapper rebuilt every artist/album candidate on each keystroke and on
  // first opening the tracks wall.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const trackFacetCandidates = useMemo(
    () =>
      hasTrackFacetQuery ? buildFacetCandidates(artistIndex, albumIndex) : EMPTY_FACET_CANDIDATES,
    [artistIndex, albumIndex, transliterationReady, hasTrackFacetQuery],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const trackFacets = useMemo(
    () =>
      hasTrackFacetQuery
        ? searchFacetCandidates(trackFacetCandidates, trackQuery)
        : EMPTY_ENTITY_FACETS,
    [trackFacetCandidates, trackQuery, transliterationReady, hasTrackFacetQuery],
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

  const items = useMemo<SetGalleryItem[]>(() => {
    if (!needsSetWall) return EMPTY_SET_GALLERY_ITEMS;
    return sessions.map((s) => {
      let setTracks: Track[] | undefined;
      const getSetTracks = () => {
        setTracks ??= s.trackIds.map((id) => trackById.get(id)).filter((tr): tr is Track => !!tr);
        return setTracks;
      };
      const fallbackCoverTrackId =
        s.coverBlobId || s.remoteCoverUrl
          ? undefined
          : (s.trackIds.find((id) => Boolean(trackById.get(id)?.coverBlobId)) ?? s.trackIds[0]);
      return {
        session: s,
        trackCount: s.trackIds.length,
        likedCount:
          likedIdsActive && likedIds.size > 0
            ? s.trackIds.reduce((count, id) => count + (likedIds.has(id) ? 1 : 0), 0)
            : 0,
        lastActivityAt: s.updatedAt,
        coverTrackId: fallbackCoverTrackId,
        matchesQuery: hasSetQuery
          ? (trackQuery) => searchTracks(getSetTracks(), trackQuery, memoryNotes).length > 0
          : undefined,
      };
    });
  }, [hasSetQuery, likedIds, likedIdsActive, memoryNotes, sessions, trackById, needsSetWall]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shown = useMemo(() => {
    if (!needsSetWall || !showLocalPlaylists) return [];
    const byOrigin =
      originFilter === "all"
        ? items
        : items.filter((it) => resolveSetOrigin(it.session) === originFilter);
    return sortSets(filterSets(byOrigin, setQuery), sort, sortDir);
  }, [
    items,
    setQuery,
    sort,
    sortDir,
    transliterationReady,
    needsSetWall,
    originFilter,
    showLocalPlaylists,
  ]);
  // Only the sets home shows the system-playlist cards, yet these derive a
  // recency/most-played sort over the WHOLE library (twice). Gate to the sets tab so
  // sitting on tracks/artists/albums while music plays doesn't re-sort 6k tracks per
  // heartbeat for cards that aren't on screen; the stats inputs are deferred too.
  const systemPlaylistRows = useMemo(
    () =>
      needsSetWall && showLocalPlaylists
        ? {
            "system:liked": deriveHeartedPlaylist(allTracks, likedIds).map(trackToSystemPlayable),
            "system:recent": deriveRecentlyPlayedPlaylist(allTracks, {
              events: deferredPlaybackEvents,
              remoteTracks,
              stats: deferredPlaybackStats,
            }),
            "system:most": deriveMostPlayedPlaylist(allTracks, {
              events: deferredPlaybackEvents,
              now: Date.now(),
              range: "all",
              remoteTracks,
              stats: deferredPlaybackStats,
            }),
          }
        : EMPTY_SYSTEM_PLAYLIST_ROWS,
    [
      needsSetWall,
      showLocalPlaylists,
      allTracks,
      deferredPlaybackEvents,
      deferredPlaybackStats,
      remoteTracks,
      likedIds,
    ],
  );
  const systemPlaylistItems = useMemo<SystemPlaylistCardItem[]>(
    () =>
      needsSetWall && showLocalPlaylists
        ? SYSTEM_PLAYLISTS.map((playlist) => ({
            count: systemPlaylistRows[playlist.id].length,
            coverTrack: pickSystemPlaylistCoverTrack(systemPlaylistRows[playlist.id]),
            icon: playlist.icon,
            id: playlist.id,
            label: systemPlaylistLabel(playlist.id, t),
            playLabel: t("systemPlaylists.play", { name: systemPlaylistLabel(playlist.id, t) }),
            subtitle: t("gallery.count", { count: systemPlaylistRows[playlist.id].length }),
          }))
        : [],
    [systemPlaylistRows, t, needsSetWall, showLocalPlaylists],
  );
  // Stable key accessors for the virtualized walls (kept stable so the grid's
  // memoized scroll/focus callbacks don't churn every render).
  const getSetKey = useCallback((item: SetGalleryItem) => item.session.id, []);
  const getEntityKey = useCallback((item: LibraryEntityItem) => item.key, []);
  // The active wall's cards in display order — roving keyboard nav walks these
  // keys (not the DOM) so it can reach cards that virtualization hasn't mounted.
  const galleryKeys = useMemo<string[]>(() => {
    if (mode === "sets") {
      return [
        ...(showLocalPlaylists && !collapsedSetSections.system
          ? systemPlaylistItems.map((item) => item.id)
          : []),
        ...(showLocalPlaylists && !collapsedSetSections.local
          ? shown.map((item) => item.session.id)
          : []),
        ...(showOnlinePlaylists && !collapsedSetSections.online
          ? visibleOnlinePlaylists.map((playlist) => `online:${playlist.source}:${playlist.id}`)
          : []),
      ];
    }
    if (mode === "albums") return albumItems.map((item) => item.key);
    if (mode === "artists") return artistItems.map((item) => item.key);
    return [];
  }, [
    mode,
    shown,
    albumItems,
    artistItems,
    systemPlaylistItems,
    visibleOnlinePlaylists,
    showLocalPlaylists,
    showOnlinePlaylists,
    collapsedSetSections,
  ]);
  const galleryKeysRef = useRef(galleryKeys);
  galleryKeysRef.current = galleryKeys;
  // Pre-sort + liked-filter, then search: with no query the chosen order shows
  // through; with a query, relevance wins and the sort is the stable tiebreak.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    if (!needsTrackWall) return EMPTY_TRACKS;
    const sorted = sortTracks(
      filterTracksByRating(filterLikedTracks(allTracks, likedOnly, likedIds), ratingRange),
      trackSort,
      trackSortDir,
      lastPlayedByTrack,
    );
    return searchTracks(sorted, trackQuery, memoryNotes);
  }, [
    allTracks,
    likedOnly,
    ratingRange,
    likedIds,
    trackSort,
    trackSortDir,
    lastPlayedByTrack,
    memoryNotes,
    trackQuery,
    transliterationReady,
    needsTrackWall,
  ]);
  const selectedLibraryTrack = useMemo(
    () => shownTracks.find((track) => track.id === selectedLibraryTrackId) ?? shownTracks[0],
    [selectedLibraryTrackId, shownTracks],
  );
  // A–Z fast-scroll strip — only on a long, name-sorted, unfiltered, query-free
  // library (other orders / relevance results don't map to letters).
  const trackAlphabetLetterOf = useTrackAlphabetLetterOf(
    needsTrackWall &&
      trackSort === "name" &&
      trackQuery.trim() === "" &&
      !likedOnly &&
      !ratingRange &&
      shownTracks.length > ALPHABET_INDEX_MIN_TRACKS,
    transliterationReady,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownRemoteTracks = useMemo(
    () =>
      needsTrackWall && trackQuery.trim()
        ? remoteTracks
            .filter((track) => matchesRemoteSearchTrack(track, trackQuery))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [remoteTracks, trackQuery, transliterationReady, needsTrackWall],
  );
  const isEmptyTrackLibrary =
    allTracks.length === 0 && trackQuery.trim() === "" && !likedOnly && !ratingRange;
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

  // Route the wall hover-scrollbar drag through the wall's Lenis (immediate) when
  // active, else native — mirrors the track list's scrollToTop.
  const wallScrollToTop = useCallback(
    (top: number) => {
      if (wallLenisRef.current) wallLenisRef.current.scrollTo(top, { immediate: true });
      else wallScrollRef.current?.scrollTo({ top });
    },
    [wallLenisRef],
  );
  // A–Z fast-scroll buckets + jump for the active wall — only when name-sorted,
  // unfiltered, and long enough. Items are already name-sorted (reading-aware via
  // sortSets/sortEntities), so buildAlphabetIndex over them is contiguous; jumps go
  // through the grid's scrollToKey (handles list AND grid index→row). Recomputes when
  // the dictionaries load (transliterationReady) so labels refine to pinyin/kana.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady refreshes the labels after dictionaries load
  const wallAlphabet = useMemo(() => {
    if (query.trim() !== "") return null;
    if (mode === "sets") {
      if (sort !== "name" || shown.length <= WALL_ALPHABET_MIN_ITEMS) return null;
      return {
        buckets: buildAlphabetIndex(shown, (item) => transliterateInitial(item.session.name)),
        jump: (index: number) => {
          const item = shown[index];
          if (item) galleryRef.current?.scrollToKey(item.session.id);
        },
      };
    }
    if (mode === "albums" || mode === "artists") {
      if (entitySort !== "name") return null;
      const items = mode === "albums" ? albumItems : artistItems;
      if (items.length <= WALL_ALPHABET_MIN_ITEMS) return null;
      return {
        buckets: buildAlphabetIndex(items, (item) => transliterateInitial(item.label)),
        jump: (index: number) => {
          const item = items[index];
          if (item) galleryRef.current?.scrollToKey(item.key);
        },
      };
    }
    return null;
  }, [mode, sort, entitySort, query, shown, albumItems, artistItems, transliterationReady]);

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
    if (!isGalleryWallMode(mode)) return;
    setViewByMode((prev) => (prev[mode] === next ? prev : { ...prev, [mode]: next }));
    if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_KEYS[mode], next);
  }

  function setModePref(next: GalleryMode) {
    setMode(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, next);
  }

  // Sort chips: re-clicking the active field flips direction; picking a new field
  // selects it at its natural orientation (newest/longest first, names A→Z).
  function onSetSortClick(next: SetSort) {
    const dir: SortDir =
      sort === next ? (sortDir === "asc" ? "desc" : "asc") : SET_SORT_DEFAULT_DIR[next];
    setSort(next);
    setSortDir(dir);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SET_SORT_KEY, next);
      localStorage.setItem(SET_SORT_DIR_KEY, dir);
    }
  }

  function onSetSourceFilterClick(next: SetSourceFilter) {
    setSetSourceFilter(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(SET_SOURCE_FILTER_KEY, next);
  }

  function toggleSetSection(section: SetWallSectionId) {
    setCollapsedSetSections((current) => {
      const next = { ...current, [section]: !current[section] };
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SET_SECTION_COLLAPSE_KEY, JSON.stringify(next));
      }
      return next;
    });
  }

  function onTrackSortClick(next: TrackSort) {
    // Re-clicking the active field flips direction; a new field selects it at its
    // natural orientation. Persist both so the choice survives a reload.
    const dir: SortDir =
      trackSort === next ? (trackSortDir === "asc" ? "desc" : "asc") : TRACK_SORT_DEFAULT_DIR[next];
    setTrackSort(next);
    setTrackSortDir(dir);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TRACK_SORT_KEY, next);
      localStorage.setItem(TRACK_SORT_DIR_KEY, dir);
    }
  }

  function onEntitySortClick(next: EntitySort) {
    const dir: SortDir =
      entitySort === next
        ? entitySortDir === "asc"
          ? "desc"
          : "asc"
        : ENTITY_SORT_DEFAULT_DIR[next];
    setEntitySort(next);
    setEntitySortDir(dir);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ENTITY_SORT_KEY, next);
      localStorage.setItem(ENTITY_SORT_DIR_KEY, dir);
    }
  }

  const playSet = useCallback(
    async (setId: string) => {
      await setActiveSession(setId);
      void play();
    },
    [play, setActiveSession],
  );

  const playSystemSet = useCallback(
    async (playlistId: SystemPlaylistId) => {
      await playSystemPlaylist(
        playlistId,
        localTracksFromSystemRows(systemPlaylistRows[playlistId]),
      );
      void play();
    },
    [play, playSystemPlaylist, systemPlaylistRows],
  );
  const handleSetInitialFocusHandled = useCallback(() => {
    returnFocusKeyRef.current = null;
  }, []);

  async function createNewSet() {
    const s = await createSession({
      name: t("gallery.newSetName"),
      seedPrompt: "",
      config: { autoExtend: false },
    });
    clearCoverMorphBeforeTransition();
    transitionState(() => setSelectedSetId(s.id));
  }

  // Leaving a detail keeps the current morph key through the transition so the
  // detail cover can pair with the returning wall card. The wall restores its
  // scroll position as it mounts; keeping the name is what makes Back mirror Enter
  // instead of falling back to only the root cross-fade.
  function leaveDetail(update: () => void) {
    transitionState(update);
  }

  // Re-tapping the already-active library tab (nav-store bumps `libraryHomeNonce`)
  // backs out of any open detail to the root wall — same effect as pressing Back,
  // so it animates through `leaveDetail`. Guarded by a ref so it only fires on an
  // actual bump (not the initial mount) and no-ops when already at the wall.
  const libraryHomeNonce = useNavStore((s) => s.libraryHomeNonce);
  const lastLibraryHomeNonce = useRef(libraryHomeNonce);
  useEffect(() => {
    if (lastLibraryHomeNonce.current === libraryHomeNonce) return;
    lastLibraryHomeNonce.current = libraryHomeNonce;
    if (
      !selectedSetId &&
      !selectedSystemPlaylistId &&
      !selectedOnlinePlaylist &&
      !selectedArtistKey &&
      !selectedAlbumKey
    ) {
      return;
    }
    // Same animated back-out as `leaveDetail`, inlined so the effect depends only
    // on the nonce + open-detail flags (not the per-render `leaveDetail` closure).
    transitionState(() => {
      setSelectedSetAnchorTrackId(undefined);
      setSelectedSetId(null);
      setSelectedSystemAnchorTrackId(undefined);
      setSelectedSystemPlaylistId(null);
      setSelectedOnlinePlaylist(null);
      setSelectedArtistKey(null);
      setSelectedAlbumKey(null);
    });
  }, [
    libraryHomeNonce,
    selectedSetId,
    selectedSystemPlaylistId,
    selectedOnlinePlaylist,
    selectedArtistKey,
    selectedAlbumKey,
  ]);

  // Opening a card remembers it so backing out re-focuses it (W/S/↑↓ continue from
  // there) and restores the wall scroll position on the way back.
  const openSet = useCallback(
    (id: string) => {
      returnFocusKeyRef.current = id;
      beginCoverMorph(`set:${id}`);
      transitionState(() => {
        setSelectedSetAnchorTrackId(undefined);
        setSelectedSetId(id);
      });
    },
    [beginCoverMorph],
  );
  const renderSetCard = useCallback(
    (item: SetGalleryItem) => (
      <SetCard
        item={item}
        coverTrack={item.coverTrackId ? trackByIdRef.current.get(item.coverTrackId) : undefined}
        view={activeWallView}
        coverViewTransitionName={coverMorphName(`set:${item.session.id}`)}
        onEnter={openSet}
        onPlay={playSet}
        onRequestDelete={setDeletingSet}
      />
    ),
    [activeWallView, coverMorphName, openSet, playSet],
  );
  const openSystemPlaylist = useCallback(
    (id: SystemPlaylistId) => {
      returnFocusKeyRef.current = id;
      clearCoverMorphBeforeTransition();
      transitionState(() => {
        setSelectedSystemAnchorTrackId(undefined);
        setSelectedSystemPlaylistId(id);
      });
    },
    [clearCoverMorphBeforeTransition],
  );
  const openArtist = useCallback(
    (key: string) => {
      returnFocusKeyRef.current = key;
      beginCoverMorph(`artist:${key}`);
      transitionState(() => setSelectedArtistKey(key));
    },
    [beginCoverMorph],
  );
  const openAlbum = useCallback(
    (key: string) => {
      returnFocusKeyRef.current = key;
      beginCoverMorph(`album:${key}`);
      transitionState(() => setSelectedAlbumKey(key));
    },
    [beginCoverMorph],
  );

  function openAlbumFromArtist(key: string) {
    beginCoverMorph(`album:${key}`);
    transitionState(() => {
      setSelectedArtistKey(null);
      setSelectedAlbumKey(key);
    });
  }

  // Wall scroll container: adopt it as state so the grids re-render with a live
  // scroller the instant it attaches. Scroll-position restore is owned by the grid
  // (`restoreScrollTop`), which waits until its row estimate is known so a deep
  // offset isn't clamped against a not-yet-measured page. Re-focusing the card we
  // came from is owned by the grid too (`initialFocusKey`).
  const attachWall = useCallback(
    (node: HTMLDivElement | null) => {
      wallScrollRef.current = node;
      if (node && mode !== "tracks") {
        node.scrollTop = wallScrollTops.current[mode] || 0;
      }
      setWallScrollEl(node);
    },
    [mode],
  );

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
    if (!searchTabActive) return;
    const detailOpen =
      !!selectedSetId ||
      !!selectedSystemPlaylistId ||
      !!selectedOnlinePlaylist ||
      !!selectedArtistKey ||
      !!selectedAlbumKey;
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
  }, [
    mode,
    selectedSetId,
    selectedSystemPlaylistId,
    selectedOnlinePlaylist,
    selectedArtistKey,
    selectedAlbumKey,
    focusGalleryCard,
    searchTabActive,
  ]);

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

  // Stable across tab/chrome-only re-renders so the memoized TrackListSection can
  // keep the virtualized list asleep unless the actual list controls/facets change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: callbacks close over the listed sort/query state.
  const trackListHeader = useMemo(
    () => (
      <>
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
          <RatingFilterChip value={ratingRange} onChange={setRatingRange} />
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
    ),
    [
      trackSort,
      trackSortDir,
      likedOnly,
      ratingRange,
      facetArtistItems,
      facetAlbumItems,
      trackById,
      t,
    ],
  );
  const viewLibraryTrack = useCallback(
    (track: Track) => transitionState(() => setSelectedLibraryTrackId(track.id)),
    [],
  );
  // 全部歌曲: play in the library context (the displayed list), not the track's home set.
  const playLibraryTrack = useCallback(
    (track: Track) =>
      void playTrackInContext(track, { source: { kind: "library" }, tracks: shownTracks }),
    [playTrackInContext, shownTracks],
  );

  if (!searchContentMounted) return <div aria-hidden="true" className="h-full" />;

  // Level 2: a set's track list.
  if (selectedSystemPlaylistId) {
    return (
      <RenderTraceBoundary id="search:detail:system-playlist" active={searchTabActive}>
        <SystemPlaylistDetail
          events={playbackEvents}
          anchorTrackId={selectedSystemAnchorTrackId}
          onBack={() =>
            leaveDetail(() => {
              setSelectedSystemAnchorTrackId(undefined);
              setSelectedSystemPlaylistId(null);
            })
          }
          playlistId={selectedSystemPlaylistId}
          remoteTracks={remoteTracks}
          stats={playbackStats}
          tracks={allTracks}
        />
      </RenderTraceBoundary>
    );
  }

  if (selectedSetId) {
    return (
      <RenderTraceBoundary id="search:detail:set" active={searchTabActive}>
        <SetDetailView
          setId={selectedSetId}
          trackById={trackById}
          lastPlayed={lastPlayedByTrack}
          anchorTrackId={selectedSetAnchorTrackId}
          coverViewTransitionName={coverMorphName(`set:${selectedSetId}`)}
          onBack={() =>
            leaveDetail(() => {
              setSelectedSetAnchorTrackId(undefined);
              setSelectedSetId(null);
            })
          }
        />
      </RenderTraceBoundary>
    );
  }

  if (selectedOnlinePlaylist) {
    return (
      <RenderTraceBoundary id="search:detail:online-playlist" active={searchTabActive}>
        <OnlinePlaylistDetail
          playlist={selectedOnlinePlaylist}
          onBack={() => leaveDetail(() => setSelectedOnlinePlaylist(null))}
        />
      </RenderTraceBoundary>
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
      <RenderTraceBoundary id="search:detail:artist" active={searchTabActive}>
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
          albumCoverViewTransitionName={(key) => coverMorphName(`album:${key}`)}
          onOpenAlbum={openAlbumFromArtist}
          onBack={() => leaveDetail(() => setSelectedArtistKey(null))}
        />
      </RenderTraceBoundary>
    );
  }
  if (selectedAlbum) {
    const tracks = selectedAlbum.trackIds
      .map((id) => trackById.get(id))
      .filter((tr): tr is Track => !!tr);
    return (
      <RenderTraceBoundary id="search:detail:album" active={searchTabActive}>
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
      </RenderTraceBoundary>
    );
  }

  // Level 1: the album wall. The mode tabs + search box are a pinned toolbar at the
  // top (just below the floating wordmark); only the content region below scrolls,
  // dissolving under the floating chrome (`chrome-fade`) top and bottom.
  return (
    <div
      className={cn(
        "mx-auto flex h-full w-full flex-col pt-chrome-top",
        mode === "tracks" ? "max-w-6xl" : "max-w-4xl",
      )}
    >
      {/* Pinned toolbar — the mode tabs + search box stay put while only the content
          below scrolls. No background: it sits cleanly over the page / ambient stage,
          and the scroller's chrome-fade dissolves rows as they reach the top. */}
      <RenderTraceBoundary id="search:toolbar" active={searchTabActive}>
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
                {streamingSupported && (
                  <ModeTab value="online" shortcut="5">
                    {t("gallery.modeOnline")}
                  </ModeTab>
                )}
                <ModeTab value="downloads" shortcut="6">
                  {t("gallery.modeDownloads")}
                </ModeTab>
              </TabsList>
            </Tabs>
          </TooltipProvider>

          {/* Discover / Downloads have no text search / view toggle → hide the toolbar row. */}
          {mode !== "online" && mode !== "downloads" && (
            <div className="flex items-center gap-2 px-4">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQueryForMode(e.target.value)}
                  placeholder={t(SEARCH_PLACEHOLDER_KEY[mode], {
                    shortcut: globalSearchShortcut,
                  })}
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
              {mode === "tracks" && <AddTracksMenu size="default" className="h-10 sm:h-10" />}
              {mode !== "tracks" && (
                <ViewToggleGroup view={activeWallView} onChange={setViewPref} />
              )}
            </div>
          )}
        </div>
      </RenderTraceBoundary>

      {/* Content region. Single-column walls (sets / albums / artists) scroll here and
          dissolve under the floating search box via the top `chrome-fade`. Tracks mode
          is a two-pane master/detail instead: this frame does NOT scroll — the list and
          the inspector are each their own bounded scroll column (each with its own top
          fade), so neither pane drives the other's height and the inspector no longer
          gets clipped by the dock. */}
      <RenderTraceBoundary id={`search:wall:${mode}`} active={searchTabActive}>
        <div
          ref={attachWall}
          onScroll={(e) => {
            wallScrollTops.current[mode] = e.currentTarget.scrollTop;
          }}
          className={cn(
            "group/list no-scrollbar flex min-h-0 flex-1 flex-col px-1 pt-3",
            // Tracks + Downloads: a clipped, non-scrolling frame so the inner virtualized
            // list is capped to the viewport and scrolls itself. Other walls scroll here.
            mode === "tracks" || mode === "downloads"
              ? "overflow-hidden pb-0"
              : "chrome-fade overflow-y-auto pb-chrome-bottom [--chrome-fade-top:1.25rem]",
          )}
        >
          {/* Hover scrollbar + A–Z fast-jump for the three card walls (the track list
            carries its own). The A–Z rail shows only when the active wall is
            name-sorted; the scrollbar insets to its left then. */}
          {isGalleryWallMode(mode) && (
            <>
              <HoverScrollbar
                scrollRef={wallScrollRef}
                scrollToTop={wallScrollToTop}
                rightInset={wallAlphabet ? 24 : 0}
              />
              {wallAlphabet ? (
                <AlphabetIndex
                  scrollRef={wallScrollRef}
                  buckets={wallAlphabet.buckets}
                  onJump={wallAlphabet.jump}
                />
              ) : null}
            </>
          )}
          {mode === "sets" && (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5 px-4">
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
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                <FilterChip
                  active={setSourceFilter === "all"}
                  onClick={() => onSetSourceFilterClick("all")}
                >
                  {t("gallery.sourceFilter.all")}
                </FilterChip>
                <FilterChip
                  active={setSourceFilter === "local"}
                  onClick={() => onSetSourceFilterClick("local")}
                >
                  {t("gallery.sourceFilter.local")}
                </FilterChip>
                <FilterChip
                  active={setSourceFilter === "online"}
                  onClick={() => onSetSourceFilterClick("online")}
                >
                  {t("gallery.sourceFilter.online")}
                </FilterChip>
                {onlineSourceOptions.map((source) => (
                  <FilterChip
                    key={source}
                    active={setSourceFilter === source}
                    onClick={() => onSetSourceFilterClick(source)}
                  >
                    {STREAM_SOURCE_DISPLAY_NAMES[source]}
                  </FilterChip>
                ))}
                {showLocalPlaylists ? (
                  <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                ) : null}
                {showLocalPlaylists
                  ? SET_ORIGINS.map((o) => (
                      <FilterChip
                        key={o}
                        active={originFilter === o}
                        onClick={() => setOriginFilter((cur) => (cur === o ? "all" : o))}
                      >
                        {t(`gallery.origin.${o}` as const)}
                      </FilterChip>
                    ))
                  : null}
              </div>

              {showLocalPlaylists ? (
                <SetWallSection
                  title={t("gallery.section.system")}
                  subtitle={t("gallery.playlistCount", { count: systemPlaylistItems.length })}
                  collapsed={collapsedSetSections.system}
                  onToggle={() => toggleSetSection("system")}
                >
                  <div className="px-3">
                    <RenderTraceBoundary id="search:sets:system-cards" active={searchTabActive}>
                      <SystemPlaylistCards
                        items={systemPlaylistItems}
                        view={activeWallView}
                        onOpen={openSystemPlaylist}
                        onPlay={playSystemSet}
                      />
                    </RenderTraceBoundary>
                  </div>
                </SetWallSection>
              ) : null}

              {showLocalPlaylists ? (
                <SetWallSection
                  title={t("gallery.section.local")}
                  subtitle={t("gallery.playlistCount", { count: shown.length })}
                  collapsed={collapsedSetSections.local}
                  onToggle={() => toggleSetSection("local")}
                >
                  {shown.length === 0 ? (
                    sessions.length === 0 && setQuery.trim() === "" ? (
                      <LibraryImportEmptyState className="mt-6" actions="direct" />
                    ) : (
                      <p className="mt-12 text-center text-sm text-muted-foreground">
                        {t("gallery.empty")}
                      </p>
                    )
                  ) : (
                    <ContextMenu>
                      <ContextMenuTrigger className="block min-h-[40vh] px-3">
                        <RenderTraceBoundary id="search:sets:grid" active={searchTabActive}>
                          <VirtualCardGrid
                            gridRef={galleryRef}
                            items={shown}
                            view={activeWallView}
                            getKey={getSetKey}
                            className={wallAlphabet ? "pr-6" : undefined}
                            scrollElement={wallScrollEl}
                            lenisRef={wallLenisRef}
                            restoreScrollTop={wallScrollTops.current.sets}
                            initialFocusKey={returnFocusKeyRef.current}
                            onInitialFocusHandled={handleSetInitialFocusHandled}
                            renderCard={renderSetCard}
                          />
                        </RenderTraceBoundary>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => void createNewSet()}>
                          <Plus /> {t("gallery.newSet")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                </SetWallSection>
              ) : null}

              {showOnlinePlaylists ? (
                <SetWallSection
                  title={t("gallery.section.online")}
                  subtitle={t("gallery.onlinePlaylistCount", {
                    count: visibleOnlinePlaylists.length,
                  })}
                  collapsed={collapsedSetSections.online}
                  onToggle={() => toggleSetSection("online")}
                  action={
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void onlineCatalog.refreshAll()}
                      disabled={onlineCatalog.syncing}
                    >
                      <RefreshCw
                        className={cn("size-4", onlineCatalog.syncing && "animate-spin")}
                      />
                      {t("gallery.refreshOnlinePlaylists")}
                    </Button>
                  }
                >
                  <OnlinePlaylistSection
                    playlists={onlineSourceFilteredPlaylists}
                    query={setQuery}
                    onOpen={setSelectedOnlinePlaylist}
                    onImport={setOnlineImportTarget}
                    onRefresh={() => void onlineCatalog.refreshAll()}
                    refreshing={onlineCatalog.syncing}
                    view={activeWallView}
                    showHeader={false}
                    scrollElement={showLocalPlaylists ? null : wallScrollEl}
                    lenisRef={showLocalPlaylists ? undefined : wallLenisRef}
                  />
                </SetWallSection>
              ) : null}
              {showOnlinePlaylists &&
              !showLocalPlaylists &&
              onlineSourceFilteredPlaylists.length === 0 ? (
                <p className="mt-12 text-center text-muted-foreground text-sm">
                  {t("gallery.onlinePlaylistNoMatches")}
                </p>
              ) : null}
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
                isEmptyTrackLibrary ? (
                  <LibraryImportEmptyState className="mt-10" actions="direct" />
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Keep the filter chips mounted when THEY emptied the list —
                        otherwise an over-tight 红心/评分 filter would unmount its
                        own toggle and strand the user in the empty state. */}
                    {(likedOnly || ratingRange !== null) && trackListHeader}
                    <p className="mt-12 text-center text-sm text-muted-foreground">
                      {t("gallery.tracksEmpty")}
                    </p>
                  </div>
                )
              ) : (
                <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                  <div className="flex min-h-0 flex-1 flex-col gap-4">
                    {(shownTracks.length > 0 ||
                      facetArtistItems.length > 0 ||
                      facetAlbumItems.length > 0) && (
                      <RenderTraceBoundary id="search:tracks:list" active={searchTabActive}>
                        <TrackListSection
                          tracks={shownTracks}
                          selectedTrackId={selectedLibraryTrack?.id}
                          onView={viewLibraryTrack}
                          onPlay={playLibraryTrack}
                          alphabetLetterOf={trackAlphabetLetterOf}
                          emptyHint={t("gallery.tracksEmpty")}
                          listClassName="chrome-fade no-scrollbar pt-1.5 pb-chrome-bottom [--chrome-fade-top:0.75rem]"
                          className="flex-1"
                          listHeader={trackListHeader}
                          listTraceId="search:tracks:virtual"
                        />
                      </RenderTraceBoundary>
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
                  <RenderTraceBoundary id="search:tracks:inspector" active={searchTabActive}>
                    <TrackInspectorPanel track={selectedLibraryTrack} />
                  </RenderTraceBoundary>
                </div>
              )}
            </div>
          )}

          {mode === "albums" && (
            <>
              <EntitySortRow sort={entitySort} dir={entitySortDir} onSort={onEntitySortClick} />
              {albumItems.length === 0 ? (
                allTracks.length === 0 && albumQuery.trim() === "" ? (
                  <LibraryImportEmptyState className="mt-10" actions="direct" />
                ) : (
                  <p className="mt-12 text-center text-muted-foreground text-sm">
                    {t("gallery.albumsEmpty")}
                  </p>
                )
              ) : (
                <VirtualCardGrid
                  gridRef={galleryRef}
                  items={albumItems}
                  view={activeWallView}
                  getKey={getEntityKey}
                  className={wallAlphabet ? "pr-6" : undefined}
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
                      view={activeWallView}
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
                allTracks.length === 0 && artistQuery.trim() === "" ? (
                  <LibraryImportEmptyState className="mt-10" actions="direct" />
                ) : (
                  <p className="mt-12 text-center text-muted-foreground text-sm">
                    {t("gallery.artistsEmpty")}
                  </p>
                )
              ) : (
                <VirtualCardGrid
                  gridRef={galleryRef}
                  items={artistItems}
                  view={activeWallView}
                  getKey={getEntityKey}
                  className={wallAlphabet ? "pr-6" : undefined}
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
                      view={activeWallView}
                      coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                      coverViewTransitionName={coverMorphName(`artist:${item.key}`)}
                      onOpen={() => openArtist(item.key)}
                    />
                  )}
                />
              )}
            </>
          )}
          {mode === "online" && <OnlineDiscoverTab onOpenPlaylist={setSelectedOnlinePlaylist} />}
          {mode === "downloads" && <DownloadCenter />}
        </div>
      </RenderTraceBoundary>
      <PlaylistImportDialog
        playlist={onlineImportTarget}
        onClose={() => setOnlineImportTarget(null)}
      />
    </div>
  );
}

function trackToSystemPlayable(track: Track): SystemPlaylistPlayable {
  return {
    id: track.id,
    kind: "local-track",
    metric: {
      listenedSec: 0,
      playCount: 0,
      trackId: track.id,
    },
    title: track.title,
    track,
  };
}

function localTracksFromSystemRows(rows: SystemPlaylistPlayable[]): Track[] {
  return rows.flatMap((row) => (row.kind === "local-track" ? [row.track] : []));
}

function systemPlaylistLabel(id: SystemPlaylistId, t: CommonT): string {
  switch (id) {
    case "system:liked":
      return t("systemPlaylists.hearted");
    case "system:recent":
      return t("systemPlaylists.recentlyPlayed");
    default:
      return t("systemPlaylists.mostPlayed");
  }
}

/** Set-header "save all offline" button: caches every streamed or R2-remote track
 *  in the set that has no local blob yet. Hidden when nothing is pending (a fully-
 *  local or generated set), so it only appears when there's actually cloud audio/
 *  video to pull down. Spinner + disabled while the bulk run is in flight. */
function SetCloudDownloadButton({ setId, tracks }: { setId: string; tracks: Track[] }) {
  const { t } = useTranslation();
  const downloading = useIsSetBulkDownloading(setId);
  const downloadStreamedSet = usePlayerStore((s) => s.downloadStreamedSet);
  const pending = useMemo(
    () => tracks.filter((tr) => isTrackCacheableToDevice(tr)).length,
    [tracks],
  );
  if (pending === 0) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void downloadStreamedSet(setId)}
      disabled={downloading}
      title={t("streamCache.downloadSet")}
    >
      {downloading ? <Loader2 className="size-4 animate-spin" /> : <CloudDownloadIcon size={16} />}
      {t("streamCache.downloadSet")}
      <span className="tabular-nums text-muted-foreground">{pending}</span>
    </Button>
  );
}

/** Level 2 — one set's virtualized track list. */
function SetDetailView({
  setId,
  trackById,
  lastPlayed,
  anchorTrackId,
  coverViewTransitionName,
  onBack,
}: {
  setId: string;
  trackById: Map<string, Track>;
  /** trackId → last-played epoch ms, for the 最近播放 sort (folded from playback stats). */
  lastPlayed?: ReadonlyMap<string, number>;
  anchorTrackId?: string;
  /** `view-transition-name` for the header cover, so it morphs from the set card
   *  the user tapped on the wall (set only when arriving via a cover morph). */
  coverViewTransitionName?: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const session = useLiveQuery(() => getSession(setId), [setId]);
  const playTrackInContext = usePlayerStore((s) => s.playTrackInContext);
  const fileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [pendingAnchorTrackId, setPendingAnchorTrackId] = useState<string | undefined>(
    anchorTrackId,
  );
  // 红心 lives on songs, not sets — so the "liked only" filter is here, inside the
  // playlist, rather than on the set wall.
  const [likedOnly, setLikedOnly] = useState(false);
  const likedIds = useLikedTrackIds();
  // 评分 range filter over the crowd average — same reasoning as 红心: it lives on
  // songs, so it filters inside the playlist. Chip appears only once the set has
  // at least one rated track (mirrors the likedCount gate).
  const [ratingRange, setRatingRange] = useState<RatingRange | null>(null);
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
  const likedCount = useMemo(
    () => tracks.filter((tr) => likedIds.has(tr.id)).length,
    [tracks, likedIds],
  );
  const hasRatedTracks = useMemo(
    () => tracks.some((tr) => resolveTrackRating(tr) !== null),
    [tracks],
  );
  // Lazily load + observe the transliteration dictionaries so pinyin/kana/romaji
  // matches "snap in" once ready (parity with the gallery's 全部歌曲 search).
  const transliterationReady = useTransliterationReady();
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    const filtered = filterTracksByRating(
      filterLikedTracks(tracks, likedOnly, likedIds),
      ratingRange,
    );
    const ordered = sort ? sortTracks(filtered, sort, sortDir, lastPlayed) : filtered;
    // Empty query returns `ordered` untouched, so the curated/sorted order shows through.
    return searchTracks(ordered, query, memoryNotes);
  }, [
    likedOnly,
    likedIds,
    ratingRange,
    tracks,
    sort,
    sortDir,
    lastPlayed,
    query,
    memoryNotes,
    transliterationReady,
  ]);
  // Drag-to-reorder is only meaningful when the TRUE curated order is showing — a
  // column sort, liked/rating filter, or search query makes drop positions ambiguous
  // (drag-reorder PRD §5.2). `tracks` then equals `shownTracks` in rank order.
  const isManualOrder = !sort && !likedOnly && ratingRange === null && query.trim() === "";
  const alphabetLetterOf = useTrackAlphabetLetterOf(
    sort === "name" &&
      query.trim() === "" &&
      !likedOnly &&
      !ratingRange &&
      shownTracks.length > DETAIL_ALPHABET_MIN_TRACKS,
    transliterationReady,
  );
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
    setPendingAnchorTrackId(anchorTrackId);
  }, [anchorTrackId]);

  useEffect(() => {
    if (shownTracks.length === 0) {
      setSelectedTrackId(null);
      setPendingAnchorTrackId(undefined);
      return;
    }
    if (pendingAnchorTrackId) {
      if (shownTracks.some((track) => track.id === pendingAnchorTrackId)) {
        setSelectedTrackId(pendingAnchorTrackId);
      }
      setPendingAnchorTrackId(undefined);
      return;
    }
    if (!selectedTrackId || !shownTracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(shownTracks[0].id);
    }
  }, [pendingAnchorTrackId, selectedTrackId, shownTracks]);

  // Drop back to "all" if the last liked track is unliked while filtered.
  useEffect(() => {
    if (likedOnly && likedCount === 0) setLikedOnly(false);
  }, [likedOnly, likedCount]);

  // Same for the rating filter: if the set's last rated track loses its votes,
  // clear the range so the (now unmounted) chip can't strand a hidden filter.
  useEffect(() => {
    if (ratingRange && !hasRatedTracks) setRatingRange(null);
  }, [ratingRange, hasRatedTracks]);

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
  const coverUrl = useSetCoverUrl(
    session?.coverBlobId,
    coverTrack,
    session?.coverCrop,
    session?.remoteCoverUrl,
  );
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
                  "group relative grid size-20 shrink-0 place-items-center overflow-hidden bg-secondary outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring album-cover-radius album-cover-shadow",
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
              {session?.cloudSource && (
                <div className="px-1 pt-1">
                  <SourceAttributionChip
                    source={session.cloudSource}
                    fallback={t("gallery.cloudSourceUnknown")}
                  />
                </div>
              )}
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
            {(likedCount > 0 || hasRatedTracks) && (
              <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            )}
            {likedCount > 0 && (
              <FilterChip active={likedOnly} onClick={() => setLikedOnly((v) => !v)}>
                <Heart className={cn("size-3.5", likedOnly && "fill-current")} />
                {t("gallery.filterLiked")}
              </FilterChip>
            )}
            {hasRatedTracks && <RatingFilterChip value={ratingRange} onChange={setRatingRange} />}
          </div>
          <TrackListSection
            setId={setId}
            tracks={shownTracks}
            canReorder={isManualOrder}
            anchorTrackId={pendingAnchorTrackId}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
            onPlay={(track) =>
              void playTrackInContext(track, {
                source: { kind: "set", setId },
                tracks: shownTracks,
              })
            }
            alphabetLetterOf={alphabetLetterOf}
            emptyHint={t("gallery.empty")}
            listClassName="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
            className="min-h-0 flex-1"
            startActions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    // "Play all" follows the displayed order (filters/sorts/search) —
                    // 所见即所播 (PRD Q1). Plays from the first shown track in-context.
                    if (shownTracks.length > 0) {
                      void playTrackInContext(shownTracks[0], {
                        source: { kind: "set", setId },
                        tracks: shownTracks,
                      });
                    }
                  }}
                  disabled={shownTracks.length === 0}
                >
                  <Play className="size-4" /> {t("gallery.playAll")}
                </Button>
                <AddTracksMenu setId={setId} />
                <SetCloudDownloadButton setId={setId} tracks={tracks} />
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
  remoteCoverUrl?: string,
): string | null {
  // Reuse the track cover pipeline (blob resolve + non-destructive square crop)
  // by feeding the set cover through the same shape.
  const setUrl = useTrackCoverUrl(
    coverBlobId || remoteCoverUrl ? { coverBlobId, coverCrop, remoteCoverUrl } : undefined,
  );
  const trackUrl = useTrackCoverUrl(fallbackTrack);
  return coverBlobId || remoteCoverUrl ? setUrl : trackUrl;
}

function useSetThumbnailUrl(
  coverBlobId: string | undefined,
  fallbackTrack: Track | undefined,
  coverCrop?: CropRect,
  remoteCoverUrl?: string,
  isGrid = true,
): string | null {
  const setUrl = useGridCoverUrl(
    coverBlobId || remoteCoverUrl ? { coverBlobId, coverCrop, remoteCoverUrl } : undefined,
    isGrid,
  );
  const trackUrl = useGridCoverUrl(fallbackTrack, isGrid);
  return coverBlobId || remoteCoverUrl ? setUrl : trackUrl;
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

function SetWallSection({
  title,
  subtitle,
  action,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mb-5" data-set-wall-section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !collapsed && "rotate-90",
            )}
          />
          <span className="min-w-0">
            <span className="block font-medium text-sm">{title}</span>
            {subtitle ? (
              <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
            ) : null}
          </span>
        </button>
        {action ? <div className="shrink-0 pr-3">{action}</div> : null}
      </div>
      {collapsed ? null : children}
    </section>
  );
}

/**
 * The 专辑 / 歌手 sort row — name / track count / total duration / last played.
 * Both entity walls share one sort, so this is rendered identically in each.
 * Reuses the existing gallery sort i18n keys.
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
    <div className="mb-3 flex flex-wrap items-center gap-1.5 pt-1 px-3">
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

const SetCard = memo(function SetCard({
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
  onEnter: (id: string) => void;
  onPlay: (id: string) => void;
  /** Right-click → "Delete set…". Omit to disable the context menu. */
  onRequestDelete?: (session: DjSession) => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useSetThumbnailUrl(
    item.session.coverBlobId,
    coverTrack,
    item.session.coverCrop,
    item.session.remoteCoverUrl,
    view === "grid",
  );
  // Preview hash matching whichever cover is shown: the set's own, else the
  // fallback track's (mirrors useSetCoverUrl's own/fallback choice).
  const coverThumbhash =
    item.session.coverBlobId || item.session.remoteCoverUrl
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
        void onPlay(item.session.id);
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
          onClick={() => onEnter(item.session.id)}
          data-gallery-card
          data-gallery-card-key={item.session.id}
          className="flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CoverImage
            url={coverUrl}
            thumbhash={coverThumbhash}
            placeholder={<Disc3Icon className="text-muted-foreground" size={32} />}
            className="aspect-square w-full"
            style={
              coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined
            }
          />
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
          onClick={() => onEnter(item.session.id)}
          data-gallery-card
          data-gallery-card-key={item.session.id}
          className="flex w-full items-center gap-3 rounded-xl p-2 pe-12 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CoverImage
            url={coverUrl}
            thumbhash={coverThumbhash}
            placeholder={<Disc3Icon className="text-muted-foreground" size={20} />}
            className="size-12 shrink-0"
            style={
              coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.session.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{count}</span>
          </span>
        </button>
        {playBtn}
      </>
    );

  if (!onRequestDelete) return <div className="group relative">{inner}</div>;

  return (
    <ContextMenu>
      <ContextMenuTrigger className="group relative">{inner}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          className="text-destructive-foreground"
          onClick={() => onRequestDelete(item.session)}
        >
          <Trash2 /> {t("set.contextDelete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
