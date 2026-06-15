import { describe, expect, it } from "vitest";
import { normalizeAudienceRequest } from "./audience-request-schema";
import {
  applyMapping,
  detectPresetId,
  getPresetMapping,
  REQUEST_MAPPING_PRESETS,
  REQUEST_TARGET_FIELDS,
} from "./request-mapping-presets";

describe("request-mapping-presets", () => {
  it("exposes query as the only required target field", () => {
    const required = REQUEST_TARGET_FIELDS.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(["query"]);
  });

  it("getPresetMapping returns null for auto/custom and a mapping for built-ins", () => {
    expect(getPresetMapping("auto")).toBeNull();
    expect(getPresetMapping("custom")).toBeNull();
    expect(getPresetMapping("social-stream-ninja")?.query).toContain("chatmessage");
    expect(getPresetMapping("generic-json")?.query).toContain("message");
  });

  it("applies the SSN preset to a webhook-shape payload", () => {
    const mapped = applyMapping(
      { chatmessage: "点歌 晴天", chatname: "Alice", type: "youtube", id: "m1" },
      REQUEST_MAPPING_PRESETS["social-stream-ninja"],
    );
    expect(mapped).toMatchObject({
      message: "点歌 晴天",
      username: "Alice",
      platform: "youtube",
      id: "m1",
    });
  });

  it("applies the SSN preset to a websocket channel-4-shape payload (same preset)", () => {
    // SSN public WS events use `type` for platform and `chatname`/`chatmessage`
    // — the same fields the webhook preset reads, so no remap is needed.
    const mapped = applyMapping(
      { chatname: "bob", chatmessage: "lofi please", type: "twitch", id: "ws-9" },
      REQUEST_MAPPING_PRESETS["social-stream-ninja"],
    );
    expect(mapped).toMatchObject({ message: "lofi please", platform: "twitch", username: "bob" });
  });

  it("falls back to literals when source fields are missing", () => {
    const mapped = applyMapping({}, REQUEST_MAPPING_PRESETS["social-stream-ninja"]);
    expect(mapped.platform).toBe("stream");
    expect(mapped.username).toBe("viewer");
  });

  it("detects the matching preset id, else custom", () => {
    expect(detectPresetId(REQUEST_MAPPING_PRESETS["social-stream-ninja"])).toBe(
      "social-stream-ninja",
    );
    expect(detectPresetId({ query: "{{ payload.foo }}" })).toBe("custom");
  });

  it("produces output that normalizeAudienceRequest consumes end to end", () => {
    const mapped = applyMapping(
      { chatmessage: "点歌 Plastic Love", chatname: "Mayu", type: "youtube", id: "x1" },
      REQUEST_MAPPING_PRESETS["social-stream-ninja"],
    );
    const normalized = normalizeAudienceRequest(mapped, { commandPrefixes: ["点歌"], now: 1 });
    expect(normalized.normalizedQuery).toBe("Plastic Love");
    expect(normalized.platform).toBe("youtube");
    expect(normalized.requesterDisplayName).toBe("Mayu");
    expect(normalized.externalId).toBe("x1");
  });
});
