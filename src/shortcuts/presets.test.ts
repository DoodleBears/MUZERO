import { describe, expect, it } from "vitest";
import { findConflicts, mergeBindings, sanitizeOverrides } from "./engine";
import { SHORTCUT_PRESETS } from "./presets";

describe("SHORTCUT_PRESETS", () => {
  it("have unique ids and i18n label keys", () => {
    const ids = SHORTCUT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHORTCUT_PRESETS.every((p) => p.labelKey.startsWith("shortcuts.preset."))).toBe(true);
  });

  it.each(
    SHORTCUT_PRESETS.map((p) => [p.id, p] as const),
  )("%s only targets editable actions and survives sanitize unchanged", (_id, preset) => {
    expect(sanitizeOverrides(preset.overrides, "other")).toEqual(preset.overrides);
  });

  it.each(
    SHORTCUT_PRESETS.map((p) => [p.id, p] as const),
  )("%s is conflict-free once applied", (_id, preset) => {
    const bindings = mergeBindings(preset.overrides);
    for (const [actionId, gestures] of Object.entries(preset.overrides)) {
      for (const gesture of gestures) {
        expect(findConflicts(actionId, gesture, bindings, "other")).toEqual([]);
      }
    }
  });
});
