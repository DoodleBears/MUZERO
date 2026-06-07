import type { ChatTransport, UIMessageChunk } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  clearDjChatRuntimeActors,
  getDjChatRuntimeActor,
  getOrCreateDjChatRuntimeActor,
} from "./dj-chat-runtime-registry";
import { createChatSession, getChatSession, parseQueuedPrompts } from "./dj-chat-sessions";
import type { DjChatUIMessage } from "./types";

class FakeStreamingTransport implements ChatTransport<DjChatUIMessage> {
  private calls = 0;
  sentMessages: DjChatUIMessage[][] = [];

  constructor(private readonly reply: string | string[]) {}

  async sendMessages(
    options: Parameters<ChatTransport<DjChatUIMessage>["sendMessages"]>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    this.sentMessages.push([...(options.messages as DjChatUIMessage[])]);
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
    expect(actor.getSnapshot().messages).toHaveLength(2);

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

  it("keeps concurrent session actors isolated while both stream", async () => {
    const rain = await createChatSession({ firstUserText: "rain" }, db);
    const gym = await createChatSession({ firstUserText: "gym" }, db);
    const rainTransport = new FakeStreamingTransport("rain reply");
    const gymTransport = new FakeStreamingTransport("gym reply");
    const rainActor = getOrCreateDjChatRuntimeActor(rain.id, {
      db,
      transport: rainTransport,
    });
    const gymActor = getOrCreateDjChatRuntimeActor(gym.id, {
      db,
      transport: gymTransport,
    });
    await Promise.all([rainActor.ready, gymActor.ready]);

    await Promise.all([rainActor.sendMessage("rain"), gymActor.sendMessage("gym")]);

    expect(getDjChatRuntimeActor(rain.id)).toBe(rainActor);
    expect(getDjChatRuntimeActor(gym.id)).toBe(gymActor);
    expect(rainActor.getSnapshot().meta.lastAssistantPreview).toBe("rain reply");
    expect(gymActor.getSnapshot().meta.lastAssistantPreview).toBe("gym reply");
    expect(rainTransport.sentMessages[0].at(-1)).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "rain" }],
    });
    expect(gymTransport.sentMessages[0].at(-1)).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "gym" }],
    });

    const savedRain = JSON.parse((await getChatSession(rain.id, db))?.messagesJson ?? "[]");
    const savedGym = JSON.parse((await getChatSession(gym.id, db))?.messagesJson ?? "[]");
    expect(savedRain.map((message: DjChatUIMessage) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(savedGym.map((message: DjChatUIMessage) => message.role)).toEqual(["user", "assistant"]);
  });

  it("persists context compression pointers while keeping old messages visible", async () => {
    const session = await createChatSession(
      {
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "one" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
          { id: "u2", role: "user", parts: [{ type: "text", text: "three" }] },
          { id: "a2", role: "assistant", parts: [{ type: "text", text: "four" }] },
        ],
      },
      db,
    );
    const actor = getOrCreateDjChatRuntimeActor(session.id, {
      db,
      transport: new FakeStreamingTransport("unused"),
    });
    await actor.ready;

    await actor.setContextStartIndex(3);

    expect(actor.getSnapshot().meta.contextStartIndex).toBe(2);
    expect(actor.getSnapshot().messages).toHaveLength(4);
    expect((await getChatSession(session.id, db))?.contextStartIndex).toBe(2);

    clearDjChatRuntimeActors();
    const rebuilt = getOrCreateDjChatRuntimeActor(session.id, {
      db,
      transport: new FakeStreamingTransport("unused"),
    });
    await rebuilt.ready;
    expect(rebuilt.getSnapshot().meta.contextStartIndex).toBe(2);
    expect(rebuilt.getSnapshot().messages.map((message) => message.id)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
  });

  it("keeps queued prompts across actor rebuilds without auto-dispatching them", async () => {
    const session = await createChatSession({ firstUserText: "queue" }, db);
    const transport = new FakeStreamingTransport("queued reply");
    const actor = getOrCreateDjChatRuntimeActor(session.id, { db, transport });
    await actor.ready;

    const queued = await actor.queuePrompt("generate a late-night bridge");
    if (!queued) throw new Error("Expected prompt to enqueue");
    expect(actor.getSnapshot().meta.queuedPromptCount).toBe(1);
    expect(transport.sentMessages).toHaveLength(0);

    clearDjChatRuntimeActors();
    const rebuiltTransport = new FakeStreamingTransport("rebuilt reply");
    const rebuilt = getOrCreateDjChatRuntimeActor(session.id, { db, transport: rebuiltTransport });
    await rebuilt.ready;

    expect(rebuilt.getSnapshot().meta.queuedPromptCount).toBe(1);
    expect(rebuiltTransport.sentMessages).toHaveLength(0);

    await rebuilt.sendQueuedPrompt(queued.id);
    expect(rebuiltTransport.sentMessages).toHaveLength(1);
    expect(rebuiltTransport.sentMessages[0].at(-1)).toMatchObject({
      role: "user",
      metadata: { composerRaw: "generate a late-night bridge" },
    });
    expect(
      parseQueuedPrompts((await getChatSession(session.id, db))?.queuedPromptsJson),
    ).toHaveLength(0);
  });

  it("pauses queued prompt dispatch while a tool approval is pending", async () => {
    const session = await createChatSession(
      {
        firstUserText: "approval",
        messages: [
          {
            id: "asst_pending",
            role: "assistant",
            parts: [
              {
                type: "tool-dj_generate_tracks",
                toolCallId: "call_1",
                state: "approval-requested",
                input: { sessionId: "ses_1", briefs: [] },
                approval: { id: "approval_1" },
              },
            ],
          } as unknown as DjChatUIMessage,
        ],
      },
      db,
    );
    const transport = new FakeStreamingTransport("queued reply");
    const actor = getOrCreateDjChatRuntimeActor(session.id, { db, transport });
    await actor.ready;
    const queued = await actor.queuePrompt("wait until approved");
    if (!queued) throw new Error("Expected prompt to enqueue");

    await expect(actor.sendQueuedPrompt(queued.id)).resolves.toBe(false);

    expect(transport.sentMessages).toHaveLength(0);
    expect(actor.getSnapshot().meta.pendingApprovalCount).toBe(1);
    expect(actor.getSnapshot().meta.queuedPromptCount).toBe(1);
    expect(
      parseQueuedPrompts((await getChatSession(session.id, db))?.queuedPromptsJson),
    ).toHaveLength(1);
  });

  it("interrupts with an immediate marked message instead of adding to the queued prompts", async () => {
    const session = await createChatSession({ firstUserText: "interrupt" }, db);
    const transport = new FakeStreamingTransport("interrupt reply");
    const actor = getOrCreateDjChatRuntimeActor(session.id, { db, transport });
    await actor.ready;

    await actor.queuePrompt("later please");
    await actor.interruptWithMessage("actually switch to broken beat");

    const messages = actor.getSnapshot().messages;
    expect(messages[0]).toMatchObject({
      role: "user",
      metadata: {
        composerRaw: "actually switch to broken beat",
        interruptionMarker: true,
      },
    });
    expect(actor.getSnapshot().meta.queuedPromptCount).toBe(1);
    expect(
      parseQueuedPrompts((await getChatSession(session.id, db))?.queuedPromptsJson),
    ).toHaveLength(1);
  });
});
