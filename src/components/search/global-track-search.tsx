import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import {
  AudioLines,
  Captions,
  CornerDownLeft,
  Download,
  Film,
  Globe,
  Library,
  ListMusic,
  ListPlus,
  Music,
  Search,
  User,
  X,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RenderTraceBoundary } from "@/components/dev/render-trace-boundary";
import { DownloadQualityDialog } from "@/components/stream/download-quality-dialog";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { db } from "@/db/muzero-db";
import {
  getTrack,
  getTracksByIds,
  listAllTracks,
  listSessions,
  saveSettings,
} from "@/db/repositories";
import type { DjSession, StreamSourceId, Track, TrackLyrics } from "@/db/types";
import { registerSearchDriver } from "@/dev/search-drive";
import { useSettings } from "@/hooks/use-app-data";
import { useBurstSettledValue } from "@/hooks/use-burst-settled-value";
import { useTrackThumbnailUrl } from "@/hooks/use-media";
import { useOnlineSourceSearch } from "@/hooks/use-online-source-search";
import { usePausedLiveQuery } from "@/hooks/use-paused-live-query";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { useWorkerRowSearch } from "@/hooks/use-worker-track-search";
import { hasStreamingSources } from "@/lib/desktop/bridge";
import {
  albumArtistDisplayLabel,
  albumDisplayLabel,
  artistDisplayLabel,
} from "@/lib/entity-labels";
import {
  FILTER_OPTIONS,
  type FilterOption,
  matchFilterOptions,
  parseMention,
  resolveFilterScope,
  type SearchFilter,
} from "@/lib/global-search-filter";
import { rankGlobalSearchBestMatches } from "@/lib/global-search-rank";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";
import { type IndexableRow, parseSearchTokens, scoreRow } from "@/lib/search-core";
import { NO_MATCH_SCORE } from "@/lib/search-transliterate";
import { trackSubtitle } from "@/lib/track-display";
import {
  findLyricSearchMatch,
  type LyricSearchMatch,
  lyricsSearchFields,
} from "@/lib/track-search";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { canDownloadVideo, startBackgroundDownload } from "@/streamsrc/download-action";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";
import { searchGlobalLocalLibrary } from "@/workers/global-search-local-client";
import type { GlobalSearchLocalResults } from "@/workers/global-search-local-core";

/** Implemented online sources surfaced as enable chips (brand names, not i18n). */
const ONLINE_SOURCES: { id: StreamSourceId; label: string }[] = [
  { id: "netease", label: "网易云" },
  { id: "bili", label: "Bilibili" },
  { id: "youtube", label: "YouTube" },
  { id: "qq", label: "QQ 音乐" },
];
/** Brand labels for filter chips / menu (codename `source` id → display name). */
const SOURCE_LABEL: Partial<Record<StreamSourceId, string>> = {
  netease: "网易云",
  bili: "Bilibili",
  youtube: "YouTube",
  qq: "QQ 音乐",
};

/** Display label for a filter — shared by the active pill and the `@` menu. */
function filterLabel(filter: SearchFilter, t: TFunction): string {
  switch (filter.kind) {
    case "source":
      return SOURCE_LABEL[filter.source] ?? filter.source;
    case "track":
      return t("globalSearch.songs");
    case "set":
      return t("gallery.modeSets");
    case "lyrics":
      return t("dock.lyrics");
    case "artist":
      return t("gallery.modeArtists");
    case "album":
      return t("gallery.modeAlbums");
    case "video":
      return t("globalSearch.filterVideo");
    case "audio":
      return t("globalSearch.filterAudio");
    case "local":
      return t("globalSearch.filterLocal");
    case "online":
      return t("globalSearch.filterOnline");
  }
}

/** Glyph for a filter kind — shared by the pill (smaller) and the `@` menu. */
function FilterGlyph({
  filter,
  iconClass,
  discSize,
}: {
  filter: SearchFilter;
  iconClass: string;
  discSize: number;
}) {
  switch (filter.kind) {
    case "track":
      return <Music className={iconClass} />;
    case "set":
      return <ListMusic className={iconClass} />;
    case "lyrics":
      return <Captions className={iconClass} />;
    case "album":
      return <Disc3Icon size={discSize} />;
    case "artist":
      return <User className={iconClass} />;
    case "video":
      return <Film className={iconClass} />;
    case "audio":
      return <AudioLines className={iconClass} />;
    case "local":
      return <Library className={iconClass} />;
    case "source":
    case "online":
      return <Globe className={iconClass} />;
  }
}

const EMPTY_TRACKS: Track[] = [];
const EMPTY_TRACK_BY_ID = new Map<string, Track>();
const EMPTY_LOCAL_RESULTS: GlobalSearchLocalResults = {
  albums: [],
  artists: [],
  coverTrackIds: [],
  trackIds: [],
};
const MAX_SET_RESULTS = 5;
const MAX_SONG_RESULTS = 8;
const MAX_LYRIC_RESULTS = 8;
const MAX_ENTITY_RESULTS = 5;
const GLOBAL_SEARCH_LIBRARY_INITIAL_DELAY_MS = 240;
const GLOBAL_SEARCH_LOCAL_WORKER_QUERY_SETTLE_MS = 220;
const SEARCH_THUMBNAIL_MISS_DELAY_MS = 240;
const LYRIC_HIT_PREFIX = "lyrics:";

/** One arrow-navigable result across the sections (the playlist-link card is not). */
type NavItem =
  | { type: "set"; session: DjSession }
  | { type: "track"; track: Track }
  | { type: "lyric"; track: Track; match: LyricSearchMatch }
  | { type: "album"; entry: AlbumEntry }
  | { type: "artist"; entry: ArtistEntry }
  | { type: "online"; hit: StreamSearchHit };

type ScoredSetResult = {
  score: number;
  session: DjSession;
};

type BestMatchCandidate = {
  item: NavItem;
  key: string;
  kind: "set" | "track" | "lyric" | "album" | "artist";
  order: number;
  recency?: number;
  score: number;
};

