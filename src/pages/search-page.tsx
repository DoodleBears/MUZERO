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
import { useTranslation } from "react-i18next";
import { CoverContextMenu } from "@/components/library/cover-context-menu";
import { EntityDetailView } from "@/components/library/entity-detail";
import { EntityGrid, type LibraryEntityItem } from "@/components/library/entity-grid";
import { TrackListSection } from "@/components/library/track-list-section";
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
import { filterSets, type SetGalleryItem, type SetSort, sortSets } from "@/lib/set-gallery";
import { searchEntityFacets, searchTracks } from "@/lib/track-search";
import { cn, formatDuration, formatListenTime } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
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
  const wallScrollTopRef = useRef(0);
  const returnFocusKeyRef = useRef<string | null>(null);
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
    return artistIndex
      .map((entry) => {
        const count = t("gallery.count", { count: entry.trackIds.length });
        const listened = statFor(artistStats, entry.key).listenedSec;
        return {
          key: entry.key,
          label: artistDisplayLabel(entry, t),
          sublabel: listened > 0 ? `${count} · ${formatListenTime(listened)}` : count,
          coverTrackId: entry.coverTrackId,
        };
      })
      .filter((item) => freeTextMatches(artistQuery, [item.label]));
  }, [artistIndex, artistQuery, t, artistStats, transliterationReady]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const albumItems = useMemo<LibraryEntityItem[]>(() => {
    return albumIndex
      .map((entry) => {
        const base =
          entry.bucket === "unknown"
            ? t("gallery.count", { count: entry.trackIds.length })
            : albumArtistDisplayLabel(entry, t);
        const listened = statFor(albumStats, entry.key).listenedSec;
        return {
          key: entry.key,
          label: albumDisplayLabel(entry, t),
          sublabel: listened > 0 ? `${base} · ${formatListenTime(listened)}` : base,
          coverTrackId: entry.coverTrackId,
        };
      })
      .filter((item) => freeTextMatches(albumQuery, [item.label]));
  }, [albumIndex, albumQuery, t, albumStats, transliterationReady]);
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
    () => sortSets(filterSets(items, setQuery), sort),
    [items, setQuery, sort, transliterationReady],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady re-runs once dictionaries load
  const shownTracks = useMemo(() => {
    const sortedTracks = [...allTracks].sort((a, b) => b.createdAt - a.createdAt);
    return searchTracks(sortedTracks, trackQuery, memoryNotes);
  }, [allTracks, memoryNotes, trackQuery, transliterationReady]);
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

  // Opening a card remembers it so backing out re-focuses it (W/S/↑↓ continue from
  // there) and restores the wall scroll position on the way back.
  function openSet(id: string) {
    returnFocusKeyRef.current = id;
    transitionState(() => setSelectedSetId(id));
  }
  function openArtist(key: string) {
    returnFocusKeyRef.current = key;
    transitionState(() => setSelectedArtistKey(key));
  }
  function openAlbum(key: string) {
    returnFocusKeyRef.current = key;
    transitionState(() => setSelectedAlbumKey(key));
  }

  // Wall scroll container: record scroll as it moves; on remount (returning from a
  // detail) restore the position and focus the card we came from.
  const attachWall = useCallback((node: HTMLDivElement | null) => {
    wallScrollRef.current = node;
    if (!node) return;
    node.scrollTop = wallScrollTopRef.current;
    const key = returnFocusKeyRef.current;
    if (!key) return;
    window.requestAnimationFrame(() => {
      node.querySelector<HTMLElement>(`[data-gallery-card-key="${CSS.escape(key)}"]`)?.focus();
      returnFocusKeyRef.current = null;
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
      const root = wallScrollRef.current;
      if (!root) return;
      const cards = Array.from(root.querySelectorAll<HTMLElement>(GALLERY_CARD_SELECTOR));
      if (cards.length === 0) return;
      const activeIndex = cards.indexOf(document.activeElement as HTMLElement);
      if (intent === "open") {
        if (event.key.toLowerCase() === "enter") return; // focused button clicks natively
        event.preventDefault();
        event.stopImmediatePropagation();
        if (activeIndex >= 0) cards[activeIndex].click();
        else cards[0]?.focus();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const fallbackKey = returnFocusKeyRef.current;
      const fallbackIndex = fallbackKey
        ? cards.findIndex((card) => card.dataset.galleryCardKey === fallbackKey)
        : 0;
      const target = rovingIndex(cards.length, activeIndex, intent, Math.max(0, fallbackIndex));
      const el = cards[target];
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [mode, selectedSetId, selectedArtistKey, selectedAlbumKey]);

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
        onBack={() => transitionState(() => setSelectedSetId(null))}
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
        onOpenAlbum={(key) =>
          transitionState(() => {
            setSelectedArtistKey(null);
            setSelectedAlbumKey(key);
          })
        }
        onBack={() => transitionState(() => setSelectedArtistKey(null))}
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
        onBack={() => transitionState(() => setSelectedAlbumKey(null))}
      />
    );
  }

  // Level 1: the album wall. One full-height scroll surface — search + filters
  // scroll with the wall and the whole thing dissolves under the floating chrome
  // (`chrome-fade`), top and bottom, just like Now Playing.
  return (
    <div
      ref={attachWall}
      onScroll={(e) => {
        wallScrollTopRef.current = e.currentTarget.scrollTop;
      }}
      className={cn(
        "chrome-fade no-scrollbar mx-auto flex h-full w-full flex-col overflow-y-auto px-4 pt-chrome-top lg:px-6",
        mode === "tracks" ? "max-w-6xl" : "max-w-4xl",
        mode === "tracks" ? "pb-0" : "pb-chrome-bottom",
      )}
    >
      <TooltipProvider>
        <div className="mb-3 mx-auto flex rounded-lg border border-border bg-background/10 w-fit p-1">
          <ModeTab active={mode === "sets"} onClick={() => setModePref("sets")}>
            {t("gallery.modeSets")}
          </ModeTab>
          <ModeTab active={mode === "tracks"} onClick={() => setModePref("tracks")}>
            {t("gallery.modeTracks")}
          </ModeTab>
          <ModeTab active={mode === "albums"} onClick={() => setModePref("albums")}>
            {t("gallery.modeAlbums")}
          </ModeTab>
          <ModeTab active={mode === "artists"} onClick={() => setModePref("artists")}>
            {t("gallery.modeArtists")}
          </ModeTab>
        </div>
      </TooltipProvider>

      <div className="mb-3 flex items-center gap-2">
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
            size="sm"
            variant="outline"
            onClick={() => void createNewSet()}
            className="shrink-0"
          >
            <Plus className="size-4" /> {t("gallery.newSet")}
          </Button>
        )}
      </div>

      {mode === "sets" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <Chip active={sort === "recent"} onClick={() => setSort("recent")}>
              {t("gallery.sortRecent")}
            </Chip>
            <Chip active={sort === "name"} onClick={() => setSort("name")}>
              {t("gallery.sortName")}
            </Chip>
            <Chip active={sort === "size"} onClick={() => setSort("size")}>
              {t("gallery.sortSize")}
            </Chip>
            <div className="ms-auto flex items-center gap-1">
              <IconToggle
                active={view === "list"}
                onClick={() => setViewPref("list")}
                label={t("gallery.viewList")}
              >
                <List className="size-4" />
              </IconToggle>
              <IconToggle
                active={view === "grid"}
                onClick={() => setViewPref("grid")}
                label={t("gallery.viewGrid")}
              >
                <LayoutGrid className="size-4" />
              </IconToggle>
            </div>
          </div>

          <div>
            {shown.length === 0 ? (
              <p className="mt-12 text-center text-sm text-muted-foreground">
                {t("gallery.empty")}
              </p>
            ) : view === "grid" ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {shown.map((item) => (
                  <SetCard
                    key={item.session.id}
                    item={item}
                    coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                    view="grid"
                    onEnter={() => openSet(item.session.id)}
                    onPlay={() => void playSet(item.session.id)}
                    onRequestDelete={() => setDeletingSet(item.session)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {shown.map((item) => (
                  <SetCard
                    key={item.session.id}
                    item={item}
                    coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                    view="list"
                    onEnter={() => openSet(item.session.id)}
                    onPlay={() => void playSet(item.session.id)}
                    onRequestDelete={() => setDeletingSet(item.session)}
                  />
                ))}
              </div>
            )}
          </div>
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
        <div className="min-h-0 flex-1">
          {shownTracks.length === 0 &&
          shownRemoteTracks.length === 0 &&
          facetArtistItems.length === 0 &&
          facetAlbumItems.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              {t("gallery.tracksEmpty")}
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {(facetArtistItems.length > 0 || facetAlbumItems.length > 0) && (
                  <div className="flex shrink-0 flex-col gap-3">
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
                {shownTracks.length > 0 && (
                  <TrackListSection
                    tracks={shownTracks}
                    selectedTrackId={selectedLibraryTrack?.id}
                    onView={(track) => transitionState(() => setSelectedLibraryTrackId(track.id))}
                    onPlay={(track) => void playTrack(track)}
                    emptyHint={t("gallery.tracksEmpty")}
                    listClassName="no-scrollbar pb-chrome-bottom"
                    className="flex-1"
                    startActions={<AddTracksMenu />}
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
          <div className="mb-3 flex items-center justify-end">
            <ViewToggleGroup view={view} onChange={setViewPref} />
          </div>
          <EntityGrid
            items={albumItems}
            kind="album"
            view={view}
            trackById={trackById}
            onOpen={openAlbum}
            onRequestDelete={(key) => {
              const entry = albumIndex.find((a) => a.key === key);
              if (!entry) return;
              const item = albumItems.find((i) => i.key === key);
              setDeletingEntity({
                kind: "album",
                name: item?.label ?? key,
                trackIds: entry.trackIds,
              });
            }}
            emptyHint={t("gallery.albumsEmpty")}
          />
        </>
      )}

      {mode === "artists" && (
        <>
          <div className="mb-3 flex items-center justify-end">
            <ViewToggleGroup view={view} onChange={setViewPref} />
          </div>
          <EntityGrid
            items={artistItems}
            kind="artist"
            view={view}
            trackById={trackById}
            onOpen={openArtist}
            emptyHint={t("gallery.artistsEmpty")}
          />
        </>
      )}
    </div>
  );
}

/** Level 2 — one set's virtualized track list. */
function SetDetailView({
  setId,
  trackById,
  onBack,
  onPlayAll,
}: {
  setId: string;
  trackById: Map<string, Track>;
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

  const tracks = useMemo(
    () =>
      (session?.trackIds ?? []).map((id) => trackById.get(id)).filter((tr): tr is Track => !!tr),
    [session, trackById],
  );
  const likedCount = useMemo(() => tracks.filter((tr) => tr.liked).length, [tracks]);
  const shownTracks = useMemo(
    () => (likedOnly ? tracks.filter((tr) => tr.liked) : tracks),
    [likedOnly, tracks],
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
          <TrackListSection
            setId={setId}
            tracks={shownTracks}
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
                {likedCount > 0 && (
                  <Button
                    size="sm"
                    variant={likedOnly ? "default" : "outline"}
                    aria-pressed={likedOnly}
                    onClick={() => setLikedOnly((v) => !v)}
                  >
                    <Heart className={cn("size-4", likedOnly && "fill-current")} />{" "}
                    {t("gallery.filterLiked")}
                  </Button>
                )}
                <AddTracksMenu setId={setId} />
              </>
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-accent/60 text-foreground"
          : "border-border text-muted-foreground hover:bg-accent/50",
      )}
    >
      {children}
    </button>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        onClick={onClick}
        aria-pressed={active}
        className={cn(
          "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
          active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          <span>{t("gallery.toggleModeHint")}</span>
          <KbdGroup>
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
  onEnter,
  onPlay,
  onRequestDelete,
}: {
  item: SetGalleryItem;
  coverTrack: Track | undefined;
  view: GalleryView;
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
