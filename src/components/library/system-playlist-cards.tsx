import { BarChart3, Heart, History, Play } from "lucide-react";
import { memo } from "react";
import { CoverImage } from "@/components/ui/cover-image";
import type { Track } from "@/db/types";
import { useGridCoverUrl } from "@/hooks/use-media";
import type { SystemPlaylistDefinition, SystemPlaylistId } from "@/lib/system-playlists";
import { cn } from "@/lib/utils";

type SystemPlaylistIcon = SystemPlaylistDefinition["icon"];
type SystemPlaylistView = "grid" | "list";

export interface SystemPlaylistCardItem {
  id: SystemPlaylistId;
  label: string;
  playLabel: string;
  subtitle: string;
  count: number;
  icon: SystemPlaylistIcon;
  coverTrack?: Pick<Track, "coverBlobId" | "coverCrop" | "coverThumbhash" | "remoteCoverUrl">;
}

export const SystemPlaylistCards = memo(function SystemPlaylistCards({
  items,
  view,
  onOpen,
  onPlay,
}: {
  items: SystemPlaylistCardItem[];
  view: SystemPlaylistView;
  onOpen: (id: SystemPlaylistId) => void;
  onPlay: (id: SystemPlaylistId) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className={cn(
        view === "grid" ? "grid grid-cols-1 gap-2 sm:grid-cols-3" : "flex flex-col gap-1",
      )}
      data-testid="system-playlist-cards"
    >
      {items.map((item) => (
        <SystemPlaylistCard item={item} key={item.id} onOpen={onOpen} onPlay={onPlay} view={view} />
      ))}
    </div>
  );
});

const SystemPlaylistCard = memo(function SystemPlaylistCard({
  item,
  view,
  onOpen,
  onPlay,
}: {
  item: SystemPlaylistCardItem;
  view: SystemPlaylistView;
  onOpen: (id: SystemPlaylistId) => void;
  onPlay: (id: SystemPlaylistId) => void;
}) {
  const Icon = iconFor(item.icon);
  const isGrid = view === "grid";
  const coverUrl = useGridCoverUrl(item.coverTrack, isGrid);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        aria-label={item.label}
        data-gallery-card
        data-gallery-card-key={item.id}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          isGrid ? "pe-11" : "pe-12",
        )}
      >
        <span
          className={cn("shrink-0", isGrid ? "size-16" : "size-12")}
          data-system-playlist-art={item.id}
        >
          <CoverImage
            alt={item.label}
            className="size-full"
            placeholder={
              <Icon
                className={cn(isGrid ? "size-6" : "size-5", item.count > 0 && "text-primary")}
              />
            }
            thumbhash={item.coverTrack?.coverThumbhash}
            url={coverUrl}
          >
            {coverUrl && (
              <>
                <span
                  aria-hidden
                  className="absolute inset-0 bg-background/40"
                  data-system-playlist-cover-mask={item.id}
                />
                <Icon className="relative z-10 size-5 text-foreground drop-shadow-sm" />
              </>
            )}
          </CoverImage>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-medium text-sm">{item.label}</span>
          <span className="block truncate text-muted-foreground text-xs">{item.subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onPlay(item.id);
        }}
        aria-label={item.playLabel}
        className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-md transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Play className="size-4 fill-current" />
      </button>
    </div>
  );
});

function iconFor(icon: SystemPlaylistIcon) {
  switch (icon) {
    case "heart":
      return Heart;
    case "history":
      return History;
    default:
      return BarChart3;
  }
}
