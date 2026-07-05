import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  createUploadedTrack,
  getPlayQueue,
  getSession,
  getSettings,
  getTrack,
  listAllTracks,
  playQueueSet,
  prependTrackIds,
  saveSettings,
  setTrackNote,
} from "@/db/repositories";
import { DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, type Track } from "@/db/types";
import type { AudienceRequestAiDjQueue } from "./audience-request-ai-dj";
import {
  createAudienceRequestRuntime,
  executeVideoRequest,
  resolveLiveRequestOnlineSetId,
} from "./audience-request-runtime";
import type { NormalizedAudienceRequest } from "./audience-request-schema";
import type { VideoRequestPlan } from "./video-request";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-live-requests-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("AudienceRequestRuntime direct search route", () => {
  it("queues a confident local match after the current track by default", async () => {
    const { current, target, tail } = await seedQueue();
    const runtime = createAudienceRequestRuntime({ db });

    const item = await runtime.handle(request("点歌 晴天"));

    const queue = await getPlayQueue(db);
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, target.id, tail.id]);
    expect(queue.currentIndex).toBe(0);
    expect(item).toMatchObject({
      status: "completed",
      matchedTrackId: target.id,
      routeMode: "library-search",
      playbackAction: "play-next",
    });
  });

  it("fires onRequestPlayed with the matched track + action after a successful route", async () => {
    const { target } = await seedQueue();
    const onRequestPlayed = vi.fn();
    const runtime = createAudienceRequestRuntime({ db, onRequestPlayed });

    await runtime.handle(request("点歌 晴天")); // default playbackAction = play-next

    expect(onRequestPlayed).toHaveBeenCalledTimes(1);
    expect(onRequestPlayed).toHaveBeenCalledWith({ track: target, action: "play-next" });
  });

  it("does not fire onRequestPlayed when nothing was played", async () => {
    await seedQueue();
    const onRequestPlayed = vi.fn();
    const runtime = createAudienceRequestRuntime({ db, onRequestPlayed });

    await runtime.handle(request("Plastic Love")); // no confident match → ignored

    expect(onRequestPlayed).not.toHaveBeenCalled();
  });

  it("can append a confident local match to the end of the play queue", async () => {
    const { current, target, tail } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          playbackAction: "append-queue",
        },
      },
      db,
    );
    const runtime = createAudienceRequestRuntime({ db });

    await runtime.handle(request("晴天"));

    const queue = await getPlayQueue(db);
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, tail.id, target.id]);
  });

  it("keeps play-now requests in approval when approval is required", async () => {
    const { target } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          playbackAction: "play-now",
          requireApprovalForPlayNow: true,
        },
      },
      db,
    );
    const playNow = vi.fn();
    const runtime = createAudienceRequestRuntime({ db, playNow });

    const item = await runtime.handle(request("晴天"));

    expect(playNow).not.toHaveBeenCalled();
    expect(item).toMatchObject({
      status: "needs-approval",
      matchedTrackId: target.id,
    });
  });

  it("can immediately play a confident match when play-now approval is disabled", async () => {
    const { target } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          playbackAction: "play-now",
          requireApprovalForPlayNow: false,
        },
      },
      db,
    );
    const playNow = vi.fn();
    const runtime = createAudienceRequestRuntime({ db, playNow });

    const item = await runtime.handle(request("晴天"));

    expect(playNow).toHaveBeenCalledWith(target);
    expect(item.status).toBe("completed");
  });

  it("honors active-set search scope", async () => {
    const { current, tail } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          searchScope: "active-set",
        },
      },
      db,
    );
    const runtime = createAudienceRequestRuntime({ db });

    const item = await runtime.handle(request("晴天"));

    const queue = await getPlayQueue(db);
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, tail.id]);
    expect(item.status).toBe("ignored");
  });

  it("active-set scope falls back to the live play queue when the context has no DjSession (online playlist)", async () => {
    // Mimic activateExplicitQueue (online-playlist / system-playlist / entity / library):
    // a play queue with entries but NO contextSetId. The requested song is IN that queue.
    const homeSession = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const current = await track(homeSession.id, "Now Playing");
    const target = await track(homeSession.id, "晴天");
    const tail = await track(homeSession.id, "Tail Song");
    // Note: no prependTrackIds → homeSession.trackIds stays empty; the queue is the source of truth.
    await playQueueSet([current.id, target.id, tail.id], { currentIndex: 0 }, db); // no contextSetId
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          searchScope: "active-set",
        },
      },
      db,
    );
    const runtime = createAudienceRequestRuntime({ db });

    const item = await runtime.handle(request("晴天"));

    // Before the fix this returned [] → "ignored"; now active-set sees the live queue.
    expect(item).toMatchObject({ status: "completed", matchedTrackId: target.id });
  });

  it("active-set scope can use an injected live-queue resolver (store cursor) without a session", async () => {
    const homeSession = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const current = await track(homeSession.id, "Now Playing");
    const target = await track(homeSession.id, "晴天");
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          searchScope: "active-set",
        },
      },
      db,
    );
    // DB play queue is empty; the store-injected resolver is the authoritative "current playlist".
    const runtime = createAudienceRequestRuntime({
      db,
      getActiveQueueTrackIds: () => [current.id, target.id],
      getCurrentTrackId: () => current.id,
    });

    const item = await runtime.handle(request("晴天"));

    expect(item).toMatchObject({ status: "completed", matchedTrackId: target.id });
  });

  it("matches direct library-search requests by song title instead of notes", async () => {
    const { current, tail } = await seedQueue();
    await setTrackNote(tail.id, "Plastic Love memory", db);
    const runtime = createAudienceRequestRuntime({ db });

    const item = await runtime.handle(request("Plastic Love"));

    const queue = await getPlayQueue(db);
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, tail.id]);
    expect(item).toMatchObject({
      confidence: "none",
      status: "ignored",
    });
  });

  it("tries an injected online fallback when local confidence is too low", async () => {
    const { current, tail, sessionId } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          onlineFallbackOnLowConfidence: true,
        },
        streamSources: { netease: { enabled: true } },
      },
      db,
    );
    let online: Track | undefined;
    const onlineFallback = vi.fn(async () => {
      online = await track(sessionId, "Rare Online Song");
      return { trackId: online.id };
    });
    const runtime = createAudienceRequestRuntime({
      db,
      hasConfiguredOnlineSources: () => true,
      onlineFallback,
    });

    const item = await runtime.handle(request("rare online"));

    expect(onlineFallback).toHaveBeenCalledWith(expect.objectContaining({ query: "rare online" }));
    const queue = await getPlayQueue(db);
    expect(online).toBeTruthy();
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, online!.id, tail.id]);
    expect(item.matchedTrackId).toBe(online!.id);
  });

  it("routes a confident match from another set by reusing its track id (no online, no copy)", async () => {
    // Case ①②: the requested song lives in a DIFFERENT local set — all-library scope
    // finds it and we route THAT exact track, never re-fetching a fresh online copy.
    await seedQueue();
    const otherSet = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const elsewhere = await track(otherSet.id, "Plastic Love");
    const before = (await listAllTracks(db)).length;
    const onlineFallback = vi.fn();
    const runtime = createAudienceRequestRuntime({ db, onlineFallback });

    const item = await runtime.handle(request("Plastic Love"));

    expect(item).toMatchObject({ status: "completed", matchedTrackId: elsewhere.id });
    expect(onlineFallback).not.toHaveBeenCalled(); // reused local — did not go online
    expect((await listAllTracks(db)).length).toBe(before); // no duplicate track row
  });

  it("routes AI DJ requests into the injected AI queue and links the chat session", async () => {
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          routeMode: "ai-dj",
        },
      },
      db,
    );
    const done = deferred<void>();
    const aiDjQueue: AudienceRequestAiDjQueue = {
      enqueue: vi.fn(async (input) => {
        input.onProgress?.({ chatSessionId: "cht_live", status: "queued" });
        await done.promise;
        input.onProgress?.({ chatSessionId: "cht_live", status: "completed" });
        return { chatSessionId: "cht_live" };
      }),
    };
    const onAiDjRequestReceived = vi.fn();
    const runtime = createAudienceRequestRuntime({
      aiDjQueue,
      canUseAiDj: () => true,
      db,
      onAiDjRequestReceived,
    });

    const item = await runtime.handle(request("DJ 选一首暖场 city pop"));

    expect(aiDjQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        playbackAction: "play-next",
        routeMode: "ai-dj",
        request: expect.objectContaining({ normalizedQuery: "DJ 选一首暖场 city pop" }),
      }),
    );
    expect(item.status).toBe("queued");
    expect(item.chatSessionId).toBe("cht_live");
    expect(onAiDjRequestReceived).toHaveBeenCalledWith({
      request: expect.objectContaining({ normalizedQuery: "DJ 选一首暖场 city pop" }),
    });

    done.resolve();
    await flushAsync();
    expect(item.status).toBe("completed");
    expect(item.chatSessionId).toBe("cht_live");
  });

  it("marks AI DJ failures without throwing through playback", async () => {
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          routeMode: "ai-dj",
        },
      },
      db,
    );
    const aiDjQueue: AudienceRequestAiDjQueue = {
      enqueue: vi.fn(async (input) => {
        input.onProgress?.({ chatSessionId: "cht_failed", status: "queued" });
        throw new Error("model unavailable");
      }),
    };
    const runtime = createAudienceRequestRuntime({
      aiDjQueue,
      canUseAiDj: () => true,
      db,
    });

    const item = await runtime.handle(request("ask the DJ"));

    await flushAsync();
    expect(item).toMatchObject({
      chatSessionId: "cht_failed",
      error: "model unavailable",
      status: "failed",
    });
  });

  it("rate-limits request floods before additional playback side effects", async () => {
    const { current, target, tail } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          maxRequestsPerMinute: 1,
        },
      },
      db,
    );
    let now = 1_000;
    const runtime = createAudienceRequestRuntime({ db, now: () => now });

    const first = await runtime.handle(request("晴天"));
    now += 100;
    const second = await runtime.handle(request("Tail Song"));

    const queue = await getPlayQueue(db);
    expect(first.status).toBe("completed");
    expect(second).toMatchObject({ error: "rate-limited", status: "ignored" });
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, target.id, tail.id]);
  });
});

