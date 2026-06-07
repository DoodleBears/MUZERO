import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryNoteComposer, type MemoryNoteComposerLabels } from "./memory-note-composer";

const labels: MemoryNoteComposerLabels = {
  addPhoto: "Add photo",
  cancel: "Cancel",
  changePhoto: "Change photo",
  notePlaceholder: "Write a memory",
  photoInput: "Memory photo",
  removePhoto: (name) => `Remove ${name}`,
  save: "Save memory",
};

describe("MemoryNoteComposer", () => {
  it("submits trimmed note text and clears the draft", () => {
    const onSubmit = vi.fn();
    render(<MemoryNoteComposer labels={labels} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "  late-night loop  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(onSubmit).toHaveBeenCalledWith("late-night loop");
    expect(screen.getByPlaceholderText("Write a memory")).toHaveValue("");
  });

  it("does not submit blank memory notes", () => {
    const onSubmit = vi.fn();
    render(<MemoryNoteComposer labels={labels} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("can focus the note field when opened from the create tile", () => {
    render(<MemoryNoteComposer autoFocus labels={labels} onSubmit={() => undefined} />);

    expect(screen.getByPlaceholderText("Write a memory")).toHaveFocus();
  });

  it("supports edit mode with cancel", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(
      <MemoryNoteComposer
        initialNote="train-window rain"
        labels={labels}
        onCancel={onCancel}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByPlaceholderText("Write a memory")).toHaveValue("train-window rain");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("reports selected and removed photos without owning persistence", () => {
    const onPhotoRemove = vi.fn();
    const onPhotoSelect = vi.fn();
    render(
      <MemoryNoteComposer
        labels={labels}
        onPhotoRemove={onPhotoRemove}
        onPhotoSelect={onPhotoSelect}
        onSubmit={() => undefined}
        selectedPhotoName="rain.jpg"
      />,
    );

    const file = new File(["img"], "new.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Memory photo"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove rain.jpg" }));

    expect(onPhotoSelect).toHaveBeenCalledWith(file);
    expect(onPhotoRemove).toHaveBeenCalledOnce();
  });
});
