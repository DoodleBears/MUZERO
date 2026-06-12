import { rgbaToThumbHash } from "thumbhash";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { thumbhashToBase64 } from "@/lib/cover-thumbhash";
import type { R2SetIndex } from "./r2-manifest-schema";
import { applySetPullMerges } from "./r2-set-pull-merge";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-set-pull-merge-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const config = {
  autoExtend: false,
  refillThreshold: 2,
  batchSize: 1,
  targetDurationSec: 60,
  allowVocals: true,
};

function remoteIndex(over: Partial<R2SetIndex> = {}): R2SetIndex {
  return {
    schema: "muzero-r2-set-index-v1",
    revision: 2,
    set: {
      id: "ses_1",
      name: "Shared",
      seedPrompt: "",
      displayMode: "cover",
      config,
      createdAt: 100,
      updatedAt: 1000,
    },
    tracks: [],
    ...over,
  };
}

async function seedOwnSession(over: Record<string, unknown> = {}) {
  await db.sessions.put({
    id: "ses_1",
    name: "Shared",
    seedPrompt: "",
    trackIds: ["trk_mine"],
    status: "idle",
    config,
    displayMode: "cover",
    createdAt: 100,
    updatedAt: 1000,
    ...over,
  });
  await db.tracks.put({
    id: "trk_mine",
    sessionId: "ses_1",
    title: "Mine",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 10,
    createdAt: 100,
    playCount: 0,
    liked: false,
    tags: [],
  });
}

const input = (index: R2SetIndex) => ({
  driveId: "drv_1",
  baseUrl: "https://pub.example.com/muzero/",
  setIds: ["ses_1"],
  base: { setIndexes: { ses_1: { value: index } } },
  db,
});

const blueThumbhash = () =>
  thumbhashToBase64(rgbaToThumbHash(1, 1, new Uint8ClampedArray([20, 120, 220, 255])));

describe("applySetPullMerges (co-editing receive half)", () => {
  it("lands another device's new member as a remote-backed row with its memory", async () => {
    await seedOwnSession();
    const index = remoteIndex({
      tracks: [
        {
          id: "trk_b",
          title: "From device B",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 9,
          createdAt: 200,
          liked: false,
          tags: [],
          rank: 5,
          media: { url: "objects/media/b.mp3", mime: "audio/mpeg", bytes: 3 },
          memories: [{ id: "mem_b", note: "from B", createdAt: 250 }],
        },
      ],
    });

    const result = await applySetPullMerges(input(index));

    expect(result.merged).toBe(1);
    const session = await db.sessions.get("ses_1");
    expect(session?.trackIds).toEqual(["trk_mine", "trk_remote_drv_1_trk_b"]);
    expect(session?.lastPulledAt).toBeGreaterThan(0);
    const row = await db.tracks.get("trk_remote_drv_1_trk_b");
    expect(row).toMatchObject({
      title: "From device B",
      remoteMediaUrl: "https://pub.example.com/muzero/objects/media/b.mp3",
    });
    expect(session?.trackRanks?.trk_remote_drv_1_trk_b).toBe(5);
    const memories = await db.memories.where("trackId").equals("trk_remote_drv_1_trk_b").toArray();
    expect(memories[0]).toMatchObject({ note: "from B" });
  });

  it("derives a remote cover palette from thumbhash for newly pulled members", async () => {
    await seedOwnSession();
    const index = remoteIndex({
      tracks: [
        {
          id: "trk_b",
          title: "From device B",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 9,
          createdAt: 200,
          liked: false,
          tags: [],
          media: { url: "objects/media/b.mp3", mime: "audio/mpeg", bytes: 3 },
          cover: { url: "objects/covers/b.jpg", mime: "image/jpeg", bytes: 4 },
          thumbhash: blueThumbhash(),
          memories: [],
        },
      ],
    });

    await applySetPullMerges(input(index));

    const row = await db.tracks.get("trk_remote_drv_1_trk_b");
    expect(row?.coverPalette?.[0]?.b).toBeGreaterThan(row?.coverPalette?.[0]?.r ?? 0);
    expect(row?.coverPaletteSource).toBe("https://pub.example.com/muzero/objects/covers/b.jpg");
  });

  it("applies a remote removal tombstone to a stale local copy", async () => {
    await seedOwnSession();
    const index = remoteIndex({ removedTracks: [{ id: "trk_mine", removedAt: 5000 }] });

    await applySetPullMerges(input(index));

    expect((await db.sessions.get("ses_1"))?.trackIds).toEqual([]);
  });

  it("keeps a genuine re-add (pulled after the removal already applied)", async () => {
    await seedOwnSession({ lastPulledAt: 6000 });
    const index = remoteIndex({ removedTracks: [{ id: "trk_mine", removedAt: 5000 }] });

    await applySetPullMerges(input(index));

    expect((await db.sessions.get("ses_1"))?.trackIds).toEqual(["trk_mine"]);
  });

  it("does not re-add a member this device removed (pending local tombstone)", async () => {
    await seedOwnSession({ trackIds: [], removedTracks: { trk_mine: 9000 } });
    const index = remoteIndex({
      tracks: [
        {
          id: "trk_mine",
          title: "Mine",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 10,
          createdAt: 100,
          liked: false,
          tags: [],
          media: { url: "objects/media/m.mp3", mime: "audio/mpeg", bytes: 3 },
          memories: [],
        },
      ],
    });

    await applySetPullMerges(input(index));

    expect((await db.sessions.get("ses_1"))?.trackIds).toEqual([]);
  });

  it("set metadata is last-write-wins", async () => {
    await seedOwnSession();
    const index = remoteIndex({
      set: { ...remoteIndex().set, name: "Renamed on B", updatedAt: 9000 },
    });

    await applySetPullMerges(input(index));

    expect(await db.sessions.get("ses_1")).toMatchObject({ name: "Renamed on B", updatedAt: 9000 });
  });
});
