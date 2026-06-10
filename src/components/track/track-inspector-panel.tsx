import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { CoverContextMenu } from "@/components/library/cover-context-menu";
import { Disc3Icon } from "@/components/ui/disc-3";
import { clearTrackCover } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { AnnotationEditor } from "./annotation-editor";

interface TrackInspectorPanelProps {
  className?: string;
  track: Track | undefined;
}

export function TrackInspectorPanel({ className, track }: TrackInspectorPanelProps) {
  const { t } = useTranslation();

  return (
    <aside
      className={cn(
        // Its own bounded scroll column (the parent grid row caps its height), so the
        // detail pane scrolls independently of the list and its top dissolves under the
        // floating search box via `chrome-fade` — matching the list/wall scrollers.
        "hidden min-h-0 border-border border-l ps-4 lg:block",
        "chrome-fade no-scrollbar overflow-y-auto pt-2 pb-chrome-bottom [--chrome-fade-top:0.75rem]",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {track ? (
          <motion.div
            key={track.id}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex min-h-0 flex-col gap-4"
          >
            <TrackMetadataSummary track={track} />
            <AnnotationEditor key={track.id} track={track} />
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            className="pt-10 text-center text-muted-foreground text-sm"
          >
            {t("gallery.noTrackSelected")}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

interface MetadataFact {
  label: string;
  value: string;
  onOpen?: () => void;
}

function TrackMetadataSummary({ track }: { track: Track }) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(track);
  const metadata = track.mediaMetadata;
  const artists = trackArtists(track);
  const artist = artists.join(", ") || metadata?.albumArtists?.join(", ");
  const album = trackAlbum(track);
  const genres = metadata?.genres?.join(", ");
  const year = metadata?.year ? String(metadata.year) : metadata?.date;
  const facts = [
    artist
      ? {
          label: t("gallery.trackArtist"),
          value: artist,
          onOpen: artists[0] ? () => useNavStore.getState().openArtist(artists[0]) : undefined,
        }
      : undefined,
    album
      ? {
          label: t("gallery.trackAlbum"),
          value: album,
          onOpen: () => useNavStore.getState().openAlbumForTrack(track.id),
        }
      : undefined,
    genres ? { label: t("gallery.trackGenre"), value: genres } : undefined,
    year ? { label: t("gallery.trackYear"), value: year } : undefined,
    { label: t("gallery.trackDuration"), value: formatDuration(track.durationSec) },
  ].filter((fact): fact is MetadataFact => !!fact);

  return (
    <section className="flex flex-col gap-3">
      {/* Right-click a pinned cover to remove it back to the disc placeholder. */}
      <CoverContextMenu
        hasCover={!!track.coverBlobId}
        onRemove={() => void clearTrackCover(track.id)}
      >
        <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-secondary">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3Icon className="text-muted-foreground" size={48} />
          )}
        </div>
      </CoverContextMenu>
      <div className="min-w-0">
        <h2 className="truncate font-semibold text-lg">{track.title}</h2>
        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
          {track.brief?.caption ??
            artist ??
            album ??
            t(`track.${track.kind === "video" ? "uploadedVideo" : "uploadedAudio"}`)}
        </p>
      </div>
      {facts.length > 0 && (
        <dl className="grid gap-2 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">{fact.label}</dt>
              <dd className="truncate text-foreground">
                {fact.onOpen ? (
                  <button
                    type="button"
                    onClick={fact.onOpen}
                    className="max-w-full truncate rounded text-left outline-none hover:underline focus-visible:underline"
                  >
                    {fact.value}
                  </button>
                ) : (
                  fact.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
