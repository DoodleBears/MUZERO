import type { ChatTransport, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  clearDjChatRuntimeActors,
  getOrCreateDjChatRuntimeActor,
} from "./dj-chat-runtime-registry";
import { createChatSession, getChatSession } from "./dj-chat-sessions";
import type { DjChatUIMessage } from "./types";

class FakeStreamingTransport implements ChatTransport<DjChatUIMessage> {
  private calls = 0;

  constructor(private readonly reply: string | string[]) {}

  async sendMessages(): Promise<ReadableStream<UIMessageChunk>> {
    const reply = Array.isArray(this.reply) ? this.reply[this.calls] : this.reply;
    this.calls += 1;
    const chunks: UIMessageChunk[] = [
      { type: "start", messageId: "asst_fake" },
      { type: "text-start", id: "txt_fake" },
      { type: "text-delta", id: "txt_fake", delta: reply.slice(0, 8) },
      { type: "text-delta", id: "txt_fake", delta: reply.slice(8) },
      { type: "text-end", id: "txt_fake" },
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

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-runtime-${Math.random().toString(36).slice(2)}`;
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

describe("DjChatRuntimeActor", () => {
  it("streams a single-session reply, persists messagesJson, and restores history in a rebuilt actor", async () => {
    const session = await createChatSession({ firstUserText: "rainy focus" }, db);
    const actor = getOrCreateDjChatRuntimeActor(session.id, {
      db,
      transport: new FakeStreamingTransport("A rainy focus set is queued in spirit."),
    });

    await actor.ready;
    await actor.sendMessage("rainy focus");

    const saved = await getChatSession(session.id, db);
    const persisted = JSON.parse(saved?.messagesJson ?? "[]") as DjChatUIMessage[];
    expect(persisted).toHaveLength(2);
    expect(persisted[0]).toMatchObject({
      role: "user",
      metadata: { composerRaw: "rainy focus" },
    });
    expect(persisted[1].role).toBe("assistant");
    expect(persisted[1].parts).toContainEqual({
      type: "text",
      text: "A rainy focus set is queued in spirit.",
      state: "done",
    });

    clearDjChatRuntimeActors();
    const rebuilt = getOrCreateDjChatRuntimeActor(session.id, {
      db,
      transport: new FakeStreamingTransport("unused"),
    });
    await rebuilt.ready;
    expect(rebuilt.getSnapshot().messages).toEqual(persisted);
    expect(rebuilt.getSnapshot().meta.status).toBe("idle");
    expect(rebuilt.getSnapshot().meta.lastAssistantPreview).toBe(
      "A rainy focus set is queued in spirit.",
    );
  });

  it("edits a user turn, truncates later messages, and streams a regenerated reply", async () => {
    const session = await createChatSession({ firstUserText: "first" }, db);
    const actor = getOrCreateDjChatRuntimeActor(session.id, {
      db,
      transport: new FakeStreamingTransport(["old reply", "new reply"]),
    });
    await actor.ready;
    await actor.sendMessage("first");
    const userId = actor.getSnapshot().messages[0].id;

    await actor.regenerateUserMessage(userId, "second");

    const messages = actor.getSnapshot().messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: userId,
      role: "user",
      parts: [{ type: "text", text: "second" }],
      metadata: { composerRaw: "second" },
    });
    expect(messages[1].parts).toContainEqual({
      type: "text",
      text: "new reply",
      state: "done",
    });
  });
});
