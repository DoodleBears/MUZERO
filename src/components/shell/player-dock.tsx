import { useLiveQuery } from "dexie-react-hooks";
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
import { Disc3Icon } from "@/components/ui/disc-3";
import { MessageCircleMoreIcon } from "@/components/ui/message-circle-more";
import { db } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/**
 * The unified bottom player-dock: a slim tool row floats above the dock card
 * for context/navigation; the card itself keeps track identity + transport and
 * the full-width scrubber.
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
          "pointer-events-none fixed bottom-0 left-1/2 z-30 w-fit max-w-[calc(100vw-1.5rem)] -translate-x-1/2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-opacity duration-500",
          hidden && "pointer-events-none opacity-0",
        )}
      >
        <div
          className={cn(
            "mx-auto flex w-[min(calc(100vw-1.5rem),46rem)] min-w-0 flex-col gap-2",
            !hidden && "pointer-events-auto",
          )}
        >
          <div className="flex min-w-0 items-center justify-end gap-2 px-4">
            <DockMemoryToggle className="hidden md:flex" visible={tab === "now"} />
            <div className="shrink-0">
              <NavFab value={tab} onChange={onTabChange} />
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2.5 rounded-3xl bg-card/93 p-3 shadow-lg backdrop-blur-md">
            <div className="flex min-w-0 items-center gap-2">
              <TrackIdentityRow
                className="min-w-0 flex-1"
                onOpen={onOpenNowPlaying}
                controls={<DockControls className="flex" onOpenQueue={() => setQueueOpen(true)} />}
              />
            </div>
            <div className="px-0.5">
              <ProgressScrubber />
            </div>
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

function DockMemoryToggle({ className, visible }: { className?: string; visible: boolean }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const currentTrackId = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
  );
  const memoryCount = useLiveQuery(
    (): Promise<number> =>
      currentTrackId
        ? db.memories.where("trackId").equals(currentTrackId).count()
        : Promise.resolve(0),
    [currentTrackId],
    0,
  );
  const collapsed = Boolean(settings.nowPlayingRightRailCollapsed);
  const canShowMemoryRail = (memoryCount ?? 0) > 0;
  const label = collapsed ? t("dock.playlist") : t("dock.memory");
  const Icon = collapsed ? Disc3Icon : MessageCircleMoreIcon;

  if (!visible || (!collapsed && !canShowMemoryRail)) return null;

  return (
    <button
      aria-label={label}
      className={cn(
        "h-11 w-fit shrink-0 items-center justify-start gap-2 rounded-full bg-card/90 px-4 text-primary shadow-lg ring-1 ring-border/40 outline-none backdrop-blur-md transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      data-testid="dock-memory-toggle"
      onClick={() => void saveSettings({ nowPlayingRightRailCollapsed: !collapsed })}
      type="button"
    >
      <Icon aria-hidden="true" size={20} />
      <span className="max-[380px]:hidden whitespace-nowrap text-[15px] font-medium">{label}</span>
    </button>
  );
}
