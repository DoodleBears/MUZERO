import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  createUploadedTrack,
  getTrackLyrics,
  setTrackLyrics,
} from "@/db/repositories";
import { buildR2ExportPlan } from "./r2-export-plan";
import { importRemoteSetStream, lyricsRemoteWins } from "./r2-import-stream";
import { r2SetIndexSchema } from "./r2-manifest-schema";
import type { RemoteSetIndexResult } from "./r2-subscription";

describe("lyricsRemoteWins", () => {
  it("lets remote win when there is no local record", () => {
    expect(lyricsRemoteWins(undefined, { source: "lrclib" })).toBe(true);
  });

  it("keeps a local manual record over a remote auto one", () => {
    expect(lyricsRemoteWins({ source: "manual" }, { source: "lrclib" })).toBe(false);
  });

  it("lets a remote manual record win over a local auto one", () => {
    expect(lyricsRemoteWins({ source: "lrclib" }, { source: "manual" })).toBe(true);
  });

  it("lets remote win between two manual records (published is authoritative)", () => {
    expect(lyricsRemoteWins({ source: "manual" }, { source: "manual" })).toBe(true);
  });
});

describe("lyrics R2 round-trip", () => {
  let db: MuzeroDB;
  let dbName: string;

  beforeEach(() => {
    dbName = `muzero-lyrics-sync-${Math.random().toString(36).slice(2)}`;
    db = new MuzeroDB(dbName);
  });

  afterEach(async () => {
    db.close();
    await deleteDb(dbName);
  });

  async function seedSetWithLyrics(): Promise<string> {
    const session = await createSession({ seedPrompt: "night drive" }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Blue Highway",
        kind: "audio",
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 214,
      },
      db,
    );
    // createUploadedTrack doesn't append to the set (the store does); do it here.
    await db.sessions.update(session.id, { trackIds: [track.id] });
    await setTrackLyrics(
      {
        trackId: track.id,
        record: {
          source: "lrclib",
          instrumental: false,
          status: "found",
          synced: "[00:01.00]hi",
          plain: "hi",
        },
      },
      db,
    );
    return session.id;
  }

  async function exportedIndex(setId: string) {
    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://x/muzero/",
      setIds: [setId],
      db,
    });
    return r2SetIndexSchema.parse(
      JSON.parse(String(plan.objects.find((o) => o.kind === "set-index")?.body)),
    );
  }

  function asRemoteSet(index: ReturnType<typeof r2SetIndexSchema.parse>): RemoteSetIndexResult {
    return {
      indexUrl: "https://x/muzero/index.json",
      index,
      tracks: index.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        mediaUrl: "https://x/m.mp3",
        coverUrl: undefined,
        memoryPhotoUrls: [],
        source: t,
      })),
    };
  }

  it("carries lyrics through the set index on export", async () => {
    const index = await exportedIndex(await seedSetWithLyrics());
    expect(index.tracks[0].lyrics).toMatchObject({
      source: "lrclib",
      synced: "[00:01.00]hi",
      plain: "hi",
      instrumental: false,
    });
  });

  it("lands exported lyrics into a fresh device on import", async () => {
    const remoteSet = asRemoteSet(await exportedIndex(await seedSetWithLyrics()));
    const fresh = new MuzeroDB(`${dbName}-b`);
    try {
      const res = await importRemoteSetStream({ driveId: "drv_2", remoteSet }, fresh);
      const row = await getTrackLyrics(res.trackIds[0], fresh);
      expect(row).toMatchObject({ source: "lrclib", synced: "[00:01.00]hi", status: "found" });
    } finally {
      fresh.close();
      await deleteDb(`${dbName}-b`);
    }
  });

  it("does not clobber a local manual record on re-import", async () => {
    const remoteSet = asRemoteSet(await exportedIndex(await seedSetWithLyrics()));
    const fresh = new MuzeroDB(`${dbName}-c`);
    try {
      const res = await importRemoteSetStream({ driveId: "drv_2", remoteSet }, fresh);
      const id = res.trackIds[0];
      await setTrackLyrics(
        {
          trackId: id,
          record: { source: "manual", instrumental: false, status: "found", plain: "my words" },
        },
        fresh,
      );
      await importRemoteSetStream({ driveId: "drv_2", remoteSet }, fresh);
      const row = await getTrackLyrics(id, fresh);
      expect(row?.source).toBe("manual");
      expect(row?.plain).toBe("my words");
    } finally {
      fresh.close();
      await deleteDb(`${dbName}-c`);
    }
  });
});

function deleteDb(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = () => resolve();
  });
}
