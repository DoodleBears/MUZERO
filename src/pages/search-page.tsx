import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowLeft,
  Disc3,
  Heart,
  ImagePlus,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/db/muzero-db";
import {
  createSession,
  getSession,
  listAllTracks,
  listSessions,
  setSessionCover,
  updateSession,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { useObjectUrl, useTrackCoverUrl } from "@/hooks/use-media";
import { dragHasFiles, filesFromTransfer, IMAGE_ACCEPT, MEDIA_ACCEPT } from "@/lib/file-drop";
import {
  filterSets,
  type SetFilter,
  type SetGalleryItem,
  type SetSort,
  sortSets,
} from "@/lib/set-gallery";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { useUploadTargetStore } from "@/stores/upload-target-store";

type GalleryView = "list" | "grid";
const VIEW_KEY = "muzero-gallery-view";

function normalizeDescription(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .trim();
}

function stripDescriptionNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SetFilter>("all");
  const [sort, setSort] = useState<SetSort>("recent");
  const [view, setView] = useState<GalleryView>(() =>
    (typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY)) === "grid"
      ? "grid"
      : "list",
  );

  const sessions = useLiveQuery(() => listSessions(db), [], []);
  const allTracks = useLiveQuery(() => listAllTracks(db), [], []);
  const setActiveSession = usePlayerStore((s) => s.setActiveSession);
  const play = usePlayerStore((s) => s.play);
  const setUploadTarget = useUploadTargetStore((s) => s.setTarget);

  // Route app-wide dropped/pasted media: a set detail → that set; the album wall →
  // a target-set picker. Reset to the default behavior when leaving the gallery.
  useEffect(() => {
    setUploadTarget(selectedSetId ? { kind: "set", setId: selectedSetId } : { kind: "pick" });
    return () => setUploadTarget({ kind: "active" });
  }, [selectedSetId, setUploadTarget]);

  const trackById = useMemo(() => new Map(allTracks.map((tr) => [tr.id, tr])), [allTracks]);

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
        };
      }),
    [sessions, trackById],
  );

  const shown = useMemo(
    () => sortSets(filterSets(items, query, filter), sort),
    [items, query, filter, sort],
  );

  function setViewPref(next: GalleryView) {
    setView(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_KEY, next);
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
    setSelectedSetId(s.id);
  }

  // Level 2: a set's track list.
  if (selectedSetId) {
    return (
      <SetDetailView
        setId={selectedSetId}
        trackById={trackById}
        onBack={() => setSelectedSetId(null)}
        onPlayAll={() => void playSet(selectedSetId)}
      />
    );
  }

  // Level 1: the album wall. One full-height scroll surface — search + filters
  // scroll with the wall and the whole thing dissolves under the floating chrome
  // (`chrome-fade`), top and bottom, just like Now Playing.
  return (
    <div className="chrome-fade no-scrollbar mx-auto h-full w-full max-w-4xl overflow-y-auto px-4 pt-chrome-top pb-chrome-bottom lg:px-6">
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("gallery.search")}
            className="pl-9"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void createNewSet()}
          className="shrink-0"
        >
          <Plus className="size-4" /> {t("gallery.newSet")}
        </Button>
      </div>

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
          <p className="mt-12 text-center text-sm text-muted-foreground">{t("gallery.empty")}</p>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((item) => (
              <SetCard
                key={item.session.id}
                item={item}
                coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
                view="grid"
                onEnter={() => setSelectedSetId(item.session.id)}
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
                onEnter={() => setSelectedSetId(item.session.id)}
                onPlay={() => void playSet(item.session.id)}
              />
            ))}
          </div>
        )}
      </div>
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

  const tracks = useMemo(
    () =>
      (session?.trackIds ?? []).map((id) => trackById.get(id)).filter((tr): tr is Track => !!tr),
    [session, trackById],
  );

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
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col px-4 pt-14 lg:px-6">
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
            <Disc3 className="size-7 text-muted-foreground" />
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

      <div className="min-h-0 flex-1">
        <VirtualTrackList
          tracks={tracks}
          onPlay={(track) => void playTrack(track)}
          emptyHint={t("gallery.empty")}
          className="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
        />
      </div>
    </div>
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
              <Disc3 className="size-8 text-muted-foreground" />
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
            <Disc3 className="size-5 text-muted-foreground" />
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
