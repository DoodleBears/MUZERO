import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ overrides: undefined as Record<string, unknown> | undefined }));
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: state.overrides }),
}));

import { useShortcutHint } from "./use-shortcut-hint";

describe("useShortcutHint", () => {
  beforeEach(() => {
    state.overrides = undefined;
  });

  it("returns the default transport chips (volume shows up + down)", () => {
    const { result } = renderHook(() => useShortcutHint());
    expect(result.current("play")).toEqual(["Space"]);
    expect(result.current("prev")).toEqual(["Q"]);
    expect(result.current("next")).toEqual(["E"]);
    expect(result.current("like")).toEqual(["L"]);
    expect(result.current("queue")).toEqual(["T"]);
    expect(result.current("volume")).toEqual(["↑", "↓"]);
  });

  it("reflects a rebind (prev → Z)", () => {
    state.overrides = {
      "playback.prev": [{ kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } }],
    };
    const { result } = renderHook(() => useShortcutHint());
    expect(result.current("prev")).toEqual(["Z"]);
  });
});
