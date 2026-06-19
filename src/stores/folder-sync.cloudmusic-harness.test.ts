import { copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { stdout } from "node:process";
import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@/lib/desktop/bridge";
import { type DirEntryLike, type FolderFs, scanFolderForMedia } from "@/lib/folder-import";
import type { TraceEntry } from "@/lib/trace";

const HARNESS_TIMEOUT_MS = 60_000;
const LARGE_SYNC_SAMPLE_SIZE = Math.max(
  1,
  Number.parseInt(process.env.MUZERO_HARNESS_SAMPLE_SIZE ?? "1000", 10),
);
const LARGE_SYNC_MAX_MS = Math.max(
  1000,
  Number.parseInt(
    process.env.MUZERO_HARNESS_MAX_MS ?? String(Math.ceil(LARGE_SYNC_SAMPLE_SIZE * 2)),
    10,
  ),
);
const harnessRoot = process.env.MUZERO_HARNESS_CLOUDMUSIC;
const benchmarkLoops = Math.max(1, Number.parseInt(process.env.MUZERO_HARNESS_LOOPS ?? "1", 10));
const runHarness = harnessRoot ? describe : describe.skip;
const preparedHarnessDir = path.resolve(".vitest-attachments", "cloudmusic-playback-harness");

const mediaEngineMock = vi.hoisted(() => ({
  instances: [] as Array<{ callbacks: unknown }>,
  loadBlob: vi.fn(() => Promise.resolve()),
  loadUrl: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  seek: vi.fn(),
  setDiagnosticsContext: vi.fn(),
}));

vi.mock("@/player/media-engine", () => ({
  MediaEngine: class {
    callbacks: unknown;
    loadBlob = mediaEngineMock.loadBlob;
    loadUrl = mediaEngineMock.loadUrl;
    play = mediaEngineMock.play;
    seek = mediaEngineMock.seek;
    setDiagnosticsContext = mediaEngineMock.setDiagnosticsContext;
    constructor(callbacks: unknown = {}) {
      this.callbacks = callbacks;
      mediaEngineMock.instances.push(this);
    }
    setCallbacks(callbacks: unknown) {
      this.callbacks = callbacks;
    }
    setVolume() {}
    pause() {}
    mount() {}
    unmount() {}
    stop() {}
    getAnalyser() {
      return null;
    }
    get element() {
      return null;
    }
  },
}));

vi.mock("music-metadata", () => ({
  parseBlob: vi.fn(async () => ({ common: {}, format: {} })),
}));

vi.mock("@/lib/image-palette", () => ({
  extractImagePalette: vi.fn(async () => []),
}));

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

function writeHarnessLine(line: string): void {
  stdout.write(`${line}\n`);
}

beforeEach(async () => {
  vi.resetModules();
  mediaEngineMock.loadBlob.mockClear();
  mediaEngineMock.loadUrl.mockClear();
  mediaEngineMock.play.mockClear();
  mediaEngineMock.seek.mockClear();
  mediaEngineMock.setDiagnosticsContext.mockClear();
  mediaEngineMock.instances.length = 0;
  await deleteDefaultDb();
});

afterEach(async () => {
  Object.defineProperty(window, "muzero", { configurable: true, value: undefined });
  await deleteDefaultDb();
});

function nodeFolderFs(): FolderFs {
  return {
    async readDir(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.map((entry): DirEntryLike => {
        const isSymlink = entry.isSymbolicLink();
        return {
          name: entry.name,
          isDirectory: !isSymlink && entry.isDirectory(),
          isFile: !isSymlink && entry.isFile(),
          isSymlink,
        };
      });
    },
    join: (base, name) => path.win32.join(base, name),
    async readFile(filePath) {
      return new Uint8Array(await readFile(filePath)) as Uint8Array<ArrayBuffer>;
    },
  };
}

async function findSampleFiles(root: string) {
  const plaintext: string[] = [];
  const ncm: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.win32.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (plaintext.length === 0 || ncm.length === 0) await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if ((ext === ".mp3" || ext === ".flac" || ext === ".wav") && plaintext.length === 0) {
        plaintext.push(full);
      } else if (ext === ".ncm" && ncm.length === 0) {
        ncm.push(full);
      }
      if (plaintext.length > 0 && ncm.length > 0) return;
    }
  }

  await walk(root);
  return { plaintext: plaintext[0], ncm: ncm[0] };
}

