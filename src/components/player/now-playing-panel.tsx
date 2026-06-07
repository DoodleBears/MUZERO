import { useLiveQuery } from "dexie-react-hooks";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import {
  MemoryTimelineRail,
  type MemoryTimelineRailItem,
} from "@/components/player/memory-timeline-rail";
import { db } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import type { Memory } from "@/db/types";
import { useSession, useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type PanelTab = "queue" | "lyrics";

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
  const currentTrackTitle = current?.title;
  const railMemories = useLiveQuery(
    (): Promise<Memory[]> =>
      collapsed && currentTrackId
        ? db.memories.where("trackId").equals(currentTrackId).sortBy("createdAt")
        : Promise.resolve([] as Memory[]),
    [collapsed, currentTrackId],
    [] as Memory[],
  );
  const memoryTimelineItems = useMemo<MemoryTimelineRailItem[]>(
    () =>
      railMemories.map((memory) => ({
        ...memory,
        trackTitle: currentTrackTitle,
      })),
    [currentTrackTitle, railMemories],
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

  function setMemoryRailScrollTop(nextScrollTop: number) {
    const scrollTop = Math.max(0, Math.round(nextScrollTop));
    if (scrollTop === (settings.nowPlayingMemoryRailScrollTop ?? 0)) return;
    void saveSettings({ nowPlayingMemoryRailScrollTop: scrollTop });
  }

  if (collapsed) {
    return (
      <motion.div
        className={cn("flex h-full min-h-0 flex-col justify-end gap-3", className)}
        data-state="collapsed"
        data-testid="now-playing-panel"
        layout
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
        <motion.div
          className="shrink-0 rounded-2xl bg-muted/50 p-2 shadow-sm backdrop-blur-sm dark:bg-card/85"
          layout
          transition={{ type: "spring", stiffness: 360, damping: 34, mass: 0.8 }}
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
                <span className="block truncate text-muted-foreground text-xs">{session.name}</span>
              )}
            </span>
            <PanelRightOpen aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl rounded-b-none bg-card/80 shadow-sm dark:bg-card/85",
        className,
      )}
      data-state="expanded"
      data-testid="now-playing-panel"
      layout
    >
      <div className="flex shrink-0 items-center gap-1 px-2">
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
            className="ml-auto grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setCollapsed(true)}
            type="button"
          >
            <PanelRightClose aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>

      {tab === "queue" ? (
        <>
          {session && (
            <div className="shrink-0 px-4 pt-3">
              <div className="text-xs text-muted-foreground">{t("nowPlaying.playingFrom")}</div>
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
  );
}
