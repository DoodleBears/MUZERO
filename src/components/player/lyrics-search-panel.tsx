import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Track } from "@/db/types";
import { type LyricsSearch, useLyricsSearch } from "@/hooks/use-lyrics-search";
import type { LyricsHit } from "@/lyrics/provider";

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
            <span className="min-w-0">
              <span className="block truncate font-medium">{hit.matched.trackName}</span>
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
    <div className="flex flex-col gap-2">
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
        <Button type="button" onClick={() => void search.runSearch()} disabled={search.searching}>
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
  onCancel,
  onPicked,
}: {
  track: Track;
  prompt?: string;
  onCancel?: () => void;
  onPicked?: () => void;
}) {
  const { t } = useTranslation();
  const search = useLyricsSearch(track);

  async function choose(hit: LyricsHit) {
    await search.pick(hit);
    onPicked?.();
  }

  return (
    <div className="no-scrollbar flex h-full flex-col gap-3 overflow-y-auto">
      <p className="text-muted-foreground text-sm">{prompt ?? t("lyrics.searchPrompt")}</p>
      <LyricsSearchForm search={search} />
      {search.error && <p className="text-destructive text-xs">{t("lyrics.searchError")}</p>}
      <LyricsCandidateList results={search.results} searching={search.searching} onPick={choose} />
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-auto self-start text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("lyrics.backToLyrics")}
        </button>
      )}
    </div>
  );
}
