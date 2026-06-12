import { fireEvent, render, screen } from "@testing-library/react";
import type { ToolUIPart } from "ai";
import { describe, expect, it, vi } from "vitest";
import type { DjChatRuntimeSnapshot, DjChatUIMessage } from "@/chat/types";
import { useChatStore } from "@/stores/chat-store";
import {
  type ChatActivityLabels,
  ChatActivityPopover,
  deriveChatActivity,
} from "./chat-activity-popover";

const labels: ChatActivityLabels = {
  ariaLabel: "DJ activity",
  error: "Something went wrong",
  idle: "Idle",
  thinking: "Thinking",
  queued: "Queued next prompt",
  waitingApproval: "Waiting for approval",
  toolStates: {
    "approval-requested": "Waiting for approval",
    "approval-responded": "Approval answered",
    "input-available": "Running",
    "input-streaming": "Running",
    "output-available": "Done",
    "output-denied": "Denied",
    "output-error": "Failed",
  },
  tools: {
    library_search: { label: "Searching library" },
    play_track: { label: "Playing track" },
  },
};

function snapshot(part: ToolUIPart, text = "I found a few songs."): DjChatRuntimeSnapshot {
  return {
    messages: [
      {
        id: "asst_1",
        role: "assistant",
        parts: [{ type: "text", text }, part],
      } as unknown as DjChatUIMessage,
    ],
    meta: {
      sessionId: "cht_1",
      status: part.state === "approval-requested" ? "awaiting-approval" : "streaming",
      messageCount: 1,
      lastAssistantPreview: text,
      pendingApprovalCount: part.state === "approval-requested" ? 1 : 0,
      queuedPromptCount: 0,
      contextStartIndex: 0,
    },
    queuedPrompts: [],
  };
}

describe("deriveChatActivity", () => {
  it("uses the latest tool label and assistant text preview", () => {
    const activity = deriveChatActivity(
      snapshot({
        type: "tool-library_search",
        toolCallId: "call_1",
        state: "input-available",
        input: { queries: ["rain"] },
      } satisfies ToolUIPart),
      labels,
    );

    expect(activity).toMatchObject({
      preview: "I found a few songs.",
      status: "Searching library",
      tone: "running",
    });
  });

  it("keeps approval activity sticky", () => {
    const activity = deriveChatActivity(
      snapshot(
        {
          type: "tool-play_track",
          toolCallId: "call_2",
          state: "approval-requested",
          input: { trackId: "#T1" },
          approval: { id: "approval_1" },
        } satisfies ToolUIPart,
        "",
      ),
      labels,
    );

    expect(activity).toMatchObject({
      autoHide: false,
      status: "Waiting for approval",
      tone: "approval",
    });
  });
});

describe("ChatActivityPopover", () => {
  it("renders compact activity with a two-line preview and expands on click", () => {
    const onDismiss = vi.fn();
    useChatStore.setState({ mode: "chip" });

    render(
      <ChatActivityPopover
        activity={{
          autoHide: true,
          preview:
            "This is a long streamed assistant preview that should stay in a two-line viewport without showing a scrollbar.",
          status: "Searching library",
          tone: "running",
        }}
        labels={labels}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Searching library");
    const preview = screen.getByTestId("chat-activity-preview");
    expect(preview).toHaveClass("max-h-[calc(2_*_1.25rem)]");
    expect(preview).toHaveClass("no-scrollbar");
    expect(preview).toHaveClass("motion-reduce:line-clamp-2");
    expect(preview.firstElementChild).toHaveClass("motion-reduce:animate-none");

    fireEvent.click(screen.getByRole("button", { name: "DJ activity" }));
    expect(useChatStore.getState().mode).toBe("expanded");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses with Escape or outside pointer without expanding", () => {
    const onDismiss = vi.fn();
    useChatStore.setState({ mode: "chip" });

    render(
      <ChatActivityPopover
        activity={{
          autoHide: false,
          preview: "Approve before I play this track.",
          status: "Waiting for approval",
          tone: "approval",
        }}
        labels={labels}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(document.body);

    expect(onDismiss).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().mode).toBe("chip");
  });

  it("does not render without activity", () => {
    const { container } = render(<ChatActivityPopover activity={undefined} labels={labels} />);
    expect(container.firstChild).toBeNull();
  });
});
