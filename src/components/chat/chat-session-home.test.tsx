import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatSession, DjChatUIMessage } from "@/chat/types";
import { ChatSessionHome, type ChatSessionHomeLabels } from "./chat-session-home";

const labels: ChatSessionHomeLabels = {
  cancel: "Cancel rename",
  delete: "Delete chat",
  empty: "No chats found",
  itemMeta: ({ messageCount, queuedPromptCount }) =>
    `${messageCount} messages / ${queuedPromptCount} queued`,
  open: "Open chat",
  rename: "Rename chat",
  saveRename: "Save chat name",
  searchPlaceholder: "Search chats",
  title: "DJ chat sessions",
  titleInput: "Chat title",
  updatedAt: (updatedAt) => `Updated ${updatedAt}`,
};

function message(id: string, role: "user" | "assistant", text: string): DjChatUIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

function session(input: {
  id: string;
  messages?: DjChatUIMessage[];
  queuedPromptsJson?: string;
  title: string;
  updatedAt: number;
}): ChatSession {
  return {
    createdAt: input.updatedAt - 1,
    id: input.id,
    messagesJson: JSON.stringify(input.messages ?? []),
    queuedPromptsJson: input.queuedPromptsJson,
    title: input.title,
    updatedAt: input.updatedAt,
  };
}

describe("ChatSessionHome", () => {
  it("searches titles and user messages without matching assistant-only text", () => {
    render(
      <ChatSessionHome
        labels={labels}
        sessions={[
          session({
            id: "cht_rain",
            messages: [
              message("u1", "user", "make it jazzy"),
              message("a1", "assistant", "secret synthwave"),
            ],
            title: "Rain set",
            updatedAt: 20,
          }),
          session({
            id: "cht_gym",
            messages: [message("a2", "assistant", "jazzy assistant only")],
            title: "Gym set",
            updatedAt: 10,
          }),
        ]}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "jazzy" } });
    expect(screen.getByText("Rain set")).toBeInTheDocument();
    expect(screen.queryByText("Gym set")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "synthwave" } });
    expect(screen.getByText("No chats found")).toBeInTheDocument();
  });

  it("opens, renames, and deletes sessions through callbacks", () => {
    const onDeleteSession = vi.fn();
    const onOpenSession = vi.fn();
    const onRenameSession = vi.fn();

    render(
      <ChatSessionHome
        labels={labels}
        onDeleteSession={onDeleteSession}
        onOpenSession={onOpenSession}
        onRenameSession={onRenameSession}
        sessions={[
          session({
            id: "cht_focus",
            messages: [message("u1", "user", "focus")],
            queuedPromptsJson: JSON.stringify([
              { id: "cqp_1", composerRaw: "later", createdAt: 1 },
            ]),
            title: "Focus set",
            updatedAt: 30,
          }),
        ]}
      />,
    );

    const row = screen.getByTestId("chat-session-cht_focus");

    fireEvent.click(within(row).getByRole("button", { name: "Open chat" }));
    expect(onOpenSession).toHaveBeenCalledWith("cht_focus");
    expect(within(row).getByText("1 messages / 1 queued")).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "Rename chat" }));
    const titleInput = within(row).getByLabelText("Chat title");
    fireEvent.change(titleInput, { target: { value: "Renamed focus" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save chat name" }));
    expect(onRenameSession).toHaveBeenCalledWith("cht_focus", "Renamed focus");

    fireEvent.click(within(row).getByRole("button", { name: "Delete chat" }));
    expect(onDeleteSession).toHaveBeenCalledWith("cht_focus");
  });
});
