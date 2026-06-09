import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Disc3Icon } from "@/components/ui/disc-3";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { cn, formatDuration } from "@/lib/utils";
import { AnnotationEditor } from "./annotation-editor";

interface TrackInspectorPanelProps {
  className?: string;
  track: Track | undefined;
}

export function TrackInspectorPanel({ className, track }: TrackInspectorPanelProps) {
  const { t } = useTranslation();

  return (
    <aside className={cn("hidden min-h-0 border-border border-l ps-4 lg:block", className)}>
      <AnimatePresence mode="wait" initial={false}>
        {track ? (
          <motion.div
            key={track.id}
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="sticky top-14 flex max-h-[calc(100vh-9rem)] min-h-0 flex-col gap-4 overflow-y-auto pb-chrome-bottom"
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

function TrackMetadataSummary({ track }: { track: Track }) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(track);
  const metadata = track.mediaMetadata;
  const artist = metadata?.artists?.join(", ") || metadata?.albumArtists?.join(", ");
  const album = metadata?.album;
  const genres = metadata?.genres?.join(", ");
  const year = metadata?.year ? String(metadata.year) : metadata?.date;
  const facts = [
    artist ? { label: t("gallery.trackArtist"), value: artist } : undefined,
    album ? { label: t("gallery.trackAlbum"), value: album } : undefined,
    genres ? { label: t("gallery.trackGenre"), value: genres } : undefined,
    year ? { label: t("gallery.trackYear"), value: year } : undefined,
    { label: t("gallery.trackDuration"), value: formatDuration(track.durationSec) },
  ].filter((fact): fact is { label: string; value: string } => !!fact);

  return (
    <section className="flex flex-col gap-3">
      <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-secondary">
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <Disc3Icon className="text-muted-foreground" size={48} />
        )}
      </div>
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
              <dd className="truncate text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
