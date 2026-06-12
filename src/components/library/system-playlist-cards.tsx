import { BarChart3, Heart, History, Play } from "lucide-react";
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
}

export function SystemPlaylistCards({
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
        <SystemPlaylistCard
          item={item}
          key={item.id}
          onOpen={() => onOpen(item.id)}
          onPlay={() => onPlay(item.id)}
          view={view}
        />
      ))}
    </div>
  );
}

function SystemPlaylistCard({
  item,
  view,
  onOpen,
  onPlay,
}: {
  item: SystemPlaylistCardItem;
  view: SystemPlaylistView;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const Icon = iconFor(item.icon);
  const isGrid = view === "grid";
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        aria-label={item.label}
        data-gallery-card
        data-gallery-card-key={item.id}
        className={cn(
          "w-full rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
          isGrid ? "flex flex-col gap-2" : "flex items-center gap-3 pe-12",
        )}
      >
        <span
          className={cn(
            "grid shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground",
            isGrid ? "aspect-square w-full" : "size-12",
          )}
        >
          <Icon className={cn(isGrid ? "size-9" : "size-5", item.count > 0 && "text-primary")} />
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
          onPlay();
        }}
        aria-label={item.playLabel}
        className={cn(
          "absolute grid place-items-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-md transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
          isGrid ? "bottom-3 right-3 size-9" : "right-2 top-1/2 size-8 -translate-y-1/2",
        )}
      >
        <Play className="size-4 fill-current" />
      </button>
    </div>
  );
}

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
