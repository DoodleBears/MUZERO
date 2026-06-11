import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SETTINGS } from "@/db/types";
import { useChatStore } from "@/stores/chat-store";
import { DjChatEntry } from "./dj-chat-entry";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let settings: AppSettings = { ...DEFAULT_SETTINGS };
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => settings,
}));

const sendMessage = vi.fn();
const stop = vi.fn();
const queuePrompt = vi.fn();
vi.mock("@/chat/dj-chat-runtime-registry", () => ({
  getOrCreateDjChatRuntimeActor: () => ({ sendMessage, stop, queuePrompt }),
}));

const createChatSession = vi.fn(async (_input?: unknown) => ({ id: "cht_new" }));
const deleteChatSession = vi.fn(async (_id?: unknown) => undefined);
const renameChatSession = vi.fn(async (_id?: unknown, _title?: unknown) => undefined);
vi.mock(import("@/chat/dj-chat-sessions"), async (importOriginal) => ({
  ...(await importOriginal()),
  createChatSession: ((input?: unknown) => createChatSession(input)) as never,
  deleteChatSession: ((id: string) => deleteChatSession(id)) as never,
  listChatSessions: (async () => [
    { id: "cht_1", title: "Lofi night", createdAt: 1, updatedAt: 2, messagesJson: "[]" },
  ]) as never,
  renameChatSession: ((id: string, title: string) => renameChatSession(id, title)) as never,
}));

vi.mock("./chat-panel", () => ({
  ChatPanel: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="chat-panel">{sessionId}</div>
  ),
}));

function asAvailable() {
  settings = {
    ...DEFAULT_SETTINGS,
    apiKeysByPresetId: { openai: "sk-test" },
    musicGenProvider: "mock",
  };
}

afterEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  sendMessage.mockClear();
  createChatSession.mockClear();
  useChatStore.setState({ mode: "chip", activeSessionId: null, runtimeMetaBySessionId: {} });
  localStorage.clear();
});

describe("DjChatEntry — availability gate", () => {
  it("renders nothing (not even the icon) when LLM + musicgen are unconfigured", () => {
    const { container } = render(<DjChatEntry />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when only the LLM is configured but cloud musicgen lacks a key", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      apiKeysByPresetId: { openai: "sk" },
      musicGenProvider: "cloud",
      musicCloudApiKey: "",
    };
    const { container } = render(<DjChatEntry />);
    expect(container.firstChild).toBeNull();
  });
});

describe("DjChatEntry — three states", () => {
  it("minimize: shows only the round icon and expands to the chip on click", () => {
    asAvailable();
    useChatStore.setState({ mode: "icon" });
    render(<DjChatEntry />);

    expect(screen.queryByPlaceholderText("chat.placeholder")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "chat.open" }));
    expect(useChatStore.getState().mode).toBe("chip");
  });

  it("chip (default): shows the rounded input; the minimize button collapses to the icon", () => {
    asAvailable();
    render(<DjChatEntry />);

    expect(screen.getByPlaceholderText("chat.placeholder")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "chat.minimize" }));
    expect(useChatStore.getState().mode).toBe("icon");
  });

  it("chip: submitting creates a session when none is active and sends to the runtime", async () => {
    asAvailable();
    render(<DjChatEntry />);

    const input = screen.getByPlaceholderText("chat.placeholder");
    fireEvent.change(input, { target: { value: "make a lofi set" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith("make a lofi set"));
    expect(createChatSession).toHaveBeenCalledOnce();
    expect(useChatStore.getState().activeSessionId).toBe("cht_new");
  });

  it("expand: opens the widget hosting the chat panel; Escape collapses back to the chip", async () => {
    asAvailable();
    useChatStore.setState({ activeSessionId: "cht_1" });
    render(<DjChatEntry />);

    fireEvent.click(screen.getByRole("button", { name: "chat.expand" }));
    expect(useChatStore.getState().mode).toBe("expanded");
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toHaveTextContent("cht_1"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useChatStore.getState().mode).toBe("chip");
  });

  it("expand without an active session creates one first", async () => {
    asAvailable();
    render(<DjChatEntry />);

    fireEvent.click(screen.getByRole("button", { name: "chat.expand" }));
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe("cht_new"));
    expect(createChatSession).toHaveBeenCalledOnce();
  });

  it("expanded header Shield toggles the HITL approval mode (ask ↔ auto)", async () => {
    asAvailable();
    useChatStore.setState({ mode: "expanded", activeSessionId: "cht_1" });
    render(<DjChatEntry />);

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "chat.approvalAsk" }));
    expect(useChatStore.getState().approvalMode).toBe("auto");
    fireEvent.click(screen.getByRole("button", { name: "chat.approvalAuto" }));
    expect(useChatStore.getState().approvalMode).toBe("ask");
  });

  it("history view lists sessions and opening one swaps the panel without disposing it", async () => {
    asAvailable();
    useChatStore.setState({ mode: "expanded", activeSessionId: "cht_2" });
    render(<DjChatEntry />);

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "chat.history" }));
    await waitFor(() => expect(screen.getByText("Lofi night")).toBeInTheDocument());
    expect(screen.queryByTestId("chat-panel")).toBeNull();

    fireEvent.click(screen.getByText("Lofi night"));
    await waitFor(() => expect(screen.getByTestId("chat-panel")).toHaveTextContent("cht_1"));
    expect(useChatStore.getState().activeSessionId).toBe("cht_1");
  });

  it("the new-chat header button creates a session and opens it", async () => {
    asAvailable();
    useChatStore.setState({ mode: "expanded", activeSessionId: "cht_1" });
    render(<DjChatEntry />);

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "chat.newSession" }));
    await waitFor(() => expect(useChatStore.getState().activeSessionId).toBe("cht_new"));
    expect(createChatSession).toHaveBeenCalledOnce();
  });

  it("backdrop click collapses the widget", async () => {
    asAvailable();
    useChatStore.setState({ mode: "expanded", activeSessionId: "cht_1" });
    render(<DjChatEntry />);

    await waitFor(() => expect(screen.getByTestId("chat-panel")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("dj-chat-backdrop"));
    expect(useChatStore.getState().mode).toBe("chip");
  });
});
