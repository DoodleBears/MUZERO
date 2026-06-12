import { describe, expect, it } from "vitest";
import {
  actionBindingChips,
  dedupeGestures,
  eventMatchesAction,
  findConflicts,
  formatGesture,
  gestureFromEvent,
  gestureIdentity,
  matchAction,
  mergeBindings,
  sanitizeOverrides,
  updateShortcutScopeOverride,
} from "./engine";
import type { ShortcutGesture, ShortcutScope } from "./registry";

const ev = (
  code: string,
  key: string,
  mods: Partial<Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {},
) => ({ code, key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

const scopes = (...s: ShortcutScope[]) => new Set<ShortcutScope>(s);

describe("gestureIdentity", () => {
  it("normalizes primaryKey to Meta on mac and Ctrl elsewhere", () => {
    const cmdF: ShortcutGesture = {
      kind: "key",
      stroke: { code: "KeyF", keyLabel: "F", primaryKey: true },
    };
    expect(gestureIdentity(cmdF, "mac")).toBe("key:Meta+KeyF");
    expect(gestureIdentity(cmdF, "other")).toBe("key:Ctrl+KeyF");
  });

  it("ignores keyLabel and orders modifiers Alt+Ctrl+Meta+Shift", () => {
    const a: ShortcutGesture = {
      kind: "key",
      stroke: { code: "KeyK", keyLabel: "K", shiftKey: true, altKey: true },
    };
    const b: ShortcutGesture = {
      kind: "key",
      stroke: { code: "KeyK", keyLabel: "different", altKey: true, shiftKey: true },
    };
    expect(gestureIdentity(a, "mac")).toBe(gestureIdentity(b, "mac"));
    expect(gestureIdentity(a, "mac")).toBe("key:Alt+Shift+KeyK");
  });

  it("matches a live event against a primaryKey binding per platform", () => {
    const binding: ShortcutGesture = {
      kind: "key",
      stroke: { code: "KeyF", keyLabel: "F", primaryKey: true },
    };
    expect(gestureIdentity(gestureFromEvent(ev("KeyF", "f", { metaKey: true })), "mac")).toBe(
      gestureIdentity(binding, "mac"),
    );
    expect(gestureIdentity(gestureFromEvent(ev("KeyF", "f", { ctrlKey: true })), "other")).toBe(
      gestureIdentity(binding, "other"),
    );
  });
});

describe("mergeBindings", () => {
  it("uses defaults when there is no override", () => {
    const merged = mergeBindings();
    expect(merged["playback.prev"]).toEqual([
      {
        gesture: { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } },
        scope: "global",
        source: "default",
      },
      {
        gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
        scope: "now",
        source: "default",
      },
    ]);
  });

  it("an override replaces an editable action's bindings (tagged custom)", () => {
    const merged = mergeBindings({
      "playback.prev": [{ kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } }],
    });
    expect(merged["playback.prev"]).toEqual([
      {
        gesture: { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } },
        scope: "global",
        source: "custom",
      },
    ]);
  });

  it("accepts v2 scoped overrides and preserves the binding scope", () => {
    const merged = mergeBindings({
      "playback.prev": [
        { scope: "now", gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } } },
      ],
    });
    expect(merged["playback.prev"]).toEqual([
      {
        gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
        scope: "now",
        source: "custom",
      },
    ]);
  });

  it("an empty-array override means explicitly unbound", () => {
    expect(mergeBindings({ "playback.prev": [] })["playback.prev"]).toEqual([]);
  });

  it("ignores overrides for protected / display-only actions", () => {
    const merged = mergeBindings({
      "search.openGlobal": [{ kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } }],
    });
    expect(merged["search.openGlobal"].every((b) => b.source === "default")).toBe(true);
  });
});

