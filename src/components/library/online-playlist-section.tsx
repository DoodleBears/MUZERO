import type Lenis from "lenis";
import { ListMusic, RefreshCw } from "lucide-react";
import type { RefObject } from "react";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { OnlinePlaylistCatalogEntry, StreamSourceId } from "@/db/types";
import { cn } from "@/lib/utils";
import { filterOnlinePlaylists, STREAM_SOURCE_DISPLAY_NAMES } from "@/streamsrc/playlist-catalog";
import { VirtualCardGrid } from "./virtual-card-grid";

type OnlinePlaylistView = "grid" | "list";
export type OnlinePlaylistSourceFilter = StreamSourceId | "all";

export const OnlinePlaylistSection = memo(function OnlinePlaylistSection({
  playlists,
  query,
  sourceFilter,
  onSourceFilterChange,
  onOpen,
  onImport,
  onRefresh,
  refreshing = false,
  view,
  scrollElement = null,
  lenisRef,
}: {
  playlists: OnlinePlaylistCatalogEntry[];
  query: string;
  sourceFilter: OnlinePlaylistSourceFilter;
  onSourceFilterChange: (source: OnlinePlaylistSourceFilter) => void;
  onOpen: (playlist: OnlinePlaylistCatalogEntry) => void;
  onImport: (playlist: OnlinePlaylistCatalogEntry) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  view: OnlinePlaylistView;
  scrollElement?: HTMLElement | null;
  lenisRef?: RefObject<Lenis | null>;
}) {
  const { t } = useTranslation();
  const availableSources = useMemo(
    () => Array.from(new Set(playlists.map((playlist) => playlist.source))),
    [playlists],
  );
  const visible = useMemo(() => {
    const bySource =
      sourceFilter === "all"
        ? playlists
        : playlists.filter((playlist) => playlist.source === sourceFilter);
    return filterOnlinePlaylists(bySource, query);
  }, [playlists, query, sourceFilter]);

  if (playlists.length === 0) return null;

  return (
    <section className="mb-5 px-3" data-testid="online-playlist-section">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <h2 className="font-medium text-sm">{t("gallery.onlinePlaylists")}</h2>
          <p className="text-muted-foreground text-xs">
            {t("gallery.onlinePlaylistCount", { count: playlists.length })}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          {t("gallery.refreshOnlinePlaylists")}
        </Button>
      </div>

      {availableSources.length > 1 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          <SourceChip
            active={sourceFilter === "all"}
            onClick={() => onSourceFilterChange("all")}
            label={t("gallery.allOnlineSources")}
          />
          {availableSources.map((source) => (
            <SourceChip
              key={source}
              active={sourceFilter === source}
              onClick={() => onSourceFilterChange(source)}
              label={STREAM_SOURCE_DISPLAY_NAMES[source]}
            />
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-xl px-2 py-6 text-center text-muted-foreground text-sm">
          {t("gallery.onlinePlaylistNoMatches")}
        </p>
      ) : scrollElement ? (
        <VirtualCardGrid
          items={visible}
          view={view}
          getKey={onlinePlaylistKey}
          scrollElement={scrollElement}
          lenisRef={lenisRef}
          className="pb-4"
          renderCard={(playlist) => (
            <OnlinePlaylistCard
              playlist={playlist}
              view={view}
              onOpen={onOpen}
              onImport={onImport}
            />
          )}
        />
      ) : (
        <div
          className={cn(
            view === "grid" ? "grid grid-cols-1 gap-2 sm:grid-cols-2" : "flex flex-col gap-1",
          )}
        >
          {visible.map((playlist) => (
            <OnlinePlaylistCard
              key={`${playlist.source}:${playlist.id}`}
              playlist={playlist}
              view={view}
              onOpen={onOpen}
              onImport={onImport}
            />
          ))}
        </div>
      )}
    </section>
  );
});

function onlinePlaylistKey(playlist: OnlinePlaylistCatalogEntry): string {
  return `online:${playlist.source}:${playlist.id}`;
}

function SourceChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-background/30 text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function OnlinePlaylistCard({
  playlist,
  view,
  onOpen,
  onImport,
}: {
  playlist: OnlinePlaylistCatalogEntry;
  view: OnlinePlaylistView;
  onOpen: (playlist: OnlinePlaylistCatalogEntry) => void;
  onImport: (playlist: OnlinePlaylistCatalogEntry) => void;
}) {
  const { t } = useTranslation();
  const isGrid = view === "grid";
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(playlist)}
        aria-label={playlist.name}
        data-gallery-card
        data-gallery-card-key={`online:${playlist.source}:${playlist.id}`}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          isGrid ? "pe-20" : "pe-20",
        )}
      >
        <span
          className={cn(
            "grid shrink-0 place-items-center overflow-hidden bg-secondary",
            isGrid ? "size-16" : "size-12",
            "album-cover-radius",
          )}
        >
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <ListMusic className={cn(isGrid ? "size-6" : "size-5", "text-primary")} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">{playlist.name}</span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
              {STREAM_SOURCE_DISPLAY_NAMES[playlist.source]}
            </span>
            <span className="text-muted-foreground text-xs">
              {t("streamSources.trackCount", { count: playlist.trackCount })}
            </span>
          </span>
        </span>
      </button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="absolute right-2 top-1/2 h-8 -translate-y-1/2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onImport(playlist);
        }}
      >
        {t("streamSources.import")}
      </Button>
    </div>
  );
}
