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

  it("cascades: an occupied chord spawns a relocate slot, then batch-saves the chain", () => {
    repo.setAll.mockClear();
    render(
      <ShortcutRecorderDialog
        actionId="playback.cycleRepeat"
        actionLabel="Repeat"
        open
        onOpenChange={() => {}}
      />,
    );
    const save = () => screen.getByText("shortcuts.recorder.save").closest("button");

    // Record Q for cycleRepeat — Q is held by playback.prev, so a relocate slot appears.
    const primary = document.querySelector('[data-capture-action="playback.cycleRepeat"]');
    if (!primary) throw new Error("no primary slot");
    fireEvent.keyDown(primary, { code: "KeyQ", key: "q" });

    const prevSlot = document.querySelector('[data-capture-action="playback.prev"]');
    expect(prevSlot).toBeTruthy(); // the cascade slot
    expect(save()?.disabled).toBe(true); // prev slot still pending

    // Relocate prev to a free chord → chain resolved.
    if (!prevSlot) return;
    fireEvent.keyDown(prevSlot, { code: "KeyZ", key: "z" });
    expect(save()?.disabled).toBe(false);

    fireEvent.click(save() as HTMLButtonElement);
    expect(repo.setAll).toHaveBeenCalledTimes(1);
    const overrides = repo.setAll.mock.calls[0][0];
    expect(overrides["playback.cycleRepeat"]).toEqual([
      { kind: "key", stroke: { code: "KeyR", keyLabel: "R" } },
      { kind: "key", stroke: { code: "KeyQ", keyLabel: "Q" } },
    ]);
    expect(overrides["playback.prev"]).toEqual([
      { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } },
    ]);
  });
});