describe("sanitizeOverrides", () => {
  it("drops unknown ids, protected actions, non-arrays and non-key gestures, and dedupes", () => {
    const raw = {
      "playback.prev": [
        { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } },
        { kind: "key", stroke: { code: "KeyZ", keyLabel: "z" } }, // dup by identity
        { kind: "pointer", labelKey: "x" }, // not a key gesture
      ],
      "search.openGlobal": [{ kind: "key", stroke: { code: "KeyM", keyLabel: "M" } }], // protected → drop
      "does.notExist": [{ kind: "key", stroke: { code: "KeyM", keyLabel: "M" } }], // unknown → drop
      "playback.next": "nope", // not an array → drop
    };
    const clean = sanitizeOverrides(raw, "other");
    expect(Object.keys(clean)).toEqual(["playback.prev"]);
    expect(clean["playback.prev"]).toHaveLength(1);
    expect(clean["playback.prev"][0]).toMatchObject({ scope: "global" });
  });

  it("sanitizes v2 scoped override bindings and drops unknown scopes", () => {
    const raw = {
      "playback.prev": [
        {
          scope: "now",
          gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
        },
        {
          scope: "nope",
          gesture: { kind: "key", stroke: { code: "ArrowRight", keyLabel: "→" } },
        },
      ],
    };
    expect(sanitizeOverrides(raw, "other")).toEqual({
      "playback.prev": [
        {
          scope: "now",
          gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
        },
      ],
    });
  });

  it("returns {} for non-object input", () => {
    expect(sanitizeOverrides(null, "mac")).toEqual({});
    expect(sanitizeOverrides("oops", "mac")).toEqual({});
  });
});

describe("dedupeGestures", () => {
  it("removes identity-equal duplicates, preserving order", () => {
    const out = dedupeGestures(
      [
        { kind: "key", stroke: { code: "KeyA", keyLabel: "A" } },
        { kind: "key", stroke: { code: "KeyB", keyLabel: "B" } },
        { kind: "key", stroke: { code: "KeyA", keyLabel: "a" } },
      ],
      "mac",
    );
    expect(out.map((g) => (g.kind === "key" ? g.stroke.code : ""))).toEqual(["KeyA", "KeyB"]);
  });
});

describe("findConflicts (same-scope only)", () => {
  const bindings = mergeBindings();

  it("flags a same-scope collision (rebinding cycleRepeat to Q hits prev)", () => {
    const q: ShortcutGesture = { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } };
    const conflicts = findConflicts("playback.cycleRepeat", "global", q, bindings, "other");
    expect(conflicts.map((c) => c.actionId)).toContain("playback.prev");
  });

  it("does NOT flag cross-scope shadowing (↑ in global volume vs library focus)", () => {
    const up: ShortcutGesture = { kind: "key", stroke: { code: "ArrowUp", keyLabel: "↑" } };
    // candidate is a global action; library focus also binds ↑ but is a different scope.
    expect(findConflicts("playback.volumeUp", "global", up, bindings, "other")).toEqual([]);
  });

  it("never conflicts on pointer/display gestures", () => {
    expect(
      findConflicts(
        "library.back",
        "library",
        { kind: "pointer", labelKey: "x" },
        bindings,
        "other",
      ),
    ).toEqual([]);
  });
});

describe("matchAction (scope precedence)", () => {
  const bindings = mergeBindings();

  it("Q resolves to prev track in global scope", () => {
    expect(
      matchAction(gestureFromEvent(ev("KeyQ", "q")), scopes("global"), bindings, "other"),
    ).toBe("playback.prev");
  });

  it("bare ↑ is volume in global-only but focus-up when a library surface is active", () => {
    const up = gestureFromEvent(ev("ArrowUp", "ArrowUp"));
    expect(matchAction(up, scopes("global"), bindings, "other")).toBe("playback.volumeUp");
    expect(matchAction(up, scopes("global", "library"), bindings, "other")).toBe(
      "library.focusPrev",
    );
  });

  it("bare ←/→ are track transport only when the Now Playing scope is active", () => {
    const left = gestureFromEvent(ev("ArrowLeft", "ArrowLeft"));
    const right = gestureFromEvent(ev("ArrowRight", "ArrowRight"));
    expect(matchAction(left, scopes("global"), bindings, "other")).toBeNull();
    expect(matchAction(right, scopes("global"), bindings, "other")).toBeNull();
    expect(matchAction(left, scopes("global", "now"), bindings, "other")).toBe("playback.prev");
    expect(matchAction(right, scopes("global", "now"), bindings, "other")).toBe("playback.next");
  });

  it("Cmd/Ctrl+↑ stays volume even with a library surface active", () => {
    const cmdUp = gestureFromEvent(ev("ArrowUp", "ArrowUp", { ctrlKey: true }));
    expect(matchAction(cmdUp, scopes("global", "library"), bindings, "other")).toBe(
      "playback.volumeUp",
    );
  });

  it("T resolves to the queue toggle globally (no longer memory)", () => {
    const tt = gestureFromEvent(ev("KeyT", "t"));
    expect(matchAction(tt, scopes("global", "library"), bindings, "other")).toBe("queue.toggle");
    expect(matchAction(tt, scopes("global", "library", "inspector"), bindings, "other")).toBe(
      "queue.toggle",
    );
  });

  it("N resolves to quick-add-memory only when the inspector scope is active", () => {
    const nn = gestureFromEvent(ev("KeyN", "n"));
    expect(matchAction(nn, scopes("global", "library"), bindings, "other")).toBeNull();
    expect(matchAction(nn, scopes("global", "library", "inspector"), bindings, "other")).toBe(
      "memory.quickAdd",
    );
  });

  it("returns null for an unbound chord", () => {
    expect(
      matchAction(
        gestureFromEvent(ev("KeyZ", "z")),
        scopes("global", "library", "inspector"),
        bindings,
        "other",
      ),
    ).toBeNull();
  });
});