describe("AudienceRequestRuntime per-source route override", () => {
  it("overrides playbackAction for the call (append instead of the settings default)", async () => {
    const { current, target, tail } = await seedQueue();
    const runtime = createAudienceRequestRuntime({ db });

    await runtime.handle(request("晴天"), { playbackAction: "append-queue" });

    const queue = await getPlayQueue(db);
    expect(queue.entries.map((entry) => entry.trackId)).toEqual([current.id, tail.id, target.id]);
  });

  it("overrides routeMode to ai-dj for the call even if settings say library-search", async () => {
    const aiDjQueue: AudienceRequestAiDjQueue = {
      enqueue: vi.fn(async () => ({ chatSessionId: "cht_override" })),
    };
    const runtime = createAudienceRequestRuntime({ db, aiDjQueue, canUseAiDj: () => true });

    const item = await runtime.handle(request("DJ city pop"), { routeMode: "ai-dj" });

    expect(aiDjQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ routeMode: "ai-dj" }));
    expect(item.routeMode).toBe("ai-dj");
    // Immediately-resolving mock may already be "completed"; either proves the route override took.
    expect(["queued", "completed"]).toContain(item.status);
  });
});

describe("resolveLiveRequestOnlineSetId (Q3 — online matches always land in the 点歌/online set)", () => {
  it("always resolves the dedicated online set, ignoring any active session", async () => {
    const active = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const online = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await saveSettings({ streamOnlineSetId: online.id }, db);
    // Mid-playback in a different set: the online match's home must STILL be the online set.
    await playQueueSet([], { contextSetId: active.id, currentIndex: -1 }, db);
    const settings = await getSettings(db);

    const target = await resolveLiveRequestOnlineSetId(db, settings);

    expect(target).toBe(online.id);
    expect(target).not.toBe(active.id);
  });

  it("creates and persists a dedicated online set when none exists yet", async () => {
    const settings = await getSettings(db); // no streamOnlineSetId

    const target = await resolveLiveRequestOnlineSetId(db, settings);

    expect(target).toBeTruthy();
    expect((await getSettings(db)).streamOnlineSetId).toBe(target);
    expect(await getSession(target, db)).toBeTruthy();
  });

  it("re-creates the online set when the persisted id is dangling", async () => {
    await saveSettings({ streamOnlineSetId: "ses_ghost_deleted" }, db);
    const settings = await getSettings(db);

    const target = await resolveLiveRequestOnlineSetId(db, settings);

    expect(target).not.toBe("ses_ghost_deleted");
    expect(await getSession(target, db)).toBeTruthy();
  });
});

