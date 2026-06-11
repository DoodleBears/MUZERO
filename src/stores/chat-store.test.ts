import { afterEach, describe, expect, it } from "vitest";
import { migrateChatUiState, useChatStore } from "./chat-store";

afterEach(() => {
  useChatStore.setState({
    mode: "chip",
    activeSessionId: null,
    runtimeMetaBySessionId: {},
  });
  localStorage.clear();
});

describe("chat-store — persisted shell state", () => {
  it("defaults to the chip (normal) input state", () => {
    expect(useChatStore.getState().mode).toBe("chip");
  });

  it("persists the visible shell preference but not high-frequency runtime meta", () => {
    useChatStore.getState().setMode("expanded");
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
    expect(raw).toContain("expanded");
    expect(raw).toContain("cht_1");
    expect(raw).not.toContain("hello");
    expect(raw).not.toContain("runtimeMetaBySessionId");
  });

  it("tracks per-session auto-dispatch but never persists it (reload defaults off)", () => {
    useChatStore.getState().setAutoDispatch("cht_1", true);
    expect(useChatStore.getState().autoDispatchBySessionId.cht_1).toBe(true);
    // independent per session
    expect(useChatStore.getState().autoDispatchBySessionId.cht_2).toBeUndefined();
    const raw = localStorage.getItem("muzero-chat-ui") ?? "";
    expect(raw).not.toContain("autoDispatch");
  });

  it("migrates the retired four-form modes to the dock-entry states", () => {
    expect(migrateChatUiState({ mode: "fab", dockSide: "right" }, 0)).toMatchObject({
      mode: "icon",
    });
    expect(migrateChatUiState({ mode: "bar" }, 0)).toMatchObject({ mode: "chip" });
    expect(migrateChatUiState({ mode: "dock" }, 0)).toMatchObject({ mode: "expanded" });
    expect(migrateChatUiState({ mode: "fullscreen" }, 0)).toMatchObject({ mode: "expanded" });
  });

  it("migration drops dockSide and keeps the active session id", () => {
    const migrated = migrateChatUiState(
      { mode: "dock", dockSide: "left", activeSessionId: "cht_9" },
      0,
    ) as Record<string, unknown>;
    expect(migrated.dockSide).toBeUndefined();
    expect(migrated.activeSessionId).toBe("cht_9");
  });

  it("migration passes current-version state through and defaults unknown modes to chip", () => {
    expect(migrateChatUiState({ mode: "icon" }, 1)).toMatchObject({ mode: "icon" });
    expect(migrateChatUiState({ mode: "bogus" }, 0)).toMatchObject({ mode: "chip" });
  });

  it("defaults HITL approval to ask and persists the auto opt-in", () => {
    expect(useChatStore.getState().approvalMode).toBe("ask");
    useChatStore.getState().setApprovalMode("auto");
    expect(localStorage.getItem("muzero-chat-ui")).toContain("auto");
  });
});
