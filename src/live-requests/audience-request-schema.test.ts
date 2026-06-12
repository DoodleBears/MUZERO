import { describe, expect, it } from "vitest";
import { normalizeAudienceRequest, stripAudienceRequestPrefix } from "./audience-request-schema";

describe("audience request schema", () => {
  it("normalizes Social Stream Ninja Call Webhook full JSON body", () => {
    const request = normalizeAudienceRequest(
      {
        id: "ssn-1",
        source: "social-stream-ninja",
        platform: "youtube",
        user: { id: "viewer-1", name: "Alice", role: "viewer" },
        message: "点歌 晴天 周杰伦",
      },
      { commandPrefixes: ["点歌", "!sr"] },
    );

    expect(request).toMatchObject({
      externalId: "ssn-1",
      sourceKind: "social-stream-ninja",
      platform: "youtube",
      requesterDisplayName: "Alice",
      requesterKey: "youtube:viewer-1",
      rawMessage: "点歌 晴天 周杰伦",
      normalizedQuery: "晴天 周杰伦",
    });
  });

  it("accepts generic webhook bodies with text-like message fields", () => {
    const request = normalizeAudienceRequest(
      {
        eventId: "evt-1",
        service: "twitch",
        chatname: "Bob",
        chatmessage: "!sr never gonna give you up",
      },
      { commandPrefixes: ["!sr"] },
    );

    expect(request.externalId).toBe("evt-1");
    expect(request.platform).toBe("twitch");
    expect(request.requesterDisplayName).toBe("Bob");
    expect(request.normalizedQuery).toBe("never gonna give you up");
  });

  it("strips only configured command prefixes at the start", () => {
    expect(stripAudienceRequestPrefix("点歌 晴天", ["点歌"])).toBe("晴天");
    expect(stripAudienceRequestPrefix("!sr晴天", ["!sr"])).toBe("晴天");
    expect(stripAudienceRequestPrefix("please 点歌 晴天", ["点歌"])).toBe("please 点歌 晴天");
  });
});