describe("executeVideoRequest", () => {
  it("plays a local downloaded video without calling the downloader", async () => {
    const local = await track(
      (await createSession({ seedPrompt: "", config: { autoExtend: false } }, db)).id,
      "Local MV",
      "video",
    );
    const executePlayback = vi.fn(async () => undefined);
    const downloadHit = vi.fn();

    const result = await executeVideoRequest(
      { kind: "play-local", track: local },
      {
        action: "play-next",
        downloadHit,
        executePlayback,
        getTrack: (id) => getTrack(id, db),
        notifyRejected: vi.fn(),
        resolveVideoSetId: async () => "ses_downloads",
        quality: "1080",
      },
    );

    expect(result).toEqual({ status: "completed", matchedTrackId: local.id });
    expect(executePlayback).toHaveBeenCalledWith("play-next", local);
    expect(downloadHit).not.toHaveBeenCalled();
  });

  it("downloads an online video to the downloads set, then plays the resulting track", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const downloaded = await track(session.id, "Downloaded MV", "video");
    const executePlayback = vi.fn(async () => undefined);
    const hit = { source: "bili" as const, externalId: "BV1#1", title: "MV" };
    const downloadHit = vi.fn(async () => ({
      bytes: 100,
      container: "mp4" as const,
      height: 720,
      kind: "downloaded" as const,
      trackId: downloaded.id,
    }));

    const result = await executeVideoRequest(
      {
        kind: "download-online",
        ref: { source: "bili", kind: "song", id: "BV1#1" },
        hit,
      },
      {
        action: "append-queue",
        downloadHit,
        executePlayback,
        getTrack: (id) => getTrack(id, db),
        notifyRejected: vi.fn(),
        resolveVideoSetId: async () => "ses_downloads",
        quality: "720",
      },
    );

    expect(downloadHit).toHaveBeenCalledWith(hit, { quality: "720", sessionId: "ses_downloads" });
    expect(executePlayback).toHaveBeenCalledWith("append-queue", downloaded);
    expect(result).toEqual({ status: "completed", matchedTrackId: downloaded.id });
  });

  it("notifies rejections and download failures without throwing", async () => {
    const notifyRejected = vi.fn();
    const base = {
      action: "play-next" as const,
      executePlayback: vi.fn(),
      getTrack: (id: string) => getTrack(id, db),
      notifyRejected,
      resolveVideoSetId: async () => "ses_downloads",
      quality: "1080",
    };

    await expect(
      executeVideoRequest(
        { kind: "rejected", reason: "too-long", durationSec: 481, maxSec: 480 },
        {
          ...base,
          downloadHit: vi.fn(),
        },
      ),
    ).resolves.toEqual({ status: "ignored", error: "too-long" });
    expect(notifyRejected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "too-long", durationSec: 481, maxSec: 480 }),
    );

    const failedPlan: VideoRequestPlan = {
      kind: "download-online",
      ref: { source: "bili", kind: "song", id: "BV1#1" },
      hit: { source: "bili", externalId: "BV1#1", title: "MV" },
    };
    await expect(
      executeVideoRequest(failedPlan, {
        ...base,
        downloadHit: vi.fn(async () => ({ kind: "error" as const, message: "network" })),
      }),
    ).resolves.toEqual({ status: "failed", error: "network" });
  });
});

async function seedQueue() {
  const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
  const current = await track(session.id, "Current Song");
  const target = await track(session.id, "晴天");
  const tail = await track(session.id, "Tail Song");
  await prependTrackIds(session.id, [current.id, tail.id], db);
  await playQueueSet([current.id, tail.id], { contextSetId: session.id, currentIndex: 0 }, db);
  return { current, target, tail, sessionId: session.id };
}

async function track(
  sessionId: string,
  title: string,
  kind: "audio" | "video" = "audio",
): Promise<Track> {
  return createUploadedTrack(
    {
      sessionId,
      title,
      kind,
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      mime: "audio/mpeg",
      durationSec: 180,
    },
    db,
  );
}

function request(message: string): NormalizedAudienceRequest {
  return {
    sourceKind: "manual-test",
    requesterRole: "viewer",
    rawMessage: message,
    normalizedQuery: message.replace(/^点歌\s*/, ""),
    receivedAt: Date.now(),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}
