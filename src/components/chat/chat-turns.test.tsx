import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DjChatUIMessage } from "@/chat/types";
import type { ChatToolLabels } from "./chat-tool-collapsible";
import { ChatTurns } from "./chat-turns";

const labels: ChatToolLabels = {
  approve: "Approve",
  error: "Error",
  input: "Input",
  output: "Output",
  reject: "Reject",
  states: {
    "approval-requested": "Approval requested",
    "approval-responded": "Approval responded",
    "input-available": "Input ready",
    "input-streaming": "Input streaming",
    "output-available": "Done",
    "output-denied": "Denied",
    "output-error": "Failed",
  },
};

describe("ChatTurns", () => {
  it("renders tool parts through the collapsible when labels are provided", () => {
    const onApproveTool = vi.fn();
    const onRejectTool = vi.fn();
    const messages = [
      {
        id: "asst_1",
        role: "assistant",
        parts: [
          { type: "text", text: "I can generate this." },
          {
            type: "tool-dj_generate_tracks",
            toolCallId: "call_1",
            state: "approval-requested",
            input: { sessionId: "ses_1", briefs: [] },
            approval: { id: "approval_1" },
          },
        ],
      } as unknown as DjChatUIMessage,
    ];

    render(
      <ChatTurns
        messages={messages}
        onApproveTool={onApproveTool}
        onRejectTool={onRejectTool}
        toolLabels={labels}
      />,
    );

    expect(screen.getByText("I can generate this.")).toBeInTheDocument();
    expect(screen.getByText("dj_generate_tracks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onApproveTool).toHaveBeenCalledWith("approval_1");
    expect(onRejectTool).toHaveBeenCalledWith("approval_1");
  });

  it("interleaves text and tool parts in emission order (not all text above tools)", () => {
    const messages = [
      {
        id: "asst_2",
        role: "assistant",
        parts: [
          { type: "text", text: "Let me search your library." },
          {
            type: "tool-library_search_tracks",
            toolCallId: "call_s",
            state: "output-available",
            input: { query: "lofi" },
            output: { total: 0 },
          },
          { type: "text", text: "Nothing matched — want me to widen it?" },
        ],
      } as unknown as DjChatUIMessage,
    ];

    render(<ChatTurns messages={messages} toolLabels={labels} />);

    const before = screen.getByText("Let me search your library.");
    const tool = screen.getByText("library_search_tracks");
    const after = screen.getByText("Nothing matched — want me to widen it?");

    // Document order must be before → tool → after.
    expect(before.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tool.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
