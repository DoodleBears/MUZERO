import { useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { useSession } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

type PanelTab = "queue" | "lyrics";

/**
 * The Now-Playing right rail, YouTube-Music style: tabs for the up-next queue
 * and the current track's lyrics, with a "playing from <set>" source header.
 */
export function NowPlayingPanel({ className }: { className?: string } = {}) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const session = useSession(activeSessionId);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const [tab, setTab] = useState<PanelTab>("queue");

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "queue", label: t("nowPlaying.upNext") },
    { id: "lyrics", label: t("nowPlaying.lyrics") },
  ];

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col rounded-2xl rounded-b-none bg-card/80 shadow-sm dark:bg-card/85",
        className,
      )}
    >
      <div className="flex shrink-0 gap-1 px-2">
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
    </div>
  );
}
