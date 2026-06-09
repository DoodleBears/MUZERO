import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { R2ConflictResolutionPanel } from "./r2-conflict-resolution-panel";

const labels = {
  title: "Needs review",
  empty: "No conflicts",
  keepLocal: "Keep local",
  useRemote: "Use remote",
  duplicateBoth: "Duplicate both",
  field: "Field",
  reason: "Reason",
};

describe("R2ConflictResolutionPanel", () => {
  it("renders conflicts and emits explicit resolution actions", () => {
    const onResolve = vi.fn();
    render(
      <R2ConflictResolutionPanel
        conflicts={[
          {
            entityType: "track",
            entityId: "trk_blue",
            field: "title",
            reason: "local-and-remote-changed",
            mutationIds: ["mut_1"],
          },
        ]}
        labels={labels}
        onResolve={onResolve}
      />,
    );

    expect(screen.getByRole("region", { name: "Needs review" })).toBeInTheDocument();
    expect(screen.getByText("track: trk_blue")).toBeInTheDocument();
    expect(screen.getByText("Field: title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Duplicate both" }));

    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: "trk_blue" }),
      "duplicate-both",
    );
  });

  it("renders an empty state without resolution buttons", () => {
    render(<R2ConflictResolutionPanel conflicts={[]} labels={labels} onResolve={vi.fn()} />);

    expect(screen.getByText("No conflicts")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
