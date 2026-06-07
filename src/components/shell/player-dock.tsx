import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Tab } from "@/components/nav/dock-nav";
import { NavFab } from "@/components/nav/nav-fab";
import { DockControls } from "@/components/player/dock-controls";
import { NowPlayingPanel } from "@/components/player/now-playing-panel";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { TrackIdentityRow } from "@/components/player/track-identity-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The unified bottom player-dock: row 1 is track identity + controls/play,
 * row 2 is the full-width scrubber. Page navigation lives as a separate FAB:
 * above the dock on small screens, to the right on desktop.
 */
export function PlayerDock({
  tab,
  onTabChange,
  onOpenNowPlaying,
  hidden = false,
}: {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenNowPlaying: () => void;
  /** Fade the dock out (immersive idle). */
  hidden?: boolean;
}) {
  const { t } = useTranslation();
  const [queueOpen, setQueueOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(0);

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    const updateDockHeight = () => {
      setDockHeight(dock.getBoundingClientRect().height);
    };

    updateDockHeight();
    const resizeObserver = new ResizeObserver(updateDockHeight);
    resizeObserver.observe(dock);
    window.addEventListener("resize", updateDockHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateDockHeight);
    };
  }, []);

  return (
    <>
      <div
        ref={dockRef}
        className={cn(
          "fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-opacity duration-500",
          hidden && "pointer-events-none opacity-0",
        )}
      >
        <div className="mx-auto flex max-w-2xl flex-col items-end gap-2 md:flex-row md:items-center">
          <div className="flex w-full min-w-0 flex-col gap-2.5 rounded-3xl bg-card/90 p-3 shadow-lg md:flex-1">
            <TrackIdentityRow
              onOpen={onOpenNowPlaying}
              controls={<DockControls className="flex" onOpenQueue={() => setQueueOpen(true)} />}
            />
            <div className="px-0.5">
              <ProgressScrubber />
            </div>
          </div>
          <div className="order-first shrink-0 md:order-none">
            <NavFab value={tab} onChange={onTabChange} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {queueOpen && (
          <motion.div
            role="dialog"
            aria-label={t("nowPlaying.upNext")}
            className="fixed inset-0 z-40 xl:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <button
              type="button"
              aria-label={t("nowPlaying.closeQueue")}
              onClick={() => setQueueOpen(false)}
              className="absolute inset-0 bg-transparent"
            />
            <motion.div
              className="absolute inset-x-3 top-[calc(3.5rem+env(safe-area-inset-top))] overflow-hidden"
              style={{ bottom: `calc(${dockHeight}px + 0.5rem)` }}
              initial={{ y: 18, scale: 0.985 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 18, scale: 0.985 }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
            >
              <div className="relative mx-auto h-full max-w-2xl overflow-hidden rounded-3xl border bg-card/95 shadow-2xl backdrop-blur-md">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setQueueOpen(false)}
                  aria-label={t("nowPlaying.closeQueue")}
                  className="absolute top-2 right-2 z-10 size-9 rounded-full text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X />
                </Button>
                <NowPlayingPanel
                  className="rounded-b-3xl [&>div:first-child]:pr-11"
                  collapsible={false}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
