import { rgbaToThumbHash } from "thumbhash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { thumbhashToBase64 } from "@/lib/cover-thumbhash";
import { type MediaStorageProvider, putMediaBlob } from "./media-blob-storage";
import { MuzeroDB } from "./muzero-db";
import {
  backfillCoverMetadata,
  backfillCoverThumbhashes,
  countCoverMetadataBackfillCandidates,
  createSession,
} from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

function createMemoryProvider(id: "opfs" | "electron-file" = "opfs") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider = {
    id,
    userVisible: id === "electron-file",
    async put(input) {
      const storageKey = `cover/${input.id}`;
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
  };
  return provider;
}

/** Add a track that already has a cover blob but no thumbhash (a "legacy" cover). */
async function addTrackWithCover(id: string, sessionId: string): Promise<string> {
  const blobId = `blb_${id}`;
  await db.mediaBlobs.add({
    id: blobId,
    trackId: id,
    role: "cover",
    mime: "image/png",
    bytes: 3,
    blob: png(),
  });
  await db.tracks.add({
    id,
    sessionId,
    title: id,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 1,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    coverBlobId: blobId,
  });
  return blobId;
}

describe("backfillCoverThumbhashes", () => {
  it("encodes + persists a thumbhash for legacy covers across tracks, sessions, and entities", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await addTrackWithCover("trk_a", session.id);
    // A session cover with no thumbhash (simulate legacy: write blob + row directly).
    await db.mediaBlobs.add({
      id: "blb_s",
      trackId: session.id,
      role: "cover",
      mime: "image/png",
      bytes: 3,
      blob: png(),
    });
    await db.sessions.update(session.id, { coverBlobId: "blb_s" });
    await db.entityCovers.put({
      id: "artist::a",
      kind: "artist",
      coverBlobId: "blb_e",
      updatedAt: 1,
    });
    await db.mediaBlobs.add({
      id: "blb_e",
      trackId: "artist::a",
      role: "cover",
      mime: "image/png",
      bytes: 3,
      blob: png(),
    });

    const encode = vi.fn(async () => "HASH");
    const { updated, attempted } = await backfillCoverThumbhashes(db, encode);

    expect(updated).toBe(3);
    expect(attempted).toEqual(expect.arrayContaining(["blb_trk_a", "blb_s", "blb_e"]));
    expect((await db.tracks.get("trk_a"))?.coverThumbhash).toBe("HASH");
    expect((await db.sessions.get(session.id))?.coverThumbhash).toBe("HASH");
    expect((await db.entityCovers.get("artist::a"))?.thumbhash).toBe("HASH");
  });

  it("skips owners that already have a thumbhash (no wasted encode)", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await addTrackWithCover("trk_done", session.id);
    await db.tracks.update("trk_done", { coverThumbhash: "ALREADY" });

    const encode = vi.fn(async () => "HASH");
    const { updated } = await backfillCoverThumbhashes(db, encode);
    expect(updated).toBe(0);
    expect(encode).not.toHaveBeenCalled();
  });

  it("honors the limit so it can run incrementally", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await addTrackWithCover("trk_1", session.id);
    await addTrackWithCover("trk_2", session.id);
    await addTrackWithCover("trk_3", session.id);

    const encode = vi.fn(async () => "HASH");
    const first = await backfillCoverThumbhashes(db, encode, { limit: 2 });
    expect(first.updated).toBe(2);
    const second = await backfillCoverThumbhashes(db, encode, { limit: 2 });
    expect(second.updated).toBe(1); // only one legacy cover left
  });

  it("marks un-encodable covers as attempted (so a caller can avoid retrying) without persisting", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await addTrackWithCover("trk_bad", session.id);

    const encode = vi.fn(async () => undefined); // e.g. no canvas / decode failure
    const { updated, attempted } = await backfillCoverThumbhashes(db, encode);
    expect(updated).toBe(0);
    expect(attempted).toContain("blb_trk_bad");
    expect((await db.tracks.get("trk_bad"))?.coverThumbhash).toBeUndefined();
  });

  it("excludes blob ids in the skip set", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await addTrackWithCover("trk_skip", session.id);

    const encode = vi.fn(async () => "HASH");
    const { updated } = await backfillCoverThumbhashes(db, encode, {
      skip: new Set(["blb_trk_skip"]),
    });
    expect(updated).toBe(0);
    expect(encode).not.toHaveBeenCalled();
  });

  it("resolves provider-backed covers before encoding thumbhashes", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    const provider = createMemoryProvider("opfs");
    const cover = await putMediaBlob(
      {
        id: "blb_provider_cover",
        trackId: "trk_provider",
        role: "cover",
        mime: "image/png",
        blob: png(),
      },
      db,
      { provider },
    );
    await db.tracks.add({
      id: "trk_provider",
      sessionId: session.id,
      title: "provider",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 1,
      createdAt: 1,
      playCount: 0,
      liked: false,
      tags: [],
      coverBlobId: cover.id,
    });

    const encode = vi.fn(async () => "HASH");
    const { updated } = await backfillCoverThumbhashes(db, encode, {
      storage: { providers: [provider] },
    });

    expect(updated).toBe(1);
    expect(encode).toHaveBeenCalledWith(expect.any(Blob), undefined);
    expect((await db.tracks.get("trk_provider"))?.coverThumbhash).toBe("HASH");
  });
});

