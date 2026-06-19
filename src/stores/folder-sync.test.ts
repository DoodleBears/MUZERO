import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@/lib/desktop/bridge";
import type { DirEntryLike, FolderFs } from "@/lib/folder-import";
import { encodeNcm } from "@/lib/ncm-fixture";

const FOLDER_SYNC_TEST_TIMEOUT_MS = 15_000;

// player-store imports the MediaEngine at module load; we never call init()/play()
// here, so a no-op stub keeps the import side-effect free.
vi.mock("@/player/media-engine", () => ({
  MediaEngine: class {
    destroy() {}
    getAnalyser() {
      return null;
    }
    on() {
      return () => {};
    }
    setMuted() {}
    setVolume() {}
  },
}));

// The folder-import worker path parses tags with music-metadata (off-thread in
// the app; inline here since jsdom has no Worker). Stub parseBlob to a minimal
// metadata object so the ingest core runs instantly and deterministically.
vi.mock("music-metadata", () => ({
  parseBlob: vi.fn(async () => ({ common: {}, format: {} })),
}));

// jsdom never settles `<img>` loads, so embedded-cover palette extraction would
// hang on the object URL. Match the browser failure fallback: no palette.
vi.mock("@/lib/image-palette", () => ({
  extractImagePalette: vi.fn(async () => []),
}));

