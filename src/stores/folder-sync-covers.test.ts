import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntryLike, FolderFs } from "@/lib/folder-import";
import { encodeNcm } from "@/lib/ncm-fixture";

const FOLDER_SYNC_COVER_TEST_TIMEOUT_MS = 15_000;

vi.mock("@/player/media-engine", () => ({
  MediaEngine: class {
    getAnalyser() {
      return null;
    }
  },
}));

// Content-aware stub: a file whose 1st byte is 0xEB carries an embedded picture
// whose LENGTH mirrors the file's 2nd byte (byte[1] * 11) — a per-file marker that
// survives the IndexedDB clone as the stored blob size. Anything else → no picture
// (the .ncm stream is [7,7,7,7], so it takes the remote albumPic path).
vi.mock("music-metadata", () => ({
  parseBlob: vi.fn(async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes[0] === 0xeb) {
      return {
        common: { picture: [{ format: "image/png", data: new Uint8Array(bytes[1] * 11) }] },
        format: {},
      };
    }
    return { common: {}, format: {} };
  }),
}));

// jsdom never settles `<img>` loads, so cover palette extraction would hang on
// object URLs. The production path treats decode failures as an empty palette.
vi.mock("@/lib/image-palette", () => ({
  extractImagePalette: vi.fn(async () => []),
}));

// Distinct image per cover URL: the 4th byte encodes which cover it is, so we can
// assert each track stored ITS OWN cover (not a neighbour's).
vi.mock("@/lib/platform", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  const marker = (url: string) => (url.includes("cover1") ? 1 : url.includes("cover2") ? 2 : 9);
  const fetchFn = async (url: string) =>
    new Response(new Uint8Array([0xff, 0xd8, 0xff, marker(url)]), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  return { ...actual, getAppFetch: async () => fetchFn, appFetch: fetchFn };
});

const file = (name: string): DirEntryLike => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});

function fakeFs(
  tree: Record<string, DirEntryLike[]>,
  bytesByPath: Record<string, Uint8Array>,
): FolderFs {
  return {
    readDir: async (p) => tree[p] ?? [],
    join: (base, name) => `${base}/${name}`,
    readFile: async (p) => (bytesByPath[p] ?? new Uint8Array([1, 2, 3])) as Uint8Array<ArrayBuffer>,
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
  return { db: dbMod.db, repos, runFolderSync: store.runFolderSync };
}

const ncm = (musicName: string, albumPic: string) =>
  new Uint8Array(
    encodeNcm({
      audio: new Uint8Array([7, 7, 7, 7]),
      meta: { musicName, artist: [["歌手", 1]], album: "专辑", format: "mp3", albumPic },
    }),
  );

describe("runFolderSync remote covers", () => {
  it(
    "stores each .ncm's own albumPic cover on its own track (no cross-track swap)",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
      const folderId = await repos.upsertImportFolder({ path: "/m", setId: session.id });

      const fs = fakeFs(
        { "/m": [file("a.ncm"), file("b.ncm")] },
        {
          "/m/a.ncm": ncm("歌曲A", "https://cdn/cover1.jpg"),
          "/m/b.ncm": ncm("歌曲B", "https://cdn/cover2.jpg"),
        },
      );

      const result = await runFolderSync([folderId], fs);
      expect(result.imported).toBe(2);

      // Cover fetches are fire-and-forget — wait for both to land.
      const trackByPath = async () => {
        const rows = await db.tracks.where("sessionId").equals(session.id).toArray();
        return new Map(rows.map((t) => [t.sourcePath, t]));
      };
      for (let i = 0; i < 100; i += 1) {
        const m = await trackByPath();
        const a = m.get("/m/a.ncm");
        const b = m.get("/m/b.ncm");
        if (a?.coverBlobId && b?.coverBlobId) break;
        await new Promise((r) => setTimeout(r, 10));
      }

      const m = await trackByPath();
      const a = m.get("/m/a.ncm");
      const b = m.get("/m/b.ncm");
      expect(a?.coverBlobId).toBeTruthy();
      expect(b?.coverBlobId).toBeTruthy();

      const coverMarker = async (blobId: string | undefined) => {
        const row = blobId ? await db.mediaBlobs.get(blobId) : undefined;
        if (!row?.blob) return undefined;
        return new Uint8Array(await row.blob.arrayBuffer())[3];
      };
      // 歌曲A must carry cover1 (marker 1), 歌曲B must carry cover2 (marker 2).
      expect(await coverMarker(a?.coverBlobId)).toBe(1);
      expect(await coverMarker(b?.coverBlobId)).toBe(2);
    },
    FOLDER_SYNC_COVER_TEST_TIMEOUT_MS,
  );

  it(
    "stores each plaintext file's own EMBEDDED cover on its own track (worker path)",
    async () => {
      const { db, repos, runFolderSync } = await load();
      const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
      const folderId = await repos.upsertImportFolder({ path: "/m", setId: session.id });

      // 0xEB sentinel → the parseBlob stub returns an embedded picture marked by byte[1].
      const fs = fakeFs(
        { "/m": [file("a.mp3"), file("b.mp3")] },
        {
          "/m/a.mp3": new Uint8Array([0xeb, 1, 0, 0]),
          "/m/b.mp3": new Uint8Array([0xeb, 2, 0, 0]),
        },
      );

      const result = await runFolderSync([folderId], fs);
      expect(result.imported).toBe(2);

      const rows = await db.tracks.where("sessionId").equals(session.id).toArray();
      const byPath = new Map(rows.map((t) => [t.sourcePath, t]));
      const a = byPath.get("/m/a.mp3");
      const b = byPath.get("/m/b.mp3");

      // Marker = stored cover blob size (byte[1] * 11): a.mp3 → 11, b.mp3 → 22.
      const coverSize = async (blobId: string | undefined) =>
        blobId ? (await db.mediaBlobs.get(blobId))?.bytes : undefined;
      // Embedded covers land atomically with createUploadedTrack — each on its own track.
      expect(await coverSize(a?.coverBlobId)).toBe(11);
      expect(await coverSize(b?.coverBlobId)).toBe(22);
    },
    FOLDER_SYNC_COVER_TEST_TIMEOUT_MS,
  );
});
