import { describe, expect, it } from "vitest";
import { addToSetCandidates } from "./add-to-set";

const sets = [
  { id: "ses_a", name: "Road Trip" },
  { id: "ses_b", name: "Focus" },
  { id: "ses_c", name: "Chill" },
];

describe("addToSetCandidates", () => {
  it("offers every set, excluding the one you're already in", () => {
    const { sets: out } = addToSetCandidates(sets, "ses_b", "");
    expect(out.map((s) => s.id)).toEqual(["ses_a", "ses_c"]);
  });

  it("keeps all sets when there's nothing to exclude", () => {
    expect(addToSetCandidates(sets, undefined, "").sets).toHaveLength(3);
  });

  it("offers to create a set for a novel typed name", () => {
    expect(addToSetCandidates(sets, undefined, "Gym").offerCreate).toBe(true);
  });

  it("does not offer create for an empty query or an existing name (case-insensitive)", () => {
    expect(addToSetCandidates(sets, undefined, "   ").offerCreate).toBe(false);
    expect(addToSetCandidates(sets, undefined, "focus").offerCreate).toBe(false);
    expect(addToSetCandidates(sets, undefined, "FOCUS").offerCreate).toBe(false);
  });

  it("an existing name still blocks create even when that set is the excluded one", () => {
    // You're in "Focus"; typing "focus" shouldn't offer to create a duplicate.
    expect(addToSetCandidates(sets, "ses_b", "Focus").offerCreate).toBe(false);
  });
});
