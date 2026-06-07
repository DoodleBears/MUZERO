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
});
