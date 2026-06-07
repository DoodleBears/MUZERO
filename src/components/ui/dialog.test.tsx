import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

describe("Dialog primitive", () => {
  it("opens from the trigger and exposes title and description", async () => {
    render(
      <Dialog>
        <DialogTrigger render={<Button>Open dialog</Button>} />
        <DialogContent>
          <DialogTitle>Pick a model</DialogTitle>
          <DialogDescription>Choose the provider and model for this session.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));

    const dialog = await screen.findByRole("dialog", { name: "Pick a model" });
    expect(dialog).toHaveTextContent("Choose the provider and model for this session.");
  });

  it("closes with DialogClose and reports controlled open changes", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog onOpenChange={onOpenChange}>
        <DialogTrigger render={<Button>Open dialog</Button>} />
        <DialogContent>
          <DialogTitle>Settings</DialogTitle>
          <DialogClose render={<Button>Close</Button>} />
        </DialogContent>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
  });
});
