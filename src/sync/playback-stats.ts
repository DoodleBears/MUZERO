import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { PlaybackAggregate, PlaybackEvent, TrackPlaybackStats } from "@/db/types";
import { newId } from "@/lib/id";

export interface PlayThresholdInput {
  listenedSec: number;
  durationSec: number;
}

export interface RecordPlaybackListenInput {
  devicePublicId: string;
  trackId: string;
  durationSec: number;
  listenedSec: number;
  startedAt: number;
  endedAt?: number;
  context: PlaybackEvent["context"];
}

export function shouldCountAsPlay(input: PlayThresholdInput): boolean {
  const listenedSec = Math.max(0, input.listenedSec);
  const durationSec = Math.max(0, input.durationSec);
  const threshold = durationSec > 0 ? Math.min(30, durationSec / 2) : 30;
  return listenedSec >= threshold;
}

export async function recordPlaybackListen(
  input: RecordPlaybackListenInput,
  db: MuzeroDB = defaultDb,
): Promise<PlaybackEvent> {
  const listenedSec = Math.max(0, Math.round(input.listenedSec));
  const countedAsPlay = shouldCountAsPlay({
    listenedSec,
    durationSec: input.durationSec,
  });
  const updatedAt = input.endedAt ?? Date.now();
  const event: PlaybackEvent = {
    id: newId("ple"),
    devicePublicId: input.devicePublicId,
    trackId: input.trackId,
    context: input.context,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    listenedSec,
    countedAsPlay,
  };

  await db.transaction(
    "rw",
    db.playbackEvents,
    db.trackPlaybackStats,
    db.playbackAggregates,
    db.tracks,
    async () => {
      await db.playbackEvents.put(event);
      await upsertTrackStats(
        input.devicePublicId,
        input.trackId,
        listenedSec,
        countedAsPlay,
        updatedAt,
        db,
      );
      await upsertTrackAggregate(
        input.devicePublicId,
        input.trackId,
        listenedSec,
        countedAsPlay,
        updatedAt,
        db,
      );
      if (input.context.setId) {
        await upsertSetAggregate(
          input.devicePublicId,
          input.context.setId,
          listenedSec,
          countedAsPlay,
          updatedAt,
          db,
        );
      }
      if (countedAsPlay) {
        const track = await db.tracks.get(input.trackId);
        if (track) await db.tracks.update(input.trackId, { playCount: track.playCount + 1 });
      }
    },
  );

  return event;
}

async function upsertTrackStats(
  devicePublicId: string,
  trackId: string,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  const id = `${devicePublicId}:${trackId}`;
  const current = await db.trackPlaybackStats.get(id);
  const next: TrackPlaybackStats = {
    id,
    devicePublicId,
    trackId,
    playCount: (current?.playCount ?? 0) + (countedAsPlay ? 1 : 0),
    listenedSec: (current?.listenedSec ?? 0) + listenedSec,
    lastPlayedAt: countedAsPlay ? updatedAt : current?.lastPlayedAt,
    updatedAt,
  };
  await db.trackPlaybackStats.put(next);
}

async function upsertTrackAggregate(
  devicePublicId: string,
  trackId: string,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  await upsertAggregate(
    {
      id: `${devicePublicId}:track:${trackId}`,
      devicePublicId,
      scope: "track",
      trackId,
    },
    listenedSec,
    countedAsPlay,
    updatedAt,
    db,
  );
}

async function upsertSetAggregate(
  devicePublicId: string,
  setId: string,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  await upsertAggregate(
    {
      id: `${devicePublicId}:set:${setId}`,
      devicePublicId,
      scope: "set",
      setId,
    },
    listenedSec,
    countedAsPlay,
    updatedAt,
    db,
  );
}

async function upsertAggregate(
  base: Pick<PlaybackAggregate, "id" | "devicePublicId" | "scope" | "trackId" | "setId">,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  const current = await db.playbackAggregates.get(base.id);
  const next: PlaybackAggregate = {
    ...base,
    playCount: (current?.playCount ?? 0) + (countedAsPlay ? 1 : 0),
    listenedSec: (current?.listenedSec ?? 0) + listenedSec,
    lastPlayedAt: countedAsPlay ? updatedAt : current?.lastPlayedAt,
    updatedAt,
  };
  await db.playbackAggregates.put(next);
}
