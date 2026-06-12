import { describe, expect, it } from "vitest";
import { type AssignmentDraft, planReassignment, reconcileRecorderDrafts } from "./conflict";
import type { ShortcutGesture } from "./registry";

const key = (code: string, keyLabel: string, mods = {}): ShortcutGesture => ({
  kind: "key",
  stroke: { code, keyLabel, ...mods },
});

const codes = (bindings: { gesture: ShortcutGesture }[]) =>
  bindings.map((binding) => (binding.gesture.kind === "key" ? binding.gesture.stroke.code : ""));

describe("planReassignment — cascading displacement", () => {
  it("displaces the chord off its current holder and reports it for replacement", () => {
    // Give Q (held by playback.prev) to playback.cycleRepeat.
    const plan = planReassignment(
      [{ actionId: "playback.cycleRepeat", gesture: key("KeyQ", "Q") }],
      undefined,
      "other",
    );
    // cycleRepeat now has R + Q; prev lost Q (now unbound).
    expect(codes(plan.overrides["playback.cycleRepeat"])).toEqual(["KeyR", "KeyQ"]);
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
    expect(codes(plan.overrides["playback.prev"])).toEqual(["KeyZ"]);
    expect(
      plan.overrides["playback.cycleRepeat"].some(
        (binding) => binding.gesture.kind === "key" && binding.gesture.stroke.code === "KeyQ",
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
      plan.overrides["library.focusNext"].some(
        (binding) => binding.gesture.kind === "key" && binding.gesture.stroke.code === "KeyR",
      ),
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

describe("reconcileRecorderDrafts — cascading chain", () => {
  const Q = key("KeyQ", "Q");
  const E = key("KeyE", "E");

  it("a free chord needs no chain and can save", () => {
    const r = reconcileRecorderDrafts(
      [{ actionId: "playback.cycleRepeat", gesture: key("KeyZ", "Z") }],
      undefined,
      "other",
    );
    expect(r.drafts).toHaveLength(1);
    expect(r.canSave).toBe(true);
  });

  it("an occupied chord spawns a pending slot for the displaced action", () => {
    const r = reconcileRecorderDrafts(
      [{ actionId: "playback.cycleRepeat", gesture: Q }], // Q is held by playback.prev
      undefined,
      "other",
    );
    expect(r.drafts.map((d) => d.actionId)).toEqual(["playback.cycleRepeat", "playback.prev"]);
    expect(r.drafts[1].gesture).toBeNull();
    expect(r.drafts[1].displacedChord).toEqual(Q);
    expect(r.canSave).toBe(false);
  });

  it("filling the displaced slot with a free chord lets it save", () => {
    const r = reconcileRecorderDrafts(
      [
        { actionId: "playback.cycleRepeat", gesture: Q },
        { actionId: "playback.prev", gesture: key("KeyZ", "Z"), displacedChord: Q },
      ],
      undefined,
      "other",
    );
    expect(r.canSave).toBe(true);
    expect(r.drafts).toHaveLength(2);
  });

  it("cascades a second level (prev's replacement displaces next)", () => {
    const r = reconcileRecorderDrafts(
      [
        { actionId: "playback.cycleRepeat", gesture: Q },
        { actionId: "playback.prev", gesture: E, displacedChord: Q }, // E is held by next
      ],
      undefined,
      "other",
    );
    expect(r.drafts.map((d) => d.actionId)).toEqual([
      "playback.cycleRepeat",
      "playback.prev",
      "playback.next",
    ]);
    expect(r.drafts[2].gesture).toBeNull();
    expect(r.canSave).toBe(false);
  });

  it("prunes a stale slot when the primary is re-recorded elsewhere", () => {
    const r = reconcileRecorderDrafts(
      [
        { actionId: "playback.cycleRepeat", gesture: E }, // now displaces next, not prev
        { actionId: "playback.prev", gesture: null, displacedChord: Q }, // stale pending
      ],
      undefined,
      "other",
    );
    expect(r.drafts.map((d) => d.actionId)).toEqual(["playback.cycleRepeat", "playback.next"]);
  });

  it("cannot save when the chain hits a protected holder", () => {
    const r = reconcileRecorderDrafts(
      [{ actionId: "playback.cycleRepeat", gesture: key("KeyF", "F", { primaryKey: true }) }],
      undefined,
      "mac",
    );
    expect(r.plan.blocked.map((b) => b.actionId)).toContain("search.openGlobal");
    expect(r.canSave).toBe(false);
  });
});
