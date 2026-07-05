import type Lenis from "lenis";
import { ListMusic, RefreshCw } from "lucide-react";
import type { RefObject } from "react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CoverImage } from "@/components/ui/cover-image";
import type { OnlinePlaylistCatalogEntry } from "@/db/types";
import { cn } from "@/lib/utils";
import { filterOnlinePlaylists, STREAM_SOURCE_DISPLAY_NAMES } from "@/streamsrc/playlist-catalog";
import { VirtualCardGrid } from "./virtual-card-grid";

type OnlinePlaylistView = "grid" | "list";
const INLINE_VIRTUALIZE_MIN_ITEMS = 40;

export const OnlinePlaylistSection = memo(function OnlinePlaylistSection({
  playlists,
  query,
  onOpen,
  onImport,
  onRefresh,
  refreshing = false,
  view,
  showHeader = true,
  scrollElement,
  lenisRef,
}: {
  playlists: OnlinePlaylistCatalogEntry[];
  query: string;
  onOpen: (playlist: OnlinePlaylistCatalogEntry) => void;
  onImport: (playlist: OnlinePlaylistCatalogEntry) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  view: OnlinePlaylistView;
  showHeader?: boolean;
  scrollElement?: HTMLElement | null;
  lenisRef?: RefObject<Lenis | null>;
}) {
  const { t } = useTranslation();
  const visible = useMemo(() => filterOnlinePlaylists(playlists, query), [playlists, query]);
  const [inlineScrollElement, setInlineScrollElement] = useState<HTMLDivElement | null>(null);
  const hasExternalScroller = scrollElement !== undefined;
  const shouldVirtualizeInline =
    !hasExternalScroller && visible.length > INLINE_VIRTUALIZE_MIN_ITEMS;

  if (playlists.length === 0) return null;

  return (
    <section className="mb-5 px-3" data-testid="online-playlist-section">
      {showHeader ? (
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
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-xl px-2 py-6 text-center text-muted-foreground text-sm">
          {t("gallery.onlinePlaylistNoMatches")}
        </p>
      ) : hasExternalScroller ? (
        scrollElement ? (
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
        ) : null
      ) : shouldVirtualizeInline ? (
        <div
          ref={setInlineScrollElement}
          data-testid="online-playlist-inline-virtual-scroll"
          className="thin-transparent-scrollbar max-h-[min(58vh,620px)] overflow-y-auto pr-1"
        >
          {inlineScrollElement ? (
            <VirtualCardGrid
              items={visible}
              view={view}
              getKey={onlinePlaylistKey}
              scrollElement={inlineScrollElement}
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
          ) : null}
        </div>
      ) : (
        <div
          className={cn(
            view === "grid"
              ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
              : "flex flex-col gap-1",
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
  const importButton = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        "absolute opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
        isGrid ? "bottom-3 right-3 h-8" : "right-2 top-1/2 h-8 -translate-y-1/2",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onImport(playlist);
      }}
    >
      {t("streamSources.import")}
    </Button>
  );

  if (isGrid) {
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={() => onOpen(playlist)}
          aria-label={playlist.name}
          data-gallery-card
          data-gallery-card-key={`online:${playlist.source}:${playlist.id}`}
          className="flex w-full flex-col gap-2 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CoverImage
            url={playlist.coverUrl ?? null}
            placeholder={<ListMusic className="text-primary" size={32} />}
            className="aspect-square w-full"
          />
          <span className="min-w-0">
            <span className="block truncate font-medium text-sm">{playlist.name}</span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
                {STREAM_SOURCE_DISPLAY_NAMES[playlist.source]}
              </span>
              <span className="text-muted-foreground text-xs">
                {t("streamSources.trackCount", { count: playlist.trackCount })}
              </span>
            </span>
          </span>
        </button>
        {importButton}
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(playlist)}
        aria-label={playlist.name}
        data-gallery-card
        data-gallery-card-key={`online:${playlist.source}:${playlist.id}`}
        className="flex w-full items-center gap-3 rounded-xl p-2 pe-20 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CoverImage
          url={playlist.coverUrl ?? null}
          placeholder={<ListMusic className="text-primary" size={20} />}
          className="size-12 shrink-0"
        />
        <span className="min-w-0 flex-1">
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
      {importButton}
    </div>
  );
}
