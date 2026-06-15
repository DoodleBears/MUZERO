import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, ArrowLeft, Disc3, ListMusic, Loader2, Play, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlaylistImportDialog } from "@/components/stream/playlist-import-dialog";
import { Button } from "@/components/ui/button";
import { Disc3Icon } from "@/components/ui/disc-3";
import { useSettings } from "@/hooks/use-app-data";
import { useBackGesture } from "@/hooks/use-back-gesture";
import { cn, formatDuration } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { isNeteaseDailyPlaylist } from "@/streamsrc/virtual-playlists";

const ONLINE_ROW_HEIGHT = 60;

export function OnlinePlaylistDetail({
  playlist,
  onBack,
}: {
  playlist: StreamPlaylist;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const playStreamedHit = usePlayerStore((s) => s.playStreamedHit);
  const playStreamedHits = usePlayerStore((s) => s.playStreamedHits);
  const isDaily = isNeteaseDailyPlaylist(playlist);
  const [hits, setHits] = useState<StreamSearchHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const totalDurationSec = useMemo(
    () => hits.reduce((sum, hit) => sum + (hit.durationSec ?? 0), 0),
    [hits],
  );

  useBackGesture(onBack);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(false);
      try {
        const source = createStreamSource(playlist.source, {
          http: createStreamHttp(),
          now: () => Date.now(),
          getCookie: (id) => settings.streamSources?.[id]?.cookie,
        });
        const next = isDaily
          ? await source?.getDailyRecommendedTracks?.({
              signal: controller.signal,
              afresh: reloadKey > 0,
            })
          : await source?.importPlaylist?.(playlist.id, {
              signal: controller.signal,
            });
        if (!cancelled) setHits(next ?? []);
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setHits([]);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isDaily, playlist.id, playlist.source, reloadKey, settings.streamSources]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="mx-auto flex h-full w-full max-w-6xl flex-col pt-chrome-top"
    >
      <button
        type="button"
        onClick={onBack}
        aria-label={t("gallery.back")}
        className="mb-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius album-cover-shadow">
            {playlist.coverUrl ? (
              <img
                src={playlist.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="size-full object-cover"
              />
            ) : (
              <ListMusic className="size-7" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate px-1 font-semibold text-lg">{playlist.name}</h2>
            <p className="px-1 pt-0.5 text-muted-foreground text-xs tabular-nums">
              {t("streamSources.trackCount", { count: playlist.trackCount })}
              {totalDurationSec > 0 && ` · ${formatDuration(totalDurationSec)}`}
              {` · ${playlist.source}`}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 px-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => void playStreamedHits(hits)}
              disabled={hits.length === 0}
            >
              <Play className="size-4" />
              {t("gallery.playAll")}
            </Button>
            {!isDaily ? (
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <Disc3 className="size-4" />
                {t("streamSources.import")}
              </Button>
            ) : null}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setReloadKey((n) => n + 1)}
            disabled={loading}
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
            {t(isDaily ? "discover.reroll" : "discover.retry")}
          </Button>
        </div>

        {loading ? (
          <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              {t("streamSources.loadingTracks")}
            </span>
          </div>
        ) : error ? (
          <div className="grid min-h-0 flex-1 place-items-center">
            <div className="flex flex-col items-center gap-3 text-center text-muted-foreground text-sm">
              <AlertCircle className="size-5" />
              <p>{t("streamSources.playlistTracksError")}</p>
              <Button size="sm" variant="outline" onClick={() => setReloadKey((n) => n + 1)}>
                <RefreshCw className="size-4" />
                {t("discover.retry")}
              </Button>
            </div>
          </div>
        ) : (
          <OnlineTrackList
            hits={hits}
            emptyHint={t("streamSources.playlistEmpty")}
            onPlay={(hit) => void playStreamedHit(hit)}
          />
        )}
      </div>

      <PlaylistImportDialog
        playlist={importOpen && !isDaily ? playlist : null}
        onClose={() => setImportOpen(false)}
      />
    </motion.div>
  );
}

function OnlineTrackList({
  hits,
  emptyHint,
  onPlay,
}: {
  hits: StreamSearchHit[];
  emptyHint: string;
  onPlay: (hit: StreamSearchHit) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: hits.length,
    estimateSize: () => ONLINE_ROW_HEIGHT,
    getItemKey: (index) => `${hits[index]?.source}:${hits[index]?.externalId}`,
    getScrollElement: () => parentRef.current,
    overscan: 8,
  });

  if (hits.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-muted-foreground text-sm">
        {emptyHint}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="chrome-fade no-scrollbar min-h-0 pt-2 flex-1 overflow-y-auto pb-chrome-bottom [--chrome-fade-top:1.25rem]"
      role="listbox"
    >
      <div className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const hit = hits[virtualRow.index];
          return (
            <div
              key={`${hit.source}:${hit.externalId}`}
              className="absolute left-0 top-0 flex w-full items-center"
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <OnlineTrackRow hit={hit} onPlay={onPlay} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OnlineTrackRow({
  hit,
  onPlay,
}: {
  hit: StreamSearchHit;
  onPlay: (hit: StreamSearchHit) => void;
}) {
  const subtitle = [hit.artist, hit.album].filter(Boolean).join(" · ") || hit.source;
  return (
    <button
      type="button"
      onClick={() => onPlay(hit)}
      className="group flex h-full w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius">
        {hit.coverUrl ? (
          <img
            src={hit.coverUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <Disc3Icon size={16} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{hit.title}</span>
        <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
      </span>
      {hit.durationSec ? (
        <span className="w-10 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
          {formatDuration(hit.durationSec)}
        </span>
      ) : null}
    </button>
  );
}
