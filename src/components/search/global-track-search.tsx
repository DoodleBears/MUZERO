import { useLiveQuery } from "dexie-react-hooks";
import { CornerDownLeft, Globe, ListPlus, Search, User, X } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { db } from "@/db/muzero-db";
import { listAllTracks, memoryNotesByTrack, saveSettings } from "@/db/repositories";
import type { StreamSourceId, Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { useOnlineSourceSearch } from "@/hooks/use-online-source-search";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { useWorkerTrackSearch } from "@/hooks/use-worker-track-search";
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
  type SearchFilter,
} from "@/lib/global-search-filter";
import {
  type AlbumEntry,
  type ArtistEntry,
  buildAlbumIndex,
  buildArtistIndex,
} from "@/lib/library-index";
import { trackSubtitle } from "@/lib/track-display";
import { searchEntityFacets } from "@/lib/track-search";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";

/** Implemented online sources surfaced as enable chips (brand names, not i18n). */
const ONLINE_SOURCES: { id: StreamSourceId; label: string }[] = [
  { id: "netease", label: "网易云" },
  { id: "bili", label: "Bilibili" },
  { id: "youtube", label: "YouTube" },
];
/** Brand labels for filter chips / menu (codename `source` id → display name). */
const SOURCE_LABEL: Partial<Record<StreamSourceId, string>> = {
  netease: "网易云",
  bili: "Bilibili",
  youtube: "YouTube",
};

const EMPTY_MEMORY_NOTES = new Map<string, string[]>();
const MAX_SONG_RESULTS = 8;
const MAX_ENTITY_RESULTS = 5;

