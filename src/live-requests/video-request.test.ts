import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import type { StreamSearchHit } from "@/streamsrc/provider";
import {
  normalizeVideoRequestBody,
  planVideoRequest,
  resolvePartRef,
  withinRequestDurationLimit,
} from "./video-request";

const hit = (externalId: string, durationSec?: number): StreamSearchHit => ({
  source: "bili",
  externalId,
  title: "Video",
  durationSec,
});

const localTrack = (id: string, externalId: string): Track =>
  ({
    id,
    sessionId: "ses_1",
    title: "Local video",
    kind: "video",
    origin: "streamed",
    provider: "bili",
    status: "ready",
    durationSec: 100,
    blobId: `blb_${id}`,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    streamSourceId: "bili",
    streamExternalId: externalId,
  }) as Track;

describe("normalizeVideoRequestBody", () => {
  it("turns Bilibili id plus a separated cid into the persisted #cid form", () => {
    expect(normalizeVideoRequestBody("BV1HLz9BJEgi 998877")).toBe("BV1HLz9BJEgi#998877");
    expect(normalizeVideoRequestBody("av170001   998877")).toBe("av170001#998877");
  });

  it("leaves links and already-normalized ids alone", () => {
    expect(normalizeVideoRequestBody("https://youtu.be/0EbmNplrNqE")).toBe(
      "https://youtu.be/0EbmNplrNqE",
    );
    expect(normalizeVideoRequestBody("BV1HLz9BJEgi#998877")).toBe("BV1HLz9BJEgi#998877");
  });
});

describe("withinRequestDurationLimit", () => {
  it("accepts unknown duration and durations at the limit", () => {
    expect(withinRequestDurationLimit(undefined, 480)).toBe(true);
    expect(withinRequestDurationLimit(480, 480)).toBe(true);
  });

  it("rejects durations above a positive max", () => {
    expect(withinRequestDurationLimit(481, 480)).toBe(false);
  });
});

describe("resolvePartRef", () => {
  it("keeps explicit Bilibili part refs", async () => {
    await expect(
      resolvePartRef(
        { source: "bili", kind: "song", id: "BV1HLz9BJEgi#998877" },
        { fetchFirstPartExternalId: vi.fn() },
      ),
    ).resolves.toEqual({ source: "bili", kind: "song", id: "BV1HLz9BJEgi#998877" });
  });

  it("resolves a bare Bilibili id to P1 through the injected lookup", async () => {
    const fetchFirstPartExternalId = vi.fn(async () => "BV1HLz9BJEgi#111");

    await expect(
      resolvePartRef(
        { source: "bili", kind: "song", id: "BV1HLz9BJEgi" },
        { fetchFirstPartExternalId },
      ),
    ).resolves.toEqual({ source: "bili", kind: "song", id: "BV1HLz9BJEgi#111" });
    expect(fetchFirstPartExternalId).toHaveBeenCalledWith("BV1HLz9BJEgi");
  });
});

describe("planVideoRequest", () => {
  it("plays a downloaded local video without fetching hit metadata", async () => {
    const local = localTrack("trk_local", "BV1HLz9BJEgi#111");
    const fetchHit = vi.fn();

    const plan = await planVideoRequest("BV1HLz9BJEgi", {
      maxDurationSec: 480,
      fetchFirstPartExternalId: async () => "BV1HLz9BJEgi#111",
      findLocal: async () => local,
      fetchHit,
    });

    expect(plan).toEqual({ kind: "play-local", track: local });
    expect(fetchHit).not.toHaveBeenCalled();
  });

  it("downloads when no blob-backed local video exists and the hit is within the duration limit", async () => {
    const plan = await planVideoRequest("BV1HLz9BJEgi#222", {
      maxDurationSec: 480,
      fetchFirstPartExternalId: async () => "unused",
      findLocal: async () => undefined,
      fetchHit: async () => hit("BV1HLz9BJEgi#222", 300),
    });

    expect(plan).toEqual({
      kind: "download-online",
      ref: { source: "bili", kind: "song", id: "BV1HLz9BJEgi#222" },
      hit: hit("BV1HLz9BJEgi#222", 300),
    });
  });

  it("accepts YouTube ids and links", async () => {
    const plan = await planVideoRequest("https://youtu.be/0EbmNplrNqE", {
      maxDurationSec: 480,
      fetchFirstPartExternalId: async () => "unused",
      findLocal: async () => undefined,
      fetchHit: async (ref) => ({
        source: ref.source,
        externalId: ref.id,
        title: "YT",
        durationSec: undefined,
      }),
    });

    expect(plan.kind).toBe("download-online");
    expect(plan.kind === "download-online" ? plan.ref : null).toEqual({
      source: "youtube",
      kind: "song",
      id: "0EbmNplrNqE",
    });
  });

  it("rejects pure text and non-video sources", async () => {
    const deps = {
      maxDurationSec: 480,
      fetchFirstPartExternalId: async () => "unused",
      findLocal: async () => undefined,
      fetchHit: async () => undefined,
    };

    await expect(planVideoRequest("周杰伦 七里香", deps)).resolves.toEqual({
      kind: "rejected",
      reason: "not-a-video-ref",
    });
    await expect(planVideoRequest("https://music.163.com/song?id=123", deps)).resolves.toEqual({
      kind: "rejected",
      reason: "unsupported-source",
    });
  });

  it("rejects unresolved and too-long videos while allowing unknown duration", async () => {
    const base = {
      maxDurationSec: 480,
      fetchFirstPartExternalId: async () => "BV1HLz9BJEgi#111",
      findLocal: async () => undefined,
    };

    await expect(
      planVideoRequest("BV1HLz9BJEgi", { ...base, fetchHit: async () => undefined }),
    ).resolves.toEqual({ kind: "rejected", reason: "unresolved" });
    await expect(
      planVideoRequest("BV1HLz9BJEgi", {
        ...base,
        fetchHit: async () => hit("BV1HLz9BJEgi#111", 481),
      }),
    ).resolves.toEqual({ kind: "rejected", reason: "too-long", durationSec: 481, maxSec: 480 });
    await expect(
      planVideoRequest("BV1HLz9BJEgi", {
        ...base,
        fetchHit: async () => hit("BV1HLz9BJEgi#111", undefined),
      }),
    ).resolves.toMatchObject({ kind: "download-online" });
  });
});
