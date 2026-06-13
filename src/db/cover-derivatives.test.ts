import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countMissingCoverDerivatives,
  coverDerivativeId,
  coverDerivativeSourceForTrack,
  deleteCoverDerivativesForSource,
  ensureCoverBacklightDerivative,
  ensureCoverPaletteDerivative,
  ensureCoverThumbnailDerivative,
  repairMissingCoverDerivatives,
  resolveCoverPaletteDerivative,
} from "./cover-derivatives";
import { MuzeroDB } from "./muzero-db";
import { deleteTrack } from "./repositories";
import type { Track } from "./types";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-cover-derivatives-${Math.random().toString(36).slice(2)}`;
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

describe("cover derivatives", () => {
  it("builds a stable local-cover derivative id from source, crop, kind, and version", () => {
    expect(
      coverDerivativeId({
        cropSig: "10:20:300:300",
        kind: "thumbnail",
        sourceKey: "local:blb_cover",
        version: 1,
      }),
    ).toBe(
      coverDerivativeId({
        cropSig: "10:20:300:300",
        kind: "thumbnail",
        sourceKey: "local:blb_cover",
        version: 1,
      }),
    );
    expect(
      coverDerivativeId({
        cropSig: "full",
        kind: "thumbnail",
        sourceKey: "local:blb_cover",
        version: 1,
      }),
    ).not.toBe(
      coverDerivativeId({
        cropSig: "10:20:300:300",
        kind: "thumbnail",
        sourceKey: "local:blb_cover",
        version: 1,
      }),
    );
  });

  it("persists a thumbnail derivative and reuses it on the next request", async () => {
    const track = await addTrackWithCover("trk_thumb");
    const extract = vi.fn(async () => ({
      palette: [],
      thumbnail: {
        bytes: await new Blob(["thumb"], { type: "image/webp" }).arrayBuffer(),
        height: 96,
        mime: "image/webp",
        width: 96,
      },
      timings: {
        backlightMs: 0,
        decodeMs: 1,
        paletteMs: 0,
        thumbnailMs: 2,
        thumbhashMs: 0,
        totalMs: 3,
      },
    }));

    const first = await ensureCoverThumbnailDerivative(track, db, { extract });
    const second = await ensureCoverThumbnailDerivative(track, db, { extract });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(first?.derivative.id).toBe(second?.derivative.id);
    expect(first?.blobId).toBe(second?.blobId);
    expect(await first?.blob.text()).toBe("thumb");
    const row = await db.coverDerivatives.get(first?.derivative.id ?? "");
    expect(row).toMatchObject({
      blobId: first?.blobId,
      height: 96,
      kind: "thumbnail",
      mime: "image/webp",
      sourceKind: "local-cover",
      width: 96,
    });
  });

  it("persists a backlight derivative separately from the thumbnail derivative", async () => {
    const track = await addTrackWithCover("trk_backlight");
    const extract = vi.fn(async () => ({
      backlight: {
        bytes: await new Blob(["backlight"], { type: "image/webp" }).arrayBuffer(),
        height: 192,
        mime: "image/webp",
        width: 192,
      },
      palette: [],
      timings: {
        backlightMs: 2,
        decodeMs: 1,
        paletteMs: 0,
        thumbnailMs: 0,
        thumbhashMs: 0,
        totalMs: 3,
      },
    }));

    const first = await ensureCoverBacklightDerivative(track, db, { extract });
    const second = await ensureCoverBacklightDerivative(track, db, { extract });

    expect(extract).toHaveBeenCalledTimes(1);
    expect(first?.derivative.kind).toBe("backlight");
    expect(first?.derivative.id).toBe(second?.derivative.id);
    expect(first?.derivative.id).not.toBe(
      coverDerivativeId({
        cropSig: "10:20:300:300",
        kind: "thumbnail",
        sourceKey: `local:${track.coverBlobId}`,
        version: 1,
      }),
    );
    expect(await first?.blob.text()).toBe("backlight");
  });

  it("persists palette metadata without creating a media blob", async () => {
    const track = await addTrackWithCover("trk_palette");
    const palette = [{ r: 20, g: 120, b: 220 }];
    const extract = vi.fn(async () => ({
      palette,
      timings: {
        backlightMs: 0,
        decodeMs: 1,
        paletteMs: 2,
        thumbnailMs: 0,
        thumbhashMs: 0,
        totalMs: 3,
      },
    }));

    const first = await ensureCoverPaletteDerivative(track, db, { extract });
    const second = await resolveCoverPaletteDerivative(track, db);

    expect(extract).toHaveBeenCalledTimes(1);
    expect(first?.palette).toEqual(palette);
    expect(second?.palette).toEqual(palette);
    expect(first?.derivative.blobId).toBeUndefined();
    expect(first?.derivative).toMatchObject({
      kind: "palette",
      palette,
      sourceKind: "local-cover",
    });
    expect(await db.mediaBlobs.where("role").equals("cover-derivative").count()).toBe(0);
  });

  it("dedupes concurrent thumbnail generation for the same cover source", async () => {
    const track = await addTrackWithCover("trk_concurrent");
    let release: (() => void) | undefined;
    const result = {
      palette: [],
      thumbnail: {
        bytes: await new Blob(["thumb"], { type: "image/webp" }).arrayBuffer(),
        height: 96,
        mime: "image/webp",
        width: 96,
      },
      timings: {
        backlightMs: 0,
        decodeMs: 1,
        paletteMs: 0,
        thumbnailMs: 2,
        thumbhashMs: 0,
        totalMs: 3,
      },
    };
    const extract = vi.fn(
      () =>
        new Promise<typeof result>((resolve) => {
          release = () => resolve(result);
        }),
    );

    const first = ensureCoverThumbnailDerivative(track, db, { extract });
    const second = ensureCoverThumbnailDerivative(track, db, { extract });
    await waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(extract).toHaveBeenCalledTimes(1);
    expect(a?.derivative.id).toBe(b?.derivative.id);
  });

  it("counts and repairs missing thumbnail derivatives in batches", async () => {
    const track = await addTrackWithCover("trk_repair");
    const extract = vi.fn(async () => ({
      palette: [],
      thumbnail: {
        bytes: await new Blob(["thumb"], { type: "image/webp" }).arrayBuffer(),
        height: 96,
        mime: "image/webp",
        width: 96,
      },
      timings: {
        backlightMs: 0,
        decodeMs: 1,
        paletteMs: 0,
        thumbnailMs: 2,
        thumbhashMs: 0,
        totalMs: 3,
      },
    }));

    await expect(countMissingCoverDerivatives("thumbnail", db)).resolves.toBe(1);
    await expect(
      repairMissingCoverDerivatives("thumbnail", db, { extract, limit: 1 }),
    ).resolves.toMatchObject({
      attempted: [track.coverBlobId],
      failed: 0,
      processed: 1,
      updated: 1,
    });
    await expect(countMissingCoverDerivatives("thumbnail", db)).resolves.toBe(0);
  });

  it("deletes derivative rows and blobs for a replaced cover source", async () => {
    const track = await addTrackWithCover("trk_delete_source");
    const resolved = await ensureCoverThumbnailDerivative(track, db, {
      extract: async () => ({
        palette: [],
        thumbnail: {
          bytes: await new Blob(["thumb"], { type: "image/webp" }).arrayBuffer(),
          height: 96,
          mime: "image/webp",
          width: 96,
        },
        timings: {
          backlightMs: 0,
          decodeMs: 1,
          paletteMs: 0,
          thumbnailMs: 2,
          thumbhashMs: 0,
          totalMs: 3,
        },
      }),
    });
    expect(await db.mediaBlobs.get(resolved?.blobId ?? "")).toBeTruthy();

    await expect(deleteCoverDerivativesForSource(`local:${track.coverBlobId}`, db)).resolves.toBe(
      1,
    );

    expect(await db.coverDerivatives.get(resolved?.derivative.id ?? "")).toBeUndefined();
    expect(await db.mediaBlobs.get(resolved?.blobId ?? "")).toBeUndefined();
  });

  it("deletes derivative rows and blobs when the owning track is deleted", async () => {
    const track = await addTrackWithCover("trk_delete_track");
    const resolved = await ensureCoverThumbnailDerivative(track, db, {
      extract: async () => ({
        palette: [],
        thumbnail: {
          bytes: await new Blob(["thumb"], { type: "image/webp" }).arrayBuffer(),
          height: 96,
          mime: "image/webp",
          width: 96,
        },
        timings: {
          backlightMs: 0,
          decodeMs: 1,
          paletteMs: 0,
          thumbnailMs: 2,
          thumbhashMs: 0,
          totalMs: 3,
        },
      }),
    });

    await deleteTrack(track.id, db);

    expect(await db.coverDerivatives.get(resolved?.derivative.id ?? "")).toBeUndefined();
    expect(await db.mediaBlobs.get(resolved?.blobId ?? "")).toBeUndefined();
  });
});

async function addTrackWithCover(id: string): Promise<Track> {
  const coverBlobId = `blb_${id}`;
  await db.mediaBlobs.add({
    id: coverBlobId,
    trackId: id,
    role: "cover",
    mime: "image/png",
    bytes: 3,
    blob: png(),
  });
  const track: Track = {
    id,
    sessionId: "ses_1",
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
    coverBlobId,
    coverCrop: { height: 300, width: 300, x: 10, y: 20 },
  };
  await db.tracks.add(track);
  expect(coverDerivativeSourceForTrack(track)?.sourceKey).toBe(`local:${coverBlobId}`);
  return track;
}
