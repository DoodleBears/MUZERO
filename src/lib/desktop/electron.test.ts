import { describe, expect, it } from "vitest";
import { electronMediaProxyUrl } from "./electron";

describe("electronMediaProxyUrl", () => {
  it("carries media headers and playback trace context for main-process diagnostics", () => {
    const url = electronMediaProxyUrl(
      "https://rr.example.com/videoplayback?itag=140&pot=secret",
      {
        Referer: "https://www.youtube.com",
        Origin: "https://www.youtube.com",
      },
      {
        traceId: "ply_1",
        trackId: "trk_1",
        sessionId: "ses_1",
        sourceId: "youtube",
        videoId: "v1",
      },
    );

    const parsed = new URL(url);
    expect(parsed.protocol).toBe("muzfetch:");
    expect(parsed.hostname).toBe("media");
    expect(parsed.searchParams.get("__mztrace")).toBe("ply_1");
    expect(parsed.searchParams.get("__mztrack")).toBe("trk_1");
    expect(parsed.searchParams.get("__mzsession")).toBe("ses_1");
    expect(parsed.searchParams.get("__mzsource")).toBe("youtube");
    expect(parsed.searchParams.get("__mzvideo")).toBe("v1");
    expect(parsed.searchParams.get("__mzh_referer")).toBe("https://www.youtube.com");
    expect(parsed.searchParams.get("__mzh_origin")).toBe("https://www.youtube.com");
  });

  it("keeps backward-compatible traceId strings", () => {
    const url = electronMediaProxyUrl("https://cdn.example/a.mp3", undefined, "ply_2");
    expect(new URL(url).searchParams.get("__mztrace")).toBe("ply_2");
  });
});
