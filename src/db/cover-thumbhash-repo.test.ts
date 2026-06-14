import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_THUMB64 = "XjM9LzMI9wiIh4hwj3CI+AiIcH/494cP";

// Stub the browser-only encoder so the wiring is testable in jsdom: every cover
// blob "encodes" to a known marker. (The real encoder needs canvas; here we only
// assert that setting a cover persists whatever thumbhash the encoder returns.)
vi.mock("@/lib/cover-thumbhash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cover-thumbhash")>();
  return {
    ...actual,
    encodeCoverThumbhash: vi.fn(async () => VALID_THUMB64),
  };
});

const mocks = vi.hoisted(() => ({
  palette: [
    { r: 20, g: 120, b: 220 },
    { r: 230, g: 140, b: 30 },
  ],
}));

vi.mock("@/lib/image-palette", () => ({
  extractImagePalette: vi.fn(async () => mocks.palette),
}));

vi.mock("@/workers/cover-client", () => ({
  extractCoverMetadataViaWorker: vi.fn(
    async ({ targets }: { targets?: readonly ("palette" | "thumbhash")[] }) => ({
      palette: targets?.includes("palette") ? mocks.palette : [],
      thumbhash: targets?.includes("thumbhash") ? VALID_THUMB64 : undefined,
      timings: {
        backlightMs: 0,
        decodeMs: 0,
        paletteMs: 0,
        thumbnailMs: 0,
        thumbhashMs: 0,
        totalMs: 0,
      },
    }),
  ),
}));

import { extractCoverMetadataViaWorker } from "@/workers/cover-client";
import { MuzeroDB } from "./muzero-db";
import {
  countCoverMetadataBackfillCandidates,
  createSession,
  createUploadedTrack,
  setEntityCover,
  setSessionCover,
  setTrackCover,
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

describe("cover-set generates + persists a thumbhash on the owner row (Phase 3)", () => {
  it("setTrackCover stores coverThumbhash on the track", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    const id = await db.tracks.add({
      id: "trk_thumb",
      sessionId: session.id,
      title: "t",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 1,
      createdAt: 1,
      playCount: 0,
      liked: false,
      tags: [],
    });
    await setTrackCover({ trackId: id as string, blob: png(), mime: "image/png" }, db);
    const track = await db.tracks.get("trk_thumb");
    expect(track?.coverThumbhash).toBe(VALID_THUMB64);
    expect(track?.coverPalette).toEqual(mocks.palette);
    expect(track?.coverPaletteSource).toBe(track?.coverBlobId);
  });

  it("createUploadedTrack stores thumbhash AND the accurate palette in one decode for embedded covers", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);

    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Imported",
        kind: "audio",
        blob: new Blob([new Uint8Array([9, 9, 9])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 12,
        embeddedCover: { blob: png(), mime: "image/png" },
      },
      db,
    );

    const stored = await db.tracks.get(track.id);
    expect(stored?.coverBlobId).toBeTruthy();
    expect(stored?.coverThumbhash).toBe(VALID_THUMB64);
    // The accurate worker palette is set immediately — no second decode / flush.
    expect(stored?.coverPalette).toEqual(mocks.palette);
    expect(stored?.coverPaletteSource).toBe(stored?.coverBlobId);
    expect(await countCoverMetadataBackfillCandidates(db)).toBe(0);
  });

  it("imports the track WITHOUT a cover when the embedded image can't be decoded (no rollback)", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);

    // An undecodable embedded image: the worker AND its inline fallback reject with
    // InvalidStateError — exactly how `createImageBitmap` fails on the corrupt VIP
    // `.ncm` covers seen in the field. This must NOT sink the whole import.
    const decodeError = new Error("The source image could not be decoded.");
    decodeError.name = "InvalidStateError";
    vi.mocked(extractCoverMetadataViaWorker).mockRejectedValueOnce(decodeError);

    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Bad cover",
        kind: "audio",
        blob: new Blob([new Uint8Array([9, 9, 9])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 7,
        embeddedCover: { blob: png(), mime: "image/png" },
      },
      db,
    );

    // The track still landed — audio intact, just cover-less (no thumbhash/palette).
    const stored = await db.tracks.get(track.id);
    expect(stored).toBeTruthy();
    expect(stored?.status).toBe("ready");
    expect(stored?.blobId).toBeTruthy();
    expect(stored?.coverBlobId).toBeUndefined();
    expect(stored?.coverThumbhash).toBeUndefined();

    // Audio media blob retained; the unrenderable cover blob was cleaned up (not orphaned).
    const blobs = await db.mediaBlobs.toArray();
    expect(blobs.filter((b) => b.role === "media")).toHaveLength(1);
    expect(blobs.filter((b) => b.role === "cover")).toHaveLength(0);
  });

  it("setSessionCover stores coverThumbhash on the session", async () => {
    const session = await createSession({ name: "s", seedPrompt: "", config: {} }, db);
    await setSessionCover({ sessionId: session.id, blob: png(), mime: "image/png" }, db);
    expect((await db.sessions.get(session.id))?.coverThumbhash).toBe(VALID_THUMB64);
  });

  it("setEntityCover stores thumbhash on the entity-cover row", async () => {
    await setEntityCover(
      { entityKey: "artist::x", kind: "artist", blob: png(), mime: "image/png" },
      db,
    );
    expect((await db.entityCovers.get("artist::x"))?.thumbhash).toBe(VALID_THUMB64);
  });
});
