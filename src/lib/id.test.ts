import { describe, expect, it } from "vitest";
import { newIds } from "@/lib/id";

describe("newIds", () => {
  it("generates prefixed unique ids for bulk inserts", () => {
    const ids = newIds("trk", 1000);

    expect(ids).toHaveLength(1000);
    expect(new Set(ids)).toHaveLength(1000);
    expect(ids.every((id) => id.startsWith("trk_"))).toBe(true);
  });
});
