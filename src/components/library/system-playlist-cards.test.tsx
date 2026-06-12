import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type SystemPlaylistCardItem, SystemPlaylistCards } from "./system-playlist-cards";

const items: SystemPlaylistCardItem[] = [
  {
    count: 2,
    icon: "heart",
    id: "system:liked",
    label: "Hearted",
    playLabel: "Play Hearted",
    subtitle: "2 songs",
  },
  {
    count: 1,
    icon: "history",
    id: "system:recent",
    label: "Recently Played",
    playLabel: "Play Recently Played",
    subtitle: "1 song",
  },
  {
    count: 3,
    icon: "chart",
    id: "system:most",
    label: "Most Played",
    playLabel: "Play Most Played",
    subtitle: "3 songs",
  },
];

describe("SystemPlaylistCards", () => {
  it("renders non-deletable system playlist cards", () => {
    render(<SystemPlaylistCards items={items} onOpen={vi.fn()} onPlay={vi.fn()} view="grid" />);

    expect(screen.getByRole("button", { name: "Hearted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recently Played" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Most Played" })).toBeInTheDocument();
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it("opens and plays without bubbling play clicks into open", () => {
    const onOpen = vi.fn();
    const onPlay = vi.fn();
    render(<SystemPlaylistCards items={items} onOpen={onOpen} onPlay={onPlay} view="list" />);

    fireEvent.click(screen.getByRole("button", { name: "Hearted" }));
    expect(onOpen).toHaveBeenCalledWith("system:liked");

    fireEvent.click(screen.getByRole("button", { name: "Play Hearted" }));
    expect(onPlay).toHaveBeenCalledWith("system:liked");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
