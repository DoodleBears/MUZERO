// End-to-end live-request routing: a chat payload arrives at the controller and
// drives the REAL runtime → REAL library search → REAL play-queue write, for a
// source configured with routeMode "library-search" (UI: 【路由】= 搜索). Unlike
// `live-request-controller.test.ts` (which injects a FAKE runtime to isolate the
// transport/mapping layer), this test exercises the whole pipeline so we know the
// three 【播放动作】 actually land the best search match on the player/queue:
//   - play-now (立即播放)     → cuts in via the injected player (playRequestNow)
//   - append-queue (追加队列)  → match goes to the tail of the play queue
//   - play-next (下一首播放)   → match is inserted right after the current track
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  createUploadedTrack,
  getPlayQueue,
  playQueueSet,
  prependTrackIds,
  saveSettings,
} from "@/db/repositories";
import {
  type AudienceRequestSource,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  type Track,
} from "@/db/types";
import type { AudienceRequestPlaybackAction } from "./audience-request-schema";
import { createLiveRequestController } from "./live-request-controller";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-play-routing-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

// A source whose per-call route override is "library-search" (the user's 【路由】= 搜索)
// and whose playbackAction is the action under test. mappingPreset "auto" + a plain
// `{ message }` body means no field mapping is needed.
function searchSource(playbackAction: AudienceRequestPlaybackAction): AudienceRequestSource {
  return {
    id: "stage",
    name: "Stage",
    status: "active",
    authMode: "open",
    mappingPreset: "auto",
    routeMode: "library-search",
    playbackAction,
  };
}

async function configure(playbackAction: AudienceRequestPlaybackAction) {
  await saveSettings(
    {
      audienceRequestIntake: {
        ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
        enabled: true,
        requireApprovalForPlayNow: false,
        sources: [searchSource(playbackAction)],
      },
    },
    db,
  );
}

async function seedQueue() {
  const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
  const current = await track(session.id, "Current Song");
  const target = await track(session.id, "Plastic Love");
  const tail = await track(session.id, "Tail Song");
  // The play queue is [current, tail]; `target` lives in the library/set but is not
  // yet queued, so a successful route must pull it in.
  await prependTrackIds(session.id, [current.id, tail.id], db);
  await playQueueSet([current.id, tail.id], { contextSetId: session.id, currentIndex: 0 }, db);
  return { current, target, tail, sessionId: session.id };
}

async function track(sessionId: string, title: string): Promise<Track> {
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

const body = (message: string) => ({ sourceId: "stage", body: JSON.stringify({ message }) });
const queueIds = async () => (await getPlayQueue(db)).entries.map((entry) => entry.trackId);

describe("live-request play routing — route=search, end to end", () => {
  it("play-now: plays the first/best search result via the injected player", async () => {
    const { target } = await seedQueue();
    await configure("play-now");
    const playNow = vi.fn(async () => {});
    const controller = createLiveRequestController({ db, playNow });

    await controller.handlePayload(body("点歌 Plastic Love"));

    // The best (and confident) library match is played immediately — the same
    // track id the search surfaced as candidates[0].
    expect(playNow).toHaveBeenCalledTimes(1);
    expect(playNow).toHaveBeenCalledWith(expect.objectContaining({ id: target.id }));
    expect(controller.getItems()[0]).toMatchObject({
      status: "completed",
      matchedTrackId: target.id,
      routeMode: "library-search",
      playbackAction: "play-now",
    });
  });

  it("append-queue: best match lands at the tail of the play queue", async () => {
    const { current, target, tail } = await seedQueue();
    await configure("append-queue");
    const playNow = vi.fn(async () => {});
    const controller = createLiveRequestController({ db, playNow });

    await controller.handlePayload(body("点歌 Plastic Love"));

    expect(playNow).not.toHaveBeenCalled();
    expect(await queueIds()).toEqual([current.id, tail.id, target.id]);
    expect(controller.getItems()[0]).toMatchObject({
      status: "completed",
      matchedTrackId: target.id,
    });
  });

  it("play-next: best match is inserted right after the current track", async () => {
    const { current, target, tail } = await seedQueue();
    await configure("play-next");
    const playNow = vi.fn(async () => {});
    const controller = createLiveRequestController({ db, playNow });

    await controller.handlePayload(body("点歌 Plastic Love"));

    expect(playNow).not.toHaveBeenCalled();
    expect(await queueIds()).toEqual([current.id, target.id, tail.id]);
    expect(controller.getItems()[0]).toMatchObject({
      status: "completed",
      matchedTrackId: target.id,
    });
  });

  it("play-now still works when the per-source action overrides a different settings default", async () => {
    // Settings default is append-queue; the source forces play-now for THIS call.
    const { target } = await seedQueue();
    await saveSettings(
      {
        audienceRequestIntake: {
          ...DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
          enabled: true,
          playbackAction: "append-queue",
          sources: [searchSource("play-now")],
        },
      },
      db,
    );
    const playNow = vi.fn(async () => {});
    const controller = createLiveRequestController({ db, playNow });

    await controller.handlePayload(body("点歌 Plastic Love"));

    expect(playNow).toHaveBeenCalledWith(expect.objectContaining({ id: target.id }));
  });
});
