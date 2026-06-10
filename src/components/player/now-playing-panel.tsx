import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import {
  MemoryTimelineRail,
  type MemoryTimelineRailItem,
} from "@/components/player/memory-timeline-rail";
import { SyncedLyricsView } from "@/components/player/synced-lyrics-view";
import { Disc3Icon } from "@/components/ui/disc-3";
import { MessageCircleMoreIcon } from "@/components/ui/message-circle-more";
import { db } from "@/db/muzero-db";
import { getMemoryPhoto, saveSettings } from "@/db/repositories";
import type { Memory } from "@/db/types";
import { useSession, useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type PanelTab = "queue" | "lyrics";

const PANEL_CONTENT_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * The Now-Playing right rail, YouTube-Music style: tabs for the up-next queue
 * and the current track's lyrics, with a "playing from <set>" source header.
 */
export function NowPlayingPanel({
  className,
  collapsible = true,
  showFloatingToggle = true,
}: {
  className?: string;
  collapsible?: boolean;
  showFloatingToggle?: boolean;
} = {}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const session = useSession(activeSessionId);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const [tab, setTab] = useState<PanelTab>("queue");
  const collapsed = collapsible && Boolean(settings.nowPlayingRightRailCollapsed);
  const currentTrackId = current?.id;
  const railMemories = useLiveQuery(
    (): Promise<Memory[]> =>
      currentTrackId
        ? db.memories.where("trackId").equals(currentTrackId).sortBy("createdAt")
        : Promise.resolve([] as Memory[]),
    [currentTrackId],
    [] as Memory[],
  );
  const [memoryPhotoUrls, setMemoryPhotoUrls] = useState<Record<string, string>>({});
  const memoryTimelineItems = useMemo<MemoryTimelineRailItem[]>(
    () =>
      railMemories.map((memory) => ({
        ...memory,
        photoUrl: memoryPhotoUrls[memory.id],
      })),
    [memoryPhotoUrls, railMemories],
  );
  const memoryDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
      }),
    [],
  );

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "queue", label: t("nowPlaying.upNext") },
    { id: "lyrics", label: t("nowPlaying.lyrics") },
  ];
  const canShowMemoryRail = memoryTimelineItems.length > 0;
  const toggleLabel = collapsed ? t("dock.playlist") : t("dock.memory");
  const ToggleIcon = collapsed ? Disc3Icon : MessageCircleMoreIcon;

  function setCollapsed(next: boolean) {
    void saveSettings({ nowPlayingRightRailCollapsed: next });
  }

  function setMemoryRailScrollTop(nextScrollTop: number) {
    const scrollTop = Math.max(0, Math.round(nextScrollTop));
    if (scrollTop === (settings.nowPlayingMemoryRailScrollTop ?? 0)) return;
    void saveSettings({ nowPlayingMemoryRailScrollTop: scrollTop });
  }

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    async function loadPhotoUrls() {
      if (!collapsed || typeof URL.createObjectURL !== "function") {
        setMemoryPhotoUrls({});
        return;
      }

      const next: Record<string, string> = {};
      for (const memory of railMemories) {
        if (!memory.photoBlobId) continue;
        const blob = await getMemoryPhoto(memory, db);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        urls.push(url);
        next[memory.id] = url;
      }
      if (!cancelled) setMemoryPhotoUrls(next);
    }

    void loadPhotoUrls();

    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [collapsed, railMemories]);

  return (
    <div
      className={cn("relative h-full min-h-0 overflow-hidden", className)}
      data-state={collapsed ? "collapsed" : "expanded"}
      data-testid="now-playing-panel"
    >
      <AnimatePresence initial={false} mode="wait">
        {collapsed ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            // Full-height surface, matching the left column. The rail's own
            // carousel/list pad themselves with the chrome insets so content
            // sits below the header and clears the bottom dock — giving the
            // masonry the full height to scroll instead of a clipped band.
            className="flex h-full min-h-0 flex-col"
            exit={{ opacity: 0, y: 12 }}
            initial={{ opacity: 0, y: 12 }}
            key="collapsed"
            transition={PANEL_CONTENT_TRANSITION}
          >
            <MemoryTimelineRail
              className="min-h-0 flex-1"
              formatCreatedAt={(createdAt) => memoryDateFormatter.format(createdAt)}
              initialOffset={settings.nowPlayingMemoryRailScrollTop ?? 0}
              labels={{
                empty: t("annotation.memoryEmpty"),
                memory: t("annotation.memory"),
              }}
              memories={memoryTimelineItems}
              onOffsetChange={setMemoryRailScrollTop}
            />
          </motion.div>
        ) : (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mt-chrome-top flex h-[calc(100%-var(--spacing-chrome-top))] min-h-0 flex-col overflow-hidden rounded-2xl rounded-b-none bg-muted/50 shadow-sm backdrop-blur-sm dark:bg-card/85"
            exit={{ opacity: 0, y: 12 }}
            initial={{ opacity: 0, y: 12 }}
            key="expanded"
            transition={PANEL_CONTENT_TRANSITION}
          >
            <div className="flex shrink-0 items-stretch gap-1 px-2">
              {tabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative px-3 py-3 text-sm font-medium transition-colors",
                    tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {tab === id && (
                    <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            {tab === "queue" ? (
              <>
                {session && (
                  <div className="shrink-0 px-4 pt-3">
                    <div className="text-xs text-muted-foreground">
                      {t("nowPlaying.playingFrom")}
                    </div>
                    <div className="truncate text-sm font-semibold">{session.name}</div>
                  </div>
                )}
                <div className="min-h-0 flex-1 px-2 py-2">
                  <VirtualTrackList
                    tracks={queue}
                    emptyHint={t("queue.empty")}
                    // Bottom fade only (under the dock). No top fade: the list sits below
                    // the tabs/source — not under the header — so a top fade would just
                    // dim the first row when scrolled to the top.
                    className="pb-chrome-bottom no-scrollbar"
                  />
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-hidden px-4 pt-3 pb-chrome-bottom">
                <SyncedLyricsView track={current} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {showFloatingToggle && collapsible && (collapsed || canShowMemoryRail) && (
        <button
          aria-label={toggleLabel}
          className="absolute right-4 bottom-[calc(var(--spacing-chrome-bottom)+1rem)] z-20 flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-4 py-2 font-medium text-sm shadow-lg backdrop-blur-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="now-playing-panel-floating-toggle"
          onClick={() => setCollapsed(!collapsed)}
          type="button"
        >
          <ToggleIcon aria-hidden="true" className="text-muted-foreground" size={16} />
          <span>{toggleLabel}</span>
        </button>
      )}
    </div>
  );
}
