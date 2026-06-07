import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DjChatQueuedPrompt } from "@/db/types";
import { ChatQueueTray, type ChatQueueTrayLabels } from "./chat-queue-tray";

const labels: ChatQueueTrayLabels = {
  autoDispatch: "Auto dispatch",
  delete: "Delete queued prompt",
  dragHandle: "Drag queued prompt",
  empty: "No queued prompts",
  itemPosition: (index, total) => `${index + 1} / ${total}`,
  moveDown: "Move queued prompt down",
  moveUp: "Move queued prompt up",
  send: "Send queued prompt",
  title: "Queued prompts",
};

function queuedPrompt(id: string, composerRaw: string, createdAt: number): DjChatQueuedPrompt {
  return { id, composerRaw, createdAt };
}

describe("ChatQueueTray", () => {
  it("renders the empty state and auto-dispatch switch", () => {
    const onAutoDispatchChange = vi.fn();
    render(
      <ChatQueueTray
        autoDispatchEnabled={false}
        labels={labels}
        onAutoDispatchChange={onAutoDispatchChange}
        prompts={[]}
      />,
    );

    expect(screen.getByText("No queued prompts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Auto dispatch" }));
    expect(onAutoDispatchChange).toHaveBeenCalledWith(true);
  });

  it("dispatches send and delete callbacks for a queued prompt", () => {
    const onDelete = vi.fn();
    const onSend = vi.fn();
    render(
      <ChatQueueTray
        labels={labels}
        onDelete={onDelete}
        onSend={onSend}
        prompts={[queuedPrompt("cqp_1", "make the next track brighter", 10)]}
      />,
    );

    expect(screen.getByText("make the next track brighter")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send queued prompt" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete queued prompt" }));

    expect(onSend).toHaveBeenCalledWith("cqp_1");
    expect(onDelete).toHaveBeenCalledWith("cqp_1");
  });

  it("reorders prompts with accessible move buttons", () => {
    const onReorder = vi.fn();
    render(
      <ChatQueueTray
        labels={labels}
        onReorder={onReorder}
        prompts={[
          queuedPrompt("cqp_1", "first", 10),
          queuedPrompt("cqp_2", "second", 20),
          queuedPrompt("cqp_3", "third", 30),
        ]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Move queued prompt down" })[0]);
    expect(onReorder).toHaveBeenCalledWith(["cqp_2", "cqp_1", "cqp_3"]);

    fireEvent.click(screen.getAllByRole("button", { name: "Move queued prompt up" })[2]);
    expect(onReorder).toHaveBeenLastCalledWith(["cqp_1", "cqp_3", "cqp_2"]);
  });

  it("reorders prompts when one queued item is dropped on another", () => {
    const onReorder = vi.fn();
    render(
      <ChatQueueTray
        labels={labels}
        onReorder={onReorder}
        prompts={[queuedPrompt("cqp_1", "first", 10), queuedPrompt("cqp_2", "second", 20)]}
      />,
    );

    fireEvent.dragStart(screen.getByTestId("queued-prompt-cqp_2"));
    fireEvent.drop(screen.getByTestId("queued-prompt-cqp_1"));

    expect(onReorder).toHaveBeenCalledWith(["cqp_2", "cqp_1"]);
  });
});
