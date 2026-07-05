import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INTAKE_COMMANDS } from "@/db/types";
import type { NormalizedAudienceRequest } from "./audience-request-schema";
import { matchIntakeCommand } from "./intake-command";
import {
  applyAnnotationCommand,
  applyRatingCommand,
  createAnnotationLimiter,
  resolveRaterKey,
} from "./live-request-annotation";

const req = (over: Partial<NormalizedAudienceRequest> = {}): NormalizedAudienceRequest => ({
  sourceKind: "http",
  requesterRole: "viewer",
  rawMessage: "",
  normalizedQuery: "",
  receivedAt: 1,
  ...over,
});

const rating = (message: string) => {
  const match = matchIntakeCommand(message, DEFAULT_INTAKE_COMMANDS);
  if (!match) throw new Error(`no match for ${message}`);
  return match;
};

describe("applyRatingCommand", () => {
  it("writes a clamped vote for the current track, keyed by the requester", async () => {
    const setTrackRating = vi.fn(async () => {});
    const res = await applyRatingCommand(rating("评分 5 好听"), req({ requesterKey: "bili:1" }), {
      setTrackRating,
      getCurrentTrackId: () => "trk_1",
    });
    expect(res.status).toBe("written");
    expect(setTrackRating).toHaveBeenCalledWith("trk_1", "bili:1", 5);
  });

  it("ignores when nothing is playing", async () => {
    const setTrackRating = vi.fn(async () => {});
    const res = await applyRatingCommand(rating("评分 4"), req(), {
      setTrackRating,
      getCurrentTrackId: () => undefined,
    });
    expect(res).toEqual({ status: "ignored", reason: "no-current-track" });
    expect(setTrackRating).not.toHaveBeenCalled();
  });

  it("ignores a rating with no score", async () => {
    const setTrackRating = vi.fn(async () => {});
    const res = await applyRatingCommand(rating("评分 好听"), req(), {
      setTrackRating,
      getCurrentTrackId: () => "trk_1",
    });
    expect(res).toEqual({ status: "ignored", reason: "no-score" });
    expect(setTrackRating).not.toHaveBeenCalled();
  });

  it("synthesizes a rater key from platform + name when there is no requesterKey", () => {
    expect(resolveRaterKey(req({ platform: "Twitch", requesterDisplayName: "Bob" }))).toBe(
      "audience:twitch:Bob",
    );
  });
});

const memoryStub = async (input: { trackId: string; note: string; atSec?: number }) => ({
  id: "mem_1",
  trackId: input.trackId,
  note: input.note,
  createdAt: 1,
  atSec: input.atSec,
});

describe("applyAnnotationCommand", () => {
  const comment = (message: string) => {
    const match = matchIntakeCommand(message, DEFAULT_INTAKE_COMMANDS);
    if (!match) throw new Error(`no match for ${message}`);
    return match;
  };

  it("writes a floating memory attributed to the sender", async () => {
    const addMemory = vi.fn(memoryStub);
    const res = await applyAnnotationCommand(
      comment("评论 这段绝了"),
      req({ requesterKey: "bili:1", requesterDisplayName: "阿强" }),
      { addMemory, getCurrentTrackId: () => "trk_1" },
    );
    expect(res.status).toBe("written");
    expect(addMemory).toHaveBeenCalledWith({
      trackId: "trk_1",
      note: "这段绝了",
      author: { devicePublicId: "audience:bili:1", displayName: "阿强" },
      atSec: undefined,
    });
  });

  it("anchors to an explicit mm:ss, clamped to the track length", async () => {
    const addMemory = vi.fn(memoryStub);
    await applyAnnotationCommand(comment("评论 3:14 这句绝了"), req(), {
      addMemory,
      getCurrentTrackId: () => "trk_1",
      getTrackDurationSec: () => 100,
    });
    expect(addMemory.mock.calls[0][0].atSec).toBe(100); // 194s clamped to 100s duration
  });

  it("keeps an in-range explicit timestamp", async () => {
    const addMemory = vi.fn(memoryStub);
    await applyAnnotationCommand(comment("评论 0:30 nice"), req(), {
      addMemory,
      getCurrentTrackId: () => "trk_1",
      getTrackDurationSec: () => 200,
    });
    expect(addMemory.mock.calls[0][0].atSec).toBe(30);
  });

  it("ignores an empty comment and when nothing is playing", async () => {
    const addMemory = vi.fn(memoryStub);
    expect(
      await applyAnnotationCommand(comment("评论   "), req(), {
        addMemory,
        getCurrentTrackId: () => "trk_1",
      }),
    ).toEqual({ status: "ignored", reason: "empty" });
    expect(
      await applyAnnotationCommand(comment("评论 hi"), req(), {
        addMemory,
        getCurrentTrackId: () => undefined,
      }),
    ).toEqual({ status: "ignored", reason: "no-current-track" });
    expect(addMemory).not.toHaveBeenCalled();
  });
});

describe("createAnnotationLimiter", () => {
  it("enforces per-rater cooldown and a per-minute cap", () => {
    const limiter = createAnnotationLimiter();
    const opts = (now: number) => ({ cooldownMs: 10_000, maxPerMinute: 3, now });
    expect(limiter.allow("a", opts(0))).toBe(true);
    expect(limiter.allow("a", opts(5_000))).toBe(false); // still cooling down
    expect(limiter.allow("a", opts(11_000))).toBe(true); // cooldown elapsed
    expect(limiter.allow("b", opts(11_100))).toBe(true);
    expect(limiter.allow("c", opts(11_200))).toBe(false); // 4th accepted this minute → capped
  });

  it("expires cooled-down raters instead of remembering every rater forever", () => {
    const limiter = createAnnotationLimiter();
    const opts = (now: number) => ({ cooldownMs: 10_000, maxPerMinute: 1000, now });
    // A long stream of distinct raters, each far past the previous one's cooldown:
    // decisions must stay identical to the unbounded map (all allowed), while the
    // sweep keeps the map from retaining the whole audience history (PRD L-8).
    for (let i = 0; i < 500; i += 1) {
      expect(limiter.allow(`rater-${i}`, opts(i * 61_000))).toBe(true);
    }
    // Cooldown semantics survive the sweep: an immediate repeat is still blocked.
    const at = 500 * 61_000;
    expect(limiter.allow("again", opts(at))).toBe(true);
    expect(limiter.allow("again", opts(at + 1_000))).toBe(false);
    expect(limiter.allow("again", opts(at + 11_000))).toBe(true);
  });
});
