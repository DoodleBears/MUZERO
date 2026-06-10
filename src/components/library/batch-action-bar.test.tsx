import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BatchActionBar } from "./batch-action-bar";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function renderBar(extra: { disabled?: boolean } = {}) {
  render(
    <BatchActionBar
      count={2}
      allSelected={false}
      indeterminate
      onToggleAll={vi.fn()}
      onCancel={vi.fn()}
      actions={[{ label: "Remove", onClick: vi.fn() }]}
      {...extra}
    />,
  );
}

describe("BatchActionBar", () => {
  it("enables actions with a non-empty selection", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Remove" })).not.toBeDisabled();
  });

  it("disables actions while a drag is in progress (drag-mutex)", () => {
    renderBar({ disabled: true });
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  });
});
