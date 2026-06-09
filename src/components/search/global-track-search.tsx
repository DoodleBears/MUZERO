import { useLiveQuery } from "dexie-react-hooks";
import { CornerDownLeft, ListPlus, Search } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disc3Icon } from "@/components/ui/disc-3";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { db } from "@/db/muzero-db";
import { listAllTracks, memoryNotesByTrack } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { useWorkerTrackSearch } from "@/hooks/use-worker-track-search";
import { trackSubtitle } from "@/lib/track-display";
import { cn, formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const EMPTY_MEMORY_NOTES = new Map<string, string[]>();
const MAX_RESULTS = 10;
const GLOBAL_RESULT_BUTTON_SELECTOR = "[data-muzero-global-track-result]";

export function GlobalTrackSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const allTracks = useLiveQuery(() => listAllTracks(db), [], []);
  const memoryNotes = useLiveQuery(
    () =>
      allTracks.length > 0
        ? memoryNotesByTrack(
            allTracks.map((track) => track.id),
            db,
          )
        : Promise.resolve(EMPTY_MEMORY_NOTES),
    [allTracks],
    EMPTY_MEMORY_NOTES,
  );
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);

  const playable = useMemo(
    () =>
      allTracks
        .filter((track) => track.status === "ready")
        .sort((a, b) => b.createdAt - a.createdAt),
    [allTracks],
  );
  // Off-thread, transliteration-aware search (pinyin / kana / romaji), ranked.
  const ranked = useWorkerTrackSearch(playable, query, memoryNotes);
  const results = useMemo(() => ranked.slice(0, MAX_RESULTS), [ranked]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(Math.max(0, index), Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  function focusResult(index: number) {
    setSelectedIndex(index);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          `${GLOBAL_RESULT_BUTTON_SELECTOR}[data-result-index="${index}"]`,
        )
        ?.focus();
    });
  }

  async function commit(track: Track | undefined, mode: "play" | "next") {
    if (!track) return;
    if (mode === "next") {
      await playNextTrack(track);
    } else {
      await playTrack(track);
      onOpenChange(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (results.length === 0) return;
      const fromInput = event.target === inputRef.current;
      focusResult(fromInput ? selectedIndex : Math.min(results.length - 1, selectedIndex + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const fromInput = event.target === inputRef.current;
      focusResult(fromInput ? results.length - 1 : Math.max(0, selectedIndex - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void commit(results[selectedIndex], event.shiftKey ? "next" : "play");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/55 px-4 pt-[12vh] backdrop-blur-md"
      onKeyDown={onKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label={t("globalSearch.title")}
    >
      <button
        type="button"
        aria-label={t("drop.close")}
        className="absolute inset-0 size-full cursor-default"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative z-10 mx-auto max-w-2xl overflow-hidden rounded-2xl border border-white/12 bg-popover/90 text-popover-foreground shadow-2xl ring-1 ring-black/10">
        <div className="flex items-center gap-3 border-white/10 border-b px-4">
          <Search className="size-5 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("globalSearch.placeholder")}
            type="search"
            className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2" role="listbox">
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center text-muted-foreground text-sm">
              {t("globalSearch.empty")}
            </div>
          ) : (
            results.map((track, index) => (
              <GlobalTrackSearchRow
                key={track.id}
                track={track}
                selected={index === selectedIndex}
                resultIndex={index}
                onMouseEnter={() => setSelectedIndex(index)}
                onPlay={() => void commit(track, "play")}
                onPlayNext={() => void commit(track, "next")}
              />
            ))
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-white/10 border-t px-4 py-3 text-muted-foreground text-xs">
          <span>{t("globalSearch.count", { count: results.length })}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              {t("globalSearch.playHint")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KbdGroup>
                <Kbd>Shift</Kbd>
                <Kbd>Enter</Kbd>
              </KbdGroup>
              {t("globalSearch.playNextHint")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlobalTrackSearchRow({
  track,
  selected,
  resultIndex,
  onMouseEnter,
  onPlay,
  onPlayNext,
}: {
  track: Track;
  selected: boolean;
  resultIndex: number;
  onMouseEnter: () => void;
  onPlay: () => void;
  onPlayNext: () => void;
}) {
  const { t } = useTranslation();
  const coverUrl = useTrackCoverUrl(track);
  return (
    <div
      className={cn(
        "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
      )}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
    >
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        data-muzero-global-track-result
        data-result-index={resultIndex}
      >
        <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-secondary text-muted-foreground">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="size-full object-cover" />
          ) : (
            <Disc3Icon size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm">{track.title}</div>
          <div className="truncate text-muted-foreground text-xs">{trackSubtitle(track)}</div>
        </div>
      </button>
      <div className="hidden shrink-0 items-center gap-1 sm:flex">
        <button
          type="button"
          onClick={onPlay}
          aria-label={t("globalSearch.playHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <CornerDownLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={onPlayNext}
          aria-label={t("globalSearch.playNextHint")}
          className="grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
        >
          <ListPlus className="size-4" />
        </button>
      </div>
      <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
        {formatDuration(track.durationSec)}
      </span>
    </div>
  );
}
