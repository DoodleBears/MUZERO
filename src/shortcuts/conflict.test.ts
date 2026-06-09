import { describe, expect, it } from "vitest";
import { type AssignmentDraft, planReassignment } from "./conflict";
import type { ShortcutGesture } from "./registry";

const key = (code: string, keyLabel: string, mods = {}): ShortcutGesture => ({
  kind: "key",
  stroke: { code, keyLabel, ...mods },
});

describe("planReassignment — cascading displacement", () => {
  it("displaces the chord off its current holder and reports it for replacement", () => {
    // Give Q (held by playback.prev) to playback.cycleRepeat.
    const plan = planReassignment(
      [{ actionId: "playback.cycleRepeat", gesture: key("KeyQ", "Q") }],
      undefined,
      "other",
    );
    // cycleRepeat now has R + Q; prev lost Q (now unbound).
    expect(
      plan.overrides["playback.cycleRepeat"].map((g) => (g.kind === "key" ? g.stroke.code : "")),
    ).toEqual(["KeyR", "KeyQ"]);
    expect(plan.overrides["playback.prev"]).toEqual([]);
    expect(plan.displaced.map((d) => d.actionId)).toEqual(["playback.prev"]);
    expect(plan.blocked).toEqual([]);
  });

  it("resolves the chain when the displaced action gets a replacement in the same plan", () => {
    const drafts: AssignmentDraft[] = [
      { actionId: "playback.cycleRepeat", gesture: key("KeyQ", "Q") },
      { actionId: "playback.prev", gesture: key("KeyZ", "Z") }, // prev's replacement
    ];
    const plan = planReassignment(drafts, undefined, "other");
    expect(plan.displaced).toEqual([]); // prev was re-bound, no dangling displacement
    expect(
      plan.overrides["playback.prev"].map((g) => (g.kind === "key" ? g.stroke.code : "")),
    ).toEqual(["KeyZ"]);
    expect(
      plan.overrides["playback.cycleRepeat"].some(
        (g) => g.kind === "key" && g.stroke.code === "KeyQ",
      ),
    ).toBe(true);
  });

  it("does not conflict across scopes (R is global cycle-repeat AND a free library chord)", () => {
    // R is held by playback.cycleRepeat (global); no library action uses it.
    const plan = planReassignment(
      [{ actionId: "library.focusNext", gesture: key("KeyR", "R") }],
      undefined,
      "other",
    );
    expect(plan.displaced).toEqual([]); // global cycleRepeat is a different scope → not displaced
    expect(plan.blocked).toEqual([]);
    expect(plan.overrides["playback.cycleRepeat"]).toBeUndefined(); // global holder unchanged
    expect(
      plan.overrides["library.focusNext"].some((g) => g.kind === "key" && g.stroke.code === "KeyR"),
    ).toBe(true);
  });

  it("displaces a same-scope holder within the library (↑ moves off focusPrev)", () => {
    const plan = planReassignment(
      [{ actionId: "library.focusNext", gesture: key("ArrowUp", "↑") }],
      undefined,
      "other",
    );
    expect(plan.displaced.map((d) => d.actionId)).toEqual(["library.focusPrev"]);
    expect(plan.overrides["playback.volumeUp"]).toBeUndefined(); // global ↑ untouched
  });

  it("blocks when a protected holder owns the chord", () => {
    // Cmd+F belongs to the protected search.openGlobal (global). Try to take it.
    const plan = planReassignment(
      [{ actionId: "playback.cycleRepeat", gesture: key("KeyF", "F", { primaryKey: true }) }],
      undefined,
      "mac",
    );
    expect(plan.blocked.map((b) => b.actionId)).toContain("search.openGlobal");
  });

  it("blocks assigning to a non-editable target", () => {
    const plan = planReassignment(
      [{ actionId: "search.openGlobal", gesture: key("KeyJ", "J") }],
      undefined,
      "other",
    );
    expect(plan.blocked.map((b) => b.actionId)).toEqual(["search.openGlobal"]);
    expect(plan.overrides["search.openGlobal"]).toBeUndefined();
  });
});
