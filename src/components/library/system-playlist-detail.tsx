import type { TFunction } from "i18next";
import { ArrowLeft, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrackInspectorPanel } from "@/components/track/track-inspector-panel";
import { Button } from "@/components/ui/button";
import type { PlaybackEvent, RemoteSearchTrack, Track, TrackPlaybackStats } from "@/db/types";
import {
  deriveHeartedPlaylist,
  deriveMostPlayedPlaylist,
  deriveRecentlyPlayedPlaylist,
  type MostPlayedRange,
  type SystemPlaylistId,
  type SystemPlaylistPlayable,
} from "@/lib/system-playlists";
import { cn, formatListenTime } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";
import { TrackListSection } from "./track-list-section";

const MOST_PLAYED_RANGES: MostPlayedRange[] = ["all", "month", "week", "day"];
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const play = usePlayerStore((s) => s.play);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playSystemPlaylist = usePlayerStore((s) => s.playSystemPlaylist);

  const rows = useMemo(
    () => deriveRows(playlistId, tracks, stats, events, remoteTracks, range, now),
    [events, now, playlistId, range, remoteTracks, stats, tracks],
  );
  const localTracks = useMemo(
    () => rows.flatMap((row) => (row.kind === "local-track" ? [row.track] : [])),
    [rows],
  );
  const remoteRows = useMemo(
    () =>
      rows.filter(
        (row): row is Extract<SystemPlaylistPlayable, { kind: "remote-track" }> =>
          row.kind === "remote-track",
      ),
    [rows],
  );
  const metricsByTrackId = useMemo(
    () =>
      new Map(
        rows.flatMap((row) =>
          row.kind === "local-track" ? ([[row.track.id, row.metric]] as const) : [],
        ),
      ),
    [rows],
  );
  const selectedTrack = useMemo(
    () => localTracks.find((track) => track.id === selectedTrackId) ?? localTracks[0],
    [localTracks, selectedTrackId],
  );

  async function playAll() {
    await playSystemPlaylist(playlistId, localTracks);
    void play();
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-4 pt-14 lg:px-6">
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
            listClassName="chrome-fade no-scrollbar pt-5 pb-chrome-bottom [--chrome-fade-top:1.25rem]"
            className="min-h-0 flex-1"
            getTrackSupplement={
              playlistId === "system:most"
                ? (track) => metricSupplement(metricsByTrackId.get(track.id), t)
                : undefined
            }
            startActions={
              <Button size="sm" onClick={() => void playAll()} disabled={localTracks.length === 0}>
                <Play className="size-4" /> {t("gallery.playAll")}
              </Button>
            }
          />
          {remoteRows.length > 0 && (
            <div className="flex shrink-0 flex-col gap-1 px-1 pb-3">
              {remoteRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-md border border-border bg-background/70 px-3 py-2"
                >
                  <p className="truncate text-sm">{row.remote.title}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {metricSupplement(row.metric, t)}
                  </p>
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
      return deriveHeartedPlaylist(tracks).map((track) => ({
        id: track.id,
        kind: "local-track",
        metric: {
          listenedSec: 0,
          playCount: 0,
          trackId: track.id,
        },
        title: track.title,
        track,
      }));
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

function metricSupplement(
  metric: SystemPlaylistPlayable["metric"] | undefined,
  t: CommonT,
) {
  if (!metric) return undefined;
  return `${t("systemPlaylists.playCount", {
    count: metric.playCount,
  })} · ${t("systemPlaylists.listenTime", {
    time: formatListenTime(metric.listenedSec),
  })}`;
}
