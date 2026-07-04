import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INTAKE_COMMANDS } from "@/db/types";
import type { NormalizedAudienceRequest } from "./audience-request-schema";
import { matchIntakeCommand } from "./intake-command";
import { applyRatingCommand, resolveRaterKey } from "./live-request-annotation";

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
