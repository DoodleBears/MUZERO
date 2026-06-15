import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import { DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS } from "@/db/types";
import type {
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
    async (_request: NormalizedAudienceRequest) => ({ id: "arq_x" }) as AudienceRequestRuntimeItem,
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

const payload = (body: string) => ({ body, receivedAt: 1 });

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
    await controller.handlePayload(payload(JSON.stringify({ message: "lofi" })));

    expect(controls.subscribed).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
