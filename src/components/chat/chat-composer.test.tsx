import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatComposer } from "./chat-composer";

function draftBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox");
}

describe("ChatComposer keyboard contract", () => {
  it("sends a draft with Enter while idle", () => {
    const onSend = vi.fn();
    render(<ChatComposer onSend={onSend} />);

    fireEvent.change(draftBox(), { target: { value: "rain focus" } });
    fireEvent.keyDown(draftBox(), { key: "Enter" });

    expect(onSend).toHaveBeenCalledWith("rain focus");
  });

  it("queues a draft with Enter while running", () => {
    const onQueue = vi.fn();
    const onSend = vi.fn();
    render(<ChatComposer isRunning onQueue={onQueue} onSend={onSend} />);

    fireEvent.change(draftBox(), { target: { value: "after this, go darker" } });
    fireEvent.keyDown(draftBox(), { key: "Enter" });

    expect(onQueue).toHaveBeenCalledWith("after this, go darker");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("interrupts with a draft on Cmd/Ctrl+Enter while running", () => {
    const onInterrupt = vi.fn();
    const onQueue = vi.fn();
    render(<ChatComposer isRunning onInterrupt={onInterrupt} onQueue={onQueue} onSend={vi.fn()} />);

    fireEvent.change(draftBox(), { target: { value: "actually switch now" } });
    fireEvent.keyDown(draftBox(), { key: "Enter", metaKey: true });

    expect(onInterrupt).toHaveBeenCalledWith("actually switch now");
    expect(onQueue).not.toHaveBeenCalled();
  });

  it("keeps Shift+Enter for multiline drafting", () => {
    const onSend = vi.fn();
    const onQueue = vi.fn();
    render(<ChatComposer isRunning onQueue={onQueue} onSend={onSend} />);

    fireEvent.change(draftBox(), { target: { value: "line one" } });
    fireEvent.keyDown(draftBox(), { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(onQueue).not.toHaveBeenCalled();
  });
});
