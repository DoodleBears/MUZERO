import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/stores/chat-store";
import { ChatReplyNotification } from "./chat-reply-notification";

afterEach(() => {
  useChatStore.setState({
    mode: "chip",
    activeSessionId: null,
    runtimeMetaBySessionId: {},
  });
  localStorage.clear();
});

function seedReply(mode: "icon" | "chip" | "expanded", status = "idle") {
  useChatStore.setState({
    mode,
    activeSessionId: "cht_1",
    runtimeMetaBySessionId: {
      cht_1: {
        sessionId: "cht_1",
        status: status as never,
        messageCount: 2,
        pendingApprovalCount: 0,
        queuedPromptCount: 0,
        contextStartIndex: 0,
        lastAssistantPreview: "here is a chill set",
      },
    },
  });
}

describe("ChatReplyNotification", () => {
  it("shows folded replies in icon and chip states", () => {
    seedReply("icon");
    const { unmount } = render(<ChatReplyNotification />);
    expect(screen.getByText("here is a chill set")).toBeInTheDocument();
    unmount();

    seedReply("chip");
    render(<ChatReplyNotification />);
    expect(screen.getByText("here is a chill set")).toBeInTheDocument();
  });

  it("stays hidden while the widget is expanded (reply already visible)", () => {
    seedReply("expanded");
    const { container } = render(<ChatReplyNotification />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("stays hidden for active streaming turns because compact activity owns them", () => {
    seedReply("chip", "streaming");
    const { container } = render(<ChatReplyNotification />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("expands the widget when tapped", () => {
    seedReply("chip");
    render(<ChatReplyNotification />);
    fireEvent.click(screen.getByRole("button"));
    expect(useChatStore.getState().mode).toBe("expanded");
  });
});
