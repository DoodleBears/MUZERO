import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KEYMAP_SCHEMA } from "@/shortcuts/keymap-io";

const repo = vi.hoisted(() => ({
  setAll: vi.fn((_overrides: Record<string, unknown>) => Promise.resolve()),
}));
const notifyMock = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => ({ shortcutOverrides: undefined }) }));
vi.mock("@/db/repositories", () => ({
  setAllShortcutOverrides: repo.setAll,
  resetAllShortcuts: vi.fn(),
  resetShortcut: vi.fn(),
  setShortcutOverride: vi.fn(),
}));
vi.mock("@/stores/notification-store", () => ({ notify: notifyMock }));

import { ShortcutsSettings } from "./shortcuts-settings";

const Z = { kind: "key", stroke: { code: "KeyZ", keyLabel: "Z" } };

function fileInput(container: HTMLElement, text: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File([text], "keymap.json", { type: "application/json" })],
  });
  return input;
}

describe("ShortcutsSettings — keymap import", () => {
  it("applies the sanitized overrides from a valid keymap", async () => {
    repo.setAll.mockClear();
    const { container } = render(<ShortcutsSettings />);
    const json = JSON.stringify({ schema: KEYMAP_SCHEMA, overrides: { "playback.prev": [Z] } });
    fireEvent.change(fileInput(container, json));
    await waitFor(() => expect(repo.setAll).toHaveBeenCalledTimes(1));
    expect(repo.setAll.mock.calls[0][0]).toEqual({ "playback.prev": [Z] });
  });

  it("rejects an invalid file with an error toast and no write", async () => {
    repo.setAll.mockClear();
    notifyMock.error.mockClear();
    const { container } = render(<ShortcutsSettings />);
    fireEvent.change(fileInput(container, "not json"));
    await waitFor(() => expect(notifyMock.error).toHaveBeenCalled());
    expect(repo.setAll).not.toHaveBeenCalled();
  });
});
