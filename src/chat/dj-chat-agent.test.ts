import type { ChatTransport } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { createDjChatTransport, type DjChatModelResolver } from "./dj-chat-agent";
import type { DjChatUIMessage } from "./types";

let db: MuzeroDB;
let dbName: string;

afterEach(async () => {
  db?.close();
  if (!dbName) return;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("createDjChatTransport", () => {
  it("passes the active chat session id to the model resolver", async () => {
    dbName = `muzero-chat-agent-${Math.random().toString(36).slice(2)}`;
    db = new MuzeroDB(dbName);
    let resolvedInput: Parameters<DjChatModelResolver>[0] | undefined;
    const transport = createDjChatTransport({
      db,
      resolveModel: async (input) => {
        resolvedInput = input;
        throw new Error(`session:${input.sessionId}`);
      },
    });

    await expect(
      transport.sendMessages({
        chatId: "cht_active",
        abortSignal: undefined,
        messageId: undefined,
        messages: [],
        trigger: "submit-message",
      } satisfies Parameters<ChatTransport<DjChatUIMessage>["sendMessages"]>[0]),
    ).rejects.toThrow("session:cht_active");

    expect(resolvedInput?.db).toBe(db);
    expect(resolvedInput?.sessionId).toBe("cht_active");
  });
});
