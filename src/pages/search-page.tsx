import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import { ArrowLeft, Heart, ImagePlus, LayoutGrid, List, Play, Plus, Search } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EntityDetailView } from "@/components/library/entity-detail";
import { EntityGrid, type LibraryEntityItem } from "@/components/library/entity-grid";
import { TrackListMenu } from "@/components/library/track-list-menu";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { Button } from "@/components/ui/button";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { db } from "@/db/muzero-db";
import {
  createSession,
  getSession,
  listAllTracks,
  listSessions,
  memoryNotesByTrack,
  setSessionCover,
  updateSession,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { useObjectUrl, useTrackCoverUrl } from "@/hooks/use-media";
import { dragHasFiles, filesFromTransfer, IMAGE_ACCEPT, MEDIA_ACCEPT } from "@/lib/file-drop";
import {
  type AlbumEntry,
  type ArtistEntry,
  albumsForArtist,
  buildAlbumIndex,
  buildArtistIndex,
  findAlbumForTrack,
  findArtistByName,
} from "@/lib/library-index";
import {
  filterSets,
  type SetFilter,
  type SetGalleryItem,
  type SetSort,
  sortSets,
} from "@/lib/set-gallery";
import { searchTracks } from "@/lib/track-search";
import { cn } from "@/lib/utils";
import { transitionState } from "@/lib/view-transition-react";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";
import { matchesRemoteSearchTrack } from "@/sync/r2-search-catalog";

type GalleryView = "list" | "grid";
type GalleryMode = "sets" | "tracks" | "albums" | "artists";
const GALLERY_MODES: GalleryMode[] = ["sets", "tracks", "albums", "artists"];
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
const GALLERY_MODE_TOGGLE_KEYS = new Set(["`", "~", "·", "｀"]);

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

function isGalleryModeToggle(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return false;
  return event.code === "Backquote" || GALLERY_MODE_TOGGLE_KEYS.has(event.key);
}

/**
 * 歌单 Gallery — a two-level surface. Level 1 browses every set like an album wall
 * (search / filter / sort / list⇄album-grid). Tapping a set opens level 2: that
 * set's virtualized track list, with a back button + "play all". A small play
 * button on each card plays the set directly without entering it.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [mode, setMode] = useState<GalleryMode>(savedGalleryMode);
  const [setQuery, setSetQuery] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [albumQuery, setAlbumQuery] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [filter, setFilter] = useState<SetFilter>("all");
  const [sort, setSort] = useState<SetSort>("recent");
  const [selectedLibraryTrackId, setSelectedLibraryTrackId] = useState<string | null>(null);
  const [selectedArtistKey, setSelectedArtistKey] = useState<string | null>(null);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const [view, setView] = useState<GalleryView>(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY)) === "grid"
      ? "grid"
      : "list",
  );

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
  const setUploadTarget = useUploadTargetStore((s) => s.setTarget);

  // Route app-wide dropped/pasted media: a set detail → that set; the album wall →
  // a target-set picker. Reset to the default behavior when leaving the gallery.
  useEffect(() => {
    setUploadTarget(selectedSetId ? { kind: "set", setId: selectedSetId } : { kind: "pick" });
    return () => setUploadTarget({ kind: "active" });
  }, [selectedSetId, setUploadTarget]);

  useEffect(() => {
    if (selectedSetId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isGalleryModeToggle(event)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      const next = GALLERY_MODES[(GALLERY_MODES.indexOf(mode) + 1) % GALLERY_MODES.length];
      setMode(next);
      if (typeof localStorage !== "undefined") localStorage.setItem(MODE_KEY, next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, selectedSetId]);

  const trackById = useMemo(() => new Map(allTracks.map((tr) => [tr.id, tr])), [allTracks]);

  // Derived artist/album entities — pure projections over the imported metadata
  // (no stored table); re-project whenever the track liveQuery emits.
  const artistIndex = useMemo(() => buildArtistIndex(allTracks), [allTracks]);
  const albumIndex = useMemo(() => buildAlbumIndex(allTracks), [allTracks]);
  const artistItems = useMemo<LibraryEntityItem[]>(() => {
    const q = artistQuery.trim().toLowerCase();
    return artistIndex
      .map((entry) => ({
        key: entry.key,
        label: artistDisplayLabel(entry, t),
        sublabel: t("gallery.count", { count: entry.trackIds.length }),
        coverTrackId: entry.coverTrackId,
      }))
      .filter((item) => !q || item.label.toLowerCase().includes(q));
  }, [artistIndex, artistQuery, t]);
  const albumItems = useMemo<LibraryEntityItem[]>(() => {
    const q = albumQuery.trim().toLowerCase();
    return albumIndex
      .map((entry) => ({
        key: entry.key,
        label: albumDisplayLabel(entry, t),
        sublabel:
          entry.bucket === "unknown"
            ? t("gallery.count", { count: entry.trackIds.length })
            : albumArtistDisplayLabel(entry, t),
        coverTrackId: entry.coverTrackId,
      }))
      .filter((item) => !q || item.label.toLowerCase().includes(q));
  }, [albumIndex, albumQuery, t]);
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

  const shown = useMemo(
    () => sortSets(filterSets(items, setQuery, filter), sort),
    [items, setQuery, filter, sort],
  );
  const shownTracks = useMemo(() => {
    const sortedTracks = [...allTracks].sort((a, b) => b.createdAt - a.createdAt);
    return searchTracks(sortedTracks, trackQuery, memoryNotes);
  }, [allTracks, memoryNotes, trackQuery]);
  const selectedLibraryTrack = useMemo(
    () => shownTracks.find((track) => track.id === selectedLibraryTrackId) ?? shownTracks[0],
    [selectedLibraryTrackId, shownTracks],
  );
  const shownRemoteTracks = useMemo(
    () =>
      trackQuery.trim()
        ? remoteTracks
            .filter((track) => matchesRemoteSearchTrack(track, trackQuery))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        : [],
    [remoteTracks, trackQuery],
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
        title={artistDisplayLabel(selectedArtist, t)}
        subtitle={t("gallery.albumCount", { count: artistAlbums.length })}
        coverTrack={
          selectedArtist.coverTrackId ? trackById.get(selectedArtist.coverTrackId) : undefined
        }
        tracks={tracks}
        albums={artistAlbums}
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
        title={albumDisplayLabel(selectedAlbum, t)}
        subtitle={
          selectedAlbum.bucket === "unknown" ? "" : albumArtistDisplayLabel(selectedAlbum, t)
        }
        coverTrack={
          selectedAlbum.coverTrackId ? trackById.get(selectedAlbum.coverTrackId) : undefined
        }
        tracks={tracks}
        onBack={() => transitionState(() => setSelectedAlbumKey(null))}
      />
    );
  }

  // Level 1: the album wall. One full-height scroll surface — search + filters
  // scroll with the wall and the whole thing dissolves under the floating chrome
  // (`chrome-fade`), top and bottom, just like Now Playing.
  return (
    <div
      className={cn(
        "chrome-fade no-scrollbar mx-auto flex h-full w-full flex-col overflow-y-auto px-4 pt-chrome-top lg:px-6",
        mode === "tracks" ? "max-w-6xl" : "max-w-4xl",
        mode === "tracks" ? "pb-0" : "pb-chrome-bottom",
      )}
    >
      <TooltipProvider>
        <div className="mb-3 inline-flex rounded-lg border border-border bg-background/10 w-fit p-1">
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
            <Chip active={filter === "all"} onClick={() => setFilter("all")}>
              {t("gallery.filterAll")}
            </Chip>
            <Chip active={filter === "liked"} onClick={() => setFilter("liked")}>
              <Heart className="size-3" /> {t("gallery.filterLiked")}
            </Chip>
            <span className="mx-1 h-4 w-px bg-border" />
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
                    onEnter={() => transitionState(() => setSelectedSetId(item.session.id))}
                    onPlay={() => void playSet(item.session.id)}
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
                    onEnter={() => transitionState(() => setSelectedSetId(item.session.id))}
                    onPlay={() => void playSet(item.session.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {mode === "tracks" && (
        <div className="min-h-0 flex-1">
          {shownTracks.length === 0 && shownRemoteTracks.length === 0 ? (
            <p className="mt-12 text-center text-sm text-muted-foreground">
              {t("gallery.tracksEmpty")}
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {shownTracks.length > 0 && (
                  <TrackListMenu className="min-h-0 flex-1">
                    <VirtualTrackList
                      tracks={shownTracks}
                      selectedTrackId={selectedLibraryTrack?.id}
                      onView={(track) => transitionState(() => setSelectedLibraryTrackId(track.id))}
                      onPlay={(track) => void playTrack(track)}
                      emptyHint={t("gallery.tracksEmpty")}
                      className="no-scrollbar pb-chrome-bottom"
                    />
                  </TrackListMenu>
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
            onOpen={(key) => transitionState(() => setSelectedAlbumKey(key))}
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
            onOpen={(key) => transitionState(() => setSelectedArtistKey(key))}
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
  const addUploadsToSet = usePlayerStore((s) => s.addUploadsToSet);
  const fileRef = useRef<HTMLInputElement>(null);
  const addFileRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const tracks = useMemo(
    () =>
      (session?.trackIds ?? []).map((id) => trackById.get(id)).filter((tr): tr is Track => !!tr),
    [session, trackById],
  );
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
  const coverUrl = useSetCoverUrl(session?.coverBlobId, coverTrack);

  function applyCover(files: File[]) {
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) void setSessionCover(setId, img, img.type || "image/jpeg");
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

  // Paste an image while on this set's detail page → set its cover.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = filesFromTransfer(e.clipboardData).find((f) => f.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        void setSessionCover(setId, img, img.type || "image/jpeg");
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [setId]);

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

      <div className="mb-3 flex items-start gap-3">
        {/* Cover — drop / paste / click to set */}
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
            applyCover(filesFromTransfer(e.dataTransfer));
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
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) applyCover(Array.from(e.target.files));
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
          <p className="px-1 pt-0.5 text-xs text-muted-foreground">
            {t("gallery.count", { count: tracks.length })}
          </p>
        </div>

        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" onClick={onPlayAll} disabled={tracks.length === 0}>
            <Play className="size-4" /> {t("gallery.playAll")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => addFileRef.current?.click()}>
            <Plus className="size-4" /> {t("gallery.addTracks")}
          </Button>
          <input
            ref={addFileRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addUploadsToSet(setId, e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <TrackListMenu setId={setId} className="min-h-0">
          <VirtualTrackList
            tracks={tracks}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => transitionState(() => setSelectedTrackId(track.id))}
            onPlay={(track) => void playTrack(track)}
            emptyHint={t("gallery.empty")}
            className="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
          />
        </TrackListMenu>
        <TrackInspectorPanel track={selectedTrack} />
      </div>
    </motion.div>
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
): string | null {
  const setBlob = useLiveQuery(
    () => (coverBlobId ? db.mediaBlobs.get(coverBlobId).then((r) => r?.blob ?? null) : null),
    [coverBlobId],
    null,
  );
  const setUrl = useObjectUrl(setBlob);
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
}: {
  item: SetGalleryItem;
  coverTrack: Track | undefined;
  view: GalleryView;
  onEnter: () => void;
  onPlay: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useSetCoverUrl(item.session.coverBlobId, coverTrack);
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

  if (view === "grid") {
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={onEnter}
          className="flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-secondary">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <Disc3Icon className="text-muted-foreground" size={32} />
            )}
            {item.likedCount > 0 && (
              <Heart className="absolute right-2 top-2 size-4 fill-primary text-primary" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{item.session.name}</span>
            <span className="block text-xs text-muted-foreground">{count}</span>
          </span>
        </button>
        {playBtn}
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onEnter}
        className="flex w-full items-center gap-3 rounded-xl p-2 pe-12 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3Icon className="text-muted-foreground" size={20} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.session.name}</span>
          <span className="block truncate text-xs text-muted-foreground">{count}</span>
        </span>
        {item.likedCount > 0 && (
          <Heart className="me-8 size-4 shrink-0 fill-primary text-primary" />
        )}
      </button>
      {playBtn}
    </div>
  );
}
