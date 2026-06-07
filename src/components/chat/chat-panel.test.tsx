import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearDjChatRuntimeActors,
  getOrCreateDjChatRuntimeActor,
} from "@/chat/dj-chat-runtime-registry";
import { createChatSession } from "@/chat/dj-chat-sessions";
import type { DjChatUIMessage } from "@/chat/types";
import { MuzeroDB } from "@/db/muzero-db";
import { ChatPanel } from "./chat-panel";
import type { ChatQueueTrayLabels } from "./chat-queue-tray";

class FakeStreamingTransport implements ChatTransport<DjChatUIMessage> {
  sentMessages: DjChatUIMessage[][] = [];

  async sendMessages(
    options: Parameters<ChatTransport<DjChatUIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    this.sentMessages.push([...(options.messages as DjChatUIMessage[])]);
    const chunks: UIMessageChunk[] = [
      { type: "start", messageId: "asst_panel" },
      { type: "text-start", id: "txt_panel" },
      { type: "text-delta", id: "txt_panel", delta: "queued prompt sent" },
      { type: "text-end", id: "txt_panel" },
      { type: "finish", finishReason: "stop" },
    ];
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null;
  }
}

const queueLabels: ChatQueueTrayLabels = {
  autoDispatch: "Auto dispatch",
  delete: "Delete queued prompt",
  dragHandle: "Drag queued prompt",
  empty: "No queued prompts",
  itemPosition: (index, total) => `${index + 1} / ${total}`,
  moveDown: "Move queued prompt down",
  moveUp: "Move queued prompt up",
  send: "Send queued prompt",
  title: "Queued prompts",
};

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-panel-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  clearDjChatRuntimeActors();
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("ChatPanel queued prompt tray", () => {
  it("renders queued prompt details and forwards tray actions to the runtime actor", async () => {
    const session = await createChatSession({ firstUserText: "panel queue" }, db);
    const transport = new FakeStreamingTransport();
    const actor = getOrCreateDjChatRuntimeActor(session.id, { db, transport });
    await actor.ready;

    await act(async () => {
      await actor.queuePrompt("first queued prompt");
      await actor.queuePrompt("second queued prompt");
    });

    render(<ChatPanel db={db} queueLabels={queueLabels} sessionId={session.id} />);

    expect(await screen.findByText("first queued prompt")).toBeInTheDocument();
    expect(screen.getByText("second queued prompt")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Move queued prompt down" })[0]);
    await waitFor(() => {
      expect(actor.getSnapshot().queuedPrompts.map((prompt) => prompt.composerRaw)).toEqual([
        "second queued prompt",
        "first queued prompt",
      ]);
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Delete queued prompt" })[0]);
    await waitFor(() => {
      expect(actor.getSnapshot().queuedPrompts.map((prompt) => prompt.composerRaw)).toEqual([
        "first queued prompt",
      ]);
    });

    const tray = screen.getByRole("region", { name: "Queued prompts" });
    fireEvent.click(within(tray).getByRole("button", { name: "Send queued prompt" }));
    await waitFor(() => {
      expect(actor.getSnapshot().queuedPrompts).toEqual([]);
    });
    await waitFor(() => {
      expect(transport.sentMessages).toHaveLength(1);
    });
    await act(async () => {
      await actor.flush();
    });
  });
});
