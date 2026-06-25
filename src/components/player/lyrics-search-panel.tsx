import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Track } from "@/db/types";
import { type LyricsSearch, useLyricsSearch } from "@/hooks/use-lyrics-search";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import type { LyricsHit } from "@/lyrics/provider";
import { useUiStore } from "@/stores/ui-store";

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

/** The LRCLIB candidate list — shared by the inline panel and the dialog. */
export function LyricsCandidateList({
  results,
  searching,
  busy,
  onPick,
}: {
  results: LyricsHit[] | null;
  searching: boolean;
  busy?: boolean;
  onPick: (hit: LyricsHit) => void;
}) {
  const { t } = useTranslation();
  if (!results) return null;
  if (results.length === 0 && !searching) {
    return (
      <p className="py-3 text-center text-muted-foreground text-xs">{t("lyrics.noResults")}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {results.map((hit) => (
        <li key={hit.sourceId ?? `${hit.matched.trackName}-${hit.matched.durationSec}`}>
          <button
            type="button"
            disabled={busy}
            onClick={() => onPick(hit)}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-card/55 px-3 py-2 text-left text-sm transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 break-words font-medium">{hit.matched.trackName}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {hit.matched.artistName} · {formatDuration(hit.matched.durationSec)}
              </span>
            </span>
            {hit.synced && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-medium text-[10px] text-primary">
                {t("lyrics.syncedBadge")}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The form half (inputs + search button), driven by a shared search hook. */
export function LyricsSearchForm({ search }: { search: LyricsSearch }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 px-1">
      <Input
        value={search.title}
        onChange={(e) => search.setTitle(e.target.value)}
        placeholder={t("lyrics.searchTitle")}
        onKeyDown={(e) => {
          if (e.key === "Enter") void search.runSearch();
        }}
      />
      <div className="flex gap-2">
        <Input
          value={search.artist}
          onChange={(e) => search.setArtist(e.target.value)}
          placeholder={t("lyrics.searchArtist")}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search.runSearch();
          }}
        />
        <Button
          size="lg"
          type="button"
          onClick={() => void search.runSearch()}
          disabled={search.searching}
        >
          {search.searching ? <Spinner className="size-4" /> : t("lyrics.searchAction")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Inline lyric-search surface shown when a track has no lyrics (the empty state
 * becomes a search UI) or when the user wants to replace a wrong match. Pick a
 * candidate to store it as the track's manual lyrics.
 */
export function LyricsSearchPanel({
  track,
  prompt,
  defaultOpen,
  onCancel,
  onPicked,
}: {
  track: Track;
  prompt?: string;
  /** Start expanded (e.g. when the user explicitly tapped "search"). */
  defaultOpen?: boolean;
  onCancel?: () => void;
  onPicked?: () => void;
}) {
  const { t } = useTranslation();
  const chromeHidden = useUiStore((s) => s.chromeHidden);
  const search = useLyricsSearch(track);
  const [open, setOpen] = useState(defaultOpen ?? false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useSmoothScroll(scrollRef);

  async function choose(hit: LyricsHit) {
    await search.pick(hit);
    onPicked?.();
  }

  // Collapsed: the prompt is just a button (and hidden entirely in immersive
  // idle, like the Dock) so the empty state never clutters the view.
  if (!open) {
    if (chromeHidden) return null;
    return (
      <div className="flex h-full items-start justify-center pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full border border-border/60 bg-background/55 px-4 py-2 text-muted-foreground text-sm backdrop-blur-sm transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {prompt ?? t("lyrics.searchPrompt")}
        </button>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="no-scrollbar flex h-full flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">{prompt ?? t("lyrics.searchPrompt")}</p>
        <button
          type="button"
          onClick={() => (onCancel ? onCancel() : setOpen(false))}
          className="shrink-0 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
        >
          {onCancel ? t("lyrics.backToLyrics") : t("lyrics.collapseSearch")}
        </button>
      </div>
      <LyricsSearchForm search={search} />
      {search.error && <p className="text-destructive text-xs">{t("lyrics.searchError")}</p>}
      <LyricsCandidateList results={search.results} searching={search.searching} onPick={choose} />
    </div>
  );
}