const file = (name: string): DirEntryLike => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});
const dir = (name: string): DirEntryLike => ({
  name,
  isDirectory: true,
  isFile: false,
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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
  Object.defineProperty(window, "muzero", { configurable: true, value: undefined });
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
  it(
    "imports new files once and skips already-known paths on re-scan (incremental)",
    async () => {
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
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it("clears terminal folder import progress after the UI settle window", async () => {
    const { repos, runFolderSync } = await load();
    const folderImport = await import("./folder-import-store");
    const { folderId } = await rememberFolder(repos, "/settle");
    const fs = fakeFs({ "/settle": [file("a.mp3")] });

    await runFolderSync([folderId], fs);
    expect(folderImport.useFolderImportStore.getState().progress?.phase).toBe("completed");

    await new Promise((resolve) => setTimeout(resolve, 1900));

    expect(folderImport.useFolderImportStore.getState().progress).toBeNull();
  });

  it("defers active-set queue append until folder import progress clears", async () => {
    const { repos, runFolderSync } = await load();
    const folderImport = await import("./folder-import-store");
    const store = await import("./player-store");
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const folderId = await repos.upsertImportFolder({ path: "/active", setId: session.id });
    await store.usePlayerStore.getState().setActiveSession(session.id);
    const fs = fakeFs({ "/active": [file("a.mp3"), file("b.mp3")] });

    await runFolderSync([folderId], fs);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await repos.getPlayQueue()).entries).toHaveLength(0);

    folderImport.setFolderImportProgress(null);

    // Clearing progress flushes the deferred append asynchronously (store
    // subscription → DB write). A single macrotask tick is racy under load, so
    // poll until it lands instead of assuming it completed in one turn.
    await vi.waitFor(async () => {
      expect((await repos.getPlayQueue()).entries.map((entry) => entry.trackId)).toHaveLength(2);
    });
  });

  it(
    "repairs tracks written before the final folder publish on resume",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const { setId, folderId } = await rememberFolder(repos, "/m");
      const fs = fakeFs({ "/m": [file("half-published.mp3")] });
      const readFile = vi.spyOn(fs, "readFile");
      const [track] = await repos.createReferencedUploadedTracks([
        {
          sessionId: setId,
          title: "half-published",
          kind: "audio",
          mime: "audio/mpeg",
          durationSec: 0,
          sourcePath: "/m/half-published.mp3",
          mediaMetadata: {
            originalMime: "audio/mpeg",
            originalExtension: "mp3",
            parser: "manual",
            parsedAt: Date.now(),
          },
        },
      ]);
      await expect(repos.getSession(setId)).resolves.toMatchObject({ trackIds: [] });

      const result = await runFolderSync([folderId], fs);

      expect(result).toMatchObject({ imported: 1, decodeFailed: 0, cancelled: false });
      expect(readFile).not.toHaveBeenCalled();
      const session = await repos.getSession(setId);
      expect(session?.trackIds).toEqual([track.id]);
      const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
      expect(tracks).toHaveLength(1);
      expect(tracks[0].sourcePath).toBe("/m/half-published.mp3");
      await expect(db.mediaBlobs.where("role").equals("media").count()).resolves.toBe(0);

      const second = await runFolderSync([folderId], fs);
      expect(second.imported).toBe(0);
      expect((await repos.getSession(setId))?.trackIds).toEqual([track.id]);
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "does not recover a known folder track that the user removed from the set",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const { setId, folderId } = await rememberFolder(repos, "/m");
      const fs = fakeFs({ "/m": [file("removed.mp3")] });
      const readFile = vi.spyOn(fs, "readFile");
      const [track] = await repos.createReferencedUploadedTracks([
        {
          sessionId: setId,
          title: "removed",
          kind: "audio",
          mime: "audio/mpeg",
          durationSec: 0,
          sourcePath: "/m/removed.mp3",
          mediaMetadata: {
            originalMime: "audio/mpeg",
            originalExtension: "mp3",
            parser: "manual",
            parsedAt: Date.now(),
          },
        },
      ]);
      await repos.insertTrackIdsAfter(setId, [track.id]);
      await repos.removeTrackFromSession(setId, track.id);
      const removedSession = await repos.getSession(setId);
      expect(removedSession?.trackIds).toEqual([]);
      expect(removedSession?.removedTracks?.[track.id]).toBeTypeOf("number");

      const result = await runFolderSync([folderId], fs);

      expect(result).toMatchObject({ imported: 0, decodeFailed: 0, cancelled: false });
      expect(readFile).not.toHaveBeenCalled();
      expect((await repos.getSession(setId))?.trackIds).toEqual([]);
      const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
      expect(tracks).toHaveLength(1);
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "counts encrypted files and survives a corrupt file",
    async () => {
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
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "honors a remembered folder's non-recursive scan preference",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
      const folderId = await repos.upsertImportFolder({
        path: "/m",
        setId: session.id,
        recursive: false,
      });
      const fs = fakeFs({
        "/m": [file("top.mp3"), dir("nested")],
        "/m/nested": [file("hidden.mp3")],
      });

      const result = await runFolderSync([folderId], fs);

      expect(result.imported).toBe(1);
      const tracks = await db.tracks.where("sessionId").equals(session.id).toArray();
      expect(tracks.map((t) => t.sourcePath)).toEqual(["/m/top.mp3"]);
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "publishes completed folder imports before the entire large folder finishes",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const { setId, folderId } = await rememberFolder(repos, "/m");
      const files = Array.from({ length: 26 }, (_, i) =>
        file(`song-${String(i + 1).padStart(2, "0")}.mp3`),
      );
      const reachedLastRead = deferred();
      const releaseLastRead = deferred();
      const baseFs = fakeFs({ "/m": files });
      const fs: FolderFs = {
        ...baseFs,
        readFile: async (path) => {
          if (path.endsWith("song-26.mp3")) {
            reachedLastRead.resolve();
            await releaseLastRead.promise;
          }
          return baseFs.readFile(path);
        },
      };

      const sync = runFolderSync([folderId], fs);
      await reachedLastRead.promise;

      const midImport = await repos.getSession(setId);
      expect(midImport?.trackIds).toHaveLength(25);

      releaseLastRead.resolve();
      await sync;

      const finished = await repos.getSession(setId);
      expect(finished?.trackIds).toHaveLength(26);
      const rows = await db.tracks.bulkGet(finished?.trackIds ?? []);
      expect(rows.map((track) => track?.sourcePath)).toEqual(
        Array.from({ length: 26 }, (_, i) => `/m/song-${String(i + 1).padStart(2, "0")}.mp3`),
      );
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "decrypts a .ncm during folder sync; an undecodable .ncm is decode-failed",
    async () => {
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
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "references Electron .ncm folder imports without copying decoded media",
    async () => {
      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });

      const { db } = await import("@/db/muzero-db");
      const repos = await import("@/db/repositories");
      const desktop = await import("@/lib/desktop/bridge");
      const ncm = encodeNcm({
        audio: new Uint8Array([7, 8, 9, 10]),
        cover: Uint8Array.from([0xff, 0xd8, 0xff, 0x44]),
        meta: { musicName: "Electron 解密", artist: [["歌手", 1]], format: "mp3" },
      });
      const baseFs = fakeFs({ "/m": [file("electron.ncm")] }, new Set(), {
        "/m/electron.ncm": new Uint8Array(ncm),
      });
      const releaseHydrationRead = deferred();
      const fs: FolderFs = {
        ...baseFs,
        readFile: async (path) => {
          await releaseHydrationRead.promise;
          return baseFs.readFile(path);
        },
      };
      const writes = new Map<string, Uint8Array<ArrayBuffer>>();
      const bridge: DesktopBridge = {
        kind: "electron",
        fetch: globalThis.fetch.bind(globalThis),
        openExternal: async () => {},
        readDir: fs.readDir,
        readFile: fs.readFile,
        join: fs.join,
        grantFolderAccess: async () => {},
        writeMediaStorageFile: async (input) => {
          writes.set(input.storageKey, new Uint8Array(input.bytes));
        },
        readMediaStorageFile: async (input) =>
          writes.get(input.storageKey) ?? new Uint8Array(new ArrayBuffer(0)),
        deleteMediaStorageFile: async (input) => {
          if (input.storageKey) writes.delete(input.storageKey);
        },
        statMediaStorageFile: async (input) => {
          const bytes = writes.get(input.storageKey)?.byteLength;
          return bytes == null ? null : { bytes };
        },
      };
      desktop.__setDesktopBridge(bridge);
      const store = await import("./player-store");
      const { setId, folderId } = await rememberFolder(repos, "/m");

      const result = await store.runFolderSync([folderId]);

      expect(result.imported).toBe(1);
      const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
      expect(tracks).toHaveLength(1);
      expect(tracks[0].title).toBe("electron");
      expect(tracks[0].sourcePath).toBe("/m/electron.ncm");
      expect(tracks[0].blobId).toBeUndefined();
      expect(tracks[0].mediaMetadata?.originalExtension).toBe("ncm");
      expect(tracks[0].durationSec).toBe(0);
      releaseHydrationRead.resolve();
      await vi.waitFor(async () => {
        const hydrated = await db.tracks.get(tracks[0].id);
        expect(hydrated?.title).toBe("Electron 解密");
        expect(hydrated?.coverBlobId).toBeTruthy();
      });
      const mediaRows = await db.mediaBlobs.where("trackId").equals(tracks[0].id).toArray();
      expect(mediaRows.filter((row) => row.role === "media")).toHaveLength(0);
      expect(mediaRows.filter((row) => row.role === "cover")).toHaveLength(1);
      expect([...writes.keys()].filter((key) => key.startsWith("media/"))).toHaveLength(0);
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it(
    "resumes lazy referenced ncm metadata hydration after restart",
    async () => {
      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });

      const desktop = await import("@/lib/desktop/bridge");
      const { db } = await import("@/db/muzero-db");
      const repos = await import("@/db/repositories");
      const ncm = encodeNcm({
        audio: new Uint8Array([1, 3, 5, 7]),
        meta: {
          musicName: "恢复单曲",
          artist: [["续传歌手", 1]],
          album: "重启专辑",
          duration: 123_000,
          format: "mp3",
        },
      });
      const blockedRead = deferred();
      const initialReadFile = vi.fn(async () => {
        await blockedRead.promise;
        return new Uint8Array(ncm) as Uint8Array<ArrayBuffer>;
      });
      const firstBridge: DesktopBridge = {
        kind: "electron",
        fetch: globalThis.fetch.bind(globalThis),
        openExternal: async () => {},
        readDir: async (path) => (path === "/resume" ? [file("resume.ncm")] : []),
        readFile: initialReadFile,
        join: async (base, name) => `${base}/${name}`,
        grantFolderAccess: async () => {},
      };
      desktop.__setDesktopBridge(firstBridge);
      const store = await import("./player-store");
      const { setId, folderId } = await rememberFolder(repos, "/resume");

      const result = await store.runFolderSync([folderId]);

      expect(result.imported).toBe(1);
      expect(initialReadFile).toHaveBeenCalledTimes(1);
      const [placeholder] = await db.tracks.where("sessionId").equals(setId).toArray();
      expect(placeholder?.title).toBe("resume");
      expect(placeholder?.durationSec).toBe(0);
      expect(placeholder?.blobId).toBeUndefined();

      vi.resetModules();
      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });
      const desktopAfterRestart = await import("@/lib/desktop/bridge");
      const dbAfterRestart = await import("@/db/muzero-db");
      const restoredReadFile = vi.fn(async () => new Uint8Array(ncm) as Uint8Array<ArrayBuffer>);
      const grantFolderAccess = vi.fn(async () => {});
      const grantFileAccess = vi.fn(async () => {});
      const restartBridge: DesktopBridge = {
        kind: "electron",
        fetch: globalThis.fetch.bind(globalThis),
        openExternal: async () => {},
        readFile: restoredReadFile,
        grantFolderAccess,
        grantFileAccess,
      };
      desktopAfterRestart.__setDesktopBridge(restartBridge);
      const storeAfterRestart = await import("./player-store");

      await storeAfterRestart.usePlayerStore.getState().restoreReferencedLocalFileAccess();

      expect(grantFolderAccess).toHaveBeenCalledWith("/resume");
      expect(grantFileAccess).not.toHaveBeenCalled();
      await vi.waitFor(async () => {
        const hydrated = await dbAfterRestart.db.tracks.get(placeholder?.id ?? "");
        expect(hydrated?.title).toBe("恢复单曲");
        expect(hydrated?.durationSec).toBe(123);
        expect(hydrated?.mediaMetadata?.artists).toEqual(["续传歌手"]);
        expect(hydrated?.blobId).toBeUndefined();
      });
      const mediaRows = await dbAfterRestart.db.mediaBlobs
        .where("trackId")
        .equals(placeholder?.id ?? "")
        .toArray();
      expect(mediaRows.filter((row) => row.role === "media")).toHaveLength(0);
      blockedRead.resolve();
    },
    FOLDER_SYNC_TEST_TIMEOUT_MS,
  );

  it("restores remembered folder access with one folder grant instead of per-file grants", async () => {
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: { kind: "electron" },
    });

    const desktop = await import("@/lib/desktop/bridge");
    const repos = await import("@/db/repositories");
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    await repos.upsertImportFolder({ path: "/bulk", setId: session.id, recursive: true });
    await repos.createReferencedUploadedTracks(
      Array.from({ length: 100 }, (_, index) => ({
        sessionId: session.id,
        title: `bulk-${index}`,
        kind: "audio" as const,
        mime: "audio/mpeg",
        durationSec: 0,
        sourcePath: `/bulk/song-${index}.mp3`,
        mediaMetadata: {
          originalMime: "audio/mpeg",
          originalExtension: "mp3",
          parser: "manual" as const,
          parsedAt: Date.now(),
        },
      })),
    );
    const grantFolderAccess = vi.fn(async () => {});
    const grantFileAccess = vi.fn(async () => {});
    desktop.__setDesktopBridge({
      kind: "electron",
      fetch: globalThis.fetch.bind(globalThis),
      openExternal: async () => {},
      grantFolderAccess,
      grantFileAccess,
    });
    const store = await import("./player-store");

    await store.usePlayerStore.getState().restoreReferencedLocalFileAccess();

    expect(grantFolderAccess).toHaveBeenCalledTimes(1);
    expect(grantFolderAccess).toHaveBeenCalledWith("/bulk");
    expect(grantFileAccess).not.toHaveBeenCalled();
  });

  it("restores remembered folder access even when exact file grants are unavailable", async () => {
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: { kind: "electron" },
    });

    const desktop = await import("@/lib/desktop/bridge");
    const repos = await import("@/db/repositories");
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    await repos.upsertImportFolder({ path: "/folder-only", setId: session.id, recursive: true });
    await repos.createReferencedUploadedTracks([
      {
        sessionId: session.id,
        title: "folder-only",
        kind: "audio",
        mime: "audio/mpeg",
        durationSec: 0,
        sourcePath: "/folder-only/song.mp3",
        mediaMetadata: {
          originalMime: "audio/mpeg",
          originalExtension: "mp3",
          parser: "manual",
          parsedAt: Date.now(),
        },
      },
    ]);
    const grantFolderAccess = vi.fn(async () => {});
    desktop.__setDesktopBridge({
      kind: "electron",
      fetch: globalThis.fetch.bind(globalThis),
      openExternal: async () => {},
      grantFolderAccess,
    });
    const store = await import("./player-store");

    await store.usePlayerStore.getState().restoreReferencedLocalFileAccess();

    expect(grantFolderAccess).toHaveBeenCalledTimes(1);
    expect(grantFolderAccess).toHaveBeenCalledWith("/folder-only");
  });

  it("bulk-imports a 1000-track Electron referenced folder without reading media bytes", async () => {
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: { kind: "electron" },
    });

    const desktop = await import("@/lib/desktop/bridge");
    const { db } = await import("@/db/muzero-db");
    const repos = await import("@/db/repositories");
    const trace = await import("@/lib/trace");
    const folderImport = await import("./folder-import-store");
    const files = Array.from({ length: 1000 }, (_, i) =>
      file(`bulk-${String(i + 1).padStart(4, "0")}.mp3`),
    );
    const readFile = vi.fn(async () => {
      throw new Error("plain referenced files should not be read");
    });
    const bridge: DesktopBridge = {
      kind: "electron",
      fetch: globalThis.fetch.bind(globalThis),
      openExternal: async () => {},
      readDir: async (path) => (path === "/bulk" ? files : []),
      readFile,
      join: async (base, name) => `${base}/${name}`,
      grantFolderAccess: async () => {},
    };
    desktop.__setDesktopBridge(bridge);
    const store = await import("./player-store");
    const { setId, folderId } = await rememberFolder(repos, "/bulk");
    trace.clearTrace();
    let importingProgressUpdates = 0;
    const unsubscribe = folderImport.useFolderImportStore.subscribe((state) => {
      if (state.progress?.phase === "importing") importingProgressUpdates += 1;
    });

    const startedAt = performance.now();
    const result = await store.runFolderSync([folderId]);
    const elapsedMs = performance.now() - startedAt;
    unsubscribe();

    expect(result).toMatchObject({ imported: 1000, decodeFailed: 0, cancelled: false });
    expect(readFile).not.toHaveBeenCalled();
    const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks).toHaveLength(1000);
    expect(tracks.every((track) => track.sourcePath?.startsWith("/bulk/"))).toBe(true);
    expect(tracks.every((track) => !track.blobId)).toBe(true);
    await expect(db.mediaBlobs.where("role").equals("media").count()).resolves.toBe(0);
    const session = await repos.getSession(setId);
    expect(session?.trackIds).toHaveLength(1000);
    expect(
      trace
        .getTraceEntries()
        .filter((entry) => entry.scope === "player.folderSync" && entry.event === "import.publish"),
    ).toHaveLength(0);
    expect(
      trace
        .getTraceEntries()
        .filter(
          (entry) => entry.scope === "player.folderSync" && entry.event === "import.publish.final",
        ),
    ).toHaveLength(1);
    expect(importingProgressUpdates).toBeLessThanOrEqual(3);
    expect(elapsedMs).toBeLessThan(5000);
  }, 20_000);

  it("uses Electron native folder scan when available", async () => {
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: { kind: "electron" },
    });

    const desktop = await import("@/lib/desktop/bridge");
    const { db } = await import("@/db/muzero-db");
    const repos = await import("@/db/repositories");
    const readDir = vi.fn(async () => {
      throw new Error("native scan should replace renderer readDir");
    });
    const scanFolderForMedia = vi.fn(async () => ({
      encryptedCount: 1,
      media: [
        { path: "/native/a.mp3", name: "a.mp3", kind: "audio" as const },
        { path: "/native/b.ncm", name: "b.ncm", kind: "audio" as const, decode: "ncm" as const },
      ],
      unsupportedCount: 2,
    }));
    const bridge: DesktopBridge = {
      kind: "electron",
      fetch: globalThis.fetch.bind(globalThis),
      openExternal: async () => {},
      readDir,
      readFile: vi.fn(() => new Promise<Uint8Array<ArrayBuffer>>(() => {})),
      join: (base, name) => `${base}/${name}`,
      grantFolderAccess: async () => {},
      scanFolderForMedia,
    };
    desktop.__setDesktopBridge(bridge);
    const store = await import("./player-store");
    const { setId, folderId } = await rememberFolder(repos, "/native");

    const result = await store.runFolderSync([folderId]);

    expect(result).toMatchObject({ imported: 2, encrypted: 1, decodeFailed: 0 });
    expect(scanFolderForMedia).toHaveBeenCalledWith("/native", { recursive: true });
    expect(readDir).not.toHaveBeenCalled();
    const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks.map((track) => track.sourcePath).sort()).toEqual([
      "/native/a.mp3",
      "/native/b.ncm",
    ]);
  });

  it("bulk-imports a 1000-track Electron referenced ncm folder without awaiting hydration", async () => {
    Object.defineProperty(window, "muzero", {
      configurable: true,
      value: { kind: "electron" },
    });

    const desktop = await import("@/lib/desktop/bridge");
    const { db } = await import("@/db/muzero-db");
    const repos = await import("@/db/repositories");
    const trace = await import("@/lib/trace");
    const folderImport = await import("./folder-import-store");
    const files = Array.from({ length: 1000 }, (_, i) =>
      file(`bulk-ncm-${String(i + 1).padStart(4, "0")}.ncm`),
    );
    const readFile = vi.fn(() => new Promise<Uint8Array<ArrayBuffer>>(() => {}));
    const bridge: DesktopBridge = {
      kind: "electron",
      fetch: globalThis.fetch.bind(globalThis),
      openExternal: async () => {},
      readDir: async (path) => (path === "/bulk-ncm" ? files : []),
      readFile,
      join: async (base, name) => `${base}/${name}`,
      grantFolderAccess: async () => {},
    };
    desktop.__setDesktopBridge(bridge);
    const store = await import("./player-store");
    const { setId, folderId } = await rememberFolder(repos, "/bulk-ncm");
    trace.clearTrace();
    let importingProgressUpdates = 0;
    const unsubscribe = folderImport.useFolderImportStore.subscribe((state) => {
      if (state.progress?.phase === "importing") importingProgressUpdates += 1;
    });

    const startedAt = performance.now();
    const result = await store.runFolderSync([folderId]);
    const elapsedMs = performance.now() - startedAt;
    unsubscribe();

    expect(result).toMatchObject({ imported: 1000, decodeFailed: 0, cancelled: false });
    expect(readFile.mock.calls.length).toBeLessThanOrEqual(2);
    const tracks = await db.tracks.where("sessionId").equals(setId).toArray();
    expect(tracks).toHaveLength(1000);
    expect(tracks.every((track) => track.sourcePath?.startsWith("/bulk-ncm/"))).toBe(true);
    expect(tracks.every((track) => track.mediaMetadata?.originalExtension === "ncm")).toBe(true);
    expect(tracks.every((track) => !track.blobId)).toBe(true);
    await expect(db.mediaBlobs.where("role").equals("media").count()).resolves.toBe(0);
    const session = await repos.getSession(setId);
    expect(session?.trackIds).toHaveLength(1000);
    expect(
      trace
        .getTraceEntries()
        .filter((entry) => entry.scope === "player.folderSync" && entry.event === "import.publish"),
    ).toHaveLength(0);
    expect(
      trace
        .getTraceEntries()
        .filter(
          (entry) => entry.scope === "player.folderSync" && entry.event === "import.publish.final",
        ),
    ).toHaveLength(1);
    expect(importingProgressUpdates).toBeLessThanOrEqual(3);
    expect(elapsedMs).toBeLessThan(5000);
  }, 20_000);
});
