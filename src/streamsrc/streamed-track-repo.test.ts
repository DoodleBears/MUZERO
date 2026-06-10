import { beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { StreamSearchHit } from "./provider";
import { createStreamedTrack, findStreamedTrack, hitToStreamedInput } from "./streamed-track-repo";

let dbName = "";
let db: MuzeroDB;
let counter = 0;

beforeEach(() => {
  dbName = `streamed-repo-test-${counter++}`;
  db = new MuzeroDB(dbName);
});

const hit: StreamSearchHit = {
  source: "bili",
  externalId: "BV1xx411c7mD#998877",
  title: "晴天",
  artist: "周杰伦",
  album: "叶惠美",
  durationSec: 245,
  coverUrl: "https://i0.hdslb.com/cover.jpg",
};

describe("createStreamedTrack", () => {
  it("persists a streamed track with the source ref + cover + meta", async () => {
    const track = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    expect(track).toMatchObject({
      sessionId: "ses_1",
      origin: "streamed",
      provider: "bili",
      kind: "audio",
      status: "ready",
      title: "晴天",
      durationSec: 245,
      streamSourceId: "bili",
      streamExternalId: "BV1xx411c7mD#998877",
      remoteCoverUrl: "https://i0.hdslb.com/cover.jpg",
    });
    expect(track.streamMeta).toMatchObject({ artist: "周杰伦", album: "叶惠美" });
    expect(track.blobId).toBeUndefined(); // no audio bytes stored — resolved on play
    const stored = await db.tracks.get(track.id);
    expect(stored?.streamExternalId).toBe("BV1xx411c7mD#998877");
  });

  it("dedupes within a session: same source+externalId returns the existing track", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const b = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    expect(b.id).toBe(a.id);
    expect(await db.tracks.count()).toBe(1);
  });

  it("treats the same external id in a different session as a new track", async () => {
    const a = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const b = await createStreamedTrack(hitToStreamedInput("ses_2", hit), db);
    expect(b.id).not.toBe(a.id);
    expect(await db.tracks.count()).toBe(2);
  });

  it("treats a different external id in the same session as a new track", async () => {
    await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    await createStreamedTrack(
      hitToStreamedInput("ses_1", { ...hit, externalId: "BV9other#1" }),
      db,
    );
    expect(await db.tracks.count()).toBe(2);
  });
});

describe("findStreamedTrack", () => {
  it("finds an existing streamed track by source + externalId within a session", async () => {
    const created = await createStreamedTrack(hitToStreamedInput("ses_1", hit), db);
    const found = await findStreamedTrack("ses_1", "bili", "BV1xx411c7mD#998877", db);
    expect(found?.id).toBe(created.id);
    expect(await findStreamedTrack("ses_1", "bili", "nope", db)).toBeUndefined();
  });
});

describe("hitToStreamedInput", () => {
  it("maps a search hit into a streamed-track input", () => {
    expect(hitToStreamedInput("ses_9", hit)).toEqual({
      sessionId: "ses_9",
      sourceId: "bili",
      externalId: "BV1xx411c7mD#998877",
      title: "晴天",
      kind: "audio",
      coverUrl: "https://i0.hdslb.com/cover.jpg",
      meta: {
        artist: "周杰伦",
        album: "叶惠美",
        coverUrl: "https://i0.hdslb.com/cover.jpg",
        durationSec: 245,
      },
    });
  });
});