export function GlobalTrackSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  // Active `@` scope (artist / album facet, or a forced online source). Reset on open.
  const [filter, setFilter] = useState<SearchFilter | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuIndex, setMenuIndex] = useState(0);
  // Escape dismisses the `@` menu without closing the overlay; cleared on next keystroke.
  const [menuDismissed, setMenuDismissed] = useState(false);
  // The pending download request (hit + audio/video mode); null = dialog closed.
  const [downloadHit, setDownloadHit] = useState<StreamSearchHit | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // The trailing `@mention` the caret is inside, and the text we actually search
  // (everything before that mention).
  const mention = parseMention(query);
  const searchText = (mention.active ? mention.before : query).trim();
  const needsLyricTracks = filter?.kind === "lyrics" && searchText.length > 0;

  // DEV-only: expose open/type/filter/snapshot to the perf-control endpoint so the
  // search scenario can script the ⌘F overlay (its open + query + filter are
  // component-local state, unreachable through the store/action surface). snapshot
  // reads a ref updated each render with the latest results. Behind import.meta.env.DEV
  // so it tree-shakes out of prod.
  const driverSnapshotRef = useRef<() => unknown>(() => null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    registerSearchDriver({
      setOpen: onOpenChange,
      setQuery,
      setFilter: (filterId) => {
        if (filterId === null || filterId === "" || filterId === "clear") {
          setFilter(null);
          return;
        }
        const opt = FILTER_OPTIONS.find((o) => o.id === filterId);
        if (opt) setFilter(opt.filter);
      },
      snapshot: () => driverSnapshotRef.current(),
    });
    return () => registerSearchDriver(null);
  }, [onOpenChange]);
  const deferredSearchText = useDeferredValue(searchText);
  const lyricTracksLive = usePausedLiveQuery(
    () => listAllTracks(db),
    [],
    open && needsLyricTracks,
    [],
    {
      initialDelayMs: GLOBAL_SEARCH_LIBRARY_INITIAL_DELAY_MS,
    },
  );
  const lyricTracks = useThrottledValue(lyricTracksLive, LIBRARY_QUERY_COALESCE_MS);
  const sessions = useLiveQuery(() => listSessions(db), [], []);
  const lyricsRows = usePausedLiveQuery(
    () => db.lyrics.toArray(),
    [],
    open && needsLyricTracks,
    [],
    { initialDelayMs: GLOBAL_SEARCH_LIBRARY_INITIAL_DELAY_MS },
  );
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const playStreamedHit = usePlayerStore((s) => s.playStreamedHit);
  const openSet = useNavStore((s) => s.openSet);
  const openArtist = useNavStore((s) => s.openArtist);
  const openAlbumForTrack = useNavStore((s) => s.openAlbumForTrack);
  const openOnlinePlaylist = useNavStore((s) => s.openOnlinePlaylist);
  const settings = useSettings();
  // Online sources need the desktop media proxy (Referer/CORS). Hidden on web/tauri.
  const streamingSupported = hasStreamingSources();
  // ⌘F Enter on a video-capable online result downloads (video) by default; Settings off → play.
  const enterDownloadsVideo = settings.enterDownloadsVideo !== false;
  const transliterationReady = useTransliterationReady();

  // Which sections + worker/online the active filter shows — the single arbiter
  // (resolveFilterScope) so the gating never drifts. No filter → fast library
  // facets + songs + online; heavyweight full-lyrics search is opt-in via @lyrics.
  // @online skips the local worker; @local/@video/@audio cut the online network.
  const scope = resolveFilterScope(filter, streamingSupported);
  const showSets = scope.showSets;
  const showTrackResults = scope.showTracks;
  const showLyricResults = scope.showLyrics;
  const showAlbums = scope.showAlbums;
  const showArtists = scope.showArtists;
  const showOnline = scope.showOnline;
  const forcedSource = filter?.kind === "source" ? filter.source : undefined;
  const defaultRecentTracksRequested =
    deferredSearchText.length === 0 && filter === null && showTrackResults;
  const localWorkerRequested =
    open &&
    !needsLyricTracks &&
    scope.runsLocalWorker &&
    (defaultRecentTracksRequested ||
      // @video / @audio browse the whole local library even with no query (like the
      // album/artist facets), so "show me my videos" works on an empty box.
      deferredSearchText.length > 0 ||
      filter?.kind === "album" ||
      filter?.kind === "artist" ||
      scope.mediaKind != null);
  const localWorkerQuery = useBurstSettledValue(
    deferredSearchText,
    GLOBAL_SEARCH_LOCAL_WORKER_QUERY_SETTLE_MS,
  );
  const [localResults, setLocalResults] = useState<GlobalSearchLocalResults>(EMPTY_LOCAL_RESULTS);
  useEffect(() => {
    if (!localWorkerRequested) {
      setLocalResults(EMPTY_LOCAL_RESULTS);
      return undefined;
    }
    let cancelled = false;
    void searchGlobalLocalLibrary({
      includeAlbums: showAlbums && !defaultRecentTracksRequested,
      includeArtists: showArtists && !defaultRecentTracksRequested,
      includeTracks: showTrackResults,
      query: localWorkerQuery,
      resultLimit: Math.max(MAX_SONG_RESULTS, MAX_ENTITY_RESULTS),
      mediaKind: scope.mediaKind,
    }).then((results) => {
      if (!cancelled) setLocalResults(results);
    });
    return () => {
      cancelled = true;
    };
  }, [
    localWorkerQuery,
    localWorkerRequested,
    showAlbums,
    showArtists,
    showTrackResults,
    scope.mediaKind,
    defaultRecentTracksRequested,
  ]);

  const localTrackIdsKey = localResults.trackIds.join("|");
  const trackResultsLive = usePausedLiveQuery(
    () => getTracksByIds(localResults.trackIds, db),
    [localTrackIdsKey],
    open && localResults.trackIds.length > 0,
    EMPTY_TRACKS,
  );
  // Gate by showTrackResults (mirrors albumResults/artistResults): a paused liveQuery
  // RETAINS its last value when the worker is gated off, so without this the previous
  // filter's songs leak into navItems under @online/@set/@album/@artist (hidden in the
  // UI but still keyboard-selectable). Found by the live filter E2E (10/11 → 11/11).
  const trackResults = useMemo(
    () => (showTrackResults ? trackResultsLive.slice(0, MAX_SONG_RESULTS) : []),
    [trackResultsLive, showTrackResults],
  );
  const entityCoverTrackIdsKey = localResults.coverTrackIds.join("|");
  const entityCoverTracksLive = usePausedLiveQuery(
    () => getTracksByIds(localResults.coverTrackIds, db),
    [entityCoverTrackIdsKey],
    open && localResults.coverTrackIds.length > 0,
    EMPTY_TRACKS,
  );
  const entityCoverTrackById = useMemo(
    () => new Map(entityCoverTracksLive.map((track) => [track.id, track])),
    [entityCoverTracksLive],
  );
  const albumResults = showAlbums ? localResults.albums.slice(0, MAX_ENTITY_RESULTS) : [];
  const artistResults = showArtists ? localResults.artists.slice(0, MAX_ENTITY_RESULTS) : [];

  const lyricIndexWarm = useDeferredValue(open && needsLyricTracks);
  const lyricPlayable = useMemo(() => {
    if (!lyricIndexWarm || !showLyricResults) return EMPTY_TRACKS;
    return lyricTracks
      .filter((track) => track.status === "ready")
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [lyricIndexWarm, showLyricResults, lyricTracks]);
  const lyricTrackById = useMemo(() => {
    if (!lyricIndexWarm || !showLyricResults) return EMPTY_TRACK_BY_ID;
    return new Map(lyricTracks.map((track) => [track.id, track]));
  }, [lyricIndexWarm, showLyricResults, lyricTracks]);
  const lyricsByTrackId = useMemo(
    () => new Map<string, TrackLyrics>(lyricsRows.map((row) => [row.trackId, row])),
    [lyricsRows],
  );
  // Parses lyrics for the whole library (heavy, main-thread) — gate on the
  // deferred warm latch so it never runs on the open-paint frame.
  const lyricFieldsByTrackId = useMemo(() => {
    const rows = new Map<string, string[]>();
    if (!lyricIndexWarm || !showLyricResults) return rows;
    for (const track of lyricTracks) {
      const fields = lyricsSearchFields(track, lyricsByTrackId.get(track.id) ?? null);
      if (fields.length > 0) rows.set(track.id, fields);
    }
    return rows;
  }, [lyricIndexWarm, showLyricResults, lyricTracks, lyricsByTrackId]);

  // Sets — name-only, transliteration-aware. The full gallery can search inside
  // set tracks; global ⌘F keeps this result type crisp so `@set` means playlists.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const setResultHits = useMemo<ScoredSetResult[]>(() => {
    if (!open || !showSets) return [];
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const hits = deferredSearchText
      ? sorted
          .map((session, index) => ({
            index,
            score: scoreRow(
              { album: [], artist: [], free: [session.name], id: session.id, tags: [] },
              parseSearchTokens(deferredSearchText),
            ),
            session,
          }))
          .filter((hit) => hit.score < NO_MATCH_SCORE)
          .sort((a, b) => a.score - b.score || a.index - b.index)
      : filter?.kind === "set"
        ? sorted.map((session) => ({ score: 0, session }))
        : [];
    return hits.slice(0, MAX_SET_RESULTS).map(({ score, session }) => ({ score, session }));
  }, [open, showSets, sessions, deferredSearchText, filter, transliterationReady]);
  const setResults = useMemo(() => setResultHits.map((hit) => hit.session), [setResultHits]);
  const setCoverTrackIds = useMemo(
    () =>
      setResults
        .map((session) => session.trackIds[0])
        .filter((trackId): trackId is string => Boolean(trackId)),
    [setResults],
  );
  const setCoverTrackIdsKey = setCoverTrackIds.join("|");
  const setCoverTracksLive = usePausedLiveQuery(
    () => getTracksByIds(setCoverTrackIds, db),
    [setCoverTrackIdsKey],
    open && setCoverTrackIds.length > 0,
    EMPTY_TRACKS,
  );
  const setCoverTrackById = useMemo(
    () => new Map(setCoverTracksLive.map((track) => [track.id, track])),
    [setCoverTracksLive],
  );

  // Lyrics search is opt-in. Ordinary song/album/artist search runs in
  // global-search-local-worker and returns only top ids/small entity entries.
  const searchRows = useMemo<IndexableRow[]>(() => {
    if (!lyricIndexWarm || !showLyricResults) return [];
    const rows: IndexableRow[] = [];
    for (const track of lyricPlayable) {
      const fields = lyricFieldsByTrackId.get(track.id);
      if (!fields?.length) continue;
      rows.push({
        id: `${LYRIC_HIT_PREFIX}${track.id}`,
        free: fields,
        artist: [],
        album: [],
        tags: [],
      });
    }
    return rows;
  }, [lyricIndexWarm, showLyricResults, lyricPlayable, lyricFieldsByTrackId]);
  const rankedLyricHits = useWorkerRowSearch(
    searchRows,
    open && showLyricResults ? searchText : "",
  );
  const lyricResults = useMemo(() => {
    if (!showLyricResults) return [];
    if (!deferredSearchText && filter === null) return [];
    return rankedLyricHits
      .filter((hit) => hit.id.startsWith(LYRIC_HIT_PREFIX))
      .map((hit) => {
        const track = lyricTrackById.get(hit.id.slice(LYRIC_HIT_PREFIX.length));
        if (!track) return null;
        const match = findLyricSearchMatch(
          track,
          lyricsByTrackId.get(track.id) ?? null,
          deferredSearchText,
        );
        return match ? { track, match } : null;
      })
      .filter((result): result is { track: Track; match: LyricSearchMatch } => result !== null)
      .slice(0, MAX_LYRIC_RESULTS);
  }, [
    showLyricResults,
    deferredSearchText,
    filter,
    rankedLyricHits,
    lyricTrackById,
    lyricsByTrackId,
  ]);

  // Online — a source filter forces that one source ad-hoc; otherwise the enabled chips.
  const onlineQuery = open && showOnline ? searchText : "";
  const {
    hits: onlineHitsRaw,
    searching: onlineSearching,
    link,
    playlistLink,
  } = useOnlineSourceSearch(onlineQuery, forcedSource);
  const onlineHits = showOnline ? onlineHitsRaw : [];

  // A pasted link / playlist URL → put the online result FIRST (top of the list + index 0),
  // so the obvious "this is the thing you pasted" sits on top and Enter acts on it. A normal
  // text query keeps local matches first, online last.
  const onlineFirst = Boolean(link || playlistLink);
  const trackScoreById = useMemo(
    () => new Map((localResults.trackHits ?? []).map((hit) => [hit.id, hit.score])),
    [localResults.trackHits],
  );
  const albumScoreByKey = useMemo(
    () => new Map((localResults.albumHits ?? []).map((hit) => [hit.entry.key, hit.score])),
    [localResults.albumHits],
  );
  const artistScoreByKey = useMemo(
    () => new Map((localResults.artistHits ?? []).map((hit) => [hit.entry.key, hit.score])),
    [localResults.artistHits],
  );
  const lyricScoreByTrackId = useMemo(
    () =>
      new Map(
        rankedLyricHits
          .filter((hit) => hit.id.startsWith(LYRIC_HIT_PREFIX))
          .map((hit) => [hit.id.slice(LYRIC_HIT_PREFIX.length), hit.score]),
      ),
    [rankedLyricHits],
  );
  const bestMatchItems = useMemo<NavItem[]>(() => {
    if (!deferredSearchText || onlineFirst) return [];
    const candidates: BestMatchCandidate[] = [];
    let order = 0;
    for (const hit of setResultHits) {
      candidates.push({
        item: { type: "set", session: hit.session },
        key: `set:${hit.session.id}`,
        kind: "set",
        order: order++,
        recency: hit.session.updatedAt,
        score: hit.score,
      });
    }
    for (const track of trackResults) {
      candidates.push({
        item: { type: "track", track },
        key: `track:${track.id}`,
        kind: "track",
        order: order++,
        recency: track.updatedAt ?? track.createdAt,
        score: trackScoreById.get(track.id) ?? order,
      });
    }
    for (const result of lyricResults) {
      candidates.push({
        item: { type: "lyric", ...result },
        key: `lyric:${result.track.id}`,
        kind: "lyric",
        order: order++,
        recency: result.track.updatedAt ?? result.track.createdAt,
        score: lyricScoreByTrackId.get(result.track.id) ?? order,
      });
    }
    for (const entry of albumResults) {
      candidates.push({
        item: { type: "album", entry },
        key: `album:${entry.key}`,
        kind: "album",
        order: order++,
        score: albumScoreByKey.get(entry.key) ?? order,
      });
    }
    for (const entry of artistResults) {
      candidates.push({
        item: { type: "artist", entry },
        key: `artist:${entry.key}`,
        kind: "artist",
        order: order++,
        score: artistScoreByKey.get(entry.key) ?? order,
      });
    }
    return rankGlobalSearchBestMatches(candidates).map((candidate) => candidate.item);
  }, [
    albumResults,
    albumScoreByKey,
    artistResults,
    artistScoreByKey,
    deferredSearchText,
    lyricResults,
    lyricScoreByTrackId,
    onlineFirst,
    setResultHits,
    trackResults,
    trackScoreById,
  ]);

  // Flat, ordered nav list across the visible sections (the playlist-link card has its own
  // button, so it sits outside keyboard nav). Order mirrors the visual section order below.
  const navItems = useMemo<NavItem[]>(() => {
    const local: NavItem[] = [
      ...bestMatchItems,
      ...setResults.map((session) => ({ type: "set", session }) as const),
      ...trackResults.map((track) => ({ type: "track", track }) as const),
      ...lyricResults.map((result) => ({ type: "lyric", ...result }) as const),
      ...albumResults.map((entry) => ({ type: "album", entry }) as const),
      ...artistResults.map((entry) => ({ type: "artist", entry }) as const),
    ];
    const online = onlineHits.map((hit) => ({ type: "online", hit }) as const);
    return onlineFirst ? [...online, ...local] : [...local, ...online];
  }, [
    setResults,
    bestMatchItems,
    trackResults,
    lyricResults,
    albumResults,
    artistResults,
    onlineHits,
    onlineFirst,
  ]);

  // Nav-index base for each section, shifted by the online block when it leads.
  const localBase = onlineFirst ? onlineHits.length : 0;
  const bestStart = localBase;
  const setStart = bestStart + bestMatchItems.length;
  const trackStart = setStart + setResults.length;
  const lyricStart = trackStart + trackResults.length;
  const albumStart = lyricStart + lyricResults.length;
  const artistStart = albumStart + albumResults.length;
  const onlineStart = onlineFirst ? 0 : artistStart + artistResults.length;

  // DEV-only: keep the snapshot ref pointing at the latest resolved scope + result
  // counts so the perf-control endpoint can read what the active filter actually
  // produced (the scope/media-filter E2E). Constant condition → tree-shaken in prod.
  if (import.meta.env.DEV) {
    driverSnapshotRef.current = () => ({
      filterKind: filter?.kind ?? null,
      scope: {
        mediaKind: scope.mediaKind ?? null,
        showOnline: scope.showOnline,
        runsLocalWorker: scope.runsLocalWorker,
        showSets: scope.showSets,
        showTracks: scope.showTracks,
        showAlbums: scope.showAlbums,
        showArtists: scope.showArtists,
      },
      counts: {
        sets: setResults.length,
        tracks: trackResults.length,
        lyrics: lyricResults.length,
        albums: albumResults.length,
        artists: artistResults.length,
        bestMatches: bestMatchItems.length,
        online: onlineHits.length,
      },
      songKinds: trackResults.map((track) => track.kind),
    });
  }

  // `@` filter menu — sources dropped where streaming is unavailable.
  const filterOptions = streamingSupported
    ? FILTER_OPTIONS
    : FILTER_OPTIONS.filter((opt) => opt.filter.kind !== "source");
  const menuOptions = mention.active ? matchFilterOptions(mention.partial, filterOptions) : [];
  const menuOpen = mention.active && menuOptions.length > 0 && !menuDismissed;

  useEffect(() => {
    if (!open) return;
    setFilter(null);
    setMenuDismissed(false);
    setSelectedIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(Math.max(0, index), Math.max(0, navItems.length - 1)));
  }, [navItems.length]);
  useEffect(() => {
    setMenuIndex((index) => Math.min(Math.max(0, index), Math.max(0, menuOptions.length - 1)));
  }, [menuOptions.length]);
  // Keep the highlighted row in view as arrows walk across sections.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-nav-index="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!open) return null;

  function onInputChange(value: string) {
    setQuery(value);
    setMenuDismissed(false);
    setSelectedIndex(0);
  }

  function selectFilterOption(opt: FilterOption) {
    setFilter(opt.filter);
    // Drop the `@token`, keep any free text typed before it.
    setQuery(mention.before.replace(/\s+$/, ""));
    setMenuDismissed(false);
    setMenuIndex(0);
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function clearFilter() {
    setFilter(null);
    setSelectedIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function resolvePlaybackTrack(track: Track): Promise<Track> {
    return (await getTrack(track.id, db)) ?? track;
  }

  async function activate(item: NavItem, playNext: boolean) {
    switch (item.type) {
      case "set":
        openSet(item.session.id);
        onOpenChange(false);
        break;
      case "track":
      case "lyric": {
        const fullTrack = await resolvePlaybackTrack(item.track);
        if (playNext) {
          await playNextTrack(fullTrack);
        } else {
          await playTrack(fullTrack);
          onOpenChange(false);
        }
        break;
      }
      case "album":
        openAlbumForTrack(item.entry.coverTrackId ?? item.entry.trackIds[0]);
        onOpenChange(false);
        break;
      case "artist":
        openArtist(item.entry.name);
        onOpenChange(false);
        break;
      case "online":
        await playStreamedHit(item.hit);
        onOpenChange(false);
        break;
    }
  }

  async function toggleSource(id: StreamSourceId) {
    const current = settings.streamSources ?? {};
    await saveSettings({
      streamSources: { ...current, [id]: { ...current[id], enabled: !current[id]?.enabled } },
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The `@` menu owns the arrows / Enter while it's open.
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenuIndex((index) => Math.min(menuOptions.length - 1, index + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMenuIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const opt = menuOptions[menuIndex];
        if (opt) selectFilterOption(opt);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuDismissed(true);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key === "Backspace" && query === "" && filter) {
      event.preventDefault();
      clearFilter();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (navItems.length) setSelectedIndex((index) => Math.min(navItems.length - 1, index + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (navItems.length) setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = navItems[selectedIndex];
      if (!item) return;
      // Enter on a downloadable online result → download straight away at the Settings
      // default quality (no picker — that's the ⬇ button's job). Settings can disable this;
      // Shift+Enter and audio-only sources fall through to the normal play path.
      if (
        item.type === "online" &&
        enterDownloadsVideo &&
        !event.shiftKey &&
        canDownloadVideo(item.hit.source)
      ) {
        startBackgroundDownload(item.hit);
        onOpenChange(false);
        return;
      }
      void activate(item, event.shiftKey);
    }
  }

  const showEnableChips = streamingSupported && filter === null;
  const onlineActive = showOnline && (onlineSearching || onlineHits.length > 0 || !!link);
  const isEmpty = navItems.length === 0 && !onlineActive;

  // The online / pasted-link results. Rendered at the TOP when a link is pasted (onlineFirst),
  // otherwise below the local matches — so the divider/spacing only applies in the bottom slot.
  const onlineSection =
    showOnline && (onlineSearching || onlineHits.length > 0 || link) ? (
      <div className={onlineFirst ? undefined : "mt-2 border-white/10 border-t pt-2"}>
        <p className="px-3 pb-1 text-muted-foreground text-xs">
          {t(link ? "globalSearch.linkResult" : "globalSearch.online")}
          {onlineSearching ? ` · ${t("globalSearch.onlineSearching")}` : ""}
        </p>
        {playlistLink && (
          <PlaylistLinkCard
            playlist={playlistLink}
            onOpen={() => {
              openOnlinePlaylist(playlistLink);
              onOpenChange(false);
            }}
          />
        )}
        {onlineHits.map((hit, i) => (
          <OnlineResultRow
            key={`${hit.source}:${hit.externalId}`}
            hit={hit}
            index={onlineStart + i}
            selected={selectedIndex === onlineStart + i}
            onMouseEnter={() => setSelectedIndex(onlineStart + i)}
            onPlay={() => void activate({ type: "online", hit }, false)}
            onDownloadAudio={() => {
              startBackgroundDownload(hit, { audioOnly: true });
              onOpenChange(false);
            }}
            onDownloadVideo={canDownloadVideo(hit.source) ? () => setDownloadHit(hit) : undefined}
          />
        ))}
        {link && !onlineSearching && onlineHits.length === 0 && !playlistLink && (
          <p className="px-3 py-2 text-muted-foreground text-xs">
            {t("globalSearch.linkNotFound")}
          </p>
        )}
      </div>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/55 px-4 pt-[12vh] backdrop-blur-md"
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t("globalSearch.title")}
    >
      <button
        type="button"
        aria-label={t("drop.close")}
        className="absolute inset-0 size-full cursor-default"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/12 bg-popover/90 text-popover-foreground shadow-2xl ring-1 ring-black/10">
        <div className="relative flex items-center gap-2 border-white/10 border-b px-4">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          {filter && <FilterPill filter={filter} onClear={clearFilter} />}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder={t("globalSearch.placeholder")}
            type="search"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {menuOpen && (
            <FilterMenu
              options={menuOptions}
              index={menuIndex}
              onHover={setMenuIndex}
              onSelect={selectFilterOption}
            />
          )}
        </div>

        {showEnableChips && (
          <div className="flex flex-wrap items-center gap-1.5 border-white/10 border-b px-4 py-2 text-xs">
            <span className="text-muted-foreground">{t("globalSearch.enableOnline")}</span>
            {ONLINE_SOURCES.map(({ id, label }) => {
              const on = !!settings.streamSources?.[id]?.enabled;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => void toggleSource(id)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-2 py-0.5 transition-colors",
                    on
                      ? "border-primary bg-accent text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <RenderTraceBoundary id="global-search:results" active={open}>
          <div className="max-h-[52vh] overflow-y-auto p-2" role="listbox" ref={listRef}>
            {onlineFirst && onlineSection}
            {bestMatchItems.length > 0 && (
              <RenderTraceBoundary id="global-search:best-matches" active={open}>
                <div>
                  <SectionHeader>{t("globalSearch.bestMatches")}</SectionHeader>
                  {bestMatchItems.map((item, i) => {
                    const index = bestStart + i;
                    switch (item.type) {
                      case "set":
                        return (
                          <GlobalSetRow
                            key={`best-set-${item.session.id}`}
                            session={item.session}
                            coverTrack={
                              item.session.trackIds[0]
                                ? setCoverTrackById.get(item.session.trackIds[0])
                                : undefined
                            }
                            index={index}
                            selected={selectedIndex === index}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onActivate={() => void activate(item, false)}
                          />
                        );
                      case "track":
                        return (
                          <GlobalTrackSearchRow
                            key={`best-track-${item.track.id}`}
                            track={item.track}
                            index={index}
                            selected={selectedIndex === index}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onPlay={() => void activate(item, false)}
                            onPlayNext={() => void activate(item, true)}
                          />
                        );
                      case "lyric":
                        return (
                          <GlobalLyricSearchRow
                            key={`best-lyric-${item.track.id}`}
                            track={item.track}
                            match={item.match}
                            index={index}
                            selected={selectedIndex === index}
                            onMouseEnter={() => setSelectedIndex(index)}
                            onPlay={() => void activate(item, false)}
                            onPlayNext={() => void activate(item, true)}
                          />
                        );
                      case "album":
                        return (
                          <GlobalEntityRow
                            key={`best-album-${item.entry.key}`}
                            kind="album"
                            index={index}
                            selected={selectedIndex === index}
                            label={albumDisplayLabel(item.entry, t)}
                            sublabel={albumArtistDisplayLabel(item.entry, t)}
                            coverTrack={
                              item.entry.coverTrackId
                                ? entityCoverTrackById.get(item.entry.coverTrackId)
                                : undefined
                            }
                            onMouseEnter={() => setSelectedIndex(index)}
                            onActivate={() => void activate(item, false)}
                          />
                        );
                      case "artist":
                        return (
                          <GlobalEntityRow
                            key={`best-artist-${item.entry.key}`}
                            kind="artist"
                            index={index}
                            selected={selectedIndex === index}
                            label={artistDisplayLabel(item.entry, t)}
                            sublabel={t("gallery.count", { count: item.entry.trackIds.length })}
                            coverTrack={
                              item.entry.coverTrackId
                                ? entityCoverTrackById.get(item.entry.coverTrackId)
                                : undefined
                            }
                            onMouseEnter={() => setSelectedIndex(index)}
                            onActivate={() => void activate(item, false)}
                          />
                        );
                      case "online":
                        return null;
                    }
                    return null;
                  })}
                </div>
              </RenderTraceBoundary>
            )}
            {setResults.length > 0 && (
              <RenderTraceBoundary id="global-search:sets" active={open}>
                <div>
                  <SectionHeader>{t("gallery.modeSets")}</SectionHeader>
                  {setResults.map((session, i) => (
                    <GlobalSetRow
                      key={session.id}
                      session={session}
                      coverTrack={
                        session.trackIds[0] ? setCoverTrackById.get(session.trackIds[0]) : undefined
                      }
                      index={setStart + i}
                      selected={selectedIndex === setStart + i}
                      onMouseEnter={() => setSelectedIndex(setStart + i)}
                      onActivate={() => void activate({ type: "set", session }, false)}
                    />
                  ))}
                </div>
              </RenderTraceBoundary>
            )}

            {showTrackResults && trackResults.length > 0 && (
              <RenderTraceBoundary id="global-search:tracks" active={open}>
                <div>
                  <SectionHeader>{t("globalSearch.songs")}</SectionHeader>
                  {trackResults.map((track, i) => (
                    <GlobalTrackSearchRow
                      key={track.id}
                      track={track}
                      index={trackStart + i}
                      selected={selectedIndex === trackStart + i}
                      onMouseEnter={() => setSelectedIndex(trackStart + i)}
                      onPlay={() => void activate({ type: "track", track }, false)}
                      onPlayNext={() => void activate({ type: "track", track }, true)}
                    />
                  ))}
                </div>
              </RenderTraceBoundary>
            )}

            {lyricResults.length > 0 && (
              <RenderTraceBoundary id="global-search:lyrics" active={open}>
                <div>
                  <SectionHeader>{t("dock.lyrics")}</SectionHeader>
                  {lyricResults.map(({ track, match }, i) => (
                    <GlobalLyricSearchRow
                      key={track.id}
                      track={track}
                      match={match}
                      index={lyricStart + i}
                      selected={selectedIndex === lyricStart + i}
                      onMouseEnter={() => setSelectedIndex(lyricStart + i)}
                      onPlay={() => void activate({ type: "lyric", track, match }, false)}
                      onPlayNext={() => void activate({ type: "lyric", track, match }, true)}
                    />
                  ))}
                </div>
              </RenderTraceBoundary>
            )}

            {albumResults.length > 0 && (
              <RenderTraceBoundary id="global-search:albums" active={open}>
                <div>
                  <SectionHeader>{t("gallery.modeAlbums")}</SectionHeader>
                  {albumResults.map((entry, i) => (
                    <GlobalEntityRow
                      key={entry.key}
                      kind="album"
                      index={albumStart + i}
                      selected={selectedIndex === albumStart + i}
                      label={albumDisplayLabel(entry, t)}
                      sublabel={albumArtistDisplayLabel(entry, t)}
                      coverTrack={
                        entry.coverTrackId
                          ? entityCoverTrackById.get(entry.coverTrackId)
                          : undefined
                      }
                      onMouseEnter={() => setSelectedIndex(albumStart + i)}
                      onActivate={() => void activate({ type: "album", entry }, false)}
                    />
                  ))}
                </div>
              </RenderTraceBoundary>
            )}

            {artistResults.length > 0 && (
              <RenderTraceBoundary id="global-search:artists" active={open}>
                <div>
                  <SectionHeader>{t("gallery.modeArtists")}</SectionHeader>
                  {artistResults.map((entry, i) => (
                    <GlobalEntityRow
                      key={entry.key}
                      kind="artist"
                      index={artistStart + i}
                      selected={selectedIndex === artistStart + i}
                      label={artistDisplayLabel(entry, t)}
                      sublabel={t("gallery.count", { count: entry.trackIds.length })}
                      coverTrack={
                        entry.coverTrackId
                          ? entityCoverTrackById.get(entry.coverTrackId)
                          : undefined
                      }
                      onMouseEnter={() => setSelectedIndex(artistStart + i)}
                      onActivate={() => void activate({ type: "artist", entry }, false)}
                    />
                  ))}
                </div>
              </RenderTraceBoundary>
            )}

            {isEmpty &&
              // A pasted link has no local matches by design — let the online section speak.
              (link ? null : (
                <div className="px-3 py-8 text-center text-muted-foreground text-sm">
                  {t("globalSearch.empty")}
                </div>
              ))}

            {!onlineFirst && onlineSection}
          </div>
        </RenderTraceBoundary>

        <div className="flex flex-wrap items-center justify-between gap-2 border-white/10 border-t px-4 py-3 text-muted-foreground text-xs">
          <div className="flex items-center gap-3">
            <span>{t("globalSearch.count", { count: navItems.length })}</span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>@</Kbd>
              {t("globalSearch.filterHint")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              {t("globalSearch.playHint")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              {t("globalSearch.playNextHint")}
            </span>
          </div>
        </div>
      </div>
      <DownloadQualityDialog
        hit={downloadHit}
        onClose={() => setDownloadHit(null)}
        onStarted={() => {
          setDownloadHit(null);
          onOpenChange(false);
        }}
      />
    </div>
  );
}

/** A section label above a group of results (songs / albums / artists). */
function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pt-2 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
      {children}
    </p>
  );
}

function useSetResultCoverUrl(session: DjSession, fallbackTrack: Track | undefined): string | null {
  const setUrl = useTrackThumbnailUrl(
    session.coverBlobId || session.remoteCoverUrl
      ? {
          coverBlobId: session.coverBlobId,
          coverCrop: session.coverCrop,
          remoteCoverUrl: session.remoteCoverUrl,
        }
      : undefined,
    { missDelayMs: SEARCH_THUMBNAIL_MISS_DELAY_MS, traceSource: "global-search:set" },
  );
  const fallbackUrl = useTrackThumbnailUrl(fallbackTrack, {
    missDelayMs: SEARCH_THUMBNAIL_MISS_DELAY_MS,
    traceSource: "global-search:set-fallback",
  });
  return session.coverBlobId || session.remoteCoverUrl ? setUrl : fallbackUrl;
}

function GlobalSetRow({
  session,
  coverTrack,
  index,
  selected,
  onMouseEnter,
  onActivate,
}: {
  session: DjSession;
  coverTrack: Track | undefined;
  index: number;
  selected: boolean;
  onMouseEnter: () => void;
  onActivate: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useSetResultCoverUrl(session, coverTrack);
  // Mirror the cover URL resolution: the set's own cover wins, else the first track.
  const usingSetCover = !!(session.coverBlobId || session.remoteCoverUrl);
  const coverThumbhash = usingSetCover ? session.coverThumbhash : coverTrack?.coverThumbhash;
  return (
    <button
      type="button"
      data-nav-index={index}
      onClick={onActivate}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <CoverImage
        url={coverUrl}
        thumbhash={coverThumbhash}
        placeholder={<ListMusic className="size-4" />}
        className="size-11 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{session.name}</div>
        <div className="truncate text-muted-foreground text-xs">
          {t("gallery.count", { count: session.trackIds.length })}
        </div>
      </div>
    </button>
  );
}

/** The active `@` scope, shown as a removable pill left of the input. */
function FilterPill({ filter, onClear }: { filter: SearchFilter; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary bg-accent px-2 py-0.5 text-foreground text-xs">
      <FilterGlyph filter={filter} iconClass="size-3.5" discSize={13} />
      {filterLabel(filter, t)}
      <button
        type="button"
        onClick={onClear}
        aria-label={t("globalSearch.clearFilter")}
        className="grid size-4 place-items-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** The `@` suggestion dropdown — pick a facet or an online source to scope by. */
function FilterMenu({
  options,
  index,
  onHover,
  onSelect,
}: {
  options: FilterOption[];
  index: number;
  onHover: (index: number) => void;
  onSelect: (opt: FilterOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-x-3 top-full z-20 mt-1 overflow-hidden rounded-xl border border-white/12 bg-popover/95 p-1 shadow-2xl ring-1 ring-black/10">
      <p className="px-2 py-1 text-[10px] text-muted-foreground uppercase tracking-wide">
        {t("globalSearch.filterHint")}
      </p>
      {options.map((opt, i) => (
        <button
          key={opt.id}
          type="button"
          onMouseEnter={() => onHover(i)}
          // mousedown (not click) so the input doesn't blur before we apply the filter.
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(opt);
          }}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
            i === index ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
          )}
        >
          <FilterGlyph filter={opt.filter} iconClass="size-4 text-muted-foreground" discSize={16} />
          <span>{filterLabel(opt.filter, t)}</span>
        </button>
      ))}
    </div>
  );
}

function GlobalTrackSearchRow({
  track,
  index,
  selected,
  onMouseEnter,
  onPlay,
  onPlayNext,
}: {
  track: Track;
  index: number;
  selected: boolean;
  onMouseEnter: () => void;
  onPlay: () => void;
  onPlayNext: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackThumbnailUrl(track, {
    missDelayMs: SEARCH_THUMBNAIL_MISS_DELAY_MS,
    traceSource: "global-search:track",
  });
  return (
    <div
      data-nav-index={index}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CoverImage
          url={coverUrl}
          thumbhash={track.coverThumbhash}
          placeholder={<Disc3Icon size={16} />}
          className="size-11 shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{track.title}</div>
          <div className="truncate text-muted-foreground text-xs">{trackSubtitle(track)}</div>
        </div>
      </button>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        <button
          type="button"
          onClick={onPlay}
          aria-label={t("globalSearch.playHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <CornerDownLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={onPlayNext}
          aria-label={t("globalSearch.playNextHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ListPlus className="size-4" />
        </button>
      </div>
      <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
        {formatDuration(track.durationSec)}
      </span>
    </div>
  );
}

function GlobalLyricSearchRow({
  track,
  match,
  index,
  selected,
  onMouseEnter,
  onPlay,
  onPlayNext,
}: {
  track: Track;
  match: LyricSearchMatch;
  index: number;
  selected: boolean;
  onMouseEnter: () => void;
  onPlay: () => void;
  onPlayNext: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackThumbnailUrl(track, {
    missDelayMs: SEARCH_THUMBNAIL_MISS_DELAY_MS,
    traceSource: "global-search:lyric",
  });
  const hasTimestamp = match.timeSec != null && Number.isFinite(match.timeSec);
  return (
    <div
      data-nav-index={index}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <CoverImage
          url={coverUrl}
          thumbhash={track.coverThumbhash}
          placeholder={<Disc3Icon size={16} />}
          className="size-11 shrink-0 text-muted-foreground"
        >
          <span className="absolute bottom-0.5 right-0.5 grid size-4 place-items-center rounded bg-background/80 text-foreground shadow-sm">
            <Captions className="size-3" />
          </span>
        </CoverImage>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{track.title}</div>
          <div className="truncate text-muted-foreground text-xs">{match.text}</div>
        </div>
      </button>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        <button
          type="button"
          onClick={onPlay}
          aria-label={t("globalSearch.playHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <CornerDownLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={onPlayNext}
          aria-label={t("globalSearch.playNextHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ListPlus className="size-4" />
        </button>
      </div>
      <span className="w-12 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
        {hasTimestamp ? formatDuration(match.timeSec ?? 0) : t("dock.lyrics")}
      </span>
    </div>
  );
}

/** A derived artist/album result — clicking opens it in the library (closes ⌘F). */
function GlobalEntityRow({
  kind,
  index,
  selected,
  label,
  sublabel,
  coverTrack,
  onMouseEnter,
  onActivate,
}: {
  kind: "album" | "artist";
  index: number;
  selected: boolean;
  label: string;
  sublabel: string;
  coverTrack: Track | undefined;
  onMouseEnter: () => void;
  onActivate: () => void;
}) {
  const coverUrl = useTrackThumbnailUrl(coverTrack, {
    missDelayMs: SEARCH_THUMBNAIL_MISS_DELAY_MS,
    traceSource: `global-search:${kind}`,
  });
  return (
    <button
      type="button"
      data-nav-index={index}
      onClick={onActivate}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <CoverImage
        url={coverUrl}
        thumbhash={coverTrack?.coverThumbhash}
        rounded={kind === "artist"}
        placeholder={kind === "artist" ? <User className="size-4" /> : <Disc3Icon size={16} />}
        className="size-11 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{label}</div>
        <div className="truncate text-muted-foreground text-xs">{sublabel}</div>
      </div>
    </button>
  );
}

/** A pasted playlist link → enters detail; import remains available as a shortcut. */
function PlaylistLinkCard({ playlist, onOpen }: { playlist: StreamPlaylist; onOpen: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2">
        <button
          type="button"
          onClick={onOpen}
          className="grid size-11 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius album-cover-shadow"
        >
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Disc3Icon size={16} />
          )}
        </button>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate font-medium text-sm">{playlist.name}</div>
          <div className="truncate text-muted-foreground text-xs">
            {t("streamSources.trackCount", { count: playlist.trackCount })} · {playlist.source}
          </div>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary bg-accent px-2.5 py-1 text-xs transition-colors hover:bg-accent/70"
        >
          <ListPlus className="size-3.5" />
          {t("streamSources.import")}
        </button>
      </div>
      <PlaylistImportDialog playlist={open ? playlist : null} onClose={() => setOpen(false)} />
    </>
  );
}

/** A result row for an online streaming source — cover + title + source badge + download. */
function OnlineResultRow({
  hit,
  index,
  selected,
  onMouseEnter,
  onPlay,
  onDownloadAudio,
  onDownloadVideo,
}: {
  hit: StreamSearchHit;
  index: number;
  selected: boolean;
  onMouseEnter: () => void;
  onPlay: () => void;
  /** Audio-only download (available for every online source). */
  onDownloadAudio: () => void;
  /** Video download — present only for sources that can download video (Bilibili / YouTube). */
  onDownloadVideo?: () => void;
}) {
  const { t } = useTranslation();
  const subtitle = [hit.artist, hit.album].filter(Boolean).join(" · ");
  return (
    <div
      data-nav-index={index}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius album-cover-shadow">
          {hit.coverUrl ? (
            // hdslb (bilibili) blocks a foreign Referer but serves with none; netease
            // covers don't care — so no-referrer fixes bili and is safe for both.
            <img
              src={hit.coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Disc3Icon size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{hit.title}</div>
          <div className="truncate text-muted-foreground text-xs">{subtitle || hit.source}</div>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={onDownloadAudio}
          aria-label={t("download.audio")}
          title={t("download.audio")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
        >
          <Music className="size-4" />
        </button>
        {onDownloadVideo ? (
          <button
            type="button"
            onClick={onDownloadVideo}
            aria-label={t("download.video")}
            title={t("download.video")}
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          >
            <Download className="size-4" />
          </button>
        ) : null}
      </div>
      <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
        {hit.source}
      </span>
      {hit.durationSec ? (
        <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {formatDuration(hit.durationSec)}
        </span>
      ) : null}
    </div>
  );
}
