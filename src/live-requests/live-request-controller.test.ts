import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createSession, createUploadedTrack, saveSettings } from "@/db/repositories";
import {
  type AudienceRequestSource,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  DEFAULT_AUDIENCE_REQUEST_SOURCE,
  type Track,
} from "@/db/types";
import type {
  AudienceRequestHandleOverride,
  AudienceRequestRuntime,
  AudienceRequestRuntimeItem,
} from "./audience-request-runtime";
import type { NormalizedAudienceRequest } from "./audience-request-schema";
import { createLiveRequestController } from "./live-request-controller";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-controller-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function fakeRuntime() {
  const handle = vi.fn(
    async (_request: NormalizedAudienceRequest, _override?: AudienceRequestHandleOverride) =>
      ({ id: "arq_x" }) as AudienceRequestRuntimeItem,
  );
  const runtime: AudienceRequestRuntime = {
    handle,
    approve: vi.fn(),
    reject: vi.fn(() => undefined),
    getItems: () => [],
  };
  return { runtime, handle };
}

function fakeControls() {
  let cb: ((payload: { body: string; receivedAt: number }) => void) | null = null;
  let subscribed = false;
  return {
    onMessage: vi.fn((callback: (p: { body: string; receivedAt: number }) => void) => {
      cb = callback;
      subscribed = true;
      return () => {
        cb = null;
        subscribed = false;
      };
    }),
    start: vi.fn(async () => ({ supported: true, listening: true })),
    stop: vi.fn(async () => ({ supported: true, listening: false })),
    status: vi.fn(async () => ({ supported: true, listening: false })),
    emit: (body: string) => cb?.({ body, receivedAt: 1 }),
    get subscribed() {
      return subscribed;
    },
  };
}

async function enableIntake() {
  await saveSettings(
    { audienceRequestIntake: { ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, enabled: true } },
    db,
  );
}

async function setSources(sources: AudienceRequestSource[]) {
  await saveSettings(
    {
      audienceRequestIntake: {
        ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
        enabled: true,
        sources,
      },
    },
    db,
  );
}

const source = (over: Partial<AudienceRequestSource>): AudienceRequestSource => ({
  id: "s",
  name: "S",
  status: "active",
  authMode: "open",
  mappingPreset: "auto",
  ...over,
});

const payload = (body: string) => ({ body, receivedAt: 1 });

async function uploadedTrack(sessionId: string, title: string): Promise<Track> {
  return createUploadedTrack(
    {
      sessionId,
      title,
      kind: "audio",
      blob: new Blob(["audio"], { type: "audio/mpeg" }),
      mime: "audio/mpeg",
      durationSec: 180,
    },
    db,
  );
}

describe("live-request-controller pipeline", () => {
  it("routes a parsed message through normalize → runtime.handle", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "点歌 晴天" })));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ normalizedQuery: "晴天" });
  });

  it("ignores non-JSON and payloads without a message", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload("not json at all"));
    await controller.handlePayload(payload(JSON.stringify({ foo: "bar" })));

    expect(handle).not.toHaveBeenCalled();
  });

  it("does nothing while intake is disabled", async () => {
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "点歌 X" })));

    expect(handle).not.toHaveBeenCalled();
  });

  it("ignores prefix-less messages when requireCommandPrefix is on (default)", async () => {
    await enableIntake(); // default prefixes ["点歌","!sr","song:"], requireCommandPrefix true
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "just chatting" })));

    expect(handle).not.toHaveBeenCalled();
  });

  it("routes prefix-less messages when requireCommandPrefix is off", async () => {
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          enabled: true,
          requireCommandPrefix: false,
        },
      },
      db,
    );
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "lofi beats" })));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ normalizedQuery: "lofi beats" });
  });

  it("threads getActiveQueueTrackIds + getCurrentTrackId into the default runtime (active-set off-session)", async () => {
    // active-set scope + no DjSession context → the runtime must search the injected
    // live-queue ids (GAP2 / Q4). No injected runtime → controller builds the real one.
    const home = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const current = await uploadedTrack(home.id, "Now Playing");
    const target = await uploadedTrack(home.id, "晴天");
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          enabled: true,
          searchScope: "active-set",
        },
      },
      db,
    );
    const controller = createLiveRequestController({
      db,
      controls: fakeControls(),
      getActiveQueueTrackIds: () => [current.id, target.id],
      getCurrentTrackId: () => current.id,
    });

    const item = await controller.drive({ query: "晴天" });

    expect(item).toMatchObject({ status: "completed", matchedTrackId: target.id });
  });
});

describe("live-request-controller intent router", () => {
  it("routes 点歌 to library-search (fast path), stripping the keyword from the query", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "点歌 晴天" })));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ normalizedQuery: "晴天" });
    expect(handle.mock.calls[0][1]).toMatchObject({ routeMode: "library-search" });
  });

  it("routes AI点歌 to ai-dj", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "AI点歌 citypop" })));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ normalizedQuery: "citypop" });
    expect(handle.mock.calls[0][1]).toMatchObject({ routeMode: "ai-dj" });
  });

  it("does not route comment / rating commands through the runtime (annotation intents)", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "评论 这段绝了" })));
    await controller.handlePayload(payload(JSON.stringify({ message: "评分 5" })));

    expect(handle).not.toHaveBeenCalled();
  });

  it("still applies the per-source route override on the no-command fallback path", async () => {
    // A source that routes everything to ai-dj: with requireCommandPrefix off and no
    // keyword match, the source override still reaches the runtime.
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          enabled: true,
          requireCommandPrefix: false,
          sources: [source({ id: "default", routeMode: "ai-dj" })],
        },
      },
      db,
    );
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload(payload(JSON.stringify({ message: "lofi beats" })));

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][1]).toMatchObject({ routeMode: "ai-dj" });
  });
});

