import { Disc3, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { cn } from "@/lib/utils";

/** A derived library entity (artist or album) flattened for display. Labels are
 *  pre-localized at the call site so this component holds no copy. */
export interface LibraryEntityItem {
  key: string;
  /** Localized display name (bucket labels already resolved). */
  label: string;
  /** Localized secondary line (album count, or album artist). */
  sublabel: string;
  /** Track whose cover represents the entity, if any. */
  coverTrackId?: string;
}

type EntityKind = "artist" | "album";
type GridView = "list" | "grid";

/**
 * Responsive grid/list of derived artist or album entities. Mirrors the set
 * gallery's card affordances; tapping a card opens that entity's detail. Artists
 * render with a round cover, albums with a square one.
 */
export function EntityGrid({
  items,
  kind,
  view,
  trackById,
  onOpen,
  emptyHint,
}: {
  items: LibraryEntityItem[];
  kind: EntityKind;
  view: GridView;
  trackById: Map<string, Track>;
  onOpen: (key: string) => void;
  emptyHint: string;
}) {
  if (items.length === 0) {
    return <p className="mt-12 text-center text-muted-foreground text-sm">{emptyHint}</p>;
  }
  return view === "grid" ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <EntityCard
          key={item.key}
          item={item}
          kind={kind}
          view="grid"
          coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
          onOpen={() => onOpen(item.key)}
        />
      ))}
    </div>
  ) : (
    <div className="flex flex-col gap-1">
      {items.map((item) => (
        <EntityCard
          key={item.key}
          item={item}
          kind={kind}
          view="list"
          coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
          onOpen={() => onOpen(item.key)}
        />
      ))}
    </div>
  );
}

function EntityCard({
  item,
  kind,
  view,
  coverTrack,
  onOpen,
}: {
  item: LibraryEntityItem;
  kind: EntityKind;
  view: GridView;
  coverTrack: Track | undefined;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(coverTrack);
  const round = kind === "artist";
  const Placeholder = kind === "artist" ? User : Disc3;

  const cover = (size: string) => (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden bg-secondary",
        round ? "rounded-full" : "rounded-lg",
        size,
      )}
    >
      {coverUrl ? (
        <img src={coverUrl} alt="" className="size-full object-cover" />
      ) : (
        <Placeholder className="text-muted-foreground" />
      )}
    </span>
  );

  if (view === "grid") {
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("gallery.openEntity", { name: item.label })}
        className="flex w-full flex-col items-center gap-2 rounded-xl p-2 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cover(round ? "aspect-square w-full" : "aspect-square w-full")}
        <span className="min-w-0 self-stretch">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          <span className="block truncate text-muted-foreground text-xs">{item.sublabel}</span>
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("gallery.openEntity", { name: item.label })}
      className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {cover("size-12")}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.label}</span>
        <span className="block truncate text-muted-foreground text-xs">{item.sublabel}</span>
      </span>
    </button>
  );
}
