import { describe, expect, it } from "vitest";
import { gestureIdentity } from "./engine";
import {
  isEditableAction,
  type Platform,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS_BY_ID,
} from "./registry";

describe("SHORTCUT_ACTIONS registry", () => {
  it("has unique, non-empty action ids indexed 1:1", () => {
    const ids = SHORTCUT_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(Object.keys(SHORTCUT_ACTIONS_BY_ID).length).toBe(ids.length);
  });

  it("every action carries scope, category, label and at least one binding", () => {
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.scope).toBeTruthy();
      expect(action.category).toBeTruthy();
      expect(action.labelKey.startsWith("shortcuts.action.")).toBe(true);
      expect(action.defaultBindings.length).toBeGreaterThan(0);
    }
  });

  it.each<Platform>([
    "mac",
    "other",
  ])("has no two actions sharing a key chord WITHIN the same scope (%s)", (platform) => {
    const seen = new Map<string, string>(); // `${scope}|${identity}` -> actionId
    for (const action of SHORTCUT_ACTIONS) {
      for (const gesture of action.defaultBindings) {
        if (gesture.kind !== "key") continue;
        const k = `${action.scope}|${gestureIdentity(gesture, platform)}`;
        expect(seen.has(k), `${action.id} collides with ${seen.get(k)} on ${k}`).toBe(false);
        seen.set(k, action.id);
      }
    }
  });

  it("intentionally shares bare ↑ across global (volume) and library (focus)", () => {
    const up = gestureIdentity(
      { kind: "key", stroke: { code: "ArrowUp", keyLabel: "↑" } },
      "other",
    );
    const vol = SHORTCUT_ACTIONS_BY_ID["playback.volumeUp"];
    const focus = SHORTCUT_ACTIONS_BY_ID["library.focusPrev"];
    expect(vol.scope).toBe("global");
    expect(focus.scope).toBe("library");
    expect(vol.defaultBindings.some((g) => gestureIdentity(g, "other") === up)).toBe(true);
    expect(focus.defaultBindings.some((g) => gestureIdentity(g, "other") === up)).toBe(true);
  });

  it("marks search.openGlobal protected and gesture bindings display-only", () => {
    expect(isEditableAction(SHORTCUT_ACTIONS_BY_ID["search.openGlobal"])).toBe(false);
    const back = SHORTCUT_ACTIONS_BY_ID["library.back"];
    expect(back.defaultBindings.some((g) => g.kind === "pointer")).toBe(true);
  });
});
