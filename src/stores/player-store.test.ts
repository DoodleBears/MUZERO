import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";

// The store drives a real <audio>/<video> MediaEngine in init(); for store-level
// tests we only care about WHICH source it asks the engine to load, so stub the
// engine and capture loadUrl/loadBlob/play. (vi.hoisted survives vi.resetModules
// because it lives in this test module, not the re-imported store module.)
const mediaEngineMock = vi.hoisted(() => ({
  loadUrl: vi.fn(() => Promise.resolve()),
  loadBlob: vi.fn(() => Promise.resolve()),
  play: vi.fn(() => Promise.resolve()),
  setDiagnosticsContext: vi.fn(),
}));

vi.mock("@/player/media-engine", () => {
  class MockMediaEngine {
    callbacks: unknown;
    loadUrl = mediaEngineMock.loadUrl;
    loadBlob = mediaEngineMock.loadBlob;
    play = mediaEngineMock.play;
    setDiagnosticsContext = mediaEngineMock.setDiagnosticsContext;
    constructor(callbacks: unknown = {}) {
      this.callbacks = callbacks;
    }
    setCallbacks(callbacks: unknown) {
      this.callbacks = callbacks;
    }
    setVolume() {}
    pause() {}
    seek() {}
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

let openedDb: MuzeroDB | null = null;

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
  mediaEngineMock.setDiagnosticsContext.mockClear();
  await deleteDefaultDb();
});

afterEach(async () => {
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
  // Imported AFTER resetModules so they share the same `muzero-db` singleton the
  // store uses — the remote import writes tracks the store then plays.
  const subscription = await import("@/sync/r2-subscription");
  const importStream = await import("@/sync/r2-import-stream");
  return {
    db: dbMod.db,
    repos,
    usePlayerStore: store.usePlayerStore,
    sync: {
      subscribeManifest: subscription.subscribeManifest,
      loadRemoteSetIndex: subscription.loadRemoteSetIndex,
      importRemoteSetStream: importStream.importRemoteSetStream,
    },
  };
}

async function seedQueue(currentIndex = 1) {
  const { db, repos, usePlayerStore } = await loadRuntime();
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
  return { repos, session, first, second, usePlayerStore };
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

describe("player-store playback resume", () => {
  it("hydrates the last queue cursor and active set from IndexedDB", async () => {
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
  it("streams an audio track from a subscribed public manifest (no blob download)", async () => {
    const { usePlayerStore } = await subscribeAndActivateRemoteSet();
    const trace = await import("@/lib/trace");
    trace.clearTrace();

    await usePlayerStore.getState().playIndex(0);

    expect(mediaEngineMock.loadUrl).toHaveBeenCalledWith(REMOTE_AUDIO_URL, "audio");
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
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();
    expect(mediaEngineMock.play).toHaveBeenCalled();
  });

  it("streams a video track from a subscribed public manifest", async () => {
    const { usePlayerStore } = await subscribeAndActivateRemoteSet();

    await usePlayerStore.getState().playIndex(1);

    expect(mediaEngineMock.loadUrl).toHaveBeenCalledWith(REMOTE_VIDEO_URL, "video");
    expect(mediaEngineMock.loadBlob).not.toHaveBeenCalled();
  });
});
