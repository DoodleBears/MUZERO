import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";

// Generous headroom for CPU starvation under the parallel suite — see the note
// on FOLDER_SYNC_TEST_TIMEOUT_MS in folder-sync.test.ts.
const PLAYER_STORE_INTEGRATION_TEST_TIMEOUT_MS = 30_000;

// The store drives a real <audio>/<video> MediaEngine in init(); for store-level
// tests we only care about WHICH source it asks the engine to load, so stub the
// engine and capture loadUrl/loadBlob/play. (vi.hoisted survives vi.resetModules
// because it lives in this test module, not the re-imported store module.)
const mediaEngineMock = vi.hoisted(() => ({
  instances: [] as Array<{ callbacks: MediaEngineCallbacksForTest }>,
  loadUrl: vi.fn(() => Promise.resolve()),
  loadBlob: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  seek: vi.fn(),
  setDiagnosticsContext: vi.fn(),
}));
const platformFetchMock = vi.hoisted(() =>
  vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response("remote", { headers: { "content-type": "audio/mpeg" } }),
  ),
);

vi.mock("@/player/media-engine", () => {
  class MockMediaEngine {
    callbacks: unknown;
    loadUrl = mediaEngineMock.loadUrl;
    loadBlob = mediaEngineMock.loadBlob;
    play = mediaEngineMock.play;
    setDiagnosticsContext = mediaEngineMock.setDiagnosticsContext;
    constructor(callbacks: unknown = {}) {
      this.callbacks = callbacks;
      mediaEngineMock.instances.push(this as unknown as { callbacks: MediaEngineCallbacksForTest });
    }
    setCallbacks(callbacks: unknown) {
      this.callbacks = callbacks;
    }
    setVolume() {}
    pause() {}
    seek = mediaEngineMock.seek;
    mount() {}
    unmount() {}
    stop() {}
    getAnalyser() {
      return null;
    }
    get element() {
      return null;
    }
  }
  return { MediaEngine: MockMediaEngine };
});

vi.mock("@/lib/platform", () => ({
  getAppFetch: async () => platformFetchMock,
}));

let openedDb: MuzeroDB | null = null;

interface MediaEngineCallbacksForTest {
  onTimeUpdate?: (positionSec: number, durationSec: number) => void;
}

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.resetModules();
  mediaEngineMock.loadUrl.mockClear();
  mediaEngineMock.loadBlob.mockClear();
  mediaEngineMock.play.mockClear();
  mediaEngineMock.seek.mockClear();
  mediaEngineMock.setDiagnosticsContext.mockClear();
  mediaEngineMock.instances = [];
  platformFetchMock.mockClear();
  platformFetchMock.mockResolvedValue(
    new Response("remote", { headers: { "content-type": "audio/mpeg" } }),
  );
  await deleteDefaultDb();
});

afterEach(async () => {
  vi.doUnmock("@/lib/desktop/bridge");
  vi.doUnmock("@/lib/media-probe");
  vi.doUnmock("@/lib/media-metadata");
  vi.doUnmock("@/lib/video-poster-frame");
  vi.doUnmock("@/lib/example-track");
  vi.doUnmock("@/streamsrc/registry");
  vi.doUnmock("@/workers/cover-client");
  vi.unstubAllGlobals();
  openedDb?.close();
  openedDb = null;
  document.body.innerHTML = "";
  await deleteDefaultDb();
});

async function loadRuntime() {
  const dbMod = await import("@/db/muzero-db");
  openedDb = dbMod.db;
  const repos = await import("@/db/repositories");
  const store = await import("./player-store");
  const playbackCache = await import("@/player/playback-cache");
  // Imported AFTER resetModules so they share the same `muzero-db` singleton the
  // store uses — the remote import writes tracks the store then plays.
  const subscription = await import("@/sync/r2-subscription");
  const importStream = await import("@/sync/r2-import-stream");
  return {
    db: dbMod.db,
    repos,
    usePlayerStore: store.usePlayerStore,
    playbackCache,
    sync: {
      subscribeManifest: subscription.subscribeManifest,
      loadRemoteSetIndex: subscription.loadRemoteSetIndex,
      importRemoteSetStream: importStream.importRemoteSetStream,
    },
  };
}

async function onlyTrackInSession(db: MuzeroDB, sessionId: string): Promise<Track | undefined> {
  const tracks = await db.tracks.where("sessionId").equals(sessionId).toArray();
  expect(tracks).toHaveLength(1);
  return tracks[0];
}

async function seedQueue(currentIndex = 1) {
  const { db, repos, usePlayerStore, playbackCache } = await loadRuntime();
  const session = await repos.createSession({
    seedPrompt: "",
    config: { autoExtend: false },
    displayMode: "cover",
  });
  const first = track("trk_first", session.id, "First");
  const second = track("trk_second", session.id, "Second");
  await db.tracks.bulkAdd([first, second]);
  await repos.prependTrackIds(session.id, [first.id, second.id]);
  await repos.playQueueSet([first.id, second.id], {
    contextSetId: session.id,
    currentIndex,
  });
  return { db, repos, session, first, second, usePlayerStore, playbackCache };
}

function track(id: string, sessionId: string, title: string): Track {
  return {
    id,
    sessionId,
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "failed",
    durationSec: 30,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
  };
}

