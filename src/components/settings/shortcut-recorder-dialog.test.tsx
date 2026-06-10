import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  setAll: vi.fn((_overrides: Record<string, unknown>) => Promise.resolve()),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ shortcutOverrides: undefined }),
}));
vi.mock("@/db/repositories", () => ({ setAllShortcutOverrides: repo.setAll }));

import { ShortcutRecorderDialog } from "./shortcut-recorder-dialog";

describe("ShortcutRecorderDialog", () => {
  it("captures a chord and saves the resolved override map", async () => {
    repo.setAll.mockClear();
    render(
      <ShortcutRecorderDialog
        actionId="playback.prev"
        actionLabel="Previous"
        open
        onOpenChange={() => {}}
      />,
    );
    const capture = document.querySelector("[data-shortcut-capture]");
    expect(capture).toBeTruthy();
    if (!capture) return;

    fireEvent.keyDown(capture, { code: "KeyZ", key: "z" });

    const save = await screen.findByText("shortcuts.recorder.save");
    fireEvent.click(save);

    expect(repo.setAll).toHaveBeenCalledTimes(1);
    const overrides = repo.setAll.mock.calls[0][0];
    // "+" ADDS a binding: prev keeps its default Q and gains Z (multi-binding).
    expect(overrides["playback.prev"]).toEqual([
      { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } },
      { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } },
    ]);
  });

  it("ignores a bare modifier press (no chord captured yet)", () => {
    render(
      <ShortcutRecorderDialog
        actionId="playback.prev"
        actionLabel="Previous"
        open
        onOpenChange={() => {}}
      />,
    );
    const capture = document.querySelector("[data-shortcut-capture]");
    if (!capture) return;
    fireEvent.keyDown(capture, { code: "ShiftLeft", key: "Shift", shiftKey: true });
    // Save stays disabled (nothing captured).
    const save = screen.getByText("shortcuts.recorder.save").closest("button");
    expect(save?.disabled).toBe(true);
  });
});
