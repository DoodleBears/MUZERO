import { Disc3, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { CoverImage } from "@/components/ui/cover-image";
import { DeleteIcon } from "@/components/ui/delete";
import type { Track } from "@/db/types";
import { useTrackThumbnailUrl } from "@/hooks/use-media";
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
  onRequestDelete,
  emptyHint,
}: {
  items: LibraryEntityItem[];
  kind: EntityKind;
  view: GridView;
  trackById: Map<string, Track>;
  onOpen: (key: string) => void;
  /** Right-click → "Delete album/artist…" (permanently delete its songs). */
  onRequestDelete?: (key: string) => void;
  emptyHint: string;
}) {
  if (items.length === 0) {
    return <p className="mt-12 text-center text-muted-foreground text-sm">{emptyHint}</p>;
  }
  const cards = items.map((item) => (
    <EntityCard
      key={item.key}
      item={item}
      kind={kind}
      view={view}
      coverTrack={item.coverTrackId ? trackById.get(item.coverTrackId) : undefined}
      onOpen={() => onOpen(item.key)}
      onRequestDelete={onRequestDelete ? () => onRequestDelete(item.key) : undefined}
    />
  ));
  return view === "grid" ? (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{cards}</div>
  ) : (
    <div className="flex flex-col gap-1">{cards}</div>
  );
}

export function EntityCard({
  item,
  kind,
  view,
  coverTrack,
  coverViewTransitionName,
  onOpen,
  onRequestDelete,
}: {
  item: LibraryEntityItem;
  kind: EntityKind;
  view: GridView;
  coverTrack: Track | undefined;
  /** When set, the cover wears this `view-transition-name` so it morphs into the
   *  detail-page cover on open (the wall passes it only for the card being opened). */
  coverViewTransitionName?: string;
  onOpen: () => void;
  onRequestDelete?: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackThumbnailUrl(coverTrack);
  const round = kind === "artist";
  const Placeholder = kind === "artist" ? User : Disc3;

  const cover = (size: string) => (
    <CoverImage
      url={coverUrl}
      thumbhash={coverTrack?.coverThumbhash}
      rounded={round}
      placeholder={<Placeholder className="text-muted-foreground" />}
      className={cn("shrink-0", size)}
      style={coverViewTransitionName ? { viewTransitionName: coverViewTransitionName } : undefined}
    />
  );

  const card =
    view === "grid" ? (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("gallery.openEntity", { name: item.label })}
        data-gallery-card
        data-gallery-card-key={item.key}
        className="flex w-full flex-col items-center gap-2 rounded-xl p-2 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cover(round ? "aspect-square w-full" : "aspect-square w-full")}
        <span className="min-w-0 self-stretch">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          <span className="block truncate text-muted-foreground text-xs">{item.sublabel}</span>
        </span>
      </button>
    ) : (
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("gallery.openEntity", { name: item.label })}
        data-gallery-card
        data-gallery-card-key={item.key}
        className="flex w-full items-center gap-3 rounded-xl p-2 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cover("size-12")}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{item.label}</span>
          <span className="block truncate text-muted-foreground text-xs">{item.sublabel}</span>
        </span>
      </button>
    );

  if (!onRequestDelete) return card;

  return (
    <ContextMenu>
      <ContextMenuTrigger>{card}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem className="text-destructive-foreground" onClick={onRequestDelete}>
          <DeleteIcon size={16} />{" "}
          {kind === "album" ? t("entity.deleteAlbum") : t("entity.deleteArtist")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
