import { useLiveQuery } from "dexie-react-hooks";
import { ScrollText, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { clearTrackLyrics, getTrackLyrics, setTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import { lyricsRecordFromHit } from "@/lyrics/auto-fetch";
import { buildLyricsQuery } from "@/lyrics/build-query";
import { lyricsRecordFromManualText } from "@/lyrics/manual";
import type { LyricsHit } from "@/lyrics/provider";
import { resolveLyricsProvider } from "@/lyrics/registry";

/**
 * Manual lyrics management for a track: search LRCLIB candidates and pick one,
 * paste/edit LRC or plain text, or clear / re-fetch. Anything the user chooses
 * here is stored as `source: "manual"` so auto-fetch never overwrites it.
 */
export function LyricsManagerButton({ track }: { track: Track }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <button
        type="button"
        className="grid size-8 place-items-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        aria-label={t("lyrics.manage")}
      >
        <ScrollText className="size-3.5" />
      </button>
      <DialogContent className="max-h-[min(40rem,calc(100vh-2rem))] overflow-y-auto">
        {open && <LyricsManagerBody track={track} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function LyricsManagerBody({ track, onDone }: { track: Track; onDone: () => void }) {
  const { t } = useTranslation();
  const settings = useSettings();
  const provider = useMemo(() => resolveLyricsProvider(settings), [settings]);
  const row = useLiveQuery(() => getTrackLyrics(track.id), [track.id], undefined);

  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(trackArtists(track).join(", "));
  const [results, setResults] = useState<LyricsHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);

  const currentLabel = !row
    ? t("lyrics.currentNone")
    : row.status === "instrumental"
      ? t("lyrics.currentInstrumental")
      : row.synced
        ? t("lyrics.currentSynced")
        : row.plain
          ? t("lyrics.currentPlain")
          : t("lyrics.currentNone");

  async function runSearch() {
    setSearching(true);
    setError(null);
    try {
      const hits =
        (await provider.search?.({
          trackName: title.trim(),
          artistName: artist.trim(),
          albumName: trackAlbum(track),
          durationSec: track.durationSec,
        })) ?? [];
      setResults(hits);
    } catch {
      setError(t("lyrics.searchError"));
    } finally {
      setSearching(false);
    }
  }

  async function pick(hit: LyricsHit) {
    setBusy(true);
    await setTrackLyrics({
      trackId: track.id,
      record: lyricsRecordFromHit(hit, "manual"),
      matched: hit.matched,
    });
    onDone();
  }

  async function savePaste() {
    if (!paste.trim()) return;
    setBusy(true);
    await setTrackLyrics({ trackId: track.id, record: lyricsRecordFromManualText(paste) });
    onDone();
  }

  async function clear() {
    setBusy(true);
    await clearTrackLyrics(track.id);
    onDone();
  }

  async function refetch() {
    setBusy(true);
    await clearTrackLyrics(track.id);
    const q = buildLyricsQuery(track);
    if (q) {
      try {
        const hit = await provider.fetch(q);
        await setTrackLyrics({
          trackId: track.id,
          record: lyricsRecordFromHit(hit),
          matched: hit?.matched,
        });
      } catch {
        // Leave it cleared — auto-fetch will retry on next play.
      }
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <DialogTitle>{t("lyrics.manage")}</DialogTitle>
          <DialogDescription className="mt-1">{currentLabel}</DialogDescription>
        </div>
        <DialogClose
          aria-label={t("drop.close")}
          className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </DialogClose>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("lyrics.searchTitle")}
          />
          <Input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t("lyrics.searchArtist")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void runSearch()}
            disabled={searching}
          >
            {searching ? <Spinner className="size-4" /> : t("lyrics.searchAction")}
          </Button>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
        {results && results.length === 0 && !searching && (
          <p className="py-3 text-center text-muted-foreground text-xs">{t("lyrics.noResults")}</p>
        )}
        {results && results.length > 0 && (
          <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {results.map((hit) => (
              <li key={hit.sourceId ?? `${hit.matched.trackName}-${hit.matched.durationSec}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void pick(hit)}
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
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={t("lyrics.pastePlaceholder")}
          rows={5}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-2">
            {row && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void clear()}
                disabled={busy}
              >
                {t("lyrics.clear")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              disabled={busy}
            >
              {t("lyrics.refetch")}
            </Button>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void savePaste()}
            disabled={busy || !paste.trim()}
          >
            {t("lyrics.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}
