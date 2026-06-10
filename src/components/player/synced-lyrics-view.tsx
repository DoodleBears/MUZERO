import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import { getTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { activeLineIndex, type LyricsLine } from "@/lyrics/parse-lrc";
import { type ResolvedLyrics, resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";

type ShownLyrics = Extract<ResolvedLyrics, { mode: "synced" } | { mode: "plain" }>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

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
 * The Now-Playing lyrics surface. Reads the track's stored lyrics (LRCLIB or
 * manual) and renders the single arbiter's verdict: time-synced karaoke lines
 * (Apple-Music style — active line highlighted at frame rate, auto-scrolled to
 * center, click-to-seek), plain text, or an instrumental / fetching / empty
 * message.
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

  if (resolved.mode === "instrumental") {
    return <LyricsMessage>{t("lyrics.instrumental")}</LyricsMessage>;
  }
  if (resolved.mode === "none") {
    const fetching =
      !!track && track.origin !== "generated" && (settings.autoFetchLyrics ?? true) && !row;
    return <LyricsMessage>{t(fetching ? "lyrics.fetching" : "nowPlaying.noLyrics")}</LyricsMessage>;
  }
  return <LyricsScroller resolved={resolved} activeIndex={activeIndex} onSeek={seek} />;
}

function LyricsMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Presentational lyrics body — pure props, no store/db/rAF (unit-tested). */
export function LyricsScroller({
  resolved,
  activeIndex,
  onSeek,
}: {
  resolved: ShownLyrics;
  activeIndex: number;
  onSeek: (sec: number) => void;
}) {
  if (resolved.mode === "plain") {
    return (
      <div>
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground/90">
          {resolved.text}
        </pre>
        <SourceTag source={resolved.source} />
      </div>
    );
  }
  return (
    <SyncedLines
      lines={resolved.lines}
      activeIndex={activeIndex}
      onSeek={onSeek}
      source={resolved.source}
    />
  );
}

function SyncedLines({
  lines,
  activeIndex,
  onSeek,
  source,
}: {
  lines: LyricsLine[];
  activeIndex: number;
  onSeek: (sec: number) => void;
  source: ShownLyrics["source"];
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = activeRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeIndex]);

  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: lyric lines have no stable id; time+index is the natural key
          key={`${line.timeMs}-${i}`}
          ref={i === activeIndex ? activeRef : undefined}
          type="button"
          data-active={i === activeIndex || undefined}
          aria-current={i === activeIndex ? "true" : undefined}
          onClick={() => onSeek(line.timeMs / 1000)}
          className={cn(
            "block w-full rounded-lg px-3 py-2 text-left text-lg font-semibold leading-snug transition-all duration-300",
            i === activeIndex
              ? "text-foreground"
              : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
        >
          {line.text || " "}
        </button>
      ))}
      <SourceTag source={source} />
    </div>
  );
}

/** LRCLIB attribution. Manual/brief lyrics are the user's own — no tag. */
function SourceTag({ source }: { source: ShownLyrics["source"] }) {
  const { t } = useTranslation();
  if (source !== "lrclib") return null;
  return (
    <p className="pt-4 pb-2 text-center text-[11px] text-muted-foreground/70">
      {t("lyrics.source", { source: "LRCLIB" })}
    </p>
  );
}
