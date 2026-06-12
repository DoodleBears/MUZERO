import { describe, expect, it } from "vitest";
import { isDuplicateAudienceRequest, isRequesterCoolingDown } from "./audience-request-security";

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
});
