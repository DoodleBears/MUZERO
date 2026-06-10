import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntryLike, FolderFs } from "@/lib/folder-import";
import { encodeNcm } from "@/lib/ncm-fixture";

// player-store imports the MediaEngine at module load; we never call init()/play()
// here, so a no-op stub keeps the import side-effect free.
vi.mock("@/player/media-engine", () => ({
  MediaEngine: class {
    getAnalyser() {
      return null;
    }
  },
}));

// The folder-import worker path parses tags with music-metadata (off-thread in
// the app; inline here since jsdom has no Worker). Stub parseBlob to a minimal
// metadata object so the ingest core runs instantly and deterministically.
vi.mock("music-metadata", () => ({
  parseBlob: vi.fn(async () => ({ common: {}, format: {} })),
}));

const file = (name: string): DirEntryLike => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});

/**
 * Fake desktop fs over an in-memory folder; `failPaths` make `readFile` throw,
 * `bytesByPath` overrides the bytes a path yields (default `[1,2,3]`).
 */
function fakeFs(
  tree: Record<string, DirEntryLike[]>,
  failPaths: Set<string> = new Set(),
  bytesByPath: Record<string, Uint8Array> = {},
): FolderFs {
  return {
    readDir: async (p) => tree[p] ?? [],
    join: (base, name) => `${base}/${name}`,
    readFile: async (p) => {
      if (failPaths.has(p)) throw new Error(`unreadable ${p}`);
      return (bytesByPath[p] ?? new Uint8Array([1, 2, 3])) as Uint8Array<ArrayBuffer>;
    },
  };
}

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.resetModules();
  await deleteDefaultDb();
});
afterEach(async () => {
  await deleteDefaultDb();
});

async function load() {
  const dbMod = await import("@/db/muzero-db");
  const repos = await import("@/db/repositories");
  const store = await import("./player-store");
  const notif = await import("@/stores/notification-store");
  return { db: dbMod.db, repos, runFolderSync: store.runFolderSync, notify: notif.notify };
}

/** Create an upload set + remember a folder bound to it; returns the folder id. */
async function rememberFolder(repos: Awaited<ReturnType<typeof load>>["repos"], path: string) {
  const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
  const folderId = await repos.upsertImportFolder({ path, setId: session.id });
  return { setId: session.id, folderId };
}

describe("runFolderSync", () => {
  it("imports new files once and skips already-known paths on re-scan (incremental)", async () => {
    const { db, repos, runFolderSync } = await load();
    const { setId, folderId } = await rememberFolder(repos, "/m");
    const fs = fakeFs({ "/m": [file("a.mp3"), file("b.mp3")] });

    const first = await runFolderSync([folderId], fs);
    expect(first.imported).toBe(2);
    let tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks.map((t) => t.sourcePath).sort()).toEqual(["/m/a.mp3", "/m/b.mp3"]);

    const second = await runFolderSync([folderId], fs);
    expect(second.imported).toBe(0);
    tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks).toHaveLength(2); // no duplicates

    const folder = (await repos.getSettings()).importFolders?.find((f) => f.id === folderId);
    expect(folder?.lastImportedCount).toBe(0);
    expect(folder?.lastScanAt).toBeTypeOf("number");
  });

  it("counts encrypted files and survives a corrupt file", async () => {
    const { db, repos, runFolderSync } = await load();
    const { setId, folderId } = await rememberFolder(repos, "/m");
    const fs = fakeFs(
      { "/m": [file("good.mp3"), file("bad.mp3"), file("locked.qmcflac")] },
      new Set(["/m/bad.mp3"]), // readFile throws for this one
    );

    const result = await runFolderSync([folderId], fs);

    // Only the readable plaintext file imports; the corrupt one is skipped, the
    // (still-unsupported) encrypted one is counted (never decoded). Counts come
    // back in the result — toasts are owned by the sync indicator, not this fn.
    expect(result.imported).toBe(1);
    expect(result.encrypted).toBe(1);
    expect(result.cancelled).toBe(false);
    const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks.map((t) => t.sourcePath)).toEqual(["/m/good.mp3"]);
  });

  it("decrypts a .ncm during folder sync; an undecodable .ncm is decode-failed", async () => {
    const { db, repos, runFolderSync } = await load();
    const { setId, folderId } = await rememberFolder(repos, "/m");
    const ncm = encodeNcm({
      audio: new Uint8Array([7, 7, 7, 7]),
      cover: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), // embedded → no network fetch
      meta: { musicName: "解密单曲", artist: [["歌手", 1]], album: "专辑", format: "mp3" },
    });
    const fs = fakeFs(
      { "/m": [file("real.ncm"), file("broken.ncm")] },
      new Set(),
      { "/m/real.ncm": new Uint8Array(ncm) }, // broken.ncm falls back to junk bytes
    );

    const result = await runFolderSync([folderId], fs);

    expect(result.imported).toBe(1);
    expect(result.decodeFailed).toBe(1);
    const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks).toHaveLength(1);
    expect(tracks[0].title).toBe("解密单曲");
    expect(tracks[0].sourcePath).toBe("/m/real.ncm");
    expect(tracks[0].kind).toBe("audio");
    // Embedded container image was stored as the cover (no remote fetch needed).
    const cover = tracks[0].coverBlobId
      ? await db.mediaBlobs.get(tracks[0].coverBlobId)
      : undefined;
    expect(cover?.role).toBe("cover");
    expect(cover?.mime).toBe("image/jpeg");
    const media = tracks[0].blobId ? await db.mediaBlobs.get(tracks[0].blobId) : undefined;
    expect(media?.mime).toBe("audio/mpeg");
  });
});
