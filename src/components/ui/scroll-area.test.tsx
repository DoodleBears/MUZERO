import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./scroll-area";

describe("ScrollArea primitive", () => {
  it("renders content inside a viewport with a vertical scrollbar", () => {
    const { container } = render(
      <ScrollArea className="h-20">
        <div>Long model list</div>
      </ScrollArea>,
    );

    expect(screen.getByText("Long model list")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="scroll-area-content"]')).toBeInTheDocument();
  });
});