describe("formatGesture / actionBindingChips", () => {
  it("renders modifier chips and prettified keys", () => {
    expect(
      formatGesture(
        { kind: "key", stroke: { code: "KeyF", keyLabel: "F", primaryKey: true } },
        "mac",
      ),
    ).toEqual(["⌘", "F"]);
    expect(
      formatGesture(
        { kind: "key", stroke: { code: "KeyF", keyLabel: "F", primaryKey: true } },
        "other",
      ),
    ).toEqual(["Ctrl", "F"]);
    expect(
      formatGesture({ kind: "key", stroke: { code: "Space", keyLabel: "Space" } }, "mac"),
    ).toEqual(["Space"]);
    expect(formatGesture({ kind: "pointer", labelKey: "x" }, "mac")).toEqual([]);
  });

  it("exposes per-action chips skipping pointer gestures", () => {
    const chips = actionBindingChips("library.back", mergeBindings(), "other");
    expect(chips).toEqual([["A"], ["←"]]); // pointer swipe-back is omitted
  });

  it("can filter display chips by binding scope", () => {
    const bindings = mergeBindings({
      "playback.prev": [
        { scope: "global", gesture: { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } } },
        {
          scope: "now",
          gesture: { kind: "key", stroke: { code: "ArrowLeft", keyLabel: "←" } },
        },
      ],
    });
    expect(actionBindingChips("playback.prev", bindings, "other", "now")).toEqual([["←"]]);
  });
});

describe("eventMatchesAction", () => {
  const bindings = mergeBindings();
  it("matches a live event against one action's bindings (default + override)", () => {
    expect(eventMatchesAction(ev("KeyW", "w"), "library.focusPrev", bindings, "other")).toBe(true);
    expect(
      eventMatchesAction(ev("ArrowUp", "ArrowUp"), "library.focusPrev", bindings, "other"),
    ).toBe(true);
    expect(eventMatchesAction(ev("KeyW", "w"), "library.focusNext", bindings, "other")).toBe(false);
    const custom = mergeBindings({
      "library.back": [{ kind: "key", stroke: { code: "KeyB", keyLabel: "B" } }],
    });
    expect(eventMatchesAction(ev("KeyB", "b"), "library.back", custom, "other")).toBe(true);
    expect(eventMatchesAction(ev("KeyA", "a"), "library.back", custom, "other")).toBe(false);
  });
});

describe("updateShortcutScopeOverride", () => {
  it("replaces one action/scope group without changing the same action's other scopes", () => {
    const bindings = mergeBindings();
    const z = { kind: "key" as const, stroke: { code: "KeyZ", keyLabel: "Z" } };
    expect(
      updateShortcutScopeOverride(
        {},
        "playback.next",
        "now",
        [{ scope: "now", gesture: z }],
        bindings,
        "other",
      ),
    ).toEqual({
      "playback.next": [
        { scope: "global", gesture: { kind: "key", stroke: { code: "KeyE", keyLabel: "E" } } },
        { scope: "now", gesture: z },
      ],
    });
  });

  it("drops the action override when resetting that scope restores the full default", () => {
    const z = { kind: "key" as const, stroke: { code: "KeyZ", keyLabel: "Z" } };
    const overrides = {
      "playback.next": [
        {
          scope: "global" as const,
          gesture: { kind: "key" as const, stroke: { code: "KeyE", keyLabel: "E" } },
        },
        { scope: "now" as const, gesture: z },
      ],
    };
    const bindings = mergeBindings(overrides);
    expect(
      updateShortcutScopeOverride(
        overrides,
        "playback.next",
        "now",
        [
          {
            scope: "now",
            gesture: { kind: "key", stroke: { code: "ArrowRight", keyLabel: "→" } },
          },
        ],
        bindings,
        "other",
      ),
    ).toEqual({});
  });
});
