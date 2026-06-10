import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import { getTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { activeLineIndex, type LyricsLine } from "@/lyrics/parse-lrc";
import { type ResolvedLyrics, resolveTrackLyrics } from "@/lyrics/resolve-lyrics";
import { usePlayerStore } from "@/stores/player-store";

type ShownLyrics = Extract<ResolvedLyrics, { mode: "synced" } | { mode: "plain" }>;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * The Now-Playing lyrics surface. Reads the track's stored lyrics (LRCLIB or
 * manual) and renders the single arbiter's verdict: time-synced karaoke lines
 * (Apple-Music style — active line highlighted, auto-scrolled to center,
 * click-to-seek), plain text, or an instrumental / fetching / empty message.
 * Subscribes to playback position at the store's ~4Hz cadence (no per-frame rAF,
 * so nothing here re-renders the tree on every animation frame — rule 6).
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
  const positionSec = usePlayerStore((s) => s.positionSec);
  const seek = usePlayerStore((s) => s.seek);
  const resolved = useMemo(() => resolveTrackLyrics(track, row), [track, row]);

  if (resolved.mode === "instrumental") {
    return <LyricsMessage>{t("lyrics.instrumental")}</LyricsMessage>;
  }
  if (resolved.mode === "none") {
    const fetching =
      !!track && track.origin !== "generated" && (settings.autoFetchLyrics ?? true) && !row;
    return <LyricsMessage>{t(fetching ? "lyrics.fetching" : "nowPlaying.noLyrics")}</LyricsMessage>;
  }
  return <LyricsScroller resolved={resolved} positionMs={positionSec * 1000} onSeek={seek} />;
}

function LyricsMessage({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Presentational lyrics body — pure props, no store/db hooks (unit-tested). */
export function LyricsScroller({
  resolved,
  positionMs,
  onSeek,
}: {
  resolved: ShownLyrics;
  positionMs: number;
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
      positionMs={positionMs}
      onSeek={onSeek}
      source={resolved.source}
    />
  );
}

function SyncedLines({
  lines,
  positionMs,
  onSeek,
  source,
}: {
  lines: LyricsLine[];
  positionMs: number;
  onSeek: (sec: number) => void;
  source: ShownLyrics["source"];
}) {
  const active = activeLineIndex(lines, positionMs);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active < 0) return;
    const el = activeRef.current;
    if (!el || typeof el.scrollIntoView !== "function") return;
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active]);

  return (
    <div className="flex flex-col gap-1">
      {lines.map((line, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: lyric lines have no stable id; time+index is the natural key
          key={`${line.timeMs}-${i}`}
          ref={i === active ? activeRef : undefined}
          type="button"
          data-active={i === active || undefined}
          aria-current={i === active ? "true" : undefined}
          onClick={() => onSeek(line.timeMs / 1000)}
          className={cn(
            "block w-full rounded-lg px-3 py-2 text-left text-lg font-semibold leading-snug transition-all duration-300",
            i === active
              ? "text-foreground"
              : "text-muted-foreground/40 hover:text-muted-foreground",
          )}
        >
          {line.text || " "}
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
