import { useLiveQuery } from "dexie-react-hooks";
import { PanelBottomClose, PanelBottomOpen } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import {
  MemoryTimelineRail,
  type MemoryTimelineRailItem,
} from "@/components/player/memory-timeline-rail";
import { db } from "@/db/muzero-db";
import { getMemoryPhoto, saveSettings } from "@/db/repositories";
import type { Memory } from "@/db/types";
import { useSession, useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type PanelTab = "queue" | "lyrics";

const PANEL_CONTENT_TRANSITION = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const;
const PANEL_BOUNDARY_TRANSITION_LOCK_MS = 650;

/**
 * The Now-Playing right rail, YouTube-Music style: tabs for the up-next queue
 * and the current track's lyrics, with a "playing from <set>" source header.
 */
export function NowPlayingPanel({
  className,
  collapsible = true,
}: {
  className?: string;
  collapsible?: boolean;
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
  const boundaryTransitionLockUntilRef = useRef(0);
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

  function setCollapsed(next: boolean) {
    void saveSettings({ nowPlayingRightRailCollapsed: next });
  }

  function setCollapsedFromBoundaryPull(next: boolean) {
    if (next && memoryTimelineItems.length === 0) return;
    const now = Date.now();
    if (now < boundaryTransitionLockUntilRef.current) return;
    boundaryTransitionLockUntilRef.current = now + PANEL_BOUNDARY_TRANSITION_LOCK_MS;
    setCollapsed(next);
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
      className={cn("h-full min-h-0 overflow-hidden", className)}
      data-state={collapsed ? "collapsed" : "expanded"}
      data-testid="now-playing-panel"
    >
      <AnimatePresence initial={false} mode="wait">
        {collapsed ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex h-full min-h-0 flex-col justify-end gap-3"
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
              onPullPastEnd={() => setCollapsedFromBoundaryPull(false)}
              onPullPastStart={() => setCollapsedFromBoundaryPull(false)}
            />
            <div
              className="shrink-0 rounded-t-2xl rounded-b-none bg-muted/50 p-2 shadow-sm backdrop-blur-sm dark:bg-card/85"
              data-testid="now-playing-panel-compact-header"
            >
              <button
                aria-expanded={false}
                aria-label={t("nowPlaying.upNext")}
                className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-background/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setCollapsed(false)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{t("nowPlaying.upNext")}</span>
                  {session && (
                    <span className="block truncate text-muted-foreground text-xs">
                      {session.name}
                    </span>
                  )}
                </span>
                <PanelBottomOpen
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
            </div>
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
              {collapsible && (
                <button
                  aria-expanded
                  aria-label={t("nowPlaying.closeQueue")}
                  className="relative ml-auto flex min-w-11 flex-1 items-center justify-end px-3 text-muted-foreground transition-colors before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-2 before:rounded-xl before:transition-colors hover:text-foreground hover:before:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setCollapsed(true)}
                  type="button"
                >
                  <PanelBottomClose aria-hidden="true" className="relative size-4" />
                </button>
              )}
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
                    onPullPastStart={() => setCollapsedFromBoundaryPull(true)}
                    // Bottom fade only (under the dock). No top fade: the list sits below
                    // the tabs/source — not under the header — so a top fade would just
                    // dim the first row when scrolled to the top.
                    className="pb-chrome-bottom no-scrollbar"
                  />
                </div>
              </>
            ) : (
              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-chrome-bottom">
                {current?.brief?.lyrics ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
                    {current.brief.lyrics}
                  </pre>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {t("nowPlaying.noLyrics")}
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
