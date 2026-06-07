import { useLiveQuery } from "dexie-react-hooks";
import { Disc3, Heart, LayoutGrid, List, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { db } from "@/db/muzero-db";
import { listAllTracks, listSessions } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import {
  filterSets,
  type SetFilter,
  type SetGalleryItem,
  type SetSort,
  sortSets,
} from "@/lib/set-gallery";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type GalleryView = "list" | "grid";
const VIEW_KEY = "muzero-gallery-view";

/**
 * 歌单 Gallery — browse every set like an album wall. Search by name/seed, filter
 * (all / liked), sort (recent / name / size), and switch between a list and an
 * album-grid (each set's first cover is the tile). Tapping a set plays it.
 */
export function SearchPage() {
  const { t } = useTranslation();
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

  async function open(item: SetGalleryItem) {
    await setActiveSession(item.session.id);
    void play();
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col p-4 lg:p-6">
      {/* Search */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("gallery.search")}
          className="pl-9"
        />
      </div>

      {/* Filters + sort + view toggle */}
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

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                onOpen={() => void open(item)}
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
                onOpen={() => void open(item)}
              />
            ))}
          </div>
        )}
      </div>
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
  onOpen,
}: {
  item: SetGalleryItem;
  coverTrack: Track | undefined;
  view: GalleryView;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(coverTrack);
  const count = t("gallery.count", { count: item.trackCount });

  if (view === "grid") {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group flex flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
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
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-3 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
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
      {item.likedCount > 0 && <Heart className="size-4 shrink-0 fill-primary text-primary" />}
    </button>
  );
}
