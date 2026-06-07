import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/stores/chat-store";
import { ChatDock } from "./chat-dock";
import { ChatInputBar } from "./chat-input-bar";
import { ChatLauncherFab } from "./chat-launcher-fab";
import { ChatReplyNotification } from "./chat-reply-notification";

afterEach(() => {
  useChatStore.setState({
    mode: "bar",
    dockSide: "right",
    activeSessionId: null,
    runtimeMetaBySessionId: {},
  });
  localStorage.clear();
});

describe("chat shell components", () => {
  it("opens the dock when the FAB is clicked", () => {
    useChatStore.setState({ mode: "fab" });
    render(<ChatLauncherFab />);

    fireEvent.click(screen.getByRole("button"));
    expect(useChatStore.getState().mode).toBe("dock");
  });

  it("renders the bottom input bar only in bar mode", () => {
    const { container, rerender } = render(<ChatInputBar onSend={() => undefined} />);
    expect(container.firstChild).toBeInTheDocument();

    useChatStore.setState({ mode: "dock" });
    rerender(<ChatInputBar onSend={() => undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the dock for expanded modes and closes back to the bar", () => {
    useChatStore.setState({ mode: "dock", activeSessionId: "cht_1" });
    render(<ChatDock renderPanel={() => <div data-testid="panel" />} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(useChatStore.getState().mode).toBe("bar");
  });

  it("shows folded assistant replies only while collapsed and opens the dock on click", () => {
    useChatStore.setState({
      mode: "bar",
      activeSessionId: "cht_1",
      runtimeMetaBySessionId: {
        cht_1: {
          sessionId: "cht_1",
          status: "streaming",
          messageCount: 2,
          pendingApprovalCount: 0,
          queuedPromptCount: 0,
          lastAssistantPreview: "Rainy focus is ready.",
        },
      },
    });

    render(<ChatReplyNotification />);
    expect(screen.getByRole("status")).toHaveTextContent("Rainy focus is ready.");
    fireEvent.click(screen.getByRole("button"));
    expect(useChatStore.getState().mode).toBe("dock");
  });
});
