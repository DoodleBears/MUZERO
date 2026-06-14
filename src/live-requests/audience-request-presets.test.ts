import { describe, expect, it } from "vitest";
import {
  authorizationHeader,
  examplePayloadJson,
  GENERIC_WEBHOOK_EXAMPLE,
  SOCIAL_STREAM_NINJA_WEBHOOK_PRESET,
} from "./audience-request-presets";
import { normalizeAudienceRequest } from "./audience-request-schema";

describe("audience request webhook presets", () => {
  it("normalizes the Social Stream Ninja full-message JSON example", () => {
    const normalized = normalizeAudienceRequest(SOCIAL_STREAM_NINJA_WEBHOOK_PRESET.examplePayload, {
      commandPrefixes: ["点歌"],
      now: 123,
    });

    expect(normalized).toMatchObject({
      externalId: "ssn-msg-1",
      normalizedQuery: "Plastic Love",
      platform: "youtube",
      requesterDisplayName: "Alice",
      requesterKey: "youtube:alice-1",
      requesterRole: "moderator",
      roomId: "room-1",
      sourceKind: "social-stream-ninja",
    });
  });

  it("documents a generic POST JSON shape that the normalizer accepts", () => {
    const normalized = normalizeAudienceRequest(GENERIC_WEBHOOK_EXAMPLE.examplePayload, {
      commandPrefixes: ["!song"],
    });

    expect(normalized.normalizedQuery).toBe("lofi rain");
    expect(normalized.sourceKind).toBe("http");
    expect(normalized.requesterRole).toBe("viewer");
  });

  it("formats copyable setup snippets without inventing secrets", () => {
    expect(authorizationHeader("muz_live_token")).toBe("Authorization: Bearer muz_live_token");
    expect(authorizationHeader("")).toBe("Authorization: Bearer <token>");
    expect(examplePayloadJson(GENERIC_WEBHOOK_EXAMPLE.examplePayload)).toContain(
      '"message": "!song lofi rain"',
    );
  });
});
