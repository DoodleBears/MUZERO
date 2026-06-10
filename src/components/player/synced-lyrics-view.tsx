import { useLiveQuery } from "dexie-react-hooks";
import { LocateFixed } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LyricsSearchPanel } from "@/components/player/lyrics-search-panel";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
import { db } from "@/db/muzero-db";
import { getTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { DEFAULT_LYRIC_STYLE, type LyricStyle, resolveLyricStyle } from "@/lyrics/lyric-style";
import { activeLineIndex, type LyricsLine } from "@/lyrics/parse-lrc";
import { type ResolvedLyrics, resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

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
  const coverColorCss = useVisualizerCoverColorCss();
  const lyricStyle = useMemo(
    () => resolveLyricStyle(settings, coverColorCss),
    [settings, coverColorCss],
  );
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
        defaultOpen
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
      lyricStyle={lyricStyle}
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
  lyricStyle = DEFAULT_LYRIC_STYLE,
}: {
  resolved: ShownLyrics;
  activeIndex: number;
  onSeek: (sec: number) => void;
  onSearch?: () => void;
  lyricStyle?: LyricStyle;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* `relative` + an absolutely-filled scroll child guarantees a definite
          pixel height (a plain h-full chain through nested flex can collapse and
          kill scrolling). */}
      <div className="relative min-h-0 flex-1">
        {resolved.mode === "plain" ? (
          <div className="no-scrollbar absolute inset-0 overflow-y-auto">
            <pre
              className="whitespace-pre-wrap font-sans leading-relaxed"
              style={{
                color: lyricStyle.color,
                opacity: lyricStyle.activeOpacity,
                fontSize: lyricStyle.inactiveFontSize,
                textAlign: lyricStyle.align,
              }}
            >
              {resolved.text}
            </pre>
          </div>
        ) : (
          <SyncedLines
            lines={resolved.lines}
            activeIndex={activeIndex}
            onSeek={onSeek}
            lyricStyle={lyricStyle}
          />
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
 * Apple-Music-style synced lines on a NATIVE scroll viewport (overflow-y-auto +
 * overscroll-contain — so the gesture never reaches the page behind, and mobile
 * gets momentum). While "following", the active line is smooth-scrolled to ~38%
 * from the top (the browser owns the easing); a user scroll/wheel/touch detaches
 * into free scrolling, and the floating button (or tapping a line) re-attaches.
 * Top/bottom padding gives any line headroom to reach the anchor; the per-line
 * size/opacity transitions are motion-driven.
 */
function SyncedLines({
  lines,
  activeIndex,
  onSeek,
  lyricStyle,
}: {
  lines: LyricsLine[];
  activeIndex: number;
  onSeek: (sec: number) => void;
  lyricStyle: LyricStyle;
}) {
  const { t } = useTranslation();
  const reduce = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [following, setFollowing] = useState(true);
  const [viewportH, setViewportH] = useState(0);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const measure = () => setViewportH(vp.clientHeight);
    measure();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(measure);
      ro.observe(vp);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // A new song re-attaches follow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset follow when the lyric set changes
  useEffect(() => setFollowing(true), [lines]);

  // Follow via a rAF that lerps scrollTop toward the active line's ~38% anchor
  // every frame. It reads activeRef LIVE (not a React effect keyed on
  // activeIndex), so it shares the highlight's cadence and can never desync or
  // miss an update — that's what makes auto-scroll actually reliable. Runs only
  // while following; a user wheel/touch detaches it.
  useEffect(() => {
    if (!following) return;
    let raf = 0;
    let stopped = false;
    const ease = reduce ? 1 : 0.16;
    const tick = () => {
      if (stopped) return;
      const vp = viewportRef.current;
      const el = activeRef.current;
      if (vp && el) {
        // Rect-based (immune to offsetParent): where the active line's center
        // currently sits relative to the viewport top, converted to an absolute
        // scrollTop target at the ~38% anchor.
        const vpRect = vp.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const elCenterFromTop = elRect.top + elRect.height / 2 - vpRect.top;
        const target = Math.max(0, vp.scrollTop + elCenterFromTop - vp.clientHeight * 0.38);
        const delta = target - vp.scrollTop;
        if (Math.abs(delta) > 0.5) vp.scrollTop += delta * ease;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [following, reduce]);

  return (
    <>
      <div
        ref={viewportRef}
        data-testid="lyrics-scroll"
        className="no-scrollbar absolute inset-0 overflow-y-auto overscroll-contain"
        style={EDGE_FADE}
        onWheel={() => setFollowing(false)}
        onTouchMove={() => setFollowing(false)}
      >
        <div
          className="flex flex-col gap-1"
          style={{ paddingTop: viewportH * 0.38, paddingBottom: viewportH * 0.62 }}
        >
          {lines.map((line, i) => {
            const isActive = i === activeIndex;
            return (
              <motion.button
                // biome-ignore lint/suspicious/noArrayIndexKey: lyric lines have no stable id; time+index is the natural key
                key={`${line.timeMs}-${i}`}
                ref={isActive ? activeRef : undefined}
                type="button"
                data-active={isActive || undefined}
                aria-current={isActive ? "true" : undefined}
                onClick={() => {
                  onSeek(line.timeMs / 1000);
                  setFollowing(true);
                }}
                animate={{
                  opacity: isActive ? lyricStyle.activeOpacity : lyricStyle.inactiveOpacity,
                  fontSize: isActive ? lyricStyle.activeFontSize : lyricStyle.inactiveFontSize,
                  scale: reduce || isActive ? 1 : 0.97,
                }}
                transition={{ duration: reduce ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformOrigin: "left center", color: lyricStyle.color }}
                className={cn(
                  "block w-full rounded-lg px-3 py-2 font-bold leading-snug",
                  lyricStyle.align === "center"
                    ? "text-center"
                    : lyricStyle.align === "right"
                      ? "text-right"
                      : "text-left",
                )}
              >
                {line.text || "♪"}
              </motion.button>
            );
          })}
        </div>
      </div>
      {!following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          aria-label={t("lyrics.followCurrent")}
          className="-translate-x-1/2 absolute bottom-3 left-1/2 flex items-center gap-1.5 rounded-full border border-border/70 bg-background/85 px-3 py-1.5 font-medium text-xs shadow-lg backdrop-blur-md transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LocateFixed className="size-3.5" />
          {t("lyrics.followCurrent")}
        </button>
      )}
    </>
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
  const chromeHidden = useUiStore((s) => s.chromeHidden);
  const hasSource = source === "lrclib";
  if (chromeHidden || (!hasSource && !onSearch)) return null;
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
