import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { PlaybackAggregate, PlaybackEvent, TrackPlaybackStats } from "@/db/types";
import { newId } from "@/lib/id";

type AggregateBase = Pick<
  PlaybackAggregate,
  | "id"
  | "devicePublicId"
  | "scope"
  | "driveId"
  | "shareId"
  | "setId"
  | "trackId"
  | "remoteTrackId"
  | "mediaSha256"
>;

export interface PlayThresholdInput {
  listenedSec: number;
  durationSec: number;
}

export interface RecordPlaybackListenInput {
  devicePublicId: string;
  trackId: string;
  remoteTrackRef?: PlaybackEvent["remoteTrackRef"];
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
    remoteTrackRef: input.remoteTrackRef,
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
        await upsertTrackInSetAggregate(
          input.devicePublicId,
          input.trackId,
          input.context.setId,
          input.remoteTrackRef,
          listenedSec,
          countedAsPlay,
          updatedAt,
          db,
        );
        await upsertSetAggregate(
          input.devicePublicId,
          input.context.setId,
          listenedSec,
          countedAsPlay,
          updatedAt,
          db,
        );
      }
      if (input.context.shareId) {
        await upsertTrackInShareAggregate(
          input.devicePublicId,
          input.trackId,
          input.context.shareId,
          input.context.setId,
          input.remoteTrackRef,
          listenedSec,
          countedAsPlay,
          updatedAt,
          db,
        );
        await upsertShareAggregate(
          input.devicePublicId,
          input.context.shareId,
          listenedSec,
          countedAsPlay,
          updatedAt,
          db,
        );
      }
      if (input.context.driveId) {
        await upsertDriveAggregate(
          input.devicePublicId,
          input.context.driveId,
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

export function derivePlaybackAggregatesFromEvents(events: PlaybackEvent[]): PlaybackAggregate[] {
  const rows = new Map<string, PlaybackAggregate>();
  for (const event of events) {
    const listenedSec = Math.max(0, Math.round(event.listenedSec));
    const updatedAt = event.endedAt ?? event.startedAt;
    for (const base of aggregateBasesForEvent(event)) {
      const current = rows.get(base.id);
      rows.set(base.id, {
        ...base,
        playCount: (current?.playCount ?? 0) + (event.countedAsPlay ? 1 : 0),
        listenedSec: (current?.listenedSec ?? 0) + listenedSec,
        lastPlayedAt: event.countedAsPlay
          ? Math.max(current?.lastPlayedAt ?? 0, updatedAt)
          : current?.lastPlayedAt,
        updatedAt: Math.max(current?.updatedAt ?? 0, updatedAt),
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function rebuildPlaybackAggregatesFromEvents(
  devicePublicId: string,
  events: PlaybackEvent[],
  db: MuzeroDB = defaultDb,
): Promise<PlaybackAggregate[]> {
  const aggregates = derivePlaybackAggregatesFromEvents(
    events.filter((event) => event.devicePublicId === devicePublicId),
  );
  await db.transaction("rw", db.playbackAggregates, async () => {
    await db.playbackAggregates.where("devicePublicId").equals(devicePublicId).delete();
    if (aggregates.length > 0) await db.playbackAggregates.bulkPut(aggregates);
  });
  return aggregates;
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

async function upsertTrackInSetAggregate(
  devicePublicId: string,
  trackId: string,
  setId: string,
  remoteTrackRef: PlaybackEvent["remoteTrackRef"],
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  await upsertAggregate(
    {
      id: `${devicePublicId}:track-in-set:${setId}:${trackId}`,
      devicePublicId,
      scope: "track-in-set",
      setId,
      trackId,
      remoteTrackId: remoteTrackRef?.trackId,
      mediaSha256: remoteTrackRef?.mediaSha256,
    },
    listenedSec,
    countedAsPlay,
    updatedAt,
    db,
  );
}

async function upsertTrackInShareAggregate(
  devicePublicId: string,
  trackId: string,
  shareId: string,
  setId: string | undefined,
  remoteTrackRef: PlaybackEvent["remoteTrackRef"],
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  const aggregateTrackId = remoteTrackRef?.trackId ?? trackId;
  await upsertAggregate(
    {
      id: `${devicePublicId}:track-in-share:${shareId}:${aggregateTrackId}`,
      devicePublicId,
      scope: "track-in-share",
      shareId,
      setId,
      trackId,
      remoteTrackId: remoteTrackRef?.trackId,
      mediaSha256: remoteTrackRef?.mediaSha256,
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

async function upsertShareAggregate(
  devicePublicId: string,
  shareId: string,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  await upsertAggregate(
    {
      id: `${devicePublicId}:share:${shareId}`,
      devicePublicId,
      scope: "share",
      shareId,
    },
    listenedSec,
    countedAsPlay,
    updatedAt,
    db,
  );
}

async function upsertDriveAggregate(
  devicePublicId: string,
  driveId: string,
  listenedSec: number,
  countedAsPlay: boolean,
  updatedAt: number,
  db: MuzeroDB,
) {
  await upsertAggregate(
    {
      id: `${devicePublicId}:drive:${driveId}`,
      devicePublicId,
      scope: "drive",
      driveId,
    },
    listenedSec,
    countedAsPlay,
    updatedAt,
    db,
  );
}

async function upsertAggregate(
  base: AggregateBase,
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

function aggregateBasesForEvent(event: PlaybackEvent): AggregateBase[] {
  const bases: AggregateBase[] = [];
  const trackKey = event.trackId ?? event.remoteTrackRef?.trackId;
  if (trackKey) {
    bases.push({
      id: `${event.devicePublicId}:track:${trackKey}`,
      devicePublicId: event.devicePublicId,
      scope: "track",
      trackId: event.trackId,
      remoteTrackId: event.remoteTrackRef?.trackId,
      mediaSha256: event.remoteTrackRef?.mediaSha256,
    });
  }
  if (event.context.setId) {
    if (trackKey) {
      bases.push({
        id: `${event.devicePublicId}:track-in-set:${event.context.setId}:${trackKey}`,
        devicePublicId: event.devicePublicId,
        scope: "track-in-set",
        setId: event.context.setId,
        trackId: event.trackId,
        remoteTrackId: event.remoteTrackRef?.trackId,
        mediaSha256: event.remoteTrackRef?.mediaSha256,
      });
    }
    bases.push({
      id: `${event.devicePublicId}:set:${event.context.setId}`,
      devicePublicId: event.devicePublicId,
      scope: "set",
      setId: event.context.setId,
    });
  }
  if (event.context.shareId) {
    if (trackKey) {
      const shareTrackKey = event.remoteTrackRef?.trackId ?? trackKey;
      bases.push({
        id: `${event.devicePublicId}:track-in-share:${event.context.shareId}:${shareTrackKey}`,
        devicePublicId: event.devicePublicId,
        scope: "track-in-share",
        shareId: event.context.shareId,
        setId: event.context.setId,
        trackId: event.trackId,
        remoteTrackId: event.remoteTrackRef?.trackId,
        mediaSha256: event.remoteTrackRef?.mediaSha256,
      });
    }
    bases.push({
      id: `${event.devicePublicId}:share:${event.context.shareId}`,
      devicePublicId: event.devicePublicId,
      scope: "share",
      shareId: event.context.shareId,
    });
  }
  if (event.context.driveId) {
    bases.push({
      id: `${event.devicePublicId}:drive:${event.context.driveId}`,
      devicePublicId: event.devicePublicId,
      scope: "drive",
      driveId: event.context.driveId,
    });
  }
  return bases;
}
