import type { TFunction } from "i18next";
import { ArrowLeft, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { Button } from "@/components/ui/button";
import type { PlaybackEvent, RemoteSearchTrack, Track, TrackPlaybackStats } from "@/db/types";
import { useBackGesture } from "@/hooks/use-back-gesture";
import {
  deriveHeartedPlaylistRows,
  deriveMostPlayedPlaylist,
  deriveRecentlyPlayedPlaylist,
  type MostPlayedRange,
  type SystemPlaylistId,
  type SystemPlaylistPlayable,
  type SystemPlaylistSort,
  sortSystemPlaylistRows,
} from "@/lib/system-playlists";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { TrackListSection } from "./track-list-section";

const MOST_PLAYED_RANGES: MostPlayedRange[] = ["all", "month", "week", "day"];
const SYSTEM_PLAYLIST_SORTS: SystemPlaylistSort[] = ["default", "play-count", "last-played"];
type CommonT = TFunction<"common", undefined>;

export function SystemPlaylistDetail({
  playlistId,
  tracks,
  stats,
  events,
  remoteTracks,
  now = Date.now(),
  onBack,
}: {
  playlistId: SystemPlaylistId;
  tracks: Track[];
  stats: TrackPlaybackStats[];
  events: PlaybackEvent[];
  remoteTracks: RemoteSearchTrack[];
  now?: number;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [range, setRange] = useState<MostPlayedRange>("all");
  const [sort, setSort] = useState<SystemPlaylistSort>("default");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const play = usePlayerStore((s) => s.play);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playSystemPlaylist = usePlayerStore((s) => s.playSystemPlaylist);
  const showPlaybackMetrics = playlistId !== "system:liked";

  const rows = useMemo(
    () => deriveRows(playlistId, tracks, stats, events, remoteTracks, range, now),
    [events, now, playlistId, range, remoteTracks, stats, tracks],
  );
  const effectiveSort = showPlaybackMetrics ? sort : "default";
  const sortedRows = useMemo(
    () => sortSystemPlaylistRows(rows, effectiveSort),
    [effectiveSort, rows],
  );
  const localTracks = useMemo(
    () => sortedRows.flatMap((row) => (row.kind === "local-track" ? [row.track] : [])),
    [sortedRows],
  );
  const remoteRows = useMemo(
    () =>
      sortedRows.filter(
        (row): row is Extract<SystemPlaylistPlayable, { kind: "remote-track" }> =>
          row.kind === "remote-track",
      ),
    [sortedRows],
  );
  const metricsByTrackId = useMemo(
    () =>
      new Map(
        sortedRows.flatMap((row) =>
          row.kind === "local-track" ? ([[row.track.id, row.metric]] as const) : [],
        ),
      ),
    [sortedRows],
  );
  const selectedTrack = useMemo(
    () => localTracks.find((track) => track.id === selectedTrackId) ?? localTracks[0],
    [localTracks, selectedTrackId],
  );

  useBackGesture(onBack);

  async function playAll() {
    await playSystemPlaylist(playlistId, localTracks);
    void play();
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col pt-chrome-top">
      <button
        type="button"
        onClick={onBack}
        aria-label={t("gallery.back")}
        className="mb-2 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <ArrowLeft className="size-5" />
      </button>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold text-lg">{systemPlaylistLabel(playlistId, t)}</h2>
              <p className="text-muted-foreground text-xs">
                {t("gallery.count", { count: rows.length })}
              </p>
            </div>
            {playlistId === "system:most" && (
              <div className="flex rounded-md border border-border p-0.5">
                {MOST_PLAYED_RANGES.map((id) => (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setRange(id)}
                    className={cn(
                      "rounded px-2 py-1 text-xs transition-colors",
                      range === id ? "bg-accent text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {mostPlayedRangeLabel(id, t)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <TrackListSection
            tracks={localTracks}
            selectedTrackId={selectedTrack?.id}
            onView={(track) => setSelectedTrackId(track.id)}
            onPlay={(track) => void playTrack(track)}
            emptyHint={emptyHint(playlistId, t)}
            listClassName="chrome-fade no-scrollbar pt-2 pb-chrome-bottom [--chrome-fade-top:0.75rem]"
            className="min-h-0 flex-1"
            afterToolbar={
              showPlaybackMetrics && localTracks.length > 0 ? (
                <MetricColumnHeader t={t} />
              ) : undefined
            }
            endActions={
              showPlaybackMetrics ? (
                <SortControls onChange={setSort} sort={sort} t={t} />
              ) : undefined
            }
            getTrackColumns={
              showPlaybackMetrics
                ? (track) => (
                    <MetricColumns metric={metricsByTrackId.get(track.id)} now={now} t={t} />
                  )
                : undefined
            }
            startActions={
              <Button size="sm" onClick={() => void playAll()} disabled={localTracks.length === 0}>
                <Play className="size-4" /> {t("gallery.playAll")}
              </Button>
            }
          />
          {showPlaybackMetrics && remoteRows.length > 0 && (
            <div className="flex shrink-0 flex-col gap-1 px-1 pb-3">
              {remoteRows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2"
                >
                  <p className="min-w-0 truncate text-sm">{row.remote.title}</p>
                  <span className="hidden shrink-0 items-center gap-3 text-muted-foreground text-xs md:inline-flex">
                    <MetricColumns metric={row.metric} now={now} t={t} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <TrackInspectorPanel track={selectedTrack} />
      </div>
    </div>
  );
}

function deriveRows(
  playlistId: SystemPlaylistId,
  tracks: Track[],
  stats: TrackPlaybackStats[],
  events: PlaybackEvent[],
  remoteTracks: RemoteSearchTrack[],
  range: MostPlayedRange,
  now: number,
): SystemPlaylistPlayable[] {
  switch (playlistId) {
    case "system:liked":
      return deriveHeartedPlaylistRows(tracks, { stats });
    case "system:recent":
      return deriveRecentlyPlayedPlaylist(tracks, { events, remoteTracks, stats });
    default:
      return deriveMostPlayedPlaylist(tracks, { events, now, range, remoteTracks, stats });
  }
}

function systemPlaylistLabel(id: SystemPlaylistId, t: CommonT) {
  switch (id) {
    case "system:liked":
      return t("systemPlaylists.hearted");
    case "system:recent":
      return t("systemPlaylists.recentlyPlayed");
    default:
      return t("systemPlaylists.mostPlayed");
  }
}

function mostPlayedRangeLabel(range: MostPlayedRange, t: CommonT) {
  switch (range) {
    case "day":
      return t("systemPlaylists.rangeDay");
    case "week":
      return t("systemPlaylists.rangeWeek");
    case "month":
      return t("systemPlaylists.rangeMonth");
    default:
      return t("systemPlaylists.rangeAll");
  }
}

function emptyHint(id: SystemPlaylistId, t: CommonT) {
  switch (id) {
    case "system:liked":
      return t("systemPlaylists.emptyHearted");
    case "system:recent":
      return t("systemPlaylists.emptyRecentlyPlayed");
    default:
      return t("systemPlaylists.emptyMostPlayed");
  }
}

function MetricColumnHeader({ t }: { t: CommonT }) {
  return (
    <div className="hidden shrink-0 justify-end gap-3 px-3 pb-1 text-muted-foreground text-xs md:flex">
      <span className="w-16 text-right">{t("systemPlaylists.playCountColumn")}</span>
      <span className="w-20 text-right">{t("systemPlaylists.lastPlayedColumn")}</span>
      <span className="w-10" aria-hidden />
    </div>
  );
}

function SortControls({
  sort,
  onChange,
  t,
}: {
  sort: SystemPlaylistSort;
  onChange: (sort: SystemPlaylistSort) => void;
  t: CommonT;
}) {
  return (
    <div className="flex rounded-md border border-border p-0.5">
      {SYSTEM_PLAYLIST_SORTS.map((id) => (
        <button
          type="button"
          key={id}
          onClick={() => onChange(id)}
          className={cn(
            "rounded px-2 py-1 text-xs transition-colors",
            sort === id ? "bg-accent text-foreground" : "text-muted-foreground",
          )}
        >
          {sortLabel(id, t)}
        </button>
      ))}
    </div>
  );
}

function MetricColumns({
  metric,
  now,
  t,
}: {
  metric: SystemPlaylistPlayable["metric"] | undefined;
  now: number;
  t: CommonT;
}) {
  return (
    <>
      <span className="w-16 text-right tabular-nums">{metric?.playCount ?? 0}</span>
      <span className="w-20 truncate text-right tabular-nums">
        {metric?.lastPlayedAt
          ? formatLastPlayedDate(metric.lastPlayedAt, now)
          : t("systemPlaylists.neverPlayed")}
      </span>
    </>
  );
}

function formatLastPlayedDate(value: number, now: number): string {
  const date = new Date(value);
  if (isSameLocalDate(date, new Date(now))) {
    const hour = date.getHours().toString().padStart(2, "0");
    const minute = date.getMinutes().toString().padStart(2, "0");
    return `${hour}:${minute}`;
  }
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function isSameLocalDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sortLabel(sort: SystemPlaylistSort, t: CommonT) {
  switch (sort) {
    case "play-count":
      return t("systemPlaylists.sortPlayCount");
    case "last-played":
      return t("systemPlaylists.sortLastPlayed");
    default:
      return t("systemPlaylists.sortDefault");
  }
}
