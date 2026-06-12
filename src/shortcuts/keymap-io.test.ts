import { describe, expect, it } from "vitest";
import { KEYMAP_SCHEMA, parseKeymap, serializeKeymap } from "./keymap-io";
import type { ScopedShortcutBinding, ShortcutGesture } from "./registry";

const z: ShortcutGesture = { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } };
const scopedZ: ScopedShortcutBinding = { scope: "global", gesture: z };

describe("serializeKeymap", () => {
  it("wraps overrides in a versioned file", () => {
    const parsed = JSON.parse(serializeKeymap({ "playback.prev": [scopedZ] }));
    expect(parsed).toEqual({ schema: KEYMAP_SCHEMA, overrides: { "playback.prev": [scopedZ] } });
  });

  it("handles undefined overrides as an empty map", () => {
    expect(JSON.parse(serializeKeymap(undefined)).overrides).toEqual({});
  });
});

describe("parseKeymap", () => {
  it("round-trips a serialized keymap", () => {
    const json = serializeKeymap({ "playback.prev": [scopedZ] });
    expect(parseKeymap(json, "other")).toEqual({ "playback.prev": [scopedZ] });
  });

  it("imports legacy v1 gesture-only keymaps by wrapping the action's default scope", () => {
    const json = JSON.stringify({
      schema: "muzero-shortcuts-v1",
      overrides: { "playback.prev": [z] },
    });
    expect(parseKeymap(json, "other")).toEqual({ "playback.prev": [scopedZ] });
  });

  it("sanitizes: drops unknown ids, protected actions, and malformed gestures", () => {
    const json = JSON.stringify({
      schema: KEYMAP_SCHEMA,
      overrides: {
        "playback.prev": [
          scopedZ,
          { scope: "global", gesture: { kind: "pointer", labelKey: "x" } },
        ],
        "search.openGlobal": [scopedZ], // protected → drop
        "does.notExist": [scopedZ], // unknown → drop
      },
    });
    expect(parseKeymap(json, "other")).toEqual({ "playback.prev": [scopedZ] });
  });

  it("returns null for malformed JSON, wrong schema, or non-object", () => {
    expect(parseKeymap("{not json", "other")).toBeNull();
    expect(parseKeymap(JSON.stringify({ schema: "other", overrides: {} }), "other")).toBeNull();
    expect(parseKeymap(JSON.stringify([1, 2, 3]), "other")).toBeNull();
    expect(parseKeymap("42", "other")).toBeNull();
  });
});
