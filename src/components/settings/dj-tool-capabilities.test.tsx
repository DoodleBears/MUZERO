import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DjToolCapabilities } from "./dj-tool-capabilities";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("DjToolCapabilities", () => {
  it("renders tool chips and shows the selected tool description", () => {
    render(<DjToolCapabilities />);

    expect(screen.getByRole("button", { name: "chat.tools.library_search.label" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("chat.tools.library_search.description")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "chat.tools.dj_generate_tracks.label" }));

    expect(
      screen.getByRole("button", { name: "chat.tools.dj_generate_tracks.label" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("chat.tools.dj_generate_tracks.description")).toBeInTheDocument();
    expect(screen.getByText("chat.toolAvailability.generation")).toBeInTheDocument();
  });
});
