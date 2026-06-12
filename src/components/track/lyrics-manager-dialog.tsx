import { useLiveQuery } from "dexie-react-hooks";
import { ScrollText, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LyricsCandidateList, LyricsSearchForm } from "@/components/player/lyrics-search-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { clearTrackLyrics, getTrackLyrics, setTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { useLyricsSearch } from "@/hooks/use-lyrics-search";
import { lyricsRecordFromHit, lyricsSourceForProvider } from "@/lyrics/auto-fetch";
import { buildLyricsQuery } from "@/lyrics/build-query";
import { lyricsRecordFromManualText } from "@/lyrics/manual";
import type { LyricsHit } from "@/lyrics/provider";
import { resolveLyricsProviderForTrack } from "@/lyrics/registry";

/**
 * Manual lyrics management for a track: search LRCLIB candidates and pick one,
 * paste/edit LRC or plain text, or clear / re-fetch. Anything the user chooses
 * here is stored as `source: "manual"` so auto-fetch never overwrites it. Shares
 * the search hook + candidate list with the inline now-playing search panel.
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
  const row = useLiveQuery(() => getTrackLyrics(track.id), [track.id], undefined);
  const search = useLyricsSearch(track);
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

  async function pick(hit: LyricsHit) {
    setBusy(true);
    await search.pick(hit);
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
        const provider = resolveLyricsProviderForTrack(settings, track);
        const hit = await provider.fetch(q);
        await setTrackLyrics({
          trackId: track.id,
          record: lyricsRecordFromHit(hit, hit?.source ?? lyricsSourceForProvider(provider.id)),
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
        <LyricsSearchForm search={search} />
        {search.error && <p className="text-destructive text-xs">{t("lyrics.searchError")}</p>}
        <LyricsCandidateList
          results={search.results}
          searching={search.searching}
          busy={busy}
          onPick={pick}
        />
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