async function collectImportableMediaFiles(root: string, limit: number): Promise<string[]> {
  const scan = await scanFolderForMedia(root, nodeFolderFs(), { recursive: true });
  return scan.media.slice(0, limit).map((file) => file.path);
}

function summarizeCollectedFiles(root: string, files: readonly string[]) {
  const extensions = new Map<string, number>();
  const directories = new Set<string>();
  let maxDepth = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase() || "<none>";
    extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
    const relative = path.win32.relative(root, file);
    const parts = relative.split(/[\\/]/).filter(Boolean);
    const depth = Math.max(0, parts.length - 1);
    maxDepth = Math.max(maxDepth, depth);
    const dir = path.win32.dirname(relative);
    if (dir && dir !== ".") directories.add(path.win32.normalize(dir));
  }

  const extensionSummary = [...extensions.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ext, count]) => `${ext}=${count}`)
    .join(",");

  return {
    directoryCount: directories.size,
    extensionSummary,
    maxDepth,
  };
}

function buildSampleTree(root: string, files: string[]) {
  const dirs = new Map<string, DirEntryLike[]>();
  const fileSet = new Set(files.map((file) => path.win32.normalize(file)));
  const addEntry = (dir: string, entry: DirEntryLike) => {
    const key = path.win32.normalize(dir);
    const list = dirs.get(key) ?? [];
    if (!list.some((item) => item.name === entry.name)) list.push(entry);
    dirs.set(key, list);
  };

  for (const file of fileSet) {
    const relative = path.win32.relative(root, file);
    const parts = relative.split(/[\\/]/).filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i]!;
      const isLast = i === parts.length - 1;
      addEntry(dir, {
        name,
        isDirectory: !isLast,
        isFile: isLast,
        isSymlink: false,
      });
      if (!isLast) dir = path.win32.join(dir, name);
    }
  }

  return {
    readDir: async (dir: string) => dirs.get(path.win32.normalize(dir)) ?? [],
    readFile: async (filePath: string) =>
      new Uint8Array(await readFile(filePath)) as Uint8Array<ArrayBuffer>,
    join: (base: string, name: string) => path.win32.join(base, name),
  };
}

async function preparePlaybackHarnessFolder(root: string) {
  const samples = await findSampleFiles(root);
  expect(samples.plaintext).toBeTruthy();
  expect(samples.ncm).toBeTruthy();

  const resolved = path.resolve(preparedHarnessDir);
  const workspace = path.resolve(".");
  if (!resolved.startsWith(workspace)) {
    throw new Error(`Refusing to prepare harness outside workspace: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
  const plaintextPath = path.join(
    resolved,
    `sample-plain${path.extname(samples.plaintext!) || ".mp3"}`,
  );
  const ncmPath = path.join(resolved, "sample-ncm.ncm");
  await copyFile(samples.plaintext!, plaintextPath);
  await copyFile(samples.ncm!, ncmPath);
  return { folder: resolved, plaintextPath, ncmPath };
}

function createNodeDesktopBridge(): DesktopBridge {
  const fs = nodeFolderFs();
  return {
    kind: "electron",
    fetch: globalThis.fetch.bind(globalThis),
    openExternal: async () => {},
    grantFolderAccess: async () => {},
    readDir: fs.readDir,
    readFile: fs.readFile,
    join: fs.join,
    localMediaUrl: async (input) =>
      `muzfetch://local-media/?path=${encodeURIComponent(input.path)}`,
  };
}

function formatTraceValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value == null) return "";
  return String(value);
}

