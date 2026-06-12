import { useLiveQuery } from "dexie-react-hooks";
import { LocateFixed } from "lucide-react";
import { animate, motion } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LyricsSearchPanel } from "@/components/player/lyrics-search-panel";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
import { db } from "@/db/muzero-db";
import { getTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { cn } from "@/lib/utils";
import { activeWordIndex } from "@/lyrics/active-word";
import { solveLyricLayout } from "@/lyrics/lyric-layout-engine";
import {
  type LyricsMotionMode,
  lyricFollowTargetScrollTop,
  resolveLyricsMotionMode,
} from "@/lyrics/lyric-motion";
import { toLyricRenderLines } from "@/lyrics/lyric-render-line";
import { DEFAULT_LYRIC_STYLE, type LyricStyle, resolveLyricStyle } from "@/lyrics/lyric-style";
import type { LyricLine } from "@/lyrics/model";
import { activeLineIndex } from "@/lyrics/parse-lrc";
import { type ResolvedLyrics, resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { useUiStore } from "@/stores/ui-store";

type ShownLyrics = Extract<ResolvedLyrics, { mode: "synced" } | { mode: "plain" }>;
type RowElement = HTMLButtonElement | null;

/**
 * Track the active synced-lyric line at frame rate. A rAF loop reads the media
 * engine's currentTime directly (not the store's ~4Hz position) so the highlight
 * switches on the exact beat — the Apple-Music feel. It re-renders only when the
 * line index actually changes (rule 6: no per-frame tree re-render), runs only
 * while playing + tab-visible, and re-syncs once on pause/seek. Returns -1 when
 * there's no active line (before the first lyric or with no lyrics).
 */
export function useActiveLyricLine(
  lines: LyricLine[] | null,
  isPlaying: boolean,
  // Observed only while paused (-1 while playing) so a paused seek re-syncs the
  // highlight without subscribing to the 4Hz position during playback.
  pausedPositionSec: number,
): number {
  const [, setNonce] = useState(0);

  // Compute the active line DURING render from the live playback time, so a track
  // switch (new `lines`) paints the correct line on the very first frame — no
  // flash from a stale/-1 index that would make the right line "grow in".
  const activeIndex =
    lines && lines.length > 0
      ? activeLineIndex(lines, (getMediaEngine()?.getCurrentTime() ?? 0) * 1000)
      : -1;
  const lastIndexRef = useRef(activeIndex);
  lastIndexRef.current = activeIndex;

  // A rAF re-renders ONLY when the computed line changes (rule 6: not every
  // frame) while playing + visible; a paused seek re-renders via pausedPositionSec.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pausedPositionSec is an intentional paused-seek re-sync trigger
  useEffect(() => {
    if (!lines || lines.length === 0 || !isPlaying) return;
    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      const ms = (getMediaEngine()?.getCurrentTime() ?? 0) * 1000;
      if (activeLineIndex(lines, ms) !== lastIndexRef.current) setNonce((n) => n + 1);
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
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [lines, isPlaying, pausedPositionSec]);

  return activeIndex;
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
      isPlaying={isPlaying}
      wordByWord={settings.lyricsWordByWord ?? true}
      showTranslation={settings.lyricsShowTranslation ?? true}
      showRomanization={settings.lyricsShowRomanization ?? false}
      motionMode={settings.lyricsMotionMode}
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
  isPlaying = false,
  wordByWord = true,
  showTranslation = true,
  showRomanization = false,
  motionMode = "classic",
}: {
  resolved: ShownLyrics;
  activeIndex: number;
  onSeek: (sec: number) => void;
  onSearch?: () => void;
  lyricStyle?: LyricStyle;
  isPlaying?: boolean;
  wordByWord?: boolean;
  showTranslation?: boolean;
  showRomanization?: boolean;
  motionMode?: LyricsMotionMode;
}) {
  const plainScrollRef = useRef<HTMLDivElement>(null);
  useSmoothScroll(plainScrollRef);

  return (
    <div className="flex h-full flex-col">
      {/* `relative` + an absolutely-filled scroll child guarantees a definite
          pixel height (a plain h-full chain through nested flex can collapse and
          kill scrolling). */}
      <div className="relative min-h-0 flex-1">
        {resolved.mode === "plain" ? (
          <div ref={plainScrollRef} className="no-scrollbar absolute inset-0 overflow-y-auto">
            <pre
              className="whitespace-pre-wrap font-sans leading-relaxed"
              style={{
                color: lyricStyle.color,
                opacity: lyricStyle.activeOpacity,
                fontSize: lyricStyle.inactiveFontSize,
                textAlign: lyricStyle.align,
                textShadow: lyricStyle.textShadow,
                WebkitTextStroke: lyricStyle.textStroke || undefined,
                paintOrder: lyricStyle.textStroke ? "stroke fill" : undefined,
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
            isPlaying={isPlaying}
            wordByWord={wordByWord}
            showTranslation={showTranslation}
            showRomanization={showRomanization}
            motionMode={motionMode}
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
  isPlaying = false,
  wordByWord = true,
  showTranslation = true,
  showRomanization = false,
  motionMode = "classic",
}: {
  lines: LyricLine[];
  activeIndex: number;
  onSeek: (sec: number) => void;
  lyricStyle: LyricStyle;
  isPlaying?: boolean;
  wordByWord?: boolean;
  showTranslation?: boolean;
  showRomanization?: boolean;
  motionMode?: LyricsMotionMode;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<RowElement[]>([]);
  const lineHeightsRef = useRef<number[]>([]);
  const [following, setFollowing] = useState(true);
  const [viewportH, setViewportH] = useState(0);
  const lyricsMotion = useMemo(() => resolveLyricsMotionMode(motionMode), [motionMode]);
  const isAmlStyleEngine = lyricsMotion.mode === "cascade";
  const renderLines = useMemo(() => toLyricRenderLines(lines), [lines]);
  const lyricsSetKey = useMemo(() => {
    const first = lines[0];
    const last = lines[lines.length - 1];
    return `${lines.length}:${first?.timeMs ?? 0}:${first?.text ?? ""}:${last?.timeMs ?? 0}:${
      last?.text ?? ""
    }`;
  }, [lines]);
  const measurementKey = `${lyricsSetKey}:${lyricStyle.activeFontSize}:${lyricStyle.lineGap}`;
  // Karaoke fill colors: the sung part shows the full lyric color; the unsung part
  // sits at the inactive opacity (relative to active, since the whole line already
  // carries activeOpacity) so it reads like the dim lines until it's sung.
  // Fall back to `currentColor` (the inherited foreground) when no explicit lyric
  // color is set — in the default color mode `lyricStyle.color` is undefined, and
  // an "undefined" gradient stop would make `background-clip:text` paint NOTHING,
  // rendering the active line invisible (only its shadow showed). The word span
  // keeps its `color` inheriting and transparent-izes only the text FILL, so
  // `currentColor` still resolves to the real foreground.
  const sungColor = lyricStyle.color ?? "var(--color-foreground)";
  const unsungPct = Math.round(
    Math.max(0, Math.min(1, (lyricStyle.inactiveOpacity || 0) / (lyricStyle.activeOpacity || 1))) *
      100,
  );
  const unsungColor = `color-mix(in srgb, ${sungColor} ${unsungPct}%, transparent)`;

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

  useLayoutEffect(() => {
    if (!isAmlStyleEngine) return;
    void measurementKey;
    const measure = () => {
      lineHeightsRef.current = rowRefs.current.map((row) => {
        const measured = row?.getBoundingClientRect().height ?? row?.offsetHeight ?? 0;
        return measured > 0 ? measured : 48;
      });
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    rowRefs.current.forEach((row) => {
      if (row) ro.observe(row);
    });
    if (viewportRef.current) ro.observe(viewportRef.current);
    return () => ro.disconnect();
  }, [isAmlStyleEngine, measurementKey]);

  // A new song re-attaches follow.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset follow when the lyric set changes
  useEffect(() => setFollowing(true), [lines]);

  // Follow toward the active line's anchor for the scrollTop-based modes. Cascade
  // skips this path because the AMLL-style layout driver owns the stack position.
  // Synced lyrics intentionally do NOT opt into global Lenis smooth-scroll: this
  // surface owns its own programmatic follow target, and two scroll controllers
  // would fight over `scrollTop`.
  useEffect(() => {
    if (!following || isAmlStyleEngine) return;
    let raf = 0;
    let stopped = false;
    let spring: { stop: () => void } | null = null;
    const readTarget = () => {
      const vp = viewportRef.current;
      const stack = stackRef.current;
      const idx = activeIndex;
      const el = stack && idx >= 0 ? (stack.children[idx] as HTMLElement | undefined) : undefined;
      if (!vp || !el) return null;
      const vpRect = vp.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      return lyricFollowTargetScrollTop({
        scrollTop: vp.scrollTop,
        viewportTop: vpRect.top,
        viewportHeight: vp.clientHeight,
        lineTop: elRect.top,
        lineHeight: elRect.height,
        anchorRatio: lyricsMotion.follow.anchorRatio,
      });
    };
    const stopSpring = () => {
      spring?.stop();
      spring = null;
    };
    const tick = () => {
      if (stopped) return;
      const vp = viewportRef.current;
      const target = readTarget();
      if (vp && target != null) {
        const delta = target - vp.scrollTop;
        if (Math.abs(delta) > 0.5) vp.scrollTop += delta * (lyricsMotion.follow.lerp ?? 0.16);
      }
      raf = requestAnimationFrame(tick);
    };
    if (lyricsMotion.follow.kind === "spring") {
      raf = requestAnimationFrame(() => {
        if (stopped) return;
        const vp = viewportRef.current;
        const target = readTarget();
        if (!vp || target == null) return;
        spring = animate(vp.scrollTop, target, {
          type: "spring",
          stiffness: lyricsMotion.follow.stiffness,
          damping: lyricsMotion.follow.damping,
          mass: lyricsMotion.follow.mass,
          onUpdate: (value) => {
            if (!stopped && following && viewportRef.current) viewportRef.current.scrollTop = value;
          },
        });
      });
    } else {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopSpring();
    };
  }, [following, activeIndex, isAmlStyleEngine, lyricsMotion]);

  useEffect(() => {
    if (!isAmlStyleEngine) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    type RuntimeLine = {
      translateY: number;
      opacity: number;
      scale: number;
      blurPx: number;
      velocityY: number;
      velocityOpacity: number;
      velocityScale: number;
      velocityBlur: number;
      targetY: number;
      targetOpacity: number;
      targetScale: number;
      targetBlur: number;
      delayRemaining: number;
      initialized: boolean;
    };

    const states = new Map<string, RuntimeLine>();
    let raf = 0;
    let lastTs = 0;
    let stopped = false;

    const stepSpring = (
      current: number,
      velocity: number,
      target: number,
      dt: number,
    ): [number, number] => {
      const stiffness = 150;
      const damping = 24;
      const nextVelocity = velocity + (target - current) * stiffness * dt - velocity * damping * dt;
      const next = current + nextVelocity * dt;
      if (Math.abs(target - next) < 0.001 && Math.abs(nextVelocity) < 0.001) return [target, 0];
      return [next, nextVelocity];
    };

    const write = (timestamp: number) => {
      if (stopped) return;
      const dt = lastTs ? Math.min(0.05, Math.max(0.001, (timestamp - lastTs) / 1000)) : 1 / 60;
      lastTs = timestamp;
      const timeMs = (getMediaEngine()?.getCurrentTime() ?? 0) * 1000;
      const liveActiveIndex = activeLineIndex(lines, timeMs);
      const viewportHeight = viewport.clientHeight || viewportH || 1;
      const layout = solveLyricLayout({
        lines: renderLines,
        activeIndex: liveActiveIndex,
        lineHeights: lineHeightsRef.current,
        viewportHeight,
        alignPosition: 0.42,
        lineGapPx: lyricStyle.lineGap,
        reducedMotion: false,
      });

      for (const frame of layout.frames) {
        const row = rowRefs.current[frame.index];
        if (!row) continue;
        let state = states.get(frame.id);
        const targetChanged =
          !state ||
          state.targetY !== frame.translateY ||
          state.targetOpacity !== frame.opacity ||
          state.targetScale !== frame.scale ||
          state.targetBlur !== frame.blurPx;
        if (!state) {
          state = {
            translateY: frame.translateY,
            opacity: frame.opacity,
            scale: frame.scale,
            blurPx: frame.blurPx,
            velocityY: 0,
            velocityOpacity: 0,
            velocityScale: 0,
            velocityBlur: 0,
            targetY: frame.translateY,
            targetOpacity: frame.opacity,
            targetScale: frame.scale,
            targetBlur: frame.blurPx,
            delayRemaining: 0,
            initialized: false,
          };
          states.set(frame.id, state);
        }
        if (targetChanged) {
          state.targetY = frame.translateY;
          state.targetOpacity = frame.opacity;
          state.targetScale = frame.scale;
          state.targetBlur = frame.blurPx;
          state.delayRemaining = state.initialized ? frame.delaySec : 0;
        }

        if (!state.initialized) {
          state.translateY = state.targetY;
          state.opacity = state.targetOpacity;
          state.scale = state.targetScale;
          state.blurPx = state.targetBlur;
          state.velocityY = 0;
          state.velocityOpacity = 0;
          state.velocityScale = 0;
          state.velocityBlur = 0;
          state.initialized = true;
        } else if (state.delayRemaining > 0) {
          state.delayRemaining = Math.max(0, state.delayRemaining - dt);
        } else {
          [state.translateY, state.velocityY] = stepSpring(
            state.translateY,
            state.velocityY,
            state.targetY,
            dt,
          );
          [state.opacity, state.velocityOpacity] = stepSpring(
            state.opacity,
            state.velocityOpacity,
            state.targetOpacity,
            dt,
          );
          [state.scale, state.velocityScale] = stepSpring(
            state.scale,
            state.velocityScale,
            state.targetScale,
            dt,
          );
          [state.blurPx, state.velocityBlur] = stepSpring(
            state.blurPx,
            state.velocityBlur,
            state.targetBlur,
            dt,
          );
        }

        row.style.transform = `translate3d(0, ${state.translateY.toFixed(3)}px, 0) scale(${state.scale.toFixed(4)})`;
        row.style.opacity = state.opacity.toFixed(3);
        row.style.filter = `blur(${Math.max(0, state.blurPx).toFixed(3)}px)`;
        row.style.willChange = "transform, opacity, filter";
      }
      raf = requestAnimationFrame(write);
    };

    write(performance.now());
    raf = requestAnimationFrame(write);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      rowRefs.current.forEach((row) => {
        if (!row) return;
        row.style.transform = "";
        row.style.opacity = "";
        row.style.filter = "";
        row.style.willChange = "";
      });
    };
  }, [isAmlStyleEngine, lines, renderLines, lyricStyle.lineGap, viewportH]);

  // Per-syllable karaoke fill: while the active line has word timings, a single rAF
  // wipes each word as it's sung by writing one CSS var per word span DIRECTLY to
  // the DOM — never React state, so the tree doesn't re-render per frame (rule 6).
  // useLayoutEffect paints once before the browser paints (no flash of unfilled
  // text on a line/track switch); it then loops only while playing.
  useLayoutEffect(() => {
    if (!wordByWord || activeIndex < 0) return;
    const words = lines[activeIndex]?.words;
    if (!words || words.length === 0) return;
    const el = stackRef.current?.children[activeIndex] as HTMLElement | undefined;
    const spans = el?.querySelectorAll<HTMLElement>("[data-word]");
    if (!spans || spans.length === 0) return;
    const paint = () => {
      const ms = (getMediaEngine()?.getCurrentTime() ?? 0) * 1000;
      const idx = activeWordIndex(words, ms);
      spans.forEach((span, j) => {
        let pct: number;
        if (j < idx) pct = 100;
        else if (j > idx) pct = 0;
        else {
          const w = words[idx];
          pct = w.durMs <= 0 ? 100 : Math.max(0, Math.min(100, ((ms - w.timeMs) / w.durMs) * 100));
        }
        span.style.setProperty("--wfill", `${pct}%`);
      });
    };
    paint();
    if (!isPlaying) return;
    let raf = 0;
    let stopped = false;
    const loop = () => {
      if (stopped) return;
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [wordByWord, activeIndex, isPlaying, lines]);

  return (
    <>
      <div
        ref={viewportRef}
        data-testid="lyrics-scroll"
        data-motion-mode={lyricsMotion.mode}
        data-layout-engine={isAmlStyleEngine ? "amll-style" : undefined}
        className="no-scrollbar absolute inset-0 overflow-y-auto overscroll-contain"
        style={EDGE_FADE}
        onWheel={() => {
          if (!isAmlStyleEngine) setFollowing(false);
        }}
        onTouchMove={() => {
          if (!isAmlStyleEngine) setFollowing(false);
        }}
      >
        <div
          key={lyricsSetKey}
          ref={stackRef}
          className="flex flex-col"
          style={{
            paddingTop: viewportH * 0.38,
            paddingBottom: viewportH * 0.62,
            rowGap: lyricStyle.lineGap,
          }}
        >
          {lines.map((line, i) => {
            const isActive = i === activeIndex;
            return (
              <LyricLineButton
                // biome-ignore lint/suspicious/noArrayIndexKey: lyric lines have no stable id; time+index is the natural key
                key={`${line.timeMs}-${i}`}
                line={line}
                isActive={isActive}
                lyricStyle={lyricStyle}
                lyricsMotion={lyricsMotion}
                driverMode={isAmlStyleEngine}
                rowRef={(row) => {
                  rowRefs.current[i] = row;
                }}
                wordByWord={wordByWord}
                showTranslation={showTranslation}
                showRomanization={showRomanization}
                sungColor={sungColor}
                unsungColor={unsungColor}
                onClick={() => {
                  onSeek(line.timeMs / 1000);
                  setFollowing(true);
                }}
              />
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

function LyricLineButton({
  line,
  isActive,
  lyricStyle,
  lyricsMotion,
  driverMode = false,
  rowRef,
  wordByWord,
  showTranslation,
  showRomanization,
  sungColor,
  unsungColor,
  onClick,
}: {
  line: LyricLine;
  isActive: boolean;
  lyricStyle: LyricStyle;
  lyricsMotion: ReturnType<typeof resolveLyricsMotionMode>;
  driverMode?: boolean;
  rowRef?: (row: HTMLButtonElement | null) => void;
  wordByWord: boolean;
  showTranslation: boolean;
  showRomanization: boolean;
  sungColor: string;
  unsungColor: string;
  onClick: () => void;
}) {
  const targetOpacity = isActive ? lyricStyle.activeOpacity : lyricStyle.inactiveOpacity;
  // Scale inactive lines DOWN instead of animating font-size: the layout (and
  // wrapping) stays fixed at the active size, while Motion owns the visual change.
  const targetScale = isActive ? 1 : lyricStyle.inactiveFontSize / lyricStyle.activeFontSize;

  const commonProps = {
    type: "button" as const,
    ref: rowRef,
    "data-active": isActive || undefined,
    "data-layout-row": driverMode ? "true" : undefined,
    "aria-current": isActive ? ("true" as const) : undefined,
    onClick,
    style: {
      fontSize: lyricStyle.activeFontSize,
      color: lyricStyle.color,
      textShadow: lyricStyle.textShadow,
      WebkitTextStroke: lyricStyle.textStroke || undefined,
      paintOrder: lyricStyle.textStroke ? "stroke fill" : undefined,
      transformOrigin:
        lyricStyle.align === "center"
          ? "center"
          : lyricStyle.align === "right"
            ? "right center"
            : "left center",
    } satisfies React.CSSProperties,
    className: cn(
      "block w-full text-pretty rounded-lg px-3 py-2 font-bold leading-[1.45] will-change-transform",
      lyricStyle.align === "center"
        ? "text-center"
        : lyricStyle.align === "right"
          ? "text-right"
          : "text-left",
    ),
  };

  const content =
    isActive && wordByWord && line.words && line.words.length > 0
      ? line.words.map((w, j) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: word spans are positional within a line
            key={j}
            data-word
            style={
              {
                "--wfill": "0%",
                backgroundImage: `linear-gradient(90deg, ${sungColor} var(--wfill), ${unsungColor} var(--wfill))`,
                backgroundOrigin: "border-box",
                WebkitBackgroundClip: "text",
                WebkitBoxDecorationBreak: "clone",
                backgroundClip: "text",
                boxDecorationBreak: "clone",
                lineHeight: 1.45,
                paddingBlock: "0.14em",
                // Transparent-ize only the FILL (not `color`) so the gradient
                // shows through and `currentColor` above still resolves.
                WebkitTextFillColor: "transparent",
              } as React.CSSProperties
            }
          >
            {w.text}
          </span>
        ))
      : line.text || "♪";

  if (driverMode) {
    return (
      <button {...commonProps}>
        {content}
        {showRomanization && line.roman && (
          <span className="mt-0.5 block font-medium" style={{ fontSize: "0.55em", opacity: 0.62 }}>
            {line.roman}
          </span>
        )}
        {showTranslation && line.translation && (
          <span className="mt-0.5 block font-medium" style={{ fontSize: "0.6em", opacity: 0.72 }}>
            {line.translation}
          </span>
        )}
      </button>
    );
  }

  const scaleTransition =
    lyricsMotion.row.transition === "spring"
      ? {
          type: "spring" as const,
          stiffness: lyricsMotion.follow.stiffness,
          damping: lyricsMotion.follow.damping,
          mass: lyricsMotion.follow.mass,
        }
      : { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <motion.button
      {...commonProps}
      initial={false}
      animate={{
        opacity: targetOpacity,
        scale: targetScale,
        y: 0,
        filter: "blur(0px)",
      }}
      transition={{
        opacity: scaleTransition,
        scale: scaleTransition,
        y: { duration: 0 },
        filter: { duration: 0 },
      }}
    >
      {content}
      {showRomanization && line.roman && (
        <span className="mt-0.5 block font-medium" style={{ fontSize: "0.55em", opacity: 0.62 }}>
          {line.roman}
        </span>
      )}
      {showTranslation && line.translation && (
        <span className="mt-0.5 block font-medium" style={{ fontSize: "0.6em", opacity: 0.72 }}>
          {line.translation}
        </span>
      )}
    </motion.button>
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
