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
  pinToTime: "Pin to current time",
  clearTime: "Clear timestamp",
  pinnedAt: (time) => `Pinned at ${time}`,
};

describe("MemoryNoteComposer", () => {
  it("submits trimmed note text and clears the draft", () => {
    const onSubmit = vi.fn();
    render(<MemoryNoteComposer labels={labels} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "  late-night loop  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(onSubmit).toHaveBeenCalledWith("late-night loop", undefined);
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

  it("accepts pasted image files as the selected photo", () => {
    const onPhotoSelect = vi.fn();
    render(
      <MemoryNoteComposer
        labels={labels}
        onPhotoSelect={onPhotoSelect}
        onSubmit={() => undefined}
      />,
    );

    const file = new File(["img"], "pasted.png", { type: "image/png" });
    const textFile = new File(["txt"], "note.txt", { type: "text/plain" });
    fireEvent.paste(screen.getByPlaceholderText("Write a memory"), {
      clipboardData: {
        files: [textFile, file],
        items: [],
      },
    });

    expect(onPhotoSelect).toHaveBeenCalledWith(file);
  });

  it("pins the current playback second and submits it as a whole-second atSec", () => {
    const onSubmit = vi.fn();
    render(
      <MemoryNoteComposer getCurrentPositionSec={() => 98.7} labels={labels} onSubmit={onSubmit} />,
    );

    fireEvent.change(screen.getByPlaceholderText("Write a memory"), {
      target: { value: "drop hits" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pin to current time" }));
    expect(screen.getByText("1:38")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(onSubmit).toHaveBeenCalledWith("drop hits", 98);
  });

  it("shows the initial anchor and clears it before submitting", () => {
    const onSubmit = vi.fn();
    render(
      <MemoryNoteComposer
        initialAtSec={42}
        initialNote="retimed"
        labels={labels}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("0:42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear timestamp" }));
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(onSubmit).toHaveBeenCalledWith("retimed", undefined);
  });

  it("omits the pin control when no playback position is available", () => {
    render(<MemoryNoteComposer labels={labels} onSubmit={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Pin to current time" })).toBeNull();
  });

  it("submits with Enter and keeps Shift+Enter for new lines", () => {
    const onSubmit = vi.fn();
    render(<MemoryNoteComposer labels={labels} onSubmit={onSubmit} />);

    const textarea = screen.getByPlaceholderText("Write a memory");
    fireEvent.change(textarea, { target: { value: "first line" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
    });
    textarea.dispatchEvent(enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith("first line", undefined);
  });
});
