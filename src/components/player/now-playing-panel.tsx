import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const PANEL_CONTENT_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * The Now-Playing right rail (desktop): lyrics-first by default — the current
 * track's time-synced lyrics, or an inline LRCLIB search when there are none.
 * The up-next queue now lives in the Dock drawer; this rail toggles between
 * lyrics and the track's memory timeline ("music carries memories").
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
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
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

  // Collapsed shows memories → toggle back to lyrics; expanded shows lyrics →
  // toggle to the memory timeline.
  const toggleLabel = collapsed ? t("dock.lyrics") : t("dock.memory");
  const ToggleIcon = collapsed ? Disc3Icon : MessageCircleMoreIcon;

  function setCollapsed(next: boolean) {
    void saveSettings({ lyricsStageOpen: !next, nowPlayingRightRailCollapsed: next });
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
            className="mt-chrome-top flex h-[calc(100%-var(--spacing-chrome-top))] min-h-0 flex-col overflow-hidden px-4 pt-4 pb-chrome-bottom"
            data-testid="lyrics-rail"
            exit={{ opacity: 0, y: 12 }}
            initial={{ opacity: 0, y: 12 }}
            key="expanded"
            transition={PANEL_CONTENT_TRANSITION}
          >
            <SyncedLyricsView track={current} />
          </motion.div>
        )}
      </AnimatePresence>
      {showFloatingToggle && collapsible && (
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
