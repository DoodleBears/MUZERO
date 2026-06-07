import { Disc3, Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { CoverImage } from "@/components/player/cover-image";
import { Button } from "@/components/ui/button";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { trackSubtitle } from "@/lib/track-display";
import { transitionState } from "@/lib/view-transition-react";
import { usePlayerStore } from "@/stores/player-store";
import { CurrentTrackContextMenu } from "./track-context-menu";

/**
 * Row 1 of the player-dock: cover + title/artist + the single play/pause button.
 * Subscribes via a narrow `useShallow` selector to only the current track's
 * *display* scalars — so editing any track (like, tags, cover of another song),
 * which rebuilds the queue array, never re-renders this row or re-fires the
 * shared `now-cover` layout animation.
 */
export function TrackIdentityRow({
  onOpen,
  controls,
}: {
  onOpen?: () => void;
  controls?: ReactNode;
}) {
  const { t } = useTranslation();
  const track = usePlayerStore(
    useShallow((s) => {
      const c = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      if (!c) return null;
      const crop = c.coverCrop;
      return {
        id: c.id,
        title: c.title,
        subtitle: trackSubtitle(c),
        coverBlobId: c.coverBlobId,
        cropX: crop?.x,
        cropY: crop?.y,
        cropW: crop?.width,
        cropH: crop?.height,
      };
    }),
  );
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);

  // Reassemble the minimal cover descriptor (stable while the scalars are).
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on scalars, not the picked object, to keep this stable
  const coverInput = useMemo<Pick<Track, "coverBlobId" | "coverCrop"> | undefined>(
    () =>
      track
        ? {
            coverBlobId: track.coverBlobId,
            coverCrop:
              track.cropW != null
                ? {
                    x: track.cropX ?? 0,
                    y: track.cropY ?? 0,
                    width: track.cropW,
                    height: track.cropH ?? 0,
                  }
                : undefined,
          }
        : undefined,
    [track?.coverBlobId, track?.cropX, track?.cropY, track?.cropW, track?.cropH],
  );
  const coverUrl = useTrackCoverUrl(coverInput);

  // Dock identity always navigates to the Now Playing tab, including mobile.
  function handleOpen() {
    if (!track) return;
    if (onOpen) transitionState(onOpen);
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <CurrentTrackContextMenu className="min-w-0 flex-1">
        <button
          type="button"
          onClick={handleOpen}
          disabled={!track}
          aria-label={t("nav.now")}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default sm:gap-3"
        >
          <motion.span
            layoutId="now-cover"
            className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary"
          >
            {/* Crossfades to the next cover only once it has decoded (no flash). */}
            <CoverImage
              url={coverUrl}
              hasCover={!!track?.coverBlobId}
              fallback={<Disc3 className="size-5 text-muted-foreground" />}
            />
          </motion.span>
          <span className="relative min-w-0 flex-1">
            {/* Slide + fade the title/artist on track change. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={track?.id ?? "none"}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="block min-w-0"
              >
                <span className="block truncate text-sm font-semibold">
                  {track?.title ?? "MUZERO"}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {track ? track.subtitle : t("app.pressPlay")}
                </span>
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
      </CurrentTrackContextMenu>
      {controls && <div className="shrink-0">{controls}</div>}
      <Button
        size="icon-lg"
        onClick={togglePlay}
        aria-label={isPlaying ? t("player.pause") : t("player.play")}
        className="shrink-0 rounded-full"
      >
        {isPlaying ? <Pause /> : <Play />}
      </Button>
    </div>
  );
}
