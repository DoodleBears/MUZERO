import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kbd, KbdGroup } from "./kbd";

describe("Kbd", () => {
  it("renders a key cap with its text", () => {
    render(<Kbd>⌘</Kbd>);
    expect(screen.getByText("⌘")).toBeInTheDocument();
  });

  it("groups keys for a shortcut combo", () => {
    render(
      <KbdGroup>
        <Kbd>⌘</Kbd>
        <Kbd>1</Kbd>
      </KbdGroup>,
    );
    expect(screen.getByText("⌘")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});
