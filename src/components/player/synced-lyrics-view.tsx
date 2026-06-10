import { useLiveQuery } from "dexie-react-hooks";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LyricsSearchPanel } from "@/components/player/lyrics-search-panel";
import { db } from "@/db/muzero-db";
import { getTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { activeLineIndex, type LyricsLine } from "@/lyrics/parse-lrc";
import { type ResolvedLyrics, resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";

type ShownLyrics = Extract<ResolvedLyrics, { mode: "synced" } | { mode: "plain" }>;

/**
 * Track the active synced-lyric line at frame rate. A rAF loop reads the media
 * engine's currentTime directly (not the store's ~4Hz position) so the highlight
 * switches on the exact beat — the Apple-Music feel. It re-renders only when the
 * line index actually changes (rule 6: no per-frame tree re-render), runs only
 * while playing + tab-visible, and re-syncs once on pause/seek. Returns -1 when
 * there's no active line (before the first lyric or with no lyrics).
 */
export function useActiveLyricLine(
  lines: LyricsLine[] | null,
  isPlaying: boolean,
  // Observed only while paused (-1 while playing) so a paused seek re-syncs the
  // highlight without subscribing to the 4Hz position during playback.
  pausedPositionSec: number,
): number {
  const [active, setActive] = useState(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pausedPositionSec is an intentional re-sync trigger (time is read from the engine, not the dep)
  useEffect(() => {
    if (!lines || lines.length === 0) {
      setActive(-1);
      return;
    }
    const sync = () => {
      const ms = (getMediaEngine()?.getCurrentTime() ?? 0) * 1000;
      const next = activeLineIndex(lines, ms);
      setActive((prev) => (prev === next ? prev : next));
    };
    sync(); // initial / paused-seek (re-runs via pausedPositionSec dep)
    if (!isPlaying) return; // paused: the single sync above is enough

    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      sync();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        sync();
        start();
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lines, isPlaying, pausedPositionSec]);

  return active;
}

/**
 * The Now-Playing lyrics surface. Renders the single arbiter's verdict:
 * time-synced karaoke lines (Apple-Music style — active line emphasized + the
 * list spring-scrolls to keep it centered, click-to-seek), plain text, an
 * instrumental / fetching message, or — when there are no lyrics — an inline
 * LRCLIB search panel so the empty state IS the way to find them.
 */
export function SyncedLyricsView({ track }: { track?: Track }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const trackId = track?.id;
  const row = useLiveQuery(
    () => (trackId ? getTrackLyrics(trackId, db) : Promise.resolve(undefined)),
    [trackId],
    undefined,
  );
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const pausedPositionSec = usePlayerStore((s) => (s.isPlaying ? -1 : s.positionSec));
  const seek = usePlayerStore((s) => s.seek);
  const resolved = useMemo(() => resolveTrackLyrics(track, row), [track, row]);
  const lines = resolved.mode === "synced" ? resolved.lines : null;
  const activeIndex = useActiveLyricLine(lines, isPlaying, pausedPositionSec);

  const [searchOpen, setSearchOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the search panel when the track changes
  useEffect(() => setSearchOpen(false), [trackId]);

  if (searchOpen && track) {
    return (
      <LyricsSearchPanel
        track={track}
        onCancel={() => setSearchOpen(false)}
        onPicked={() => setSearchOpen(false)}
      />
    );
  }
  if (resolved.mode === "instrumental") {
    return <LyricsMessage>{t("lyrics.instrumental")}</LyricsMessage>;
  }
  if (resolved.mode === "none") {
    if (!track) return <LyricsMessage>{t("nowPlaying.noLyrics")}</LyricsMessage>;
    const fetching = track.origin !== "generated" && (settings.autoFetchLyrics ?? true) && !row;
    if (fetching) return <LyricsMessage>{t("lyrics.fetching")}</LyricsMessage>;
    return <LyricsSearchPanel track={track} />;
  }
  return (
    <LyricsScroller
      resolved={resolved}
      activeIndex={activeIndex}
      onSeek={seek}
      onSearch={track ? () => setSearchOpen(true) : undefined}
    />
  );
}

function LyricsMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-center text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

/** Presentational lyrics body — pure props, no store/db/rAF (unit-tested). */
export function LyricsScroller({
  resolved,
  activeIndex,
  onSeek,
  onSearch,
}: {
  resolved: ShownLyrics;
  activeIndex: number;
  onSeek: (sec: number) => void;
  onSearch?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {resolved.mode === "plain" ? (
          <div className="no-scrollbar h-full overflow-y-auto">
            <pre className="whitespace-pre-wrap font-sans text-foreground/90 text-sm leading-relaxed">
              {resolved.text}
            </pre>
          </div>
        ) : (
          <SyncedLines lines={resolved.lines} activeIndex={activeIndex} onSeek={onSeek} />
        )}
      </div>
      <LyricsFooter source={resolved.source} onSearch={onSearch} />
    </div>
  );
}

const EDGE_FADE = {
  maskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
} as const;

/**
 * Apple-Music-style synced lines: the whole stack spring-translates so the
 * active line stays ~40% down the viewport, while each line eases its
 * opacity/scale by distance from the active one. Re-renders only when the active
 * index changes (the rAF in useActiveLyricLine gates that), so motion animates
 * off the React path.
 */
function SyncedLines({
  lines,
  activeIndex,
  onSeek,
}: {
  lines: LyricsLine[];
  activeIndex: number;
  onSeek: (sec: number) => void;
}) {
  const reduce = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [offsetY, setOffsetY] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the anchor when the lyric lines change
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (activeIndex < 0) {
      setOffsetY(0);
      return;
    }
    const el = lineRefs.current[activeIndex];
    if (!el) return;
    // Anchor the active line ~40% down the viewport.
    setOffsetY(viewport.clientHeight * 0.4 - (el.offsetTop + el.offsetHeight / 2));
  }, [activeIndex, lines]);

  return (
    <div ref={viewportRef} className="relative h-full overflow-hidden" style={EDGE_FADE}>
      <motion.div
        animate={{ y: offsetY }}
        transition={
          reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 36, mass: 0.7 }
        }
        className="flex flex-col gap-1 will-change-transform"
      >
        {lines.map((line, i) => {
          const isActive = i === activeIndex;
          const dist = activeIndex < 0 ? i : Math.abs(i - activeIndex);
          return (
            <motion.button
              // biome-ignore lint/suspicious/noArrayIndexKey: lyric lines have no stable id; time+index is the natural key
              key={`${line.timeMs}-${i}`}
              ref={(node) => {
                lineRefs.current[i] = node;
              }}
              type="button"
              data-active={isActive || undefined}
              aria-current={isActive ? "true" : undefined}
              onClick={() => onSeek(line.timeMs / 1000)}
              animate={
                reduce
                  ? { opacity: isActive ? 1 : 0.4 }
                  : {
                      opacity: isActive ? 1 : Math.max(0.22, 0.55 - dist * 0.09),
                      scale: isActive ? 1 : 0.96,
                    }
              }
              transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
              style={{ transformOrigin: "left center" }}
              className={cn(
                "block w-full rounded-lg px-3 py-2 text-left font-bold text-2xl leading-snug text-foreground transition-colors",
                isActive ? "text-foreground" : "hover:text-foreground/70",
              )}
            >
              {line.text || "♪"}
            </motion.button>
          );
        })}
      </motion.div>
    </div>
  );
}

/** LRCLIB attribution + a "wrong lyrics? search" affordance. */
function LyricsFooter({
  source,
  onSearch,
}: {
  source: ShownLyrics["source"];
  onSearch?: () => void;
}) {
  const { t } = useTranslation();
  const hasSource = source === "lrclib";
  if (!hasSource && !onSearch) return null;
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 px-1 pt-2 pb-1">
      <span className="text-[11px] text-muted-foreground/70">
        {hasSource ? t("lyrics.source", { source: "LRCLIB" }) : ""}
      </span>
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("lyrics.wrongLyrics")}
        </button>
      )}
    </div>
  );
}
