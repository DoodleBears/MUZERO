import { describe, expect, it } from "vitest";
import {
  isDuplicateAudienceRequest,
  isRequesterCoolingDown,
  pruneExpiredTimestamps,
} from "./audience-request-security";

describe("audience request security helpers", () => {
  it("detects duplicate upstream ids inside the dedupe window", () => {
    const seen = new Map([["message-1", 1_000]]);

    expect(
      isDuplicateAudienceRequest({
        externalId: "message-1",
        now: 1_500,
        seenExternalIds: seen,
        dedupeWindowMs: 1_000,
      }),
    ).toBe(true);
    expect(
      isDuplicateAudienceRequest({
        externalId: "message-1",
        now: 2_500,
        seenExternalIds: seen,
        dedupeWindowMs: 1_000,
      }),
    ).toBe(false);
  });

  it("detects requester cooldowns without persisting viewer identity", () => {
    const accepted = new Map([["youtube:viewer-1", 10_000]]);

    expect(
      isRequesterCoolingDown({
        requesterKey: "youtube:viewer-1",
        now: 20_000,
        lastAcceptedByRequester: accepted,
        cooldownMs: 15_000,
      }),
    ).toBe(true);
    expect(
      isRequesterCoolingDown({
        requesterKey: "youtube:viewer-1",
        now: 30_000,
        lastAcceptedByRequester: accepted,
        cooldownMs: 15_000,
      }),
    ).toBe(false);
  });

  it("prunes only timestamps older than the window", () => {
    const map = new Map([
      ["expired", 1_000],
      ["boundary", 2_000], // exactly windowMs old → kept (matches the <= dedupe check)
      ["fresh", 2_900],
    ]);

    pruneExpiredTimestamps(map, 3_000, 1_000);

    expect([...map.keys()]).toEqual(["boundary", "fresh"]);
  });

  it("keeps dedupe/cooldown decisions identical after pruning", () => {
    const seen = new Map([["message-1", 1_000]]);
    // Past the window: the check already says "not a duplicate"...
    expect(
      isDuplicateAudienceRequest({
        externalId: "message-1",
        now: 5_000,
        seenExternalIds: seen,
        dedupeWindowMs: 1_000,
      }),
    ).toBe(false);
    // ...and pruning just removes the dead key without flipping anything.
    pruneExpiredTimestamps(seen, 5_000, 1_000);
    expect(seen.size).toBe(0);
    expect(
      isDuplicateAudienceRequest({
        externalId: "message-1",
        now: 5_000,
        seenExternalIds: seen,
        dedupeWindowMs: 1_000,
      }),
    ).toBe(false);
  });
});
