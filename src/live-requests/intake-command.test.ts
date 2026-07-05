import { describe, expect, it } from "vitest";
import { DEFAULT_INTAKE_COMMANDS, type IntakeCommand } from "@/db/types";
import { matchIntakeCommand, resolveCommands } from "./intake-command";

describe("matchIntakeCommand — default command table", () => {
  const cmds = DEFAULT_INTAKE_COMMANDS;

  it("routes 点歌 to the library-search request command (fast path, not AI DJ)", () => {
    const m = matchIntakeCommand("点歌 晴天", cmds);
    expect(m?.command.id).toBe("song-search");
    expect(m?.command.intent).toBe("request");
    expect(m?.command.routeMode).toBe("library-search");
    expect(m?.body).toBe("晴天");
  });

  it("routes AI点歌 to the ai-dj request command", () => {
    const m = matchIntakeCommand("AI点歌 来点citypop", cmds);
    expect(m?.command.id).toBe("ai-dj");
    expect(m?.command.routeMode).toBe("ai-dj");
    expect(m?.body).toBe("来点citypop");
  });

  it("routes 点视频 to the video request command", () => {
    const m = matchIntakeCommand("点视频 BV1HLz9BJEgi", cmds);
    expect(m?.command.id).toBe("video-request");
    expect(m?.command.intent).toBe("request");
    expect(m?.command.mediaKind).toBe("video");
    expect(m?.body).toBe("BV1HLz9BJEgi");
  });

  it("classifies a comment with no timestamp as floating", () => {
    const m = matchIntakeCommand("评论 这段副歌绝了", cmds);
    expect(m?.command.intent).toBe("comment");
    expect(m?.body).toBe("这段副歌绝了");
    expect(m?.atSec).toBeUndefined();
  });

  it("extracts an explicit mm:ss timestamp for a comment", () => {
    const m = matchIntakeCommand("评论 3:14 这句绝了", cmds);
    expect(m?.command.intent).toBe("comment");
    expect(m?.atSec).toBe(194);
    expect(m?.body).toBe("这句绝了");
  });

  it("extracts an explicit hh:mm:ss timestamp for a comment", () => {
    const m = matchIntakeCommand("评论 1:02:03 x", cmds);
    expect(m?.atSec).toBe(3723);
    expect(m?.body).toBe("x");
  });

  it("extracts a numeric rating score", () => {
    const m = matchIntakeCommand("评分 5 好听", cmds);
    expect(m?.command.intent).toBe("rating");
    expect(m?.score).toBe(5);
    expect(m?.body).toBe("好听");
  });

  it("extracts star ratings and clamps to 1..5", () => {
    expect(matchIntakeCommand("评分 ★★★★", cmds)?.score).toBe(4);
    expect(matchIntakeCommand("评分 ★★★★☆", cmds)?.score).toBe(4);
    expect(matchIntakeCommand("评分 9", cmds)?.score).toBe(5);
    expect(matchIntakeCommand("评分 0", cmds)?.score).toBe(1);
    expect(matchIntakeCommand("评分 9/10", cmds)?.score).toBe(5);
  });

  it("leaves score undefined when a rating has no number", () => {
    const m = matchIntakeCommand("评分 好听", cmds);
    expect(m?.command.intent).toBe("rating");
    expect(m?.score).toBeUndefined();
    expect(m?.body).toBe("好听");
  });

  it("is case-insensitive on latin prefixes", () => {
    expect(matchIntakeCommand("RATE: 4", cmds)?.command.id).toBe("rating");
    expect(matchIntakeCommand("Song: hello", cmds)?.command.id).toBe("song-search");
  });

  it("returns null when no command prefix matches", () => {
    expect(matchIntakeCommand("just chatting", cmds)).toBeNull();
  });

  it("trims the message before matching", () => {
    expect(matchIntakeCommand("   点歌 abc  ", cmds)?.body).toBe("abc");
  });
});

describe("matchIntakeCommand — precedence + enabled", () => {
  it("prefers the longest matching prefix", () => {
    const custom: IntakeCommand[] = [
      { id: "a", intent: "comment", prefixes: ["评"] },
      { id: "b", intent: "rating", prefixes: ["评分"] },
    ];
    expect(matchIntakeCommand("评分 5", custom)?.command.id).toBe("b");
  });

  it("skips disabled commands", () => {
    const custom: IntakeCommand[] = [
      {
        id: "song-search",
        intent: "request",
        prefixes: ["点歌"],
        routeMode: "library-search",
        enabled: false,
      },
    ];
    expect(matchIntakeCommand("点歌 x", custom)).toBeNull();
  });
});

describe("resolveCommands — legacy migration", () => {
  it("returns explicit commands verbatim when set", () => {
    const explicit: IntakeCommand[] = [{ id: "x", intent: "comment", prefixes: ["评论"] }];
    expect(resolveCommands({ commands: explicit })).toBe(explicit);
  });

  it("synthesizes song-search from legacy prefixes + routeMode, then appends defaults", () => {
    const cmds = resolveCommands({ commandPrefixes: ["点歌", "!sr"], routeMode: "hybrid" });
    const song = cmds.find((c) => c.id === "song-search");
    expect(song?.prefixes).toEqual(["点歌", "!sr"]);
    expect(song?.routeMode).toBe("hybrid");
    expect(cmds.map((c) => c.id)).toEqual([
      "song-search",
      "ai-dj",
      "video-request",
      "comment",
      "rating",
    ]);
    expect(cmds.find((c) => c.id === "video-request")?.mediaKind).toBe("video");
  });

  it("falls back to default prefixes + library-search when legacy is empty", () => {
    const cmds = resolveCommands({});
    const song = cmds.find((c) => c.id === "song-search");
    expect(song?.routeMode).toBe("library-search");
    expect(song?.prefixes).toContain("点歌");
  });
});