describe("backfillCoverMetadata", () => {
  it("repairs legacy local track covers with thumbhash and visualizer palette", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    const blobId = await addTrackWithCover("trk_palette", session.id);
    const palette = [
      { r: 20, g: 120, b: 220 },
      { r: 230, g: 140, b: 30 },
    ];
    const encode = vi.fn(async () => "HASH");
    const extract = vi.fn(async () => palette);

    await expect(countCoverMetadataBackfillCandidates(db)).resolves.toBe(1);
    const { updated, attempted } = await backfillCoverMetadata(db, { encode, extract });

    expect(updated).toBe(1);
    expect(attempted).toEqual([blobId]);
    expect(extract).toHaveBeenCalledWith(expect.anything(), undefined, "image/png");
    const track = await db.tracks.get("trk_palette");
    expect(track?.coverThumbhash).toBe("HASH");
    expect(track?.coverPalette).toEqual(palette);
    expect(track?.coverPaletteSource).toBe(blobId);
  });

  it("repairs remote-only track cover palettes from thumbhash without fetching bytes", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    const thumbhash = thumbhashToBase64(
      rgbaToThumbHash(1, 1, new Uint8ClampedArray([20, 120, 220, 255])),
    );
    await db.tracks.add({
      id: "trk_remote",
      sessionId: session.id,
      title: "remote",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 1,
      createdAt: 1,
      playCount: 0,
      liked: false,
      tags: [],
      coverThumbhash: thumbhash,
      remoteCoverUrl: "https://pub.example.com/objects/covers/blue.jpg",
    });
    const encode = vi.fn(async () => "SHOULD_NOT_RUN");
    const extract = vi.fn(async () => [{ r: 1, g: 2, b: 3 }]);

    await expect(countCoverMetadataBackfillCandidates(db)).resolves.toBe(1);
    const { updated, attempted } = await backfillCoverMetadata(db, { encode, extract });

    expect(updated).toBe(1);
    expect(attempted).toEqual([
      "remote:trk_remote:https://pub.example.com/objects/covers/blue.jpg",
    ]);
    expect(encode).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    const track = await db.tracks.get("trk_remote");
    expect(track?.coverPalette?.[0]?.b).toBeGreaterThan(track?.coverPalette?.[0]?.r ?? 0);
    expect(track?.coverPaletteSource).toBe("https://pub.example.com/objects/covers/blue.jpg");
  });
});
