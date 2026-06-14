import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";

const PLAYER_STORE_INTEGRATION_TEST_TIMEOUT_MS = 15_000;

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
  vi.doUnmock("@/lib/media-probe");
  vi.doUnmock("@/lib/media-metadata");
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

describe("player-store playback resume", () => {
  it(
    "hydrates the last queue cursor and active set from IndexedDB",
    async () => {
      const { session, first, second, usePlayerStore } = await seedQueue(1);

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

  it("keeps the current song visible and playing while the next R2 track downloads", async () => {
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
    expect(usePlayerStore.getState().currentIndex).toBe(0);
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

  it("persists the queue cursor when the user picks another track", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));

    await usePlayerStore.getState().playIndex(1);

    await waitFor(async () => {
      await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 1 });
    });
  });

  it("coalesces rapid queue cursor persistence to the final picked track", async () => {
    const { repos, usePlayerStore } = await seedQueue(0);
    usePlayerStore.getState().init();

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));

    await usePlayerStore.getState().playIndex(1);
    await usePlayerStore.getState().playIndex(0);
    await usePlayerStore.getState().playIndex(1);

    await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 0 });
    await waitFor(async () => {
      await expect(repos.getPlayQueue()).resolves.toMatchObject({ currentIndex: 1 });
    });
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

describe("player-store bulk upload visibility", () => {
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
