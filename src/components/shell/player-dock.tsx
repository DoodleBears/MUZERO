import { useTranslation } from "react-i18next";
import { DjChatEntry } from "@/components/chat/dj-chat-entry";
import type { Tab } from "@/components/nav/dock-nav";
import { NavFab } from "@/components/nav/nav-fab";
import { DockControls } from "@/components/player/dock-controls";
import { ProgressScrubber } from "@/components/player/progress-scrubber";
import { QueuePanel } from "@/components/player/queue-panel";
import { TrackIdentityRow } from "@/components/player/track-identity-row";
import { Drawer, DrawerHeader, DrawerPopup, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
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
            <DjChatEntry
              className={cn(!hidden && "pointer-events-auto")}
              onUploadLibrary={() => onTabChange("search")}
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
                transportHintScope={tab === "now" ? "now" : undefined}
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
