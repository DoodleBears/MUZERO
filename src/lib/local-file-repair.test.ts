import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { Memory, Track } from "@/db/types";
import type { FolderFs } from "./folder-import";
import { findLocalFileRepairCandidate, repairTrackSourcePathFromFolder } from "./local-file-repair";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-local-file-repair-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("findLocalFileRepairCandidate", () => {
  it("matches by original filename and track kind", () => {
    expect(
      findLocalFileRepairCandidate(localTrack(), [
        { path: "/new/Moon Song.mp4", name: "Moon Song.mp4", kind: "video" },
        { path: "/new/Moon Song.mp3", name: "Moon Song.mp3", kind: "audio" },
      ]),
    ).toMatchObject({ path: "/new/Moon Song.mp3" });
  });
});

describe("repairTrackSourcePathFromFolder", () => {
  it("repairs sourcePath without touching user-authored library state", async () => {
    const track = localTrack();
    await seedTrack(track);
    const memory: Memory = {
      id: "mem_1",
      trackId: track.id,
      note: "summer bus ride",
      createdAt: 1,
    };
    await db.memories.put(memory);

    const result = await repairTrackSourcePathFromFolder({
      db,
      folderPath: "/new",
      fs: fakeFs({
        "/new": [{ name: "nested", isDirectory: true, isFile: false, isSymlink: false }],
        "/new/nested": [
          { name: "Moon Song.mp3", isDirectory: false, isFile: true, isSymlink: false },
        ],
      }),
      now: () => 2,
      track,
    });

    const repaired = await db.tracks.get(track.id);
    const session = await db.sessions.get(track.sessionId);
    expect(result).toEqual({ kind: "repaired", sourcePath: "/new/nested/Moon Song.mp3" });
    expect(repaired).toMatchObject({
      id: track.id,
      sourcePath: "/new/nested/Moon Song.mp3",
      tags: ["favorite"],
      liked: true,
      updatedAt: 2,
      mediaMetadata: {
        album: "Blue Record",
        originalFileName: "Moon Song.mp3",
        originalMime: "audio/mpeg",
      },
    });
    expect(session?.trackIds).toEqual([track.id]);
    expect(await db.memories.get(memory.id)).toMatchObject(memory);
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it("leaves the existing track unchanged when no matching file is found", async () => {
    const track = localTrack();
    await seedTrack(track);

    const result = await repairTrackSourcePathFromFolder({
      db,
      folderPath: "/new",
      fs: fakeFs({
        "/new": [{ name: "Other.mp3", isDirectory: false, isFile: true, isSymlink: false }],
      }),
      track,
    });

    expect(result).toEqual({ kind: "no-match" });
    expect(await db.tracks.get(track.id)).toMatchObject({ sourcePath: "/old/Moon Song.mp3" });
  });
});

function localTrack(): Track {
  return {
    id: "trk_local",
    sessionId: "ses_local",
    title: "Moon Song",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    sourcePath: "/old/Moon Song.mp3",
    createdAt: 1,
    updatedAt: 1,
    playCount: 3,
    liked: true,
    tags: ["favorite"],
    mediaMetadata: {
      album: "Blue Record",
      originalFileName: "Moon Song.mp3",
      originalMime: "audio/mpeg",
      parser: "manual",
      parsedAt: 1,
      title: "Moon Song",
    },
  };
}

async function seedTrack(track: Track): Promise<void> {
  await db.sessions.put({
    id: track.sessionId,
    name: "Local Set",
    seedPrompt: "",
    trackIds: [track.id],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "cover",
    createdAt: 1,
    updatedAt: 1,
  });
  await db.tracks.put(track);
}

function fakeFs(entries: Record<string, Awaited<ReturnType<FolderFs["readDir"]>>>): FolderFs {
  return {
    readDir: async (path) => entries[path] ?? [],
    join: (base, name) => `${base}/${name}`,
    readFile: async () => {
      throw new Error("repair should not read media bytes");
    },
  };
}
