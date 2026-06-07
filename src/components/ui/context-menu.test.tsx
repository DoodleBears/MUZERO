import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuTrigger,
} from "./context-menu";

describe("ContextMenu primitive", () => {
  it("opens from right click and dispatches item clicks", async () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Cover art</ContextMenuTrigger>
        <ContextMenuContent aria-label="Track options">
          <ContextMenuLabel>Track options</ContextMenuLabel>
          <ContextMenuItem onClick={onSelect}>Change cover</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Cover art"));

    expect(await screen.findByRole("menu", { name: "Track options" })).toHaveTextContent(
      "Change cover",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Change cover" }));

    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("supports shadcn-style radio menu items", async () => {
    const onValueChange = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>Song row</ContextMenuTrigger>
        <ContextMenuContent aria-label="Track options">
          <ContextMenuRadioGroup value="video" onValueChange={onValueChange}>
            <ContextMenuRadioItem value="video">Video</ContextMenuRadioItem>
            <ContextMenuRadioItem value="cover">Cover</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuContent>
      </ContextMenu>,
    );

    fireEvent.contextMenu(screen.getByText("Song row"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Cover" }));

    expect(onValueChange).toHaveBeenCalledWith("cover", expect.anything());
  });
});
