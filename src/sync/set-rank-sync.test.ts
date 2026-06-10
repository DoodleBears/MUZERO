import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, MediaBlob, Track } from "@/db/types";
import { orderedSetTrackIds } from "@/player/set-order";
import { buildR2ExportPlan } from "./r2-export-plan";
import { importRemoteSetStream } from "./r2-import-stream";
import type { RemoteSetIndexResult, ResolvedRemoteTrack } from "./r2-subscription";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-rank-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

// ---------------------------------------------------------------- export ----

function localTrack(id: string): Track {
  return {
    id,
    sessionId: "ses_1",
    title: id,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 10,
    blobId: `blb_${id}`,
    createdAt: 100,
    playCount: 0,
    liked: false,
    tags: [],
  };
}

function mediaBlob(id: string): MediaBlob {
  return {
    id: `blb_${id}`,
    trackId: id,
    role: "media",
    mime: "audio/mpeg",
    bytes: 3,
    blob: new Blob(["abc"], { type: "audio/mpeg" }),
  };
}

async function seedSet(trackRanks?: Record<string, number>): Promise<void> {
  const session: DjSession = {
    id: "ses_1",
    name: "S",
    seedPrompt: "",
    trackIds: ["a", "b", "c"], // membership array order; display order comes from ranks
    trackRanks,
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "video",
    createdAt: 100,
    updatedAt: 200,
  };
  await db.sessions.put(session);
  await db.tracks.bulkPut([localTrack("a"), localTrack("b"), localTrack("c")]);
  await db.mediaBlobs.bulkPut([mediaBlob("a"), mediaBlob("b"), mediaBlob("c")]);
}

async function exportSetIndex(): Promise<{ tracks: Array<{ id: string; rank?: number }> }> {
  const plan = await buildR2ExportPlan({
    driveId: "drv_1",
    libraryId: "lib_1",
    baseUrl: "https://music.example.com/muzero/",
    setIds: ["ses_1"],
    db,
  });
  return JSON.parse(String(plan.objects.find((o) => o.kind === "set-index")?.body));
}

describe("R2 export carries set order via fractional rank", () => {
  it("emits tracks[] in display (rank) order, each carrying its rank", async () => {
    await seedSet({ c: 0, a: 1024, b: 2048 }); // display order c, a, b
    const setIndex = await exportSetIndex();
    expect(setIndex.tracks.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(setIndex.tracks.map((t) => t.rank)).toEqual([0, 1024, 2048]);
  });

  it("omits rank for an unmaterialized (legacy) set, keeping membership array order", async () => {
    await seedSet(undefined);
    const setIndex = await exportSetIndex();
    expect(setIndex.tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(setIndex.tracks.every((t) => t.rank === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------- import ----

function remoteTrack(id: string, rank?: number): ResolvedRemoteTrack {
  return {
    id,
    title: id,
    mediaUrl: `https://music.example.com/muzero/m/${id}.mp3`,
    memoryPhotoUrls: [],
    source: {
      id,
      title: id,
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      durationSec: 10,
      createdAt: 100,
      liked: false,
      tags: [],
      rank,
      media: { key: `m/${id}`, url: `m/${id}`, mime: "audio/mpeg", bytes: 3 },
      memories: [],
    },
  };
}

function remoteSet(tracks: ResolvedRemoteTrack[]): RemoteSetIndexResult {
  return {
    indexUrl: "https://music.example.com/muzero/sets/ses_x/index.json",
    index: {
      schema: "muzero-r2-set-index-v1",
      revision: 1,
      set: {
        id: "ses_x",
        name: "X",
        seedPrompt: "",
        displayMode: "video",
        config: {
          autoExtend: false,
          refillThreshold: 2,
          batchSize: 1,
          targetDurationSec: 60,
          allowVocals: true,
        },
        createdAt: 1,
        updatedAt: 1,
      },
      tracks: tracks.map((t) => t.source),
    },
    tracks,
  };
}

async function onlySession(): Promise<DjSession> {
  const all = await db.sessions.toArray();
  expect(all).toHaveLength(1);
  return all[0];
}

describe("R2 import reconstructs fractional rank from the manifest", () => {
  it("restores trackRanks faithfully and orders by rank", async () => {
    // Manifest in display order c, a, b with increasing ranks.
    await importRemoteSetStream(
      {
        driveId: "drv_1",
        remoteSet: remoteSet([remoteTrack("c", 0), remoteTrack("a", 1024), remoteTrack("b", 2048)]),
      },
      db,
    );
    const s = await onlySession();
    expect(s.trackRanks).toBeDefined();
    // The exporter emits tracks[] already in display order, so trackIds == display order.
    expect(orderedSetTrackIds(s.trackIds, s.trackRanks)).toEqual(s.trackIds);
    expect(s.trackIds.map((id) => s.trackRanks?.[id])).toEqual([0, 1024, 2048]);
  });

  it("leaves a legacy manifest (no rank) unmaterialized, keeping array order", async () => {
    await importRemoteSetStream(
      {
        driveId: "drv_1",
        remoteSet: remoteSet([remoteTrack("a"), remoteTrack("b"), remoteTrack("c")]),
      },
      db,
    );
    const s = await onlySession();
    expect(s.trackRanks).toBeUndefined();
    expect(orderedSetTrackIds(s.trackIds, s.trackRanks)).toEqual(s.trackIds);
  });

  it("ranks local-only tracks after the remote max (invariant: trackRanks covers all)", async () => {
    // First import with no ranks, then graft a local-only track, then re-import with ranks.
    await importRemoteSetStream(
      { driveId: "drv_1", remoteSet: remoteSet([remoteTrack("a"), remoteTrack("b")]) },
      db,
    );
    const seeded = await onlySession();
    await db.sessions.update(seeded.id, { trackIds: [...seeded.trackIds, "trk_local_only"] });

    await importRemoteSetStream(
      { driveId: "drv_1", remoteSet: remoteSet([remoteTrack("a", 0), remoteTrack("b", 1024)]) },
      db,
    );
    const s = await onlySession();
    expect(Object.keys(s.trackRanks ?? {})).toHaveLength(3);
    expect(s.trackRanks?.trk_local_only).toBeGreaterThan(1024);
    expect(orderedSetTrackIds(s.trackIds, s.trackRanks).at(-1)).toBe("trk_local_only");
  });
});
