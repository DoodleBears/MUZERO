import { fireEvent, render, screen } from "@testing-library/react";
import type { ToolUIPart } from "ai";
import { describe, expect, it, vi } from "vitest";
import { ChatToolCollapsible, type ChatToolLabels } from "./chat-tool-collapsible";

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

describe("ChatToolCollapsible", () => {
  it("renders approval actions for approval-requested tool parts", () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const part = {
      type: "tool-dj_generate_tracks",
      toolCallId: "call_1",
      state: "approval-requested",
      input: { sessionId: "ses_1", briefs: [] },
      approval: { id: "approval_1" },
    } satisfies ToolUIPart;

    render(
      <ChatToolCollapsible labels={labels} onApprove={onApprove} onReject={onReject} part={part} />,
    );

    expect(screen.getByText("dj_generate_tracks")).toBeInTheDocument();
    expect(screen.getByText("Approval requested")).toBeInTheDocument();
    expect(screen.getByText(/"sessionId": "ses_1"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(onApprove).toHaveBeenCalledWith("approval_1");
    expect(onReject).toHaveBeenCalledWith("approval_1");
  });

  it("uses localized tool labels when provided", () => {
    const part = {
      type: "tool-dj_generate_tracks",
      toolCallId: "call_1",
      state: "input-available",
      input: { sessionId: "ses_1" },
    } satisfies ToolUIPart;

    render(
      <ChatToolCollapsible
        labels={{
          ...labels,
          tools: {
            dj_generate_tracks: {
              description: "Spends provider credits after approval.",
              label: "Generate songs",
            },
          },
        }}
        part={part}
      />,
    );

    expect(screen.getByText("Generate songs")).toBeInTheDocument();
    expect(screen.getByText("Spends provider credits after approval.")).toBeInTheDocument();
    expect(screen.queryByText("dj_generate_tracks")).not.toBeInTheDocument();
  });

  it("shows the tool's key input as the summary sub-line (icon + label + detail)", () => {
    const part = {
      type: "tool-library_search",
      toolCallId: "call_s",
      state: "output-available",
      input: { queries: ["jazz", "lofi"] },
      output: { total: 3 },
    } satisfies ToolUIPart;

    render(
      <ChatToolCollapsible
        labels={{ ...labels, tools: { library_search: { label: "Search library" } } }}
        part={part}
      />,
    );

    expect(screen.getByText("Search library")).toBeInTheDocument();
    // The key input (queries joined) surfaces as the sub-line — the "executed content".
    expect(screen.getByText("jazz、lofi")).toBeInTheDocument();
  });

  it("renders tool output and errors without requiring approval actions", () => {
    const outputPart = {
      type: "tool-set_create",
      toolCallId: "call_2",
      state: "output-available",
      input: { name: "Roadtrip" },
      output: { status: "ok", summary: "Created set." },
    } satisfies ToolUIPart;
    const errorPart = {
      type: "tool-dj_generate_tracks",
      toolCallId: "call_3",
      state: "output-error",
      input: { sessionId: "missing" },
      errorText: "Target set was not found.",
    } satisfies ToolUIPart;

    const { rerender } = render(<ChatToolCollapsible labels={labels} part={outputPart} />);

    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText(/"summary": "Created set."/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    rerender(<ChatToolCollapsible labels={labels} part={errorPart} />);

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Target set was not found.");
  });

  it("collapses completed calls by default but auto-opens ones needing attention", () => {
    const donePart = {
      type: "tool-set_create",
      toolCallId: "call_d",
      state: "output-available",
      input: { name: "Roadtrip" },
      output: { status: "ok" },
    } satisfies ToolUIPart;
    const approvalPart = {
      type: "tool-dj_generate_tracks",
      toolCallId: "call_a",
      state: "approval-requested",
      input: { sessionId: "ses_1" },
      approval: { id: "approval_2" },
    } satisfies ToolUIPart;
    const errorPart = {
      type: "tool-dj_generate_tracks",
      toolCallId: "call_e",
      state: "output-error",
      input: {},
      errorText: "boom",
    } satisfies ToolUIPart;

    const detailsFor = (part: ToolUIPart) =>
      render(<ChatToolCollapsible labels={labels} part={part} />).container.querySelector(
        "details",
      );

    expect(detailsFor(donePart)?.open).toBe(false); // collapsed at a glance
    expect(detailsFor(approvalPart)?.open).toBe(true); // approval needs eyes
    expect(detailsFor(errorPart)?.open).toBe(true); // error needs eyes
  });
});