function expectLoadedBlob(kind: Track["kind"], mime: string): Blob {
  const call = (mediaEngineMock.loadBlob.mock.calls as unknown as [Blob, Track["kind"]][])[0];
  if (!call) throw new Error("Expected mediaEngine.loadBlob to have been called");
  const [loadedBlob, loadedKind] = call;
  expect(loadedBlob.size).toBeGreaterThan(0);
  expect(loadedBlob.type).toBe(mime);
  expect(loadedKind).toBe(kind);
  return loadedBlob;
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function deferredBytes() {
  let resolve!: (bytes: Uint8Array) => void;
  const promise = new Promise<Uint8Array>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("player-store playback resume", () => {
  it(
    "hydrates the last queue cursor and active set from IndexedDB",
    async () => {
      const { session, first, second, usePlayerStore, repos } = await seedQueue(1);
      // Display mode is a global preference now (not per-set), persisted in settings
      // and hydrated on init(). Switching/activating sets must not reset it.
      await repos.saveSettings({ displayMode: "cover" });

      usePlayerStore.getState().init();

      await waitFor(() => {
        const state = usePlayerStore.getState();
        expect(state.activeSessionId).toBe(session.id);
        expect(state.queue.map((t) => t.id)).toEqual([first.id, second.id]);
        expect(state.currentIndex).toBe(1);
        expect(state.displayMode).toBe("cover");
        expect(state.djEnabled).toBe(false);
      });
      expect(usePlayerStore.getState().durationSec).toBe(second.durationSec);
    },
    PLAYER_STORE_INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("keeps a pre-load seek and applies it after media loads", async () => {
    const { db, second, usePlayerStore } = await seedQueue(1);
    await db.tracks.update(second.id, {
      status: "ready",
      remoteMediaUrl: "https://media.example.com/second.mp3",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));

    usePlayerStore.getState().seek(12);

    expect(usePlayerStore.getState().positionSec).toBe(12);
    expect(mediaEngineMock.seek).not.toHaveBeenCalled();

    await usePlayerStore.getState().play();

    expect(platformFetchMock).toHaveBeenCalledWith(
      "https://media.example.com/second.mp3",
      expect.objectContaining({ cache: "no-store" }),
    );
    expectLoadedBlob("audio", "audio/mpeg");
    expect(mediaEngineMock.seek).toHaveBeenCalledWith(12);
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("ignores stale timeupdate events from the previous track during a switch", async () => {
    const { db, first, second, usePlayerStore } = await seedQueue(0);
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_first_switch",
        trackId: first.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      },
      {
        id: "blb_second_switch",
        trackId: second.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" }),
      },
    ]);
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first_switch" });
    await db.tracks.update(second.id, { status: "ready", blobId: "blb_second_switch" });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    const engine = mediaEngineMock.instances.at(-1);
    if (!engine) throw new Error("expected media engine instance");
    mediaEngineMock.seek.mockClear();
    mediaEngineMock.loadBlob.mockImplementationOnce(async () => {
      engine.callbacks.onTimeUpdate?.(42, 120);
    });

    await usePlayerStore.getState().playIndex(1);

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().positionSec).toBe(0);
    expect(mediaEngineMock.seek).not.toHaveBeenCalled();
  });

  it("loads a remote R2 track from playback cache before showing loading or fetching", async () => {
    const { db, second, usePlayerStore, playbackCache } = await seedQueue(1);
    await db.tracks.update(second.id, {
      status: "ready",
      remoteMediaUrl: "https://media.example.com/second.mp3",
    });
    const cachedTrack = await db.tracks.get(second.id);
    if (!cachedTrack) throw new Error("expected seeded track");
    const cachedBlob = { size: 3, type: "audio/mpeg" } as Blob;
    await playbackCache.putRemotePlaybackCache(
      cachedTrack,
      {
        blob: cachedBlob,
        bytes: 3,
        mime: "audio/mpeg",
      },
      { maxBytes: 100, now: () => 1 },
      db,
    );
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));
    await usePlayerStore.getState().play();

    expect(platformFetchMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().playbackLoading).toBeNull();
    expectLoadedBlob("audio", "audio/mpeg");
    expect(mediaEngineMock.play).toHaveBeenCalled();
    await expect(db.playbackCache.count()).resolves.toBe(1);
  });

  it("plays Electron file-backed local media through a storage URL instead of a Blob URL", async () => {
    const localMediaUrlForStorageKey = vi.fn(
      async () => "muzfetch://local-media/?__mztoken=storage-video",
    );
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          fetch,
          kind: "electron",
          localMediaUrlForStorageKey,
          openExternal: vi.fn(),
        }),
      };
    });
    const { db, second, usePlayerStore } = await seedQueue(1);
    await db.mediaBlobs.put({
      id: "blb_storage_playback",
      trackId: second.id,
      role: "media",
      mime: "video/mp4",
      bytes: 30_000_000,
      storageBackend: "electron-file",
      storageKey: "media/mv__blb_storage_playback.mp4",
    });
    await db.tracks.update(second.id, {
      blobId: "blb_storage_playback",
      kind: "video",
      status: "ready",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));
    await usePlayerStore.getState().play();

    expect(localMediaUrlForStorageKey).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "video/mp4",
        storageKey: "media/mv__blb_storage_playback.mp4",
      }),
    );
    expect(mediaEngineMock.loadUrl).toHaveBeenCalledWith(
      "muzfetch://local-media/?__mztoken=storage-video",
      "video",
      { crossOrigin: "anonymous" },
    );
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("falls back to the referenced sourcePath when an Electron media copy is missing", async () => {
    const localMediaUrlForStorageKey = vi.fn(
      async () => "muzfetch://local-media/?__mztoken=missing-copy",
    );
    const localMediaUrl = vi.fn(async () => "muzfetch://local-media/?__mztoken=source-file");
    const readMediaStorageFile = vi.fn();
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          deleteMediaStorageFile: vi.fn(),
          fetch,
          kind: "electron",
          localMediaUrl,
          localMediaUrlForStorageKey,
          openExternal: vi.fn(),
          readMediaStorageFile,
          statMediaStorageFile: vi.fn(async () => null),
          writeMediaStorageFile: vi.fn(),
        }),
      };
    });
    const { db, second, usePlayerStore } = await seedQueue(1);
    await db.mediaBlobs.put({
      id: "blb_missing_storage",
      trackId: second.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 12_345,
      storageBackend: "electron-file",
      storageKey: "media/missing__blb_missing_storage.mp3",
    });
    await db.tracks.update(second.id, {
      blobId: "blb_missing_storage",
      sourcePath: "D:/Music/source.mp3",
      status: "ready",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));
    await usePlayerStore.getState().play();

    expect(localMediaUrlForStorageKey).not.toHaveBeenCalled();
    expect(readMediaStorageFile).not.toHaveBeenCalled();
    expect(localMediaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        mime: "audio/mpeg",
        path: "D:/Music/source.mp3",
      }),
    );
    expect(mediaEngineMock.loadUrl).toHaveBeenCalledWith(
      "muzfetch://local-media/?__mztoken=source-file",
      "audio",
      { crossOrigin: "anonymous" },
    );
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();
  });

  it("decodes a referenced .ncm source when its persisted decoded copy is missing", async () => {
    const { encodeNcm } = await import("@/lib/ncm-fixture");
    const ncm = encodeNcm({
      audio: new Uint8Array([1, 2, 3, 4, 5]),
      meta: {
        artist: [["NetEase Artist", 1]],
        duration: 42_000,
        format: "mp3",
        musicName: "NCM Song",
      },
    });
    const localMediaUrlForStorageKey = vi.fn(
      async () => "muzfetch://local-media/?__mztoken=missing-ncm-copy",
    );
    const localMediaUrl = vi.fn(async () => "muzfetch://local-media/?__mztoken=encrypted-ncm");
    const readMediaStorageFile = vi.fn();
    const sourceBytes = deferredBytes();
    const readFile = vi.fn(async () => sourceBytes.promise);
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          deleteMediaStorageFile: vi.fn(),
          fetch,
          kind: "electron",
          localMediaUrl,
          localMediaUrlForStorageKey,
          openExternal: vi.fn(),
          readFile,
          readMediaStorageFile,
          statMediaStorageFile: vi.fn(async () => null),
          writeMediaStorageFile: vi.fn(),
        }),
      };
    });
    const { db, second, usePlayerStore } = await seedQueue(1);
    await db.mediaBlobs.put({
      id: "blb_missing_ncm_storage",
      trackId: second.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 12_345,
      storageBackend: "electron-file",
      storageKey: "media/ncm__blb_missing_ncm_storage.mp3",
    });
    await db.tracks.update(second.id, {
      blobId: "blb_missing_ncm_storage",
      mediaMetadata: {
        originalExtension: "ncm",
        originalFileName: "ncm-song.ncm",
        originalMime: "audio/mpeg",
        parsedAt: 1,
        parser: "manual",
      },
      sourcePath: "D:/Music/ncm-song.ncm",
      status: "ready",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));
    const play = usePlayerStore.getState().play();
    await waitFor(() =>
      expect(usePlayerStore.getState().playbackLoading).toMatchObject({
        trackId: second.id,
        title: second.title,
        sourceKind: "blob",
      }),
    );
    expect(readFile).toHaveBeenCalledWith("D:/Music/ncm-song.ncm");
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();

    sourceBytes.resolve(new Uint8Array(ncm));
    await play;

    expect(localMediaUrlForStorageKey).not.toHaveBeenCalled();
    expect(localMediaUrl).not.toHaveBeenCalled();
    expect(readMediaStorageFile).not.toHaveBeenCalled();
    expectLoadedBlob("audio", "audio/mpeg");
    expect(usePlayerStore.getState().playbackLoading).toBeNull();
    expect(usePlayerStore.getState().durationSec).toBe(42);
    expect(mediaEngineMock.loadUrl).not.toHaveBeenCalledWith(
      "muzfetch://local-media/?__mztoken=encrypted-ncm",
      expect.anything(),
      expect.anything(),
    );
  });

  it("decodes a referenced .ncm source without requiring a persisted media blob", async () => {
    const { encodeNcm } = await import("@/lib/ncm-fixture");
    const ncm = encodeNcm({
      audio: new Uint8Array([9, 8, 7, 6]),
      meta: {
        artist: [["NetEase Artist", 1]],
        duration: 35_000,
        format: "mp3",
        musicName: "Referenced NCM",
      },
    });
    const localMediaUrl = vi.fn(async () => "muzfetch://local-media/?__mztoken=encrypted-ncm");
    const sourceBytes = deferredBytes();
    const readFile = vi.fn(async () => sourceBytes.promise);
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          fetch,
          kind: "electron",
          localMediaUrl,
          openExternal: vi.fn(),
          readFile,
        }),
      };
    });
    const { db, second, usePlayerStore } = await seedQueue(1);
    await db.tracks.update(second.id, {
      blobId: undefined,
      mediaMetadata: {
        originalExtension: "ncm",
        originalFileName: "referenced-ncm.ncm",
        originalMime: "audio/mpeg",
        parsedAt: 1,
        parser: "manual",
      },
      sourcePath: "D:/Music/referenced-ncm.ncm",
      status: "ready",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().durationSec).toBe(30));
    const play = usePlayerStore.getState().play();
    await waitFor(() =>
      expect(usePlayerStore.getState().playbackLoading).toMatchObject({
        trackId: second.id,
        title: second.title,
        sourceKind: "local-file",
      }),
    );
    expect(readFile).toHaveBeenCalledWith("D:/Music/referenced-ncm.ncm");
    expect(localMediaUrl).not.toHaveBeenCalled();

    sourceBytes.resolve(new Uint8Array(ncm));
    await play;

    expectLoadedBlob("audio", "audio/mpeg");
    expect(usePlayerStore.getState().playbackLoading).toBeNull();
    expect(usePlayerStore.getState().durationSec).toBe(35);
    expect(mediaEngineMock.loadUrl).not.toHaveBeenCalled();
  });

  it("reuses a prepared cached remote blob during handoff", async () => {
    const { db, first, second, usePlayerStore, playbackCache } = await seedQueue(0);
    const trace = await import("@/lib/trace");
    await db.mediaBlobs.put({
      id: "blb_first_cached_handoff",
      trackId: first.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first_cached_handoff" });
    await db.tracks.update(second.id, {
      status: "ready",
      remoteMediaUrl: "https://media.example.com/second.mp3",
    });
    const cachedTrack = await db.tracks.get(second.id);
    if (!cachedTrack) throw new Error("expected seeded track");
    const cachedBlob = { size: 6, type: "audio/mpeg" } as Blob;
    await playbackCache.putRemotePlaybackCache(
      cachedTrack,
      {
        blob: cachedBlob,
        bytes: 6,
        mime: "audio/mpeg",
      },
      { maxBytes: 100, now: () => 1 },
      db,
    );
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    usePlayerStore.setState({ isPlaying: true });
    mediaEngineMock.loadBlob.mockClear();
    mediaEngineMock.play.mockClear();
    trace.clearTrace();

    await usePlayerStore.getState().playIndex(1);

    expect(platformFetchMock).not.toHaveBeenCalled();
    expectLoadedBlob("audio", "audio/mpeg");
    expect(mediaEngineMock.play).toHaveBeenCalled();
    expect(
      trace
        .getTraceEntries()
        .filter(
          (entry) => entry.scope === "player.playback" && entry.event === "media.load.remote.cache",
        ),
    ).toHaveLength(1);
  });

  it("switches the visible song immediately while the next R2 track downloads", async () => {
    const { db, first, second, usePlayerStore } = await seedQueue(0);
    await db.mediaBlobs.put({
      id: "blb_first",
      trackId: first.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first" });
    await db.tracks.update(second.id, {
      status: "ready",
      remoteMediaUrl: "https://media.example.com/second.mp3",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    usePlayerStore.setState({ isPlaying: true });
    mediaEngineMock.loadBlob.mockClear();
    mediaEngineMock.play.mockClear();
    const remote = deferredResponse();
    platformFetchMock.mockImplementationOnce(async () => remote.promise);

    const playNext = usePlayerStore.getState().playIndex(1);

    await waitFor(() =>
      expect(platformFetchMock).toHaveBeenCalledWith(
        "https://media.example.com/second.mp3",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().playbackLoading).toMatchObject({
      trackId: second.id,
      title: second.title,
      sourceKind: "remote",
    });
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();

    remote.resolve(
      new Response("remote", {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    await playNext;

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().playbackLoading).toBeNull();
    expectLoadedBlob("audio", "audio/mpeg");
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("ignores a stale R2 handoff when the user moves on before the download finishes", async () => {
    const { db, first, second, usePlayerStore } = await seedQueue(0);
    await db.mediaBlobs.put({
      id: "blb_first",
      trackId: first.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first" });
    await db.tracks.update(second.id, {
      status: "ready",
      remoteMediaUrl: "https://media.example.com/second.mp3",
    });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    usePlayerStore.setState({ isPlaying: true });
    const remote = deferredResponse();
    platformFetchMock.mockImplementationOnce(async () => remote.promise);

    const stalePlay = usePlayerStore.getState().playIndex(1);
    await waitFor(() => expect(usePlayerStore.getState().playbackLoading?.trackId).toBe(second.id));

    await usePlayerStore.getState().playIndex(0);
    expect(usePlayerStore.getState().playbackLoading).toBeNull();

    remote.resolve(
      new Response("late", {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    await stalePlay;

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(usePlayerStore.getState().playbackLoading).toBeNull();
  });

  it("does not play a stale local blob load after a rapid switch", async () => {
    const { db, first, second, usePlayerStore } = await seedQueue(0);
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_first_local_stale",
        trackId: first.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      },
      {
        id: "blb_second_local_stale",
        trackId: second.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" }),
      },
    ]);
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first_local_stale" });
    await db.tracks.update(second.id, { status: "ready", blobId: "blb_second_local_stale" });
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    const staleLoad = deferredVoid();
    mediaEngineMock.loadBlob
      .mockImplementationOnce(async () => {
        await staleLoad.promise;
      })
      .mockImplementationOnce(async () => {});

    const stalePlay = usePlayerStore.getState().playIndex(0);
    await waitFor(() => expect(mediaEngineMock.loadBlob).toHaveBeenCalledTimes(1));

    const currentPlay = usePlayerStore.getState().playIndex(1);
    await waitFor(() => expect(mediaEngineMock.loadBlob).toHaveBeenCalledTimes(2));
    await currentPlay;

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(mediaEngineMock.play).toHaveBeenCalledTimes(1);

    staleLoad.resolve();
    await stalePlay;

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(mediaEngineMock.play).toHaveBeenCalledTimes(1);
  });

  it("keeps a clicked-but-still-loading track selected when the queue list changes", async () => {
    const { db, first, repos, second, session, usePlayerStore } = await seedQueue(0);
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_first_queue_anchor",
        trackId: first.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      },
      {
        id: "blb_second_queue_anchor",
        trackId: second.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([4, 5, 6])], { type: "audio/mpeg" }),
      },
    ]);
    await db.tracks.update(first.id, { status: "ready", blobId: "blb_first_queue_anchor" });
    await db.tracks.update(second.id, { status: "ready", blobId: "blb_second_queue_anchor" });
    const third = track("trk_third_queue_anchor", session.id, "Third");
    await db.tracks.add(third);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    expect(usePlayerStore.getState().currentIndex).toBe(0);

    const pendingSecondLoad = deferredVoid();
    mediaEngineMock.loadBlob.mockImplementationOnce(async () => {
      await pendingSecondLoad.promise;
    });
    const switching = usePlayerStore.getState().playIndex(1);

    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(1));
    await repos.playQueueAppend([third.id]);
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(3));

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().queue[1]?.id).toBe(second.id);

    pendingSecondLoad.resolve();
    await switching;

    expect(usePlayerStore.getState().currentIndex).toBe(1);
    expect(usePlayerStore.getState().queue[1]?.id).toBe(second.id);
  });

  it("persists the queue cursor when the user picks another track", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));

    await usePlayerStore.getState().playIndex(1);

    // Cursor persistence is debounced 900ms; waitFor's 1000ms default leaves no slack
    // under the full parallel suite (timer drift + fake-IndexedDB write) → bump it.
    await waitFor(
      async () => {
        await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 1 });
      },
      { timeout: 2500 },
    );
  });

  it("coalesces rapid queue cursor persistence to the final picked track", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));

    await usePlayerStore.getState().playIndex(1);
    await usePlayerStore.getState().playIndex(0);
    await usePlayerStore.getState().playIndex(1);

    await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 0 });
    // 900ms debounce needs headroom over waitFor's 1000ms default (see above).
    await waitFor(
      async () => {
        await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 1 });
      },
      { timeout: 2500 },
    );
  });

  it("persists the volume when the user changes it", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    usePlayerStore.getState().setVolume(0.42);

    await waitFor(async () => {
      await expect(repos.getSettings()).resolves.toMatchObject({ playerVolume: 0.42 });
    });
  });

  it("hydrates the persisted volume on init", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    await repos.saveSettings({ playerVolume: 0.3 });

    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().volume).toBe(0.3));
  });
});

