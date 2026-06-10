import { describe, expect, it } from "vitest";
import { KEYMAP_SCHEMA, parseKeymap, serializeKeymap } from "./keymap-io";
import type { ShortcutGesture } from "./registry";

const z: ShortcutGesture = { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } };

describe("serializeKeymap", () => {
  it("wraps overrides in a versioned file", () => {
    const parsed = JSON.parse(serializeKeymap({ "playback.prev": [z] }));
    expect(parsed).toEqual({ schema: KEYMAP_SCHEMA, overrides: { "playback.prev": [z] } });
  });

  it("handles undefined overrides as an empty map", () => {
    expect(JSON.parse(serializeKeymap(undefined)).overrides).toEqual({});
  });
});

describe("parseKeymap", () => {
  it("round-trips a serialized keymap", () => {
    const json = serializeKeymap({ "playback.prev": [z] });
    expect(parseKeymap(json, "other")).toEqual({ "playback.prev": [z] });
  });

  it("sanitizes: drops unknown ids, protected actions, and malformed gestures", () => {
    const json = JSON.stringify({
      schema: KEYMAP_SCHEMA,
      overrides: {
        "playback.prev": [z, { kind: "pointer", labelKey: "x" }],
        "search.openGlobal": [z], // protected → drop
        "does.notExist": [z], // unknown → drop
      },
    });
    expect(parseKeymap(json, "other")).toEqual({ "playback.prev": [z] });
  });

  it("returns null for malformed JSON, wrong schema, or non-object", () => {
    expect(parseKeymap("{not json", "other")).toBeNull();
    expect(parseKeymap(JSON.stringify({ schema: "other", overrides: {} }), "other")).toBeNull();
    expect(parseKeymap(JSON.stringify([1, 2, 3]), "other")).toBeNull();
    expect(parseKeymap("42", "other")).toBeNull();
  });
});
