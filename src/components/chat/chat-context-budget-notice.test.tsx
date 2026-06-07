import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ChatContextBudgetNotice,
  type ChatContextBudgetNoticeLabels,
} from "./chat-context-budget-notice";

const labels: ChatContextBudgetNoticeLabels = {
  compress: "Compress context",
  detail: ({ estimatedTokens, maxTokens }) => `${estimatedTokens} / ${maxTokens}`,
  states: {
    block: "Context full",
    ok: "Context ok",
    warn: "Context getting full",
  },
};

describe("ChatContextBudgetNotice", () => {
  it("hides ok budgets by default", () => {
    const { container } = render(
      <ChatContextBudgetNotice
        labels={labels}
        result={{ estimatedTokens: 10, maxTokens: 100, ratio: 0.1, status: "ok" }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders warn and block states with budget details", () => {
    const { rerender } = render(
      <ChatContextBudgetNotice
        labels={labels}
        result={{ estimatedTokens: 80, maxTokens: 100, ratio: 0.8, status: "warn" }}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Context getting full");
    expect(screen.getByText("80 / 100")).toBeInTheDocument();

    rerender(
      <ChatContextBudgetNotice
        labels={labels}
        result={{ estimatedTokens: 95, maxTokens: 100, ratio: 0.95, status: "block" }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Context full");
    expect(screen.getByText("95 / 100")).toBeInTheDocument();
  });

  it("forwards compression requests to the caller", () => {
    const onCompress = vi.fn();
    render(
      <ChatContextBudgetNotice
        labels={labels}
        onCompress={onCompress}
        result={{ estimatedTokens: 95, maxTokens: 100, ratio: 0.95, status: "block" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compress context" }));

    expect(onCompress).toHaveBeenCalled();
  });
});