describe("queueEntriesKey (queue split-subscription gate)", () => {
  it("is stable for the same ids (cursor move) but changes on reorder/append/length", async () => {
    const { queueEntriesKey } = await import("./player-store");
    const ids = ["trk_a", "trk_b", "trk_c"];
    // Same ids → same key → a cursor move does NOT re-materialize the 5983 tracks.
    expect(queueEntriesKey(ids)).toBe(queueEntriesKey(["trk_a", "trk_b", "trk_c"]));
    // Reorder / append / prepend / length change → different key → re-subscribe.
    expect(queueEntriesKey(ids)).not.toBe(queueEntriesKey(["trk_b", "trk_a", "trk_c"]));
    expect(queueEntriesKey(ids)).not.toBe(queueEntriesKey([...ids, "trk_d"]));
    expect(queueEntriesKey(ids)).not.toBe(queueEntriesKey(["trk_z", ...ids]));
    expect(queueEntriesKey(ids)).not.toBe(queueEntriesKey(["trk_a", "trk_b"]));
  });
});

describe("player-store bulk upload visibility", () => {
  it("imports the bundled example song with its paired cover into a new set", async () => {
    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => ({
          durationSec: 143,
          kind: "audio",
          mime: file.type || "audio/mpeg",
          title: "2:23 AM",
        })),
      };
    });
    vi.doMock("@/workers/cover-client", () => ({
      extractCoverMetadataViaWorker: vi.fn(async () => ({
        palette: [{ r: 10, g: 20, b: 30 }],
        thumbhash: "XjM9LzMI9wiIh4hwj3CI+AiIcH/494cP",
        timings: {
          backlightMs: 0,
          decodeMs: 0,
          paletteMs: 0,
          thumbnailMs: 0,
          thumbhashMs: 0,
          totalMs: 0,
        },
      })),
    }));
    // Stub the asset LOADER itself rather than the global `fetch`: this test is about
    // the import orchestration (session → uploaded track → cover → active set), not
    // about how the bytes are fetched. Mocking the loader keeps it free of any
    // fetch/network/module-timing fragility. The fetch + URL-construction logic lives
    // in example-track.test.ts, exercised with an explicitly injected fetch.
    vi.doMock("@/lib/example-track", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/example-track")>("@/lib/example-track");
      return {
        ...actual,
        loadExampleTrackAssets: vi.fn(async () => ({
          audio: new File([new Uint8Array([1, 2, 3])], actual.EXAMPLE_TRACK_AUDIO_FILE_NAME, {
            type: "audio/mpeg",
          }),
          cover: {
            blob: new Blob([new Uint8Array([9, 8, 7])], { type: "image/jpeg" }),
            mime: "image/jpeg",
          },
        })),
      };
    });

    const { db, repos, usePlayerStore } = await loadRuntime();

    await usePlayerStore.getState().importExampleTrack();

    const sessions = await repos.listSessions();
    expect(sessions).toHaveLength(1);
    const session = sessions[0];
    expect(session.name).toBe("Example songs");
    expect(session.trackIds).toHaveLength(1);
    expect(usePlayerStore.getState().activeSessionId).toBe(session.id);

    const track = await db.tracks.get(session.trackIds[0]);
    expect(track).toMatchObject({
      durationSec: 143,
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      title: "2:23 AM",
    });
    expect(track?.coverBlobId).toBeTruthy();
    const media = track?.blobId ? await db.mediaBlobs.get(track.blobId) : undefined;
    const cover = track?.coverBlobId ? await db.mediaBlobs.get(track.coverBlobId) : undefined;
    expect(media).toMatchObject({ bytes: 3, mime: "audio/mpeg", role: "media" });
    expect(cover).toMatchObject({ bytes: 3, mime: "image/jpeg", role: "cover" });
  });

  it("publishes completed file uploads before the whole large selection finishes", async () => {
    const reachedLastProbe = deferredVoid();
    const releaseLastProbe = deferredVoid();

    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => {
          if (file.name === "song-26.mp3") {
            reachedLastProbe.resolve();
            await releaseLastProbe.promise;
          }
          return {
            kind: "audio",
            durationSec: 1,
            mime: file.type || "audio/mpeg",
            title: file.name.replace(/\.[^.]+$/, ""),
          };
        }),
      };
    });
    vi.doMock("@/lib/media-metadata", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/media-metadata")>("@/lib/media-metadata");
      return {
        ...actual,
        parseUploadedMediaMetadata: vi.fn(async (file: File) => ({
          embeddedCover: undefined,
          mediaMetadata: actual.fallbackUploadMediaMetadata(
            file,
            file.name.replace(/\.[^.]+$/, ""),
          ),
          title: undefined,
          albumPicUrl: undefined,
        })),
      };
    });

    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const files = Array.from(
      { length: 26 },
      (_, i) =>
        new File([new Uint8Array([i + 1])], `song-${String(i + 1).padStart(2, "0")}.mp3`, {
          type: "audio/mpeg",
        }),
    );

    const upload = usePlayerStore.getState().addUploadsToSet(session.id, files);
    await reachedLastProbe.promise;

    const midUpload = await repos.getSession(session.id);
    expect(midUpload?.trackIds).toHaveLength(25);

    releaseLastProbe.resolve();
    await upload;

    const finished = await repos.getSession(session.id);
    expect(finished?.trackIds).toHaveLength(26);
    const rows = await db.tracks.bulkGet(finished?.trackIds ?? []);
    expect(rows.map((track) => track?.title)).toEqual(
      Array.from({ length: 26 }, (_, i) => `song-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("extracts and stores a poster cover for uploaded videos without embedded art", async () => {
    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => ({
          durationSec: 12,
          kind: "video",
          mime: file.type || "video/mp4",
          title: file.name.replace(/\.[^.]+$/, ""),
        })),
      };
    });
    vi.doMock("@/lib/media-metadata", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/media-metadata")>("@/lib/media-metadata");
      return {
        ...actual,
        parseUploadedMediaMetadata: vi.fn(async (file: File) => ({
          albumPicUrl: undefined,
          embeddedCover: undefined,
          mediaMetadata: actual.fallbackUploadMediaMetadata(file, "MV"),
          title: "MV",
        })),
      };
    });
    const posterBlob = new Blob([new Uint8Array([9, 8, 7])], { type: "image/webp" });
    const posterExtract = vi.fn(async () => ({
      atTimeSeconds: 0.5,
      blob: posterBlob,
      height: 720,
      mime: "image/webp",
      score: { black: false, lumaMean: 0.4, lumaVariance: 0.1, nonBlackRatio: 0.9, rank: 0.7 },
      source: "native-video" as const,
      width: 1280,
    }));
    vi.doMock("@/lib/video-poster-frame", async () => ({
      ...(await vi.importActual<typeof import("@/lib/video-poster-frame")>(
        "@/lib/video-poster-frame",
      )),
      extractUsefulVideoPosterFrame: posterExtract,
    }));
    vi.doMock("@/workers/cover-client", () => ({
      extractCoverMetadataViaWorker: vi.fn(async () => ({
        palette: [{ r: 10, g: 20, b: 30 }],
        thumbhash: "XjM9LzMI9wiIh4hwj3CI+AiIcH/494cP",
        timings: {
          backlightMs: 0,
          decodeMs: 0,
          paletteMs: 0,
          thumbnailMs: 0,
          thumbhashMs: 0,
          totalMs: 0,
        },
      })),
    }));

    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const file = new File([new Uint8Array([1, 2, 3])], "mv.mp4", { type: "video/mp4" });

    await usePlayerStore.getState().addUploadsToSet(session.id, [file]);

    await waitFor(async () => {
      const track = await onlyTrackInSession(db, session.id);
      expect(track?.coverBlobId).toBeTruthy();
    });
    const track = await onlyTrackInSession(db, session.id);
    const cover = track?.coverBlobId ? await db.mediaBlobs.get(track.coverBlobId) : undefined;
    expect(posterExtract).toHaveBeenCalledWith(file, { durationSec: 12 });
    expect(track?.coverCrop).toEqual({ height: 720, width: 720, x: 280, y: 0 });
    expect(cover).toMatchObject({ bytes: posterBlob.size, mime: "image/webp", role: "cover" });
  });

  it("extracts and stores a poster cover for referenced local-file video uploads", async () => {
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          fetch,
          getDroppedFilePath: vi.fn(async () => "D:/media/mv.mp4"),
          kind: "electron",
          localMediaUrl: vi.fn(async () => "http://127.0.0.1/local/mv.mp4"),
          openExternal: vi.fn(),
        }),
      };
    });
    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => ({
          durationSec: 12,
          kind: "video",
          mime: file.type || "video/mp4",
          title: file.name.replace(/\.[^.]+$/, ""),
        })),
      };
    });
    vi.doMock("@/lib/media-metadata", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/media-metadata")>("@/lib/media-metadata");
      return {
        ...actual,
        parseUploadedMediaMetadata: vi.fn(async (file: File) => ({
          albumPicUrl: undefined,
          embeddedCover: undefined,
          mediaMetadata: actual.fallbackUploadMediaMetadata(file, "MV"),
          title: "MV",
        })),
      };
    });
    const posterBlob = new Blob([new Uint8Array([7, 8, 9])], { type: "image/webp" });
    const posterExtract = vi.fn(async () => ({
      atTimeSeconds: 0.5,
      blob: posterBlob,
      height: 720,
      mime: "image/webp",
      score: { black: false, lumaMean: 0.4, lumaVariance: 0.1, nonBlackRatio: 0.9, rank: 0.7 },
      source: "native-video" as const,
      width: 1280,
    }));
    vi.doMock("@/lib/video-poster-frame", async () => ({
      ...(await vi.importActual<typeof import("@/lib/video-poster-frame")>(
        "@/lib/video-poster-frame",
      )),
      extractUsefulVideoPosterFrame: posterExtract,
    }));
    vi.doMock("@/workers/cover-client", () => ({
      extractCoverMetadataViaWorker: vi.fn(async () => ({
        palette: [{ r: 10, g: 20, b: 30 }],
        thumbhash: "XjM9LzMI9wiIh4hwj3CI+AiIcH/494cP",
        timings: {
          backlightMs: 0,
          decodeMs: 0,
          paletteMs: 0,
          thumbnailMs: 0,
          thumbhashMs: 0,
          totalMs: 0,
        },
      })),
    }));

    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const file = new File([new Uint8Array([1, 2, 3])], "mv.mp4", { type: "video/mp4" });

    await usePlayerStore.getState().addUploadsToSet(session.id, [file]);

    await waitFor(async () => {
      const track = await onlyTrackInSession(db, session.id);
      expect(track?.coverBlobId).toBeTruthy();
    });
    const track = await onlyTrackInSession(db, session.id);
    const cover = track?.coverBlobId ? await db.mediaBlobs.get(track.coverBlobId) : undefined;
    expect(posterExtract).toHaveBeenCalledWith(file, { durationSec: 12 });
    expect(track?.blobId).toBeUndefined();
    expect(track?.sourcePath).toBe("D:/media/mv.mp4");
    expect(track?.coverCrop).toEqual({ height: 720, width: 720, x: 280, y: 0 });
    expect(cover).toMatchObject({ bytes: posterBlob.size, mime: "image/webp", role: "cover" });
  });

  it("restores Electron exact-file grants for reference-only local media on boot", async () => {
    const grantFileAccess = vi.fn(async () => undefined);
    vi.doMock("@/lib/desktop/bridge", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/desktop/bridge")>("@/lib/desktop/bridge");
      return {
        ...actual,
        resolveDesktopBridge: () => ({
          fetch,
          grantFileAccess,
          kind: "electron",
          openExternal: vi.fn(),
        }),
      };
    });
    const { repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    await repos.createReferencedUploadedTrack({
      sessionId: session.id,
      title: "Referenced MV",
      kind: "video",
      mime: "video/mp4",
      durationSec: 90,
      sourcePath: "D:/media/referenced-mv.mp4",
    });
    const copied = await repos.createReferencedUploadedTrack({
      sessionId: session.id,
      title: "Copied Song",
      kind: "audio",
      mime: "audio/mpeg",
      durationSec: 42,
      sourcePath: "D:/media/copied-song.mp3",
    });
    await repos.cacheReferencedTrackBlob({
      trackId: copied.id,
      blob: new Blob(["cached"], { type: "audio/mpeg" }),
      mime: "audio/mpeg",
    });

    await usePlayerStore.getState().restoreReferencedLocalFileAccess();

    expect(grantFileAccess).toHaveBeenCalledTimes(1);
    expect(grantFileAccess).toHaveBeenCalledWith("D:/media/referenced-mv.mp4");
  });

  it("keeps embedded covers ahead of auto poster extraction", async () => {
    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => ({
          durationSec: 12,
          kind: "video",
          mime: file.type || "video/mp4",
          title: file.name.replace(/\.[^.]+$/, ""),
        })),
      };
    });
    vi.doMock("@/lib/media-metadata", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/media-metadata")>("@/lib/media-metadata");
      return {
        ...actual,
        parseUploadedMediaMetadata: vi.fn(async (file: File) => ({
          albumPicUrl: undefined,
          embeddedCover: {
            blob: new Blob([new Uint8Array([4, 5, 6, 7])], { type: "image/jpeg" }),
            mime: "image/jpeg",
          },
          mediaMetadata: actual.fallbackUploadMediaMetadata(file, "MV"),
          title: "MV",
        })),
      };
    });
    const posterExtract = vi.fn();
    vi.doMock("@/lib/video-poster-frame", async () => ({
      ...(await vi.importActual<typeof import("@/lib/video-poster-frame")>(
        "@/lib/video-poster-frame",
      )),
      extractUsefulVideoPosterFrame: posterExtract,
    }));
    vi.doMock("@/workers/cover-client", () => ({
      extractCoverMetadataViaWorker: vi.fn(async () => ({
        palette: [{ r: 10, g: 20, b: 30 }],
        thumbhash: "XjM9LzMI9wiIh4hwj3CI+AiIcH/494cP",
        timings: {
          backlightMs: 0,
          decodeMs: 0,
          paletteMs: 0,
          thumbnailMs: 0,
          thumbhashMs: 0,
          totalMs: 0,
        },
      })),
    }));

    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const file = new File([new Uint8Array([1, 2, 3])], "mv.mp4", { type: "video/mp4" });

    await usePlayerStore.getState().addUploadsToSet(session.id, [file]);

    const track = await onlyTrackInSession(db, session.id);
    const cover = track?.coverBlobId ? await db.mediaBlobs.get(track.coverBlobId) : undefined;
    expect(posterExtract).not.toHaveBeenCalled();
    expect(track?.coverBlobId).toBeTruthy();
    expect(track?.coverCrop).toBeUndefined();
    expect(cover).toMatchObject({ bytes: 4, mime: "image/jpeg", role: "cover" });
  });

  it("keeps the uploaded video track when poster extraction fails", async () => {
    vi.doMock("@/lib/media-probe", async () => {
      const actual = await vi.importActual<typeof import("@/lib/media-probe")>("@/lib/media-probe");
      return {
        ...actual,
        probeMediaFile: vi.fn(async (file: File) => ({
          durationSec: 12,
          kind: "video",
          mime: file.type || "video/mp4",
          title: file.name.replace(/\.[^.]+$/, ""),
        })),
      };
    });
    vi.doMock("@/lib/media-metadata", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/media-metadata")>("@/lib/media-metadata");
      return {
        ...actual,
        parseUploadedMediaMetadata: vi.fn(async (file: File) => ({
          albumPicUrl: undefined,
          embeddedCover: undefined,
          mediaMetadata: actual.fallbackUploadMediaMetadata(file, "MV"),
          title: "MV",
        })),
      };
    });
    vi.doMock("@/lib/video-poster-frame", async () => ({
      ...(await vi.importActual<typeof import("@/lib/video-poster-frame")>(
        "@/lib/video-poster-frame",
      )),
      extractUsefulVideoPosterFrame: vi.fn(async () => {
        throw new Error("decode failed");
      }),
    }));

    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const file = new File([new Uint8Array([1, 2, 3])], "mv.mp4", { type: "video/mp4" });

    await usePlayerStore.getState().addUploadsToSet(session.id, [file]);

    const track = await onlyTrackInSession(db, session.id);
    expect(track).toMatchObject({
      kind: "video",
      status: "ready",
      title: "MV",
    });
    expect(track?.coverBlobId).toBeUndefined();
    const media = track?.blobId ? await db.mediaBlobs.get(track.blobId) : undefined;
    expect(media).toMatchObject({ mime: "video/mp4", role: "media" });
  });
});

// --- Remote subscribed-manifest playback (R2 cloud drive sync, Phase 1) --------

const REMOTE_BASE = "https://drive.example.com/muzero/";
const REMOTE_MANIFEST_URL = "https://drive.example.com/muzero/manifest.json";
const REMOTE_SET_INDEX_URL = "https://drive.example.com/muzero/sets/ses_mix/index.json";
const REMOTE_AUDIO_URL = "https://drive.example.com/muzero/objects/media/audio.mp3";
const REMOTE_VIDEO_URL = "https://drive.example.com/muzero/objects/media/clip.mp4";

function jsonFetchMap(entries: Record<string, unknown>) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const body = entries[String(input)];
    if (body === undefined) return new Response("missing", { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

const remoteManifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_drive",
  title: "Friend Drive",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  baseUrl: REMOTE_BASE,
  sets: [
    {
      id: "ses_mix",
      title: "Mixed Set",
      index: "sets/ses_mix/index.json",
      updatedAt: "2026-06-09T00:00:00.000Z",
      trackCount: 2,
      bytes: 2048,
    },
  ],
};

const remoteSetIndex = {
  schema: "muzero-r2-set-index-v1",
  revision: 1,
  set: {
    id: "ses_mix",
    name: "Mixed Set",
    seedPrompt: "",
    displayMode: "video",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 60,
      allowVocals: true,
    },
    createdAt: 1780944000000,
    updatedAt: 1780944000000,
  },
  tracks: [
    {
      id: "trk_audio",
      title: "Streamed Audio",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      durationSec: 180,
      createdAt: 1780944000000,
      liked: false,
      tags: [],
      media: { url: "objects/media/audio.mp3", mime: "audio/mpeg", bytes: 1024 },
    },
    {
      id: "trk_video",
      title: "Streamed Video",
      kind: "video",
      origin: "uploaded",
      provider: "upload",
      durationSec: 240,
      createdAt: 1780944000000,
      liked: false,
      tags: [],
      media: { url: "objects/media/clip.mp4", mime: "video/mp4", bytes: 1024 },
    },
  ],
};

/** Subscribe to the public manifest, stream-import the set, and make it active. */
async function subscribeAndActivateRemoteSet() {
  const runtime = await loadRuntime();
  const fetcher = jsonFetchMap({
    [REMOTE_MANIFEST_URL]: remoteManifest,
    [REMOTE_SET_INDEX_URL]: remoteSetIndex,
  });
  const preview = await runtime.sync.subscribeManifest(REMOTE_MANIFEST_URL, { fetcher });
  const remoteSet = await runtime.sync.loadRemoteSetIndex(preview, preview.sets[0]!, { fetcher });
  const imported = await runtime.sync.importRemoteSetStream({
    driveId: preview.libraryId,
    remoteSet,
  });
  await runtime.usePlayerStore.getState().setActiveSession(imported.sessionId);
  await waitFor(() => expect(runtime.usePlayerStore.getState().queue).toHaveLength(2));
  return runtime;
}

describe("player-store remote subscribed-manifest playback", () => {
  it("loads remote R2 audio through a temporary Blob so WebAudio cannot silence it", async () => {
    const { usePlayerStore } = await subscribeAndActivateRemoteSet();
    const trace = await import("@/lib/trace");
    trace.clearTrace();
    platformFetchMock.mockResolvedValueOnce(
      new Response("audio", {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );

    await usePlayerStore.getState().playIndex(0);

    expect(platformFetchMock).toHaveBeenCalledWith(
      REMOTE_AUDIO_URL,
      expect.objectContaining({ cache: "no-store" }),
    );
    expectLoadedBlob("audio", "audio/mpeg");
    expect(mediaEngineMock.setDiagnosticsContext).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: expect.stringMatching(/^ply_/),
        trackId: expect.stringContaining("trk_audio"),
        sessionId: expect.stringContaining("ses_mix"),
      }),
    );
    expect(trace.getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "player.playback",
          event: "playback.start",
          context: expect.objectContaining({
            trackId: expect.stringContaining("trk_audio"),
            sessionId: expect.stringContaining("ses_mix"),
            category: "media",
            phase: "start",
          }),
        }),
      ]),
    );
    expect(mediaEngineMock.loadUrl).not.toHaveBeenCalled();
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("loads remote R2 video through a temporary Blob for the audio driver and visual layer", async () => {
    const { usePlayerStore } = await subscribeAndActivateRemoteSet();
    platformFetchMock.mockResolvedValueOnce(
      new Response("video", {
        status: 200,
        headers: { "content-type": "video/mp4" },
      }),
    );

    await usePlayerStore.getState().playIndex(1);

    expect(platformFetchMock).toHaveBeenCalledWith(
      REMOTE_VIDEO_URL,
      expect.objectContaining({ cache: "no-store" }),
    );
    expectLoadedBlob("video", "video/mp4");
    expect(mediaEngineMock.loadUrl).not.toHaveBeenCalled();
  });

  it("downloads one remote R2 track to local media blobs from the track-row action", async () => {
    const { db, usePlayerStore } = await subscribeAndActivateRemoteSet();
    const track = usePlayerStore.getState().queue[0]!;
    platformFetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );

    await usePlayerStore.getState().downloadStreamedTrack(track.id);

    const stored = await db.tracks.get(track.id);
    expect(stored?.blobId).toEqual(expect.stringMatching(/^blb_/));
    await expect(db.mediaBlobs.get(stored?.blobId ?? "")).resolves.toMatchObject({
      trackId: track.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
    });
    expect(platformFetchMock).toHaveBeenCalledWith(REMOTE_AUDIO_URL, { signal: undefined });
  });

  it("downloads every remote R2 track in a set from the set-header action", async () => {
    const { db, repos, usePlayerStore } = await subscribeAndActivateRemoteSet();
    const setId = usePlayerStore.getState().activeSessionId!;
    const session = await repos.getSession(setId);
    platformFetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("clip.mp4")) {
        return new Response(new Uint8Array([4, 5, 6, 7]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });

    await usePlayerStore.getState().downloadStreamedSet(setId);

    const tracks = await db.tracks.bulkGet(session?.trackIds ?? []);
    expect(tracks).toHaveLength(2);
    expect(tracks.every((track) => !!track?.blobId)).toBe(true);
    const blobs = await db.mediaBlobs.toArray();
    expect(blobs.map((blob) => blob.mime).sort()).toEqual(["audio/mpeg", "video/mp4"]);
    expect(platformFetchMock).toHaveBeenCalledWith(REMOTE_AUDIO_URL, { signal: undefined });
    expect(platformFetchMock).toHaveBeenCalledWith(REMOTE_VIDEO_URL, { signal: undefined });
  });
});

// --- Axis B-1: order/content decoupling (PRD scalable-track-list-reactivity Phase 3) ---
// The list-level query must never observe full row content: editing ANY queue track
// used to re-fire getTracksByIds(N) and republish the whole `queue` (scenario-4
// fan-out). After B-1, only the CURRENT track is row-observed (single-row sub); a
// non-current edit must NOT re-materialize the queue, while the current track stays
// reactive to its own edits so Now Playing updates.
describe("player-store order/content decoupling (Axis B-1)", () => {
  it("reflects a CURRENT-track metadata edit via a single-row patch (Now Playing stays reactive)", async () => {
    const { repos, first, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0);
    await waitFor(() => expect(usePlayerStore.getState().queue[0]?.id).toBe(first.id));

    await repos.setTrackTags(first.id, ["mood:calm"]);

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue[s.currentIndex]?.tags).toContain("mood:calm");
    });
  });

  it("does NOT re-materialize the whole queue when a NON-current track is edited (no fan-out)", async () => {
    const { repos, first, second, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(0); // current = first
    await waitFor(() => expect(usePlayerStore.getState().queue[0]?.id).toBe(first.id));

    const before = usePlayerStore.getState().queue;
    await repos.setTrackTags(second.id, ["mood:hype"]); // edit the OTHER (non-current) track
    // Give any (unwanted) list-level liveQuery a chance to re-fire + republish.
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Same array reference → the list query did NOT refetch/republish all N rows.
    expect(usePlayerStore.getState().queue).toBe(before);
  });

  it("re-targets the single-row sub to the new current track after a switch", async () => {
    const { repos, second, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    await usePlayerStore.getState().playIndex(1); // current = second
    await waitFor(() => expect(usePlayerStore.getState().queue[1]?.id).toBe(second.id));

    await repos.setTrackTags(second.id, ["mood:focus"]);

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue[s.currentIndex]?.tags).toContain("mood:focus");
    });
  });
});

// --- Phase 1: context-aware play (playback-queue-model PRD, Part A) -------------

describe("player-store context-aware play (playTrackInContext)", () => {
  async function putMediaBlob(db: MuzeroDB, trackId: string, blobId: string) {
    await db.mediaBlobs.put({
      id: blobId,
      trackId,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
  }
  function readyTrack(id: string, sessionId: string, title: string, blobId: string): Track {
    return { ...track(id, sessionId, title), status: "ready", blobId };
  }

  it(
    "plays a shared track in the set the user is viewing, not its home set",
    async () => {
      const { db, repos, usePlayerStore } = await loadRuntime();
      const setX = await repos.createSession({
        name: "X",
        seedPrompt: "",
        config: { autoExtend: false },
      });
      const setY = await repos.createSession({
        name: "Y",
        seedPrompt: "",
        config: { autoExtend: false },
      });
      // A's HOME set is X (created there); B's home is Y. A is ALSO added to Y.
      const a = readyTrack("trk_a", setX.id, "A", "blb_a");
      const b = readyTrack("trk_b", setY.id, "B", "blb_b");
      await db.tracks.bulkAdd([a, b]);
      await putMediaBlob(db, a.id, "blb_a");
      await putMediaBlob(db, b.id, "blb_b");
      await repos.prependTrackIds(setX.id, [a.id]); // X = [a]
      await repos.prependTrackIds(setY.id, [b.id]);
      await repos.prependTrackIds(setY.id, [a.id]); // Y = [a, b]

      usePlayerStore.getState().init();
      // The set-detail view of Y renders Y's tracks in display order, then clicks A.
      const yTracks = await repos.getTracksByIds([a.id, b.id]);
      await usePlayerStore.getState().playTrackInContext(yTracks[0], {
        source: { kind: "set", setId: setY.id },
        tracks: yTracks,
      });

      await waitFor(() => {
        const s = usePlayerStore.getState();
        expect(s.activeSessionId).toBe(setY.id); // NOT setX (A's home)
        expect(s.queueSource).toEqual({ kind: "set", setId: setY.id });
        expect(s.queue.map((t) => t.id)).toEqual([a.id, b.id]); // Y's queue, not X's
        expect(s.queue[s.currentIndex]?.id).toBe(a.id);
      });
      await expect(repos.getPlayQueue()).resolves.toMatchObject({ contextSetId: setY.id });
    },
    PLAYER_STORE_INTEGRATION_TEST_TIMEOUT_MS,
  );

  it("plays a track from the viewed set even when it was removed from its home set", async () => {
    // A.sessionId = X (home) but A is NOT a member of X anymore; only Y. The old
    // playTrack switched to X (whose queue lacks A) → findIndex -1 → silent no-op.
    const { db, repos, usePlayerStore } = await loadRuntime();
    const setX = await repos.createSession({
      name: "X",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const setY = await repos.createSession({
      name: "Y",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", setX.id, "A", "blb_a");
    await db.tracks.bulkAdd([a]);
    await putMediaBlob(db, a.id, "blb_a");
    await repos.prependTrackIds(setY.id, [a.id]); // only Y contains A; X.trackIds = []

    usePlayerStore.getState().init();
    const yTracks = await repos.getTracksByIds([a.id]);
    await usePlayerStore.getState().playTrackInContext(yTracks[0], {
      source: { kind: "set", setId: setY.id },
      tracks: yTracks,
    });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.activeSessionId).toBe(setY.id);
      expect(s.queue.map((t) => t.id)).toEqual([a.id]);
      expect(s.currentIndex).toBe(0);
    });
    expect(mediaEngineMock.play).toHaveBeenCalled(); // actually played, not a silent no-op
  });

  it("loads the queue in the drag-reordered display order via setActiveSession", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const set = await repos.createSession({
      name: "S",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const t1 = track("trk_1", set.id, "One");
    const t2 = track("trk_2", set.id, "Two");
    const t3 = track("trk_3", set.id, "Three");
    await db.tracks.bulkAdd([t1, t2, t3]);
    await repos.prependTrackIds(set.id, [t1.id, t2.id, t3.id]); // membership [t1,t2,t3]
    // Drag-reorder ranks → display order [t3, t1, t2].
    await db.sessions.update(set.id, {
      trackRanks: { [t3.id]: 0, [t1.id]: 100, [t2.id]: 200 },
    });

    usePlayerStore.getState().init();
    await usePlayerStore.getState().setActiveSession(set.id);

    await waitFor(() => {
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual([t3.id, t1.id, t2.id]);
    });
  });

  it("inherits DJ auto-extend from the viewed set's config", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const djSet = await repos.createSession({
      name: "DJ",
      seedPrompt: "late night drive",
      config: { autoExtend: true },
    });
    const uploadSet = await repos.createSession({
      name: "Uploads",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_dj", djSet.id, "DJ song", "blb_dj");
    const b = readyTrack("trk_up", uploadSet.id, "Upload", "blb_up");
    await db.tracks.bulkAdd([a, b]);
    await putMediaBlob(db, a.id, "blb_dj");
    await putMediaBlob(db, b.id, "blb_up");
    await repos.prependTrackIds(djSet.id, [a.id]);
    await repos.prependTrackIds(uploadSet.id, [b.id]);

    usePlayerStore.getState().init();
    const djTracks = await repos.getTracksByIds([a.id]);
    await usePlayerStore.getState().playTrackInContext(djTracks[0], {
      source: { kind: "set", setId: djSet.id },
      tracks: djTracks,
    });
    await waitFor(() => expect(usePlayerStore.getState().djEnabled).toBe(true));

    const uploadTracks = await repos.getTracksByIds([b.id]);
    await usePlayerStore.getState().playTrackInContext(uploadTracks[0], {
      source: { kind: "set", setId: uploadSet.id },
      tracks: uploadTracks,
    });
    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.activeSessionId).toBe(uploadSet.id);
      expect(s.djEnabled).toBe(false);
    });
  });

  it("stays in the active set and plays the clicked track when clicking within it", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const set = await repos.createSession({
      name: "S",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const t1 = readyTrack("trk_1", set.id, "One", "blb_1");
    const t2 = readyTrack("trk_2", set.id, "Two", "blb_2");
    await db.tracks.bulkAdd([t1, t2]);
    await putMediaBlob(db, t1.id, "blb_1");
    await putMediaBlob(db, t2.id, "blb_2");
    await repos.prependTrackIds(set.id, [t1.id, t2.id]); // [t1, t2]

    usePlayerStore.getState().init();
    const tracks = await repos.getTracksByIds([t1.id, t2.id]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(0));

    // Click the second track of the SAME viewed set → stays in set, plays it.
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[1], { source: { kind: "set", setId: set.id }, tracks });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.activeSessionId).toBe(set.id);
      expect(s.queue.map((t) => t.id)).toEqual([t1.id, t2.id]);
      expect(s.queue[s.currentIndex]?.id).toBe(t2.id);
    });
  });

  // --- Phase 2: non-set contexts (system playlist / entity / library) ---------

  it("plays from a system playlist as its own context (no contextSetId)", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const home = await repos.createSession({
      name: "home",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", home.id, "A", "blb_a");
    const b = readyTrack("trk_b", home.id, "B", "blb_b");
    await db.tracks.bulkAdd([a, b]);
    await putMediaBlob(db, a.id, "blb_a");
    await putMediaBlob(db, b.id, "blb_b");

    usePlayerStore.getState().init();
    const liked = await repos.getTracksByIds([a.id, b.id]);
    await usePlayerStore.getState().playTrackInContext(liked[1], {
      source: { kind: "system-playlist", id: "system:liked" },
      tracks: liked,
    });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.activeSessionId).toBeNull();
      expect(s.queueSource).toEqual({ kind: "system-playlist", id: "system:liked" });
      expect(s.queue.map((t) => t.id)).toEqual([a.id, b.id]);
      expect(s.queue[s.currentIndex]?.id).toBe(b.id);
      expect(s.djEnabled).toBe(false);
    });
    await expect(repos.getPlayQueue()).resolves.toMatchObject({ contextSetId: undefined });
  });

  it("plays from a derived album entity as its own context", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const home = await repos.createSession({
      name: "home",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", home.id, "A", "blb_a");
    await db.tracks.bulkAdd([a]);
    await putMediaBlob(db, a.id, "blb_a");

    usePlayerStore.getState().init();
    const tracks = await repos.getTracksByIds([a.id]);
    await usePlayerStore.getState().playTrackInContext(tracks[0], {
      source: { kind: "entity", entityKind: "album", entityKey: "album:Mixtape", label: "Mixtape" },
      tracks,
    });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queueSource).toEqual({
        kind: "entity",
        entityKind: "album",
        entityKey: "album:Mixtape",
        label: "Mixtape",
      });
      expect(s.queue.map((t) => t.id)).toEqual([a.id]);
      expect(s.activeSessionId).toBeNull();
    });
  });

  it("plays from the whole library (全部歌曲) as its own context", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const home = await repos.createSession({
      name: "home",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", home.id, "A", "blb_a");
    const b = readyTrack("trk_b", home.id, "B", "blb_b");
    await db.tracks.bulkAdd([a, b]);
    await putMediaBlob(db, a.id, "blb_a");
    await putMediaBlob(db, b.id, "blb_b");

    usePlayerStore.getState().init();
    const tracks = await repos.getTracksByIds([a.id, b.id]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "library" }, tracks });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queueSource).toEqual({ kind: "library" });
      expect(s.queue.map((t) => t.id)).toEqual([a.id, b.id]);
      expect(s.currentIndex).toBe(0);
    });
  });

  it("plays from an online playlist as its own context (not the shared online pool)", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const home = await repos.createSession({
      name: "online-cache",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", home.id, "A", "blb_a");
    const b = readyTrack("trk_b", home.id, "B", "blb_b");
    await db.tracks.bulkAdd([a, b]);
    await putMediaBlob(db, a.id, "blb_a");
    await putMediaBlob(db, b.id, "blb_b");
    const playlist = { id: "pl_1", name: "My Playlist", source: "netease", trackCount: 2 } as const;

    usePlayerStore.getState().init();
    const tracks = await repos.getTracksByIds([a.id, b.id]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[1], { source: { kind: "online-playlist", playlist }, tracks });

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queueSource).toEqual({ kind: "online-playlist", playlist });
      expect(s.queue.map((t) => t.id)).toEqual([a.id, b.id]);
      expect(s.queue[s.currentIndex]?.id).toBe(b.id);
      expect(s.activeSessionId).toBeNull();
    });
    await expect(repos.getPlayQueue()).resolves.toMatchObject({ contextSetId: undefined });
  });

  it("plays an online playlist context while only adding the clicked song to the visible online cache", async () => {
    const resolve = vi.fn(async (externalId: string) => ({
      kind: "ok" as const,
      stream: {
        mediaUrl: `https://media.example.com/${externalId}.mp3`,
        mime: "audio/mpeg",
      },
    }));
    vi.doMock("@/streamsrc/registry", async () => {
      const actual =
        await vi.importActual<typeof import("@/streamsrc/registry")>("@/streamsrc/registry");
      return {
        ...actual,
        createStreamSource: () => ({ resolve }),
      };
    });
    const { repos, usePlayerStore } = await loadRuntime();
    await repos.saveSettings({
      streamSources: { netease: { enabled: true, cookie: "MUSIC_U=abc" } },
    });
    const playlist = { id: "pl_1", name: "My Playlist", source: "netease", trackCount: 3 } as const;
    const hits = [
      { source: "netease", externalId: "song_a", title: "A" },
      { source: "netease", externalId: "song_b", title: "B" },
      { source: "netease", externalId: "song_c", title: "C" },
    ] as const;

    usePlayerStore.getState().init();
    await usePlayerStore.getState().playOnlinePlaylist(playlist, [...hits], 1);

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queueSource).toEqual({ kind: "online-playlist", playlist });
      expect(s.queue.map((track) => track.title)).toEqual(["A", "B", "C"]);
      expect(s.queue[s.currentIndex]?.title).toBe("B");
      expect(s.activeSessionId).toBeNull();
    });
    expect(resolve).toHaveBeenCalledWith("song_b", expect.objectContaining({ quality: undefined }));

    const settings = await repos.getSettings();
    const onlineSetId = settings.streamOnlineSetId;
    if (!onlineSetId) throw new Error("expected online cache set");
    const onlineSet = await repos.getSession(onlineSetId);
    const selectedTrack = usePlayerStore.getState().queue[1];
    expect(onlineSet?.trackIds).toEqual([selectedTrack.id]);
    await expect(repos.listAllTracks()).resolves.toEqual([
      expect.objectContaining({ id: selectedTrack.id, title: "B" }),
    ]);
    await waitFor(async () => {
      const cached = await repos.getTrack(selectedTrack.id);
      expect(cached?.blobId).toEqual(expect.any(String));
    });
  });

  // --- Phase 4a: materialized shuffle + linear stepping (Part B) ---------------

  async function setupShuffleSet(rt: Awaited<ReturnType<typeof loadRuntime>>, names: string[]) {
    const { db, repos, usePlayerStore } = rt;
    const set = await repos.createSession({
      name: "S",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const items = names.map((n) => readyTrack(`trk_${n}`, set.id, `T${n}`, `blb_${n}`));
    await db.tracks.bulkAdd(items);
    for (const it of items) await putMediaBlob(db, it.id, it.blobId as string);
    await repos.prependTrackIds(
      set.id,
      items.map((i) => i.id),
    );
    usePlayerStore.getState().init();
    const tracks = await repos.getTracksByIds(items.map((i) => i.id));
    return { set, tracks };
  }

  it("shuffle on reorders the queue, pinning the current track first", async () => {
    const rt = await loadRuntime();
    const { usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c", "d"]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[2], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() =>
      expect(usePlayerStore.getState().queue[usePlayerStore.getState().currentIndex]?.id).toBe(
        "trk_c",
      ),
    );

    usePlayerStore.getState().setShuffle(true);

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.shuffle).toBe(true);
      expect(s.queue[0]?.id).toBe("trk_c"); // current pinned first
      expect(s.currentIndex).toBe(0);
      expect(new Set(s.queue.map((t) => t.id))).toEqual(
        new Set(["trk_a", "trk_b", "trk_c", "trk_d"]),
      );
    });
  });

  it("turning shuffle off restores the natural order", async () => {
    const rt = await loadRuntime();
    const { usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c", "d"]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[2], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(2));

    usePlayerStore.getState().setShuffle(true);
    await waitFor(() => expect(usePlayerStore.getState().queue[0]?.id).toBe("trk_c"));

    usePlayerStore.getState().setShuffle(false);

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue.map((t) => t.id)).toEqual(["trk_a", "trk_b", "trk_c", "trk_d"]);
      expect(s.queue[s.currentIndex]?.id).toBe("trk_c"); // current preserved
    });
  });

  // Generous per-test timeout: this test waits on two async liveQuery reflects, which the
  // forks pool can starve for many seconds on a heavily-loaded machine (the whole file has
  // been observed at ~27s under contention). Logic is fast; only scheduling is slow.
  it("plays the clicked track next even in shuffle (insert after current is not skipped)", {
    timeout: 30000,
  }, async () => {
    const rt = await loadRuntime();
    const { db, usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c"]);
    // A standalone track that gets 点歌'd in after the current one.
    const requested = readyTrack("trk_req", set.id, "Requested", "blb_req");
    await db.tracks.add(requested);
    await putMediaBlob(db, requested.id, "blb_req");

    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });
    usePlayerStore.getState().setShuffle(true);
    // Shuffle materialization + the liveQuery reflect are async; under heavy parallel-test
    // load they can exceed waitFor's 1000ms default (same slack as the debounce waits above).
    await waitFor(
      () => {
        const s = usePlayerStore.getState();
        expect(s.shuffle).toBe(true);
        expect(s.queue[0]?.id).toBe("trk_a"); // current pinned
      },
      { timeout: 5000 },
    );

    const cur = usePlayerStore.getState().currentIndex;
    await usePlayerStore.getState().playNextTrack(requested);
    // The store action publishes the queue snapshot immediately after persisting the
    // play-next entry, so this assertion no longer depends on Dexie liveQuery timing.
    await waitFor(() => expect(usePlayerStore.getState().queue[cur + 1]?.id).toBe("trk_req"), {
      timeout: 20000,
    });

    await usePlayerStore.getState().next();

    // Linear next over the visible queue → the 点歌 plays next, not a random track.
    const s = usePlayerStore.getState();
    expect(s.queue[s.currentIndex]?.id).toBe("trk_req");
  });

  it("next() follows the visible (shuffled) queue order", async () => {
    const rt = await loadRuntime();
    const { usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c", "d"]);
    // Enable shuffle first so the materialize happens inside the awaited play call.
    usePlayerStore.getState().setShuffle(true);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue[0]?.id).toBe("trk_a"); // clicked track pinned first
      expect(s.currentIndex).toBe(0);
    });

    const expectedNextId = usePlayerStore.getState().queue[1]?.id;
    await usePlayerStore.getState().next();

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queue[s.currentIndex]?.id).toBe(expectedNextId); // linear: visible next played
    });
  });

  it("reuses the same shuffle when toggled off then on within a playlist (Q8)", async () => {
    const rt = await loadRuntime();
    const { usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c", "d", "e"]);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });

    await usePlayerStore.getState().setShuffle(true);
    const firstOrder = usePlayerStore.getState().queue.map((t) => t.id);

    await usePlayerStore.getState().setShuffle(false);
    await waitFor(() =>
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(
        tracks.map((t) => t.id), // natural order restored
      ),
    );

    // Toggle back on (default: reuse, NOT re-roll) → identical order.
    await usePlayerStore.getState().setShuffle(true);
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual(firstOrder);
  });

  it("re-rolls the shuffle after switching to a different playlist (Q8)", async () => {
    const rt = await loadRuntime();
    const { repos, usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c", "d", "e"]);
    // A second set with its own tracks.
    const set2 = await repos.createSession({
      name: "S2",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const t2 = ["p", "q", "r", "s", "t"].map((n) => readyTrack(`trk_${n}`, set2.id, n, `blb_${n}`));
    await rt.db.tracks.bulkAdd(t2);
    for (const it of t2) await putMediaBlob(rt.db, it.id, it.blobId as string);
    await repos.prependTrackIds(
      set2.id,
      t2.map((i) => i.id),
    );

    await usePlayerStore.getState().setShuffle(true);
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() => expect(usePlayerStore.getState().queueSource).toBeTruthy());

    // Switch to set2 (shuffle stays on) → a fresh shuffle for the NEW context's tracks.
    const tracks2 = await repos.getTracksByIds(t2.map((i) => i.id));
    await usePlayerStore
      .getState()
      .playTrackInContext(tracks2[0], { source: { kind: "set", setId: set2.id }, tracks: tracks2 });

    await waitFor(() => {
      const ids = usePlayerStore.getState().queue.map((t) => t.id);
      expect(new Set(ids)).toEqual(new Set(t2.map((i) => i.id))); // queue is set2's tracks
      expect(ids[0]).toBe(tracks2[0].id); // clicked pinned first
    });
  });

  it("a manual play-next joins the Next-in-Queue block (requested) right after current (Q10)", async () => {
    const rt = await loadRuntime();
    const { db, repos, usePlayerStore } = rt;
    const { set, tracks } = await setupShuffleSet(rt, ["a", "b", "c"]);
    const d = readyTrack("trk_d", set.id, "D", "blb_d");
    await db.tracks.add(d);
    await putMediaBlob(db, d.id, "blb_d");

    await usePlayerStore
      .getState()
      .playTrackInContext(tracks[0], { source: { kind: "set", setId: set.id }, tracks });
    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(0));

    await usePlayerStore.getState().playNextTrack(d);

    await waitFor(() => expect(usePlayerStore.getState().queue[1]?.id).toBe("trk_d"));
    const pq = await repos.getPlayQueue();
    expect(pq.entries[pq.currentIndex + 1]?.trackId).toBe("trk_d");
    expect(pq.entries[pq.currentIndex + 1]?.requested).toBe(true); // marked as Next-in-Queue
  });

  it("restores the queueSource + natural order from the persisted queue on boot (Q3)", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const home = await repos.createSession({
      name: "home",
      seedPrompt: "",
      config: { autoExtend: false },
    });
    const a = readyTrack("trk_a", home.id, "A", "blb_a");
    const b = readyTrack("trk_b", home.id, "B", "blb_b");
    const c = readyTrack("trk_c", home.id, "C", "blb_c");
    await db.tracks.bulkAdd([a, b, c]);
    for (const it of [a, b, c]) await putMediaBlob(db, it.id, it.blobId as string);

    // Simulate a prior session: playing the whole library, shuffled to [b,a,c], with the
    // natural order [a,b,c] and the library source persisted on the play-queue row.
    await repos.playQueueSet([b.id, a.id, c.id], { currentIndex: 0 });
    await repos.playQueuePersistContextMeta({ kind: "library" }, [a.id, b.id, c.id]);
    await repos.saveSettings({ playerShuffle: true });

    usePlayerStore.getState().init();

    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.queueSource).toEqual({ kind: "library" }); // label restored from persistence
      expect(s.queue.map((t) => t.id)).toEqual([b.id, a.id, c.id]); // persisted shuffled order
    });

    // "Turn shuffle off" restores the persisted natural order even after the relaunch.
    await usePlayerStore.getState().setShuffle(false);
    await waitFor(() =>
      expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual([a.id, b.id, c.id]),
    );
  });
});

