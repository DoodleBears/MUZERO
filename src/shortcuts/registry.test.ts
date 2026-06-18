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

  it("supports tab/surface scopes in the scope vocabulary", () => {
    const scopes = new Set(
      SHORTCUT_ACTIONS.flatMap((action) => action.defaultBindings.map((b) => b.scope)),
    );
    expect(scopes.has("global")).toBe(true);
    expect(scopes.has("library")).toBe(true);
  });

  it.each<Platform>([
    "mac",
    "other",
  ])("has no two actions sharing a key chord WITHIN the same scope (%s)", (platform) => {
    const seen = new Map<string, string>(); // `${scope}|${identity}` -> actionId
    for (const action of SHORTCUT_ACTIONS) {
      for (const binding of action.defaultBindings) {
        if (binding.gesture.kind !== "key") continue;
        const k = `${binding.scope}|${gestureIdentity(binding.gesture, platform)}`;
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
    expect(vol.defaultBindings.some((g) => gestureIdentity(g.gesture, "other") === up)).toBe(true);
    expect(focus.defaultBindings.some((g) => gestureIdentity(g.gesture, "other") === up)).toBe(
      true,
    );
  });

  it("also lists bare ↑/↓ as Now Playing volume bindings for Settings", () => {
    expect(SHORTCUT_ACTIONS_BY_ID["playback.volumeUp"].defaultBindings).toEqual([
      { scope: "global", gesture: { kind: "key", stroke: { code: "ArrowUp", keyLabel: "↑" } } },
      {
        scope: "global",
        gesture: {
          kind: "key",
          stroke: { code: "ArrowUp", keyLabel: "↑", primaryKey: true },
        },
      },
      { scope: "now", gesture: { kind: "key", stroke: { code: "ArrowUp", keyLabel: "↑" } } },
    ]);
    expect(SHORTCUT_ACTIONS_BY_ID["playback.volumeDown"].defaultBindings).toEqual([
      {
        scope: "global",
        gesture: { kind: "key", stroke: { code: "ArrowDown", keyLabel: "↓" } },
      },
      {
        scope: "global",
        gesture: {
          kind: "key",
          stroke: { code: "ArrowDown", keyLabel: "↓", primaryKey: true },
        },
      },
      { scope: "now", gesture: { kind: "key", stroke: { code: "ArrowDown", keyLabel: "↓" } } },
    ]);
  });

  it("adds Now Playing arrow bindings without replacing global Q/E transport", () => {
    expect(SHORTCUT_ACTIONS_BY_ID["playback.prev"].defaultBindings).toEqual([
      { scope: "global", gesture: { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } } },
      {
        scope: "now",
        gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
      },
    ]);
    expect(SHORTCUT_ACTIONS_BY_ID["playback.next"].defaultBindings).toEqual([
      { scope: "global", gesture: { kind: "key", stroke: { code: "KeyE", keyLabel: "E" } } },
      {
        scope: "now",
        gesture: { kind: "key", stroke: { code: "ArrowRight", keyLabel: "→" } },
      },
    ]);
  });

  it("marks search.openGlobal protected and reference gestures display-only", () => {
    expect(isEditableAction(SHORTCUT_ACTIONS_BY_ID["search.openGlobal"])).toBe(false);
    const swipe = SHORTCUT_ACTIONS_BY_ID["ref.swipeBack"];
    expect(swipe.category).toBe("reference");
    expect(isEditableAction(swipe)).toBe(false);
    expect(swipe.defaultBindings.some((g) => g.gesture.kind === "pointer")).toBe(true);
  });

  it("dispatch/conflict skip reference actions (intrinsic keys stay free to rebind onto)", () => {
    // ← is a reference (scrub) chord; binding it to a real global action must not
    // resolve to or be blocked by the reference entry.
    const left = gestureIdentity(
      { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
      "other",
    );
    const ref = SHORTCUT_ACTIONS_BY_ID["ref.scrub"];
    expect(ref.category).toBe("reference");
    expect(ref.defaultBindings.some((g) => gestureIdentity(g.gesture, "other") === left)).toBe(
      true,
    );
  });

  it("binds bare Digit1–5 to the five library tabs (no clash with Cmd+1/2/3)", () => {
    const tabs = [
      ["nav.galleryTabSets", "Digit1"],
      ["nav.galleryTabTracks", "Digit2"],
      ["nav.galleryTabAlbums", "Digit3"],
      ["nav.galleryTabArtists", "Digit4"],
      ["nav.galleryTabOnline", "Digit5"],
    ] as const;
    for (const [id, code] of tabs) {
      const action = SHORTCUT_ACTIONS_BY_ID[id];
      expect(action.scope).toBe("global");
      expect(action.defaultBindings).toEqual([
        {
          scope: "global",
          gesture: { kind: "key", stroke: { code, keyLabel: code.replace("Digit", "") } },
        },
      ]);
    }
  });

  it("registers editable primary-tab cycling shortcuts for Settings", () => {
    expect(SHORTCUT_ACTIONS_BY_ID["nav.tabNext"].defaultBindings).toEqual([
      {
        scope: "global",
        gesture: { kind: "key", stroke: { code: "Tab", keyLabel: "Tab", ctrlKey: true } },
      },
    ]);
    expect(SHORTCUT_ACTIONS_BY_ID["nav.tabPrev"].defaultBindings).toEqual([
      {
        scope: "global",
        gesture: {
          kind: "key",
          stroke: { code: "Tab", keyLabel: "Tab", ctrlKey: true, shiftKey: true },
        },
      },
    ]);
    expect(isEditableAction(SHORTCUT_ACTIONS_BY_ID["nav.tabNext"])).toBe(true);
    expect(isEditableAction(SHORTCUT_ACTIONS_BY_ID["nav.tabPrev"])).toBe(true);
  });
});
