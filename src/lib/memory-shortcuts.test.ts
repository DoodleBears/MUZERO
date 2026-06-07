import { describe, expect, it } from "vitest";
import { resolveMemoryShortcut } from "./memory-shortcuts";

describe("resolveMemoryShortcut", () => {
  it("opens memory creation from T or N", () => {
    expect(resolveMemoryShortcut({ key: "t" })).toBe("create-memory");
    expect(resolveMemoryShortcut({ key: "T", shiftKey: true })).toBe("create-memory");
    expect(resolveMemoryShortcut({ key: "n" })).toBe("create-memory");
    expect(resolveMemoryShortcut({ key: "N", shiftKey: true })).toBe("create-memory");
  });

  it("ignores modifier chords and unrelated keys", () => {
    expect(resolveMemoryShortcut({ key: "t", metaKey: true })).toBeNull();
    expect(resolveMemoryShortcut({ key: "n", ctrlKey: true })).toBeNull();
    expect(resolveMemoryShortcut({ key: "n", altKey: true })).toBeNull();
    expect(resolveMemoryShortcut({ key: "m" })).toBeNull();
  });
});
