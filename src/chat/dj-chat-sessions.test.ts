import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { AppSettings, ChatSession } from "@/db/types";
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  renameChatSession,
  saveChatSessionSnapshot,
} from "./dj-chat-sessions";
import type { DjChatUIMessage } from "./types";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-chat-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("chat session repository", () => {
  it("creates sessions with a stable cht_ id and a title derived from the first user prompt", async () => {
    const session = await createChatSession(
      {
        firstUserText:
          "  make a rainy midnight focus set with brushed drums and soft piano please  ",
      },
      db,
    );

    expect(session.id).toMatch(/^cht_/);
    expect(session.title).toBe("make a rainy midnight focus set with brushed dr…");
    expect(session.title.length).toBeLessThanOrEqual(48);
    expect(session.messagesJson).toBe("[]");
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBe(session.createdAt);
  });

  it("persists full message snapshots and keeps list ordering by updatedAt desc", async () => {
    const older = await createChatSession({ firstUserText: "older" }, db);
    const newer = await createChatSession({ firstUserText: "newer" }, db);
    const messages: DjChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "hey" }] },
    ];

    await saveChatSessionSnapshot({ sessionId: older.id, messages, composerDraftRaw: "draft" }, db);
    await renameChatSession(newer.id, "  renamed  ", db);

    const reloaded = await getChatSession(older.id, db);
    expect(JSON.parse(reloaded?.messagesJson ?? "null")).toEqual(messages);
    expect(reloaded?.composerDraftRaw).toBe("draft");

    const rows = await listChatSessions(db);
    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    expect(rows[0].title).toBe("renamed");
  });
});

describe("v4 → v5 migration adds chatSessions without disturbing existing settings", () => {
  it("opens a v4 database with the new chat table and preserves settings rows", async () => {
    const name = `muzero-mig5-${Math.random().toString(36).slice(2)}`;
    const v4 = new Dexie(name);
    v4.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v4.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v4.version(3).stores({ playQueue: "id" });
    v4.version(4).stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" });
    await v4.open();
    await v4.table("settings").put({
      id: "app",
      llmProvider: "openai",
      llmModel: "gpt-4o-mini",
      musicGenProvider: "mock",
      locale: "en",
      lastSessionId: "ses_previous",
    } satisfies Partial<AppSettings>);
    await v4.close();

    const mz = new MuzeroDB(name);
    try {
      await mz.open();
      await mz.chatSessions.put({
        id: "cht_existing",
        title: "Existing",
        createdAt: 1,
        updatedAt: 1,
        messagesJson: "[]",
      } satisfies ChatSession);
      expect(await mz.chatSessions.count()).toBe(1);
      expect((await mz.settings.get("app"))?.lastSessionId).toBe("ses_previous");
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});
