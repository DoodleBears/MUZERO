import { afterEach, describe, expect, it } from "vitest";
import { useChatStore } from "./chat-store";

afterEach(() => {
  useChatStore.setState({
    mode: "bar",
    dockSide: "right",
    activeSessionId: null,
    runtimeMetaBySessionId: {},
  });
  localStorage.clear();
});

describe("chat-store — persisted shell state", () => {
  it("defaults to the bar composer with the dock on the right", () => {
    expect(useChatStore.getState().mode).toBe("bar");
    expect(useChatStore.getState().dockSide).toBe("right");
  });

  it("persists the visible shell preference but not high-frequency runtime meta", () => {
    useChatStore.getState().setMode("dock");
    useChatStore.getState().setDockSide("left");
    useChatStore.getState().setActiveSessionId("cht_1");
    useChatStore.getState().setRuntimeMeta({
      sessionId: "cht_1",
      status: "streaming",
      messageCount: 2,
      pendingApprovalCount: 0,
      queuedPromptCount: 0,
      contextStartIndex: 0,
      lastAssistantPreview: "hello",
    });

    const raw = localStorage.getItem("muzero-chat-ui") ?? "";
    expect(raw).toContain("dock");
    expect(raw).toContain("left");
    expect(raw).toContain("cht_1");
    expect(raw).not.toContain("hello");
    expect(raw).not.toContain("runtimeMetaBySessionId");
  });
});