/** One arrow-navigable result across the sections (the playlist-link card is not). */
type NavItem =
  | { type: "track"; track: Track }
  | { type: "album"; entry: AlbumEntry }
  | { type: "artist"; entry: ArtistEntry }
  | { type: "online"; hit: StreamSearchHit };

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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Coalesce write bursts so the memory join + worker snapshot below re-run at
  // most once per interval instead of once per tracks write (PRD F-3).
  const allTracksLive = useLiveQuery(() => listAllTracks(db), [], []);
  const allTracks = useThrottledValue(allTracksLive, LIBRARY_QUERY_COALESCE_MS);
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
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const playStreamedHit = usePlayerStore((s) => s.playStreamedHit);
  const openArtist = useNavStore((s) => s.openArtist);
  const openAlbumForTrack = useNavStore((s) => s.openAlbumForTrack);
  const settings = useSettings();
  // Online sources need the desktop media proxy (Referer/CORS). Hidden on web/tauri.
  const streamingSupported = hasStreamingSources();
  const transliterationReady = useTransliterationReady();

  // The trailing `@mention` the caret is inside, and the text we actually search
  // (everything before that mention).
  const mention = parseMention(query);
  const searchText = (mention.active ? mention.before : query).trim();

  // Which sections the active filter shows. No filter → everything; a facet filter
  // narrows to its one section; a source filter shows only that online source.
  const showSongs = filter === null;
  const showAlbums = filter === null || filter.kind === "album";
  const showArtists = filter === null || filter.kind === "artist";
  const showOnline = streamingSupported && (filter === null || filter.kind === "source");
  const forcedSource = filter?.kind === "source" ? filter.source : undefined;

  const playable = useMemo(
    () =>
      allTracks
        .filter((track) => track.status === "ready")
        .sort((a, b) => b.createdAt - a.createdAt),
    [allTracks],
  );
  const trackById = useMemo(
    () => new Map(allTracks.map((track) => [track.id, track])),
    [allTracks],
  );
  // Derived artist/album projections — only while the (always-mounted) overlay is
  // open, so a closed ⌘F doesn't re-project on every library change.
  const artistIndex = useMemo(() => (open ? buildArtistIndex(allTracks) : []), [open, allTracks]);
  const albumIndex = useMemo(() => (open ? buildAlbumIndex(allTracks) : []), [open, allTracks]);

  // Songs — off-thread, transliteration-aware (pinyin / kana / romaji), ranked.
  const songsQuery = open && showSongs ? searchText : "";
  const ranked = useWorkerTrackSearch(playable, songsQuery, memoryNotes);
  const trackResults = useMemo(
    () => (showSongs ? ranked.slice(0, MAX_SONG_RESULTS) : []),
    [showSongs, ranked],
  );

  // Artist/album facets — transliteration-aware, honors `artist:`/`album:` scopes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const facets = useMemo(
    () =>
      searchText
        ? searchEntityFacets(artistIndex, albumIndex, searchText)
        : { artists: [], albums: [] },
    [searchText, artistIndex, albumIndex, transliterationReady],
  );
  // A scoped facet with no query browses all real entities; otherwise show matches.
  const albumResults = useMemo<AlbumEntry[]>(() => {
    if (!showAlbums) return [];
    const base = searchText
      ? facets.albums
      : filter?.kind === "album"
        ? albumIndex.filter((entry) => !entry.bucket)
        : [];
    return base.slice(0, MAX_ENTITY_RESULTS);
  }, [showAlbums, searchText, facets, filter, albumIndex]);
  const artistResults = useMemo<ArtistEntry[]>(() => {
    if (!showArtists) return [];
    const base = searchText
      ? facets.artists
      : filter?.kind === "artist"
        ? artistIndex.filter((entry) => !entry.bucket)
        : [];
    return base.slice(0, MAX_ENTITY_RESULTS);
  }, [showArtists, searchText, facets, filter, artistIndex]);

  // Online — a source filter forces that one source ad-hoc; otherwise the enabled chips.
  const onlineQuery = open && showOnline ? searchText : "";
  const {
    hits: onlineHitsRaw,
    searching: onlineSearching,
    link,
    playlistLink,
  } = useOnlineSourceSearch(onlineQuery, forcedSource);
  const onlineHits = showOnline ? onlineHitsRaw : [];

  // Flat, ordered nav list across the visible sections (the playlist-link card has
  // its own button, so it sits outside keyboard nav).
  const navItems = useMemo<NavItem[]>(
    () => [
      ...trackResults.map((track) => ({ type: "track", track }) as const),
      ...albumResults.map((entry) => ({ type: "album", entry }) as const),
      ...artistResults.map((entry) => ({ type: "artist", entry }) as const),
      ...onlineHits.map((hit) => ({ type: "online", hit }) as const),
    ],
    [trackResults, albumResults, artistResults, onlineHits],
  );
  const albumStart = trackResults.length;
  const artistStart = albumStart + albumResults.length;
  const onlineStart = artistStart + artistResults.length;

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

  async function activate(item: NavItem, playNext: boolean) {
    switch (item.type) {
      case "track":
        if (playNext) {
          await playNextTrack(item.track);
        } else {
          await playTrack(item.track);
          onOpenChange(false);
        }
        break;
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
      if (item) void activate(item, event.shiftKey);
    }
  }

  const showEnableChips = streamingSupported && filter === null;
  const onlineActive = showOnline && (onlineSearching || onlineHits.length > 0 || !!link);
  const showSongsHeader =
    trackResults.length > 0 && (albumResults.length > 0 || artistResults.length > 0);
  const isEmpty = navItems.length === 0 && !onlineActive;

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

        <div className="max-h-[52vh] overflow-y-auto p-2" role="listbox" ref={listRef}>
          {showSongs && trackResults.length > 0 && (
            <div>
              {showSongsHeader && <SectionHeader>{t("globalSearch.songs")}</SectionHeader>}
              {trackResults.map((track, i) => (
                <GlobalTrackSearchRow
                  key={track.id}
                  track={track}
                  index={i}
                  selected={selectedIndex === i}
                  onMouseEnter={() => setSelectedIndex(i)}
                  onPlay={() => void activate({ type: "track", track }, false)}
                  onPlayNext={() => void activate({ type: "track", track }, true)}
                />
              ))}
            </div>
          )}

          {albumResults.length > 0 && (
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
                  coverTrack={entry.coverTrackId ? trackById.get(entry.coverTrackId) : undefined}
                  onMouseEnter={() => setSelectedIndex(albumStart + i)}
                  onActivate={() => void activate({ type: "album", entry }, false)}
                />
              ))}
            </div>
          )}

          {artistResults.length > 0 && (
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
                  coverTrack={entry.coverTrackId ? trackById.get(entry.coverTrackId) : undefined}
                  onMouseEnter={() => setSelectedIndex(artistStart + i)}
                  onActivate={() => void activate({ type: "artist", entry }, false)}
                />
              ))}
            </div>
          )}

          {isEmpty &&
            // A pasted link has no local matches by design — let the online section speak.
            (link ? null : (
              <div className="px-3 py-8 text-center text-muted-foreground text-sm">
                {t("globalSearch.empty")}
              </div>
            ))}

          {showOnline && (onlineSearching || onlineHits.length > 0 || link) && (
            <div className="mt-2 border-white/10 border-t pt-2">
              <p className="px-3 pb-1 text-muted-foreground text-xs">
                {t(link ? "globalSearch.linkResult" : "globalSearch.online")}
                {onlineSearching ? ` · ${t("globalSearch.onlineSearching")}` : ""}
              </p>
              {playlistLink && <PlaylistLinkCard playlist={playlistLink} />}
              {onlineHits.map((hit, i) => (
                <OnlineResultRow
                  key={`${hit.source}:${hit.externalId}`}
                  hit={hit}
                  index={onlineStart + i}
                  selected={selectedIndex === onlineStart + i}
                  onMouseEnter={() => setSelectedIndex(onlineStart + i)}
                  onPlay={() => void activate({ type: "online", hit }, false)}
                />
              ))}
              {link && !onlineSearching && onlineHits.length === 0 && !playlistLink && (
                <p className="px-3 py-2 text-muted-foreground text-xs">
                  {t("globalSearch.linkNotFound")}
                </p>
              )}
            </div>
          )}
        </div>

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

