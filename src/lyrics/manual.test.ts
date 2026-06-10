import { describe, expect, it } from "vitest";
import { lyricsRecordFromManualText } from "./manual";

describe("lyricsRecordFromManualText", () => {
  it("stores timestamped text as synced LRC (verbatim)", () => {
    const text = "[00:01.00]hi\n[00:02.00]bye";
    const r = lyricsRecordFromManualText(text);
    expect(r).toMatchObject({ source: "manual", status: "found", instrumental: false });
    expect(r.synced).toBe(text);
    expect(r.plain).toBeUndefined();
  });

  it("stores text without timestamps as plain (trimmed)", () => {
    const r = lyricsRecordFromManualText("  just words\nmore words  ");
    expect(r.plain).toBe("just words\nmore words");
    expect(r.synced).toBeUndefined();
    expect(r.source).toBe("manual");
  });
});
