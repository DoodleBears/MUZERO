import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger } from "./popover";

describe("Popover primitive", () => {
  it("opens positioned content from the trigger", async () => {
    render(
      <Popover>
        <PopoverTrigger render={<Button>Choose model</Button>} />
        <PopoverContent>
          <PopoverTitle>Models</PopoverTitle>
          <div>gpt-5.2</div>
        </PopoverContent>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose model" }));

    expect(await screen.findByText("Models")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.2")).toBeInTheDocument();
  });

  it("closes with PopoverClose and reports open changes", async () => {
    const onOpenChange = vi.fn();
    render(
      <Popover onOpenChange={onOpenChange}>
        <PopoverTrigger render={<Button>Open popover</Button>} />
        <PopoverContent>
          <PopoverTitle>Provider</PopoverTitle>
          <PopoverClose render={<Button>Done</Button>} />
        </PopoverContent>
      </Popover>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open popover" }));
    expect(await screen.findByText("Provider")).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByText("Provider")).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