/** The active `@` scope, shown as a removable pill left of the input. */
function FilterPill({ filter, onClear }: { filter: SearchFilter; onClear: () => void }) {
  const { t } = useTranslation();
  const label =
    filter.kind === "source"
      ? (SOURCE_LABEL[filter.source] ?? filter.source)
      : filter.kind === "artist"
        ? t("gallery.modeArtists")
        : t("gallery.modeAlbums");
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary bg-accent px-2 py-0.5 text-foreground text-xs">
      {filter.kind === "album" ? (
        <Disc3Icon size={13} />
      ) : filter.kind === "artist" ? (
        <User className="size-3.5" />
      ) : (
        <Globe className="size-3.5" />
      )}
      {label}
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
  const labelFor = (opt: FilterOption): string => {
    if (opt.id === "artist") return t("gallery.modeArtists");
    if (opt.id === "album") return t("gallery.modeAlbums");
    return opt.filter.kind === "source" ? (SOURCE_LABEL[opt.filter.source] ?? opt.id) : opt.id;
  };
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
          {opt.id === "artist" ? (
            <User className="size-4 text-muted-foreground" />
          ) : opt.id === "album" ? (
            <Disc3Icon size={16} />
          ) : (
            <Globe className="size-4 text-muted-foreground" />
          )}
          <span>{labelFor(opt)}</span>
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
  const coverUrl = useTrackCoverUrl(track);
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
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3Icon size={16} />
          )}
        </div>
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
  const coverUrl = useTrackCoverUrl(coverTrack);
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
      <div
        className={cn(
          "grid size-11 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground",
          kind === "artist" ? "rounded-full" : "rounded-lg",
        )}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : kind === "artist" ? (
          <User className="size-4" />
        ) : (
          <Disc3Icon size={16} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-sm">{label}</div>
        <div className="truncate text-muted-foreground text-xs">{sublabel}</div>
      </div>
    </button>
  );
}

/** A pasted playlist link → opens the import modal (new set / incremental sync / add to set). */
function PlaylistLinkCard({ playlist }: { playlist: StreamPlaylist }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2">
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
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
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{playlist.name}</div>
          <div className="truncate text-muted-foreground text-xs">
            {t("streamSources.trackCount", { count: playlist.trackCount })} · {playlist.source}
          </div>
        </div>
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

/** A result row for an online streaming source — cover + title + source badge. */
function OnlineResultRow({
  hit,
  index,
  selected,
  onMouseEnter,
  onPlay,
}: {
  hit: StreamSearchHit;
  index: number;
  selected: boolean;
  onMouseEnter: () => void;
  onPlay: () => void;
}) {
  const subtitle = [hit.artist, hit.album].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-nav-index={index}
      onClick={onPlay}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
    >
      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
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
      <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground uppercase">
        {hit.source}
      </span>
      {hit.durationSec ? (
        <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {formatDuration(hit.durationSec)}
        </span>
      ) : null}
    </button>
  );
}
