import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MemoryNotesWaterfall,
  type MemoryNotesWaterfallLabels,
  type MemoryNoteView,
  sortMemoriesForWaterfall,
} from "./memory-notes-waterfall";

const labels: MemoryNotesWaterfallLabels = {
  deleteMemory: (memory) => `Delete ${memory.note}`,
  editMemory: (memory) => `Edit ${memory.note}`,
  empty: "No memories yet",
  photoAlt: (memory) => `Photo for ${memory.note}`,
  setCoverFromMemory: (memory) => `Use ${memory.note} as cover`,
};

const memories: MemoryNoteView[] = [
  { id: "mem_old", trackId: "trk_1", note: "first listen", createdAt: 10 },
  {
    id: "mem_photo",
    trackId: "trk_1",
    note: "rainy train ride",
    createdAt: 30,
    photoBlobId: "blb_memory",
    photoUrl: "blob:rain",
  },
  { id: "mem_mid", trackId: "trk_1", note: "late coding loop", createdAt: 20 },
];

describe("MemoryNotesWaterfall", () => {
  it("renders a leading create note before newest-first memory cards", () => {
    render(
      <MemoryNotesWaterfall
        formatCreatedAt={(createdAt) => `time-${createdAt}`}
        leadingItem={<button type="button">Create memory</button>}
        labels={labels}
        memories={memories}
      />,
    );

    const list = screen.getByRole("list", { name: "No memories yet" });
    expect(list).toHaveClass("relative", "w-full");
    expect(list).not.toHaveClass("grid");
    expect(list).not.toHaveClass("columns-1");
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveTextContent("Create memory");
    expect(cards[0]).toHaveAttribute("data-column", "0");
    expect(cards[0]).toHaveAttribute("data-y", "0");
    expect(cards[1]).toHaveAttribute("data-column", "1");
    expect(cards[1]).toHaveAttribute("data-y", "0");
    expect(
      cards.slice(1).map((card) => within(card).getByTestId("memory-note-text").textContent),
    ).toEqual(["rainy train ride", "late coding loop", "first listen"]);
    expect(cards[1]?.querySelector("article")).toHaveClass("bg-card");
    expect(cards[1]).toHaveTextContent("time-30");
  });

  it("renders attached photos with caller-provided alt text", () => {
    render(
      <MemoryNotesWaterfall
        formatCreatedAt={(createdAt) => String(createdAt)}
        labels={labels}
        memories={memories}
      />,
    );

    expect(screen.getByRole("img", { name: "Photo for rainy train ride" })).toHaveAttribute(
      "src",
      "blob:rain",
    );
    expect(screen.getByRole("img", { name: "Photo for rainy train ride" })).toHaveClass(
      "object-contain",
    );
    expect(screen.getByRole("img", { name: "Photo for rainy train ride" })).not.toHaveClass(
      "object-cover",
    );
  });

  it("reports edit and delete actions without owning persistence", () => {
    const onDelete = vi.fn();
    const onEdit = vi.fn();
    render(
      <MemoryNotesWaterfall
        formatCreatedAt={(createdAt) => String(createdAt)}
        labels={labels}
        memories={memories}
        onDeleteMemory={onDelete}
        onEditMemory={onEdit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit rainy train ride" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete rainy train ride" }));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "mem_photo" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "mem_photo" }));
  });

  it("reports set-cover actions for memories that have photos", () => {
    const onSetCover = vi.fn();
    render(
      <MemoryNotesWaterfall
        formatCreatedAt={(createdAt) => String(createdAt)}
        labels={labels}
        memories={memories}
        onSetCoverFromMemory={onSetCover}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Use rainy train ride as cover" }));

    expect(onSetCover).toHaveBeenCalledWith(expect.objectContaining({ id: "mem_photo" }));
    expect(screen.queryByRole("button", { name: "Use late coding loop as cover" })).toBeNull();
  });

  it("renders the empty state when there are no memories", () => {
    render(
      <MemoryNotesWaterfall
        formatCreatedAt={(createdAt) => String(createdAt)}
        labels={labels}
        memories={[]}
      />,
    );

    expect(screen.getByText("No memories yet")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});

describe("sortMemoriesForWaterfall", () => {
  it("sorts newest first without mutating the caller array", () => {
    const input = memories.slice();

    expect(sortMemoriesForWaterfall(input).map((memory) => memory.id)).toEqual([
      "mem_photo",
      "mem_mid",
      "mem_old",
    ]);
    expect(input.map((memory) => memory.id)).toEqual(["mem_old", "mem_photo", "mem_mid"]);
  });
});
