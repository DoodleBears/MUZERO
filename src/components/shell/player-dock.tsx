import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { DjChatEntry } from "@/components/chat/dj-chat-entry";
import type { Tab } from "@/components/nav/dock-nav";
import { NavFab } from "@/components/nav/nav-fab";
import { DockControls } from "@/components/player/dock-controls";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { QueuePanel } from "@/components/player/queue-panel";
import { TrackIdentityRow } from "@/components/player/track-identity-row";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Drawer, DrawerHeader, DrawerPopup, DrawerTitle } from "@/components/ui/drawer";
import { MessageCircleMoreIcon } from "@/components/ui/message-circle-more";
import { db } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * The unified bottom player-dock: a slim tool row floats above the dock card
 * for context/navigation; the card itself keeps track identity + transport and
 * the full-width scrubber. The up-next queue opens from here as a swipe-up
 * Drawer on every screen size (wide + narrow), freeing the desktop right rail
 * to show lyrics by default.
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
  const queueOpen = useUiStore((s) => s.queueOpen);
  const setQueueOpen = useUiStore((s) => s.setQueueOpen);

  return (
    <>
      <div
        className={cn(
          "pointer-events-none fixed bottom-0 left-1/2 z-30 w-fit max-w-[calc(100vw-1.5rem)] -translate-x-1/2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-opacity duration-500",
          hidden && "pointer-events-none opacity-0",
        )}
      >
        <div className="mx-auto flex w-[min(calc(100vw-1.5rem),46rem)] min-w-0 flex-col gap-2">
          <div
            // Full-width so the chat entry can fill the space left of the
            // memory/nav icons; pointer-events stay on the CHILDREN so any
            // empty stretch of this band remains click-through.
            className="flex w-full min-w-0 items-center justify-end gap-2 px-4"
          >
            <DjChatEntry className={cn(!hidden && "pointer-events-auto")} />
            <DockMemoryToggle
              className={cn("hidden md:flex", !hidden && "pointer-events-auto")}
              visible={tab === "now"}
            />
            <div className={cn("shrink-0", !hidden && "pointer-events-auto")}>
              <NavFab value={tab} onChange={onTabChange} />
            </div>
          </div>
          <div
            className={cn(
              "flex w-full min-w-0 flex-col gap-2.5 rounded-3xl bg-card/93 p-3 shadow-lg backdrop-blur-md",
              !hidden && "pointer-events-auto",
            )}
          >
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

      <Drawer open={queueOpen} onOpenChange={setQueueOpen}>
        <DrawerPopup showBar className="mx-auto sm:max-w-2xl">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{t("nowPlaying.upNext")}</DrawerTitle>
          </DrawerHeader>
          <div className="h-[68dvh] min-h-0 pb-[env(safe-area-inset-bottom)]">
            <QueuePanel />
          </div>
        </DrawerPopup>
      </Drawer>
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
  // Collapsed → memories shown, button returns to lyrics; expanded → lyrics
  // shown, button switches to the memory timeline.
  const label = collapsed ? t("dock.lyrics") : t("dock.memory");
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
