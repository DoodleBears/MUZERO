import { describe, expect, it } from "vitest";
import { summarizeToolInput, toolIconName } from "./dj-tool-display";

describe("toolIconName", () => {
  it("maps known tools and falls back to sparkles", () => {
    expect(toolIconName("library_search")).toBe("search");
    expect(toolIconName("play_track")).toBe("play");
    expect(toolIconName("dj_generate_tracks")).toBe("wand-2");
    expect(toolIconName("unknown_tool")).toBe("sparkles");
  });
});

describe("summarizeToolInput", () => {
  it("summarizes search queries (single + list)", () => {
    expect(summarizeToolInput("library_search", { query: "lofi" })).toBe("lofi");
    expect(summarizeToolInput("library_search", { queries: ["jazz", "chill"] })).toBe(
      "jazz、chill",
    );
    expect(summarizeToolInput("online_search_tracks", { query: "周杰伦" })).toBe("周杰伦");
  });

  it("summarizes set name and memory note", () => {
    expect(summarizeToolInput("set_create", { name: "深夜专注" })).toBe("深夜专注");
    expect(summarizeToolInput("add_memory", { note: "毕业那年的歌" })).toBe("毕业那年的歌");
  });

  it("summarizes generated brief titles", () => {
    expect(
      summarizeToolInput("dj_generate_tracks", {
        briefs: [{ title: "Midnight Drive" }, { caption: "warm synth" }],
      }),
    ).toBe("Midnight Drive、warm synth");
  });

  it("returns undefined for tools whose key params are opaque ids", () => {
    expect(summarizeToolInput("play_track", { trackId: "#T3" })).toBeUndefined();
    expect(summarizeToolInput("queue_clear", {})).toBeUndefined();
  });

  it("clips overly long details", () => {
    const out = summarizeToolInput("library_search", { query: "x".repeat(200) });
    expect(out && out.length).toBeLessThanOrEqual(80);
    expect(out?.endsWith("…")).toBe(true);
  });
});