// --- Live-request "play now" (立即播放) de-dupe -------------------------------
// playRequestNow cuts the requested track in right after the playing slot. When
// that track is ALREADY in the queue it must REUSE the existing entry (move it),
// not insert a duplicate that would replay the song later at its old spot.
describe("player-store live request play-now de-dupe", () => {
  async function seedThree(currentIndex = 0) {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({
      seedPrompt: "",
      config: { autoExtend: false },
      displayMode: "cover",
    });
    const first = track("trk_first", session.id, "First");
    const second = track("trk_second", session.id, "Second");
    const third = track("trk_third", session.id, "Third");
    await db.tracks.bulkAdd([first, second, third]);
    for (const t of [first, second, third]) {
      const blobId = `blb_${t.id}`;
      await db.mediaBlobs.put({
        id: blobId,
        trackId: t.id,
        role: "media",
        mime: "audio/mpeg",
        bytes: 3,
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
      });
      await db.tracks.update(t.id, { status: "ready", blobId });
    }
    await repos.prependTrackIds(session.id, [first.id, second.id, third.id]);
    await repos.playQueueSet([first.id, second.id, third.id], {
      contextSetId: session.id,
      currentIndex,
    });
    usePlayerStore.getState().init();
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(3));
    await usePlayerStore.getState().playIndex(currentIndex);
    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(currentIndex));
    mediaEngineMock.play.mockClear();
    return { db, repos, session, first, second, third, usePlayerStore };
  }

  it("MOVES an already-queued track (ahead of cursor) to the cut-in slot instead of duplicating", async () => {
    const { first, second, third, usePlayerStore } = await seedThree(0); // playing `first`

    await usePlayerStore.getState().playRequestNow(third); // already at index 2

    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual([first.id, third.id, second.id]);
    expect(s.queue.filter((t) => t.id === third.id)).toHaveLength(1); // no duplicate
    expect(s.queue[s.currentIndex]?.id).toBe(third.id);
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("MOVES an already-queued track (behind cursor) forward without duplicating", async () => {
    const { first, second, third, usePlayerStore } = await seedThree(2); // playing `third`

    await usePlayerStore.getState().playRequestNow(first); // behind the cursor

    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual([second.id, third.id, first.id]);
    expect(s.queue.filter((t) => t.id === first.id)).toHaveLength(1);
    expect(s.queue[s.currentIndex]?.id).toBe(first.id);
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("restarts the currently-playing track when it is itself the request", async () => {
    const { first, second, third, usePlayerStore } = await seedThree(0); // playing `first`

    await usePlayerStore.getState().playRequestNow(first);

    const s = usePlayerStore.getState();
    expect(s.queue.map((t) => t.id)).toEqual([first.id, second.id, third.id]); // unchanged
    expect(s.currentIndex).toBe(0);
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });
});

// Q2: with NOTHING playing (empty/idle queue, currentIndex < 0), "play next" has no
// anchor track to queue after — so a live request should START playing it rather than
// silently appending into a queue that never advances.
describe("player-store live request idle play-next (Q2)", () => {
  it("starts playing the requested track when the queue is empty (idle, currentIndex < 0)", async () => {
    const { db, repos, usePlayerStore } = await loadRuntime();
    const session = await repos.createSession({ seedPrompt: "", config: { autoExtend: false } });
    const requested = track("trk_idle_req", session.id, "Requested");
    await db.tracks.bulkAdd([requested]);
    const blobId = `blb_${requested.id}`;
    await db.mediaBlobs.put({
      id: blobId,
      trackId: requested.id,
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
    });
    await db.tracks.update(requested.id, { status: "ready", blobId });
    // Empty play queue → nothing playing (currentIndex stays -1).
    usePlayerStore.getState().init();
    await waitFor(() => expect(usePlayerStore.getState().currentIndex).toBe(-1));
    mediaEngineMock.play.mockClear();

    await usePlayerStore.getState().playRequestNext(requested);

    // Before the fix this just appended (currentIndex stayed -1, nothing played).
    await waitFor(() => {
      const s = usePlayerStore.getState();
      expect(s.currentIndex).toBeGreaterThanOrEqual(0);
      expect(s.queue[s.currentIndex]?.id).toBe(requested.id);
    });
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });
});