describe("live-request-controller subscription", () => {
  it("subscribes once on start (idempotent) and unsubscribes on stop", () => {
    const { runtime } = fakeRuntime();
    const controls = fakeControls();
    const controller = createLiveRequestController({ db, runtime, controls });

    controller.start();
    controller.start();
    expect(controls.onMessage).toHaveBeenCalledTimes(1);
    expect(controls.subscribed).toBe(true);

    controller.stop();
    expect(controls.subscribed).toBe(false);
  });

  it("delivers incoming messages to the handle pipeline while subscribed", async () => {
    await enableIntake();
    const { runtime, handle } = fakeRuntime();
    const controls = fakeControls();
    const controller = createLiveRequestController({ db, runtime, controls });

    controller.start();
    // Drive the captured subscriber directly so we can await the async handler
    // instead of racing the fire-and-forget `void handlePayload` against teardown.
    await controller.handlePayload(payload(JSON.stringify({ message: "点歌 lofi" })));

    expect(controls.subscribed).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe("live-request-controller multi-source + testing lifecycle", () => {
  it("captures testing-source payloads for preview without acting", async () => {
    await setSources([
      DEFAULT_AUDIENCE_REQUEST_SOURCE,
      source({ id: "ssn", status: "testing", mappingPreset: "social-stream-ninja" }),
    ]);
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload({
      sourceId: "ssn",
      body: JSON.stringify({ chatmessage: "点歌 X", chatname: "a", type: "youtube" }),
    });

    expect(handle).not.toHaveBeenCalled();
    expect(controller.getCaptured("ssn")).toHaveLength(1);
  });

  it("applies an active source's preset mapping; the matched command's routeMode wins over the source override", async () => {
    await setSources([
      source({ id: "ssn", mappingPreset: "social-stream-ninja", routeMode: "ai-dj" }),
    ]);
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload({
      sourceId: "ssn",
      body: JSON.stringify({ chatmessage: "点歌 lofi", chatname: "a", type: "twitch" }),
    });

    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ normalizedQuery: "lofi", platform: "twitch" });
    // `点歌` is the song-search command (library-search) — the keyword's route wins over
    // the source's ai-dj override (per-command routing is the point of the split).
    expect(handle.mock.calls[0][1]).toMatchObject({ routeMode: "library-search" });
  });

  it("strips sensitive fields from captured payloads", async () => {
    await setSources([source({ id: "default", status: "testing", mappingPreset: "auto" })]);
    const { runtime } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload({
      sourceId: "default",
      body: JSON.stringify({ message: "hi", token: "secret123", nested: { api_key: "k" } }),
    });

    const [first] = controller.getCaptured("default");
    expect(first.body).toEqual({ message: "hi", nested: {} });
  });

  it("ignores disabled and unknown sources", async () => {
    await setSources([source({ id: "off", status: "disabled", mappingPreset: "auto" })]);
    const { runtime, handle } = fakeRuntime();
    const controller = createLiveRequestController({ db, runtime, controls: fakeControls() });

    await controller.handlePayload({ sourceId: "off", body: JSON.stringify({ message: "x" }) });
    await controller.handlePayload({ sourceId: "ghost", body: JSON.stringify({ message: "x" }) });

    expect(handle).not.toHaveBeenCalled();
  });
});

describe("live-request-controller transport lifecycle (apply)", () => {
  it("stops the transport when disabled", async () => {
    const controls = fakeControls();
    const controller = createLiveRequestController({
      db,
      runtime: fakeRuntime().runtime,
      controls,
    });

    await controller.apply({ ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, enabled: false });

    expect(controls.stop).toHaveBeenCalled();
    expect(controls.start).not.toHaveBeenCalled();
  });

  it("starts the http-webhook transport with port + token", async () => {
    const controls = fakeControls();
    const controller = createLiveRequestController({
      db,
      runtime: fakeRuntime().runtime,
      controls,
    });

    await controller.apply({
      ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
      enabled: true,
      transport: "http-webhook",
      port: 41731,
      authToken: "tok",
    });

    expect(controls.start).toHaveBeenCalledWith({
      transport: "http-webhook",
      port: 41731,
      token: "tok",
    });
  });

  it("starts the ssn-websocket transport feeding the ssn-preset source", async () => {
    const controls = fakeControls();
    const controller = createLiveRequestController({
      db,
      runtime: fakeRuntime().runtime,
      controls,
    });

    await controller.apply({
      ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
      enabled: true,
      transport: "ssn-websocket",
      ssnRelayUrl: "wss://io.socialstream.ninja",
      ssnSessionId: "SID",
      sources: [source({ id: "ssn", mappingPreset: "social-stream-ninja" })],
    });

    expect(controls.start).toHaveBeenCalledWith({
      transport: "ssn-websocket",
      relayUrl: "wss://io.socialstream.ninja",
      sessionId: "SID",
      sourceId: "ssn",
    });
  });
});