function writeFolderSyncTraceSummary(loop: number, elapsedMs: number, entries: TraceEntry[]): void {
  const rows = entries.filter(
    (entry) => entry.scope === "player.folderSync" || entry.scope === "sync.indicator",
  );
  const complete = rows.find(
    (entry) => entry.scope === "player.folderSync" && entry.event === "run.complete",
  );
  const traceId =
    complete?.context?.traceId ?? rows.find((entry) => entry.context?.traceId)?.context?.traceId;
  writeHarnessLine(
    `[CloudMusic harness] loop=${loop} elapsedMs=${elapsedMs.toFixed(1)} trace=${traceId ?? "n/a"}`,
  );
  for (const entry of rows) {
    const ctx = entry.context ?? {};
    const interesting = [
      "durationMs",
      "folderPhase",
      "reason",
      "folders",
      "totalFresh",
      "count",
      "imported",
      "done",
      "total",
      "media",
      "fresh",
      "known",
      "scanMs",
      "dedupMs",
      "mode",
      "coverJobs",
    ]
      .map((key) => [key, ctx[key]] as const)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${formatTraceValue(value)}`)
      .join(" ");
    writeHarnessLine(
      `[CloudMusic trace] loop=${loop} scope=${entry.scope} event=${entry.event ?? entry.message} ${interesting}`.trim(),
    );
  }
}

runHarness("CloudMusic real-folder harness", () => {
  it(
    "scans the real folder and smoke-imports plaintext plus ncm as sourcePath references",
    async () => {
      const root = path.win32.normalize(harnessRoot!);
      await expect(stat(root)).resolves.toMatchObject({ isDirectory: expect.any(Function) });

      const scan = await scanFolderForMedia(root, nodeFolderFs());
      const plaintextCount = scan.media.filter((file) => !file.decode).length;
      const ncmCount = scan.media.filter((file) => file.decode === "ncm").length;
      expect(plaintextCount).toBeGreaterThan(0);
      expect(ncmCount).toBeGreaterThan(0);

      const samples = await findSampleFiles(root);
      expect(samples.plaintext).toBeTruthy();
      expect(samples.ncm).toBeTruthy();

      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });

      const sampleFs = buildSampleTree(root, [samples.plaintext!, samples.ncm!]);
      const writes = new Map<string, Uint8Array<ArrayBuffer>>();
      const desktop = await import("@/lib/desktop/bridge");
      const bridge: DesktopBridge = {
        kind: "electron",
        fetch: globalThis.fetch.bind(globalThis),
        openExternal: async () => {},
        grantFolderAccess: async () => {},
        readDir: sampleFs.readDir,
        readFile: sampleFs.readFile,
        join: sampleFs.join,
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

      const { db } = await import("@/db/muzero-db");
      const repos = await import("@/db/repositories");
      const store = await import("./player-store");
      const session = await repos.createSession({
        seedPrompt: "",
        config: { autoExtend: false },
      });
      const folderId = await repos.upsertImportFolder({ path: root, setId: session.id });

      const result = await store.runFolderSync([folderId]);

      expect(result).toMatchObject({
        imported: 2,
        cancelled: false,
      });
      expect(result.decodeFailed).toBe(0);

      const tracks = await db.tracks.where("sessionId").equals(session.id).toArray();
      expect(tracks).toHaveLength(2);
      const plaintextTrack = tracks.find((track) => track.sourcePath === samples.plaintext);
      const ncmTrack = tracks.find((track) => track.sourcePath === samples.ncm);
      expect(plaintextTrack).toMatchObject({
        origin: "uploaded",
        sourcePath: samples.plaintext,
        status: "ready",
      });
      expect(plaintextTrack?.blobId).toBeUndefined();
      expect(ncmTrack?.blobId).toBeUndefined();
      expect(ncmTrack?.mediaMetadata?.originalExtension).toBe("ncm");
      await waitFor(async () => {
        const hydrated = ncmTrack ? await db.tracks.get(ncmTrack.id) : undefined;
        expect(hydrated?.durationSec ?? 0).toBeGreaterThan(0);
      });

      const mediaRows = ncmTrack
        ? await db.mediaBlobs.where("trackId").equals(ncmTrack.id).toArray()
        : [];
      expect(mediaRows.filter((row) => row.role === "media")).toHaveLength(0);
      expect([...writes.keys()].filter((key) => key.startsWith("media/"))).toHaveLength(0);
    },
    HARNESS_TIMEOUT_MS,
  );

  it(
    "prepares a small folder, imports it as a new set, and playback-loads mp3 plus ncm references",
    async () => {
      const root = path.win32.normalize(harnessRoot!);
      const prepared = await preparePlaybackHarnessFolder(root);
      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });

      const desktop = await import("@/lib/desktop/bridge");
      desktop.__setDesktopBridge(createNodeDesktopBridge());

      const { db } = await import("@/db/muzero-db");
      const repos = await import("@/db/repositories");
      const store = await import("./player-store");
      const session = await repos.createSession({
        name: "CloudMusic playback harness",
        seedPrompt: "",
        config: { autoExtend: false },
        displayMode: "cover",
      });
      const folderId = await repos.upsertImportFolder({ path: prepared.folder, setId: session.id });

      const result = await store.runFolderSync([folderId]);

      expect(result.imported).toBe(2);
      expect(result.decodeFailed).toBe(0);
      await store.usePlayerStore.getState().setActiveSession(session.id);
      await waitFor(() => expect(store.usePlayerStore.getState().queue).toHaveLength(2));
      const queue = store.usePlayerStore.getState().queue;
      const plaintextIndex = queue.findIndex(
        (track) => track.sourcePath === prepared.plaintextPath,
      );
      const ncmIndex = queue.findIndex((track) => track.sourcePath === prepared.ncmPath);
      expect(plaintextIndex).toBeGreaterThanOrEqual(0);
      expect(ncmIndex).toBeGreaterThanOrEqual(0);
      expect(queue[plaintextIndex]?.blobId).toBeUndefined();
      expect(queue[ncmIndex]?.blobId).toBeUndefined();

      await store.usePlayerStore.getState().playIndex(plaintextIndex);
      expect(mediaEngineMock.loadUrl).toHaveBeenCalledWith(
        expect.stringContaining("muzfetch://local-media/"),
        "audio",
        { crossOrigin: "anonymous" },
      );
      expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();

      mediaEngineMock.loadUrl.mockClear();
      mediaEngineMock.loadBlob.mockClear();
      await store.usePlayerStore.getState().playIndex(ncmIndex);
      expect(mediaEngineMock.loadUrl).not.toHaveBeenCalled();
      expect(mediaEngineMock.loadBlob).toHaveBeenCalledWith(expect.any(Blob), "audio");
      const ncmCall = mediaEngineMock.loadBlob.mock.calls.at(-1) as [Blob, "audio"] | undefined;
      const ncmBlob = ncmCall?.[0];
      expect(ncmBlob).toBeDefined();
      expect(ncmBlob).toBeInstanceOf(Blob);
      expect(ncmBlob?.size).toBeGreaterThan(1024);
      expect(ncmBlob?.type).toBe("audio/mpeg");

      const tracks = await db.tracks.where("sessionId").equals(session.id).toArray();
      expect(tracks.every((track) => track.sourcePath?.startsWith(prepared.folder))).toBe(true);
      expect(tracks.every((track) => !track.blobId)).toBe(true);
    },
    HARNESS_TIMEOUT_MS,
  );

  it(
    "imports real CloudMusic media paths as references after a clean DB reset",
    async () => {
      const root = path.win32.normalize(harnessRoot!);
      const files = await collectImportableMediaFiles(root, LARGE_SYNC_SAMPLE_SIZE);
      const expectedImportCount = files.length;
      expect(expectedImportCount).toBeGreaterThan(0);
      expect(expectedImportCount).toBeLessThanOrEqual(LARGE_SYNC_SAMPLE_SIZE);
      const summary = summarizeCollectedFiles(root, files);
      writeHarnessLine(
        `[CloudMusic harness] collected=${expectedImportCount} sampleLimit=${LARGE_SYNC_SAMPLE_SIZE} directories=${summary.directoryCount} maxDepth=${summary.maxDepth} extensions=${summary.extensionSummary}`,
      );
      Object.defineProperty(window, "muzero", {
        configurable: true,
        value: { kind: "electron" },
      });

      const sampleFs = buildSampleTree(root, files);
      const readFile = vi.fn(() => new Promise<Uint8Array<ArrayBuffer>>(() => {}));
      const desktop = await import("@/lib/desktop/bridge");
      desktop.__setDesktopBridge({
        kind: "electron",
        fetch: globalThis.fetch.bind(globalThis),
        openExternal: async () => {},
        grantFolderAccess: async () => {},
        readDir: sampleFs.readDir,
        readFile,
        join: sampleFs.join,
      });

      const { db } = await import("@/db/muzero-db");
      const repos = await import("@/db/repositories");
      const folderImport = await import("./folder-import-store");
      const notification = await import("./notification-store");
      const syncIndicator = await import("./sync-indicator");
      const trace = await import("@/lib/trace");
      const store = await import("./player-store");
      syncIndicator.startSyncIndicator();

      for (let loop = 1; loop <= benchmarkLoops; loop += 1) {
        await db.transaction("rw", db.tracks, db.sessions, db.settings, async () => {
          await db.tracks.clear();
          await db.sessions.clear();
          await db.settings.clear();
        });
        notification.notify.clear();
        trace.clearTrace();
        const session = await repos.createSession({
          name: `CloudMusic ${expectedImportCount} reference harness ${loop}`,
          seedPrompt: "",
          config: { autoExtend: false },
        });
        const folderId = await repos.upsertImportFolder({ path: root, setId: session.id });
        let importingProgressUpdates = 0;
        const unsubscribe = folderImport.useFolderImportStore.subscribe((state) => {
          if (state.progress?.phase === "importing") importingProgressUpdates += 1;
        });

        const startedAt = performance.now();
        const result = await store.runFolderSync([folderId]);
        const elapsedMs = performance.now() - startedAt;
        unsubscribe();
        writeFolderSyncTraceSummary(loop, elapsedMs, trace.getTraceEntries());

        expect(result).toMatchObject({
          imported: expectedImportCount,
          decodeFailed: 0,
          cancelled: false,
        });
        expect(readFile.mock.calls.length).toBeLessThanOrEqual(2);
        expect(importingProgressUpdates).toBeLessThanOrEqual(
          Math.ceil(expectedImportCount / 1000) + 3,
        );
        expect(elapsedMs).toBeLessThan(LARGE_SYNC_MAX_MS);
        const tracks = await db.tracks.where("sessionId").equals(session.id).toArray();
        expect(tracks).toHaveLength(expectedImportCount);
        expect(tracks.every((track) => track.sourcePath && files.includes(track.sourcePath))).toBe(
          true,
        );
        expect(tracks.every((track) => !track.blobId)).toBe(true);
        await expect(db.mediaBlobs.where("role").equals("media").count()).resolves.toBe(0);
        await expect(repos.getSession(session.id)).resolves.toMatchObject({
          trackIds: expect.arrayContaining(tracks.map((track) => track.id)),
        });
      }
    },
    HARNESS_TIMEOUT_MS,
  );
});
