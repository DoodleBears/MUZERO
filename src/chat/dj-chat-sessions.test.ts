import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { AppSettings, ChatSession } from "@/db/types";
import {
  branchChatSession,
  createChatSession,
  enqueueChatPrompt,
  getChatSession,
  listChatSessions,
  parseChatMessages,
  parseQueuedPrompts,
  renameChatSession,
  reorderQueuedPrompts,
  saveChatSessionSnapshot,
  searchChatSessions,
  setChatContextStartIndex,
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

  it("derives an automatic title from the first persisted user message for empty sessions", async () => {
    const session = await createChatSession({}, db);

    await saveChatSessionSnapshot(
      {
        sessionId: session.id,
        messages: [
          {
            id: "u1",
            role: "user",
            parts: [{ type: "text", text: "make a foggy drum and bass set" }],
          },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "on it" }] },
        ],
      },
      db,
    );

    expect((await getChatSession(session.id, db))?.title).toBe("make a foggy drum and bass set");
  });

  it("keeps manual titles and existing messages when saving an empty stale snapshot", async () => {
    const messages: DjChatUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "keep this turn" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "kept" }] },
    ];
    const session = await createChatSession({ title: "Manual title", messages }, db);

    await saveChatSessionSnapshot({ sessionId: session.id, messages: [] }, db);

    const reloaded = await getChatSession(session.id, db);
    expect(reloaded?.title).toBe("Manual title");
    expect(JSON.parse(reloaded?.messagesJson ?? "null")).toEqual(messages);
  });

  it("searches titles and user messages, not assistant-only text", async () => {
    await createChatSession(
      {
        title: "Rain set",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "make it jazzy" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "secret synthwave" }] },
        ],
      },
      db,
    );
    await createChatSession({ title: "Workout", firstUserText: "gym drums" }, db);

    expect((await searchChatSessions("rain", db)).map((row) => row.title)).toEqual(["Rain set"]);
    expect((await searchChatSessions("jazzy", db)).map((row) => row.title)).toEqual(["Rain set"]);
    expect(await searchChatSessions("synthwave", db)).toEqual([]);
  });

  it("branches a session by deep-copying messages through the fork index", async () => {
    const parent = await createChatSession(
      {
        title: "Parent",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "one" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
          { id: "u2", role: "user", parts: [{ type: "text", text: "three" }] },
        ],
      },
      db,
    );

    const branch = await branchChatSession({ parentSessionId: parent.id, forkedFromIndex: 1 }, db);
    expect(branch.id).not.toBe(parent.id);
    expect(branch.parentSessionId).toBe(parent.id);
    expect(branch.forkedFromIndex).toBe(1);
    expect(JSON.parse(branch.messagesJson)).toEqual([
      { id: "u1", role: "user", parts: [{ type: "text", text: "one" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
    ]);

    await saveChatSessionSnapshot(
      {
        sessionId: branch.id,
        messages: [{ id: "branch-only", role: "user", parts: [{ type: "text", text: "fork" }] }],
      },
      db,
    );
    expect(parseChatMessages((await getChatSession(parent.id, db))?.messagesJson)).toHaveLength(3);
  });

  it("persists queued prompts as session-scoped durable drafts and supports reorder", async () => {
    const session = await createChatSession({ firstUserText: "queue ideas" }, db);

    const first = await enqueueChatPrompt(
      { sessionId: session.id, composerRaw: "make it darker", now: () => 10 },
      db,
    );
    const second = await enqueueChatPrompt(
      { sessionId: session.id, composerRaw: "then add hand drums", now: () => 20 },
      db,
    );
    await enqueueChatPrompt({ sessionId: session.id, composerRaw: "   " }, db);
    if (!first || !second) throw new Error("Expected non-empty prompts to enqueue");

    const saved = await getChatSession(session.id, db);
    expect(
      parseQueuedPrompts(saved?.queuedPromptsJson).map((prompt) => prompt.composerRaw),
    ).toEqual(["make it darker", "then add hand drums"]);
    expect(first.id).toMatch(/^cqp_/);
    expect(second.createdAt).toBe(20);

    await reorderQueuedPrompts({ sessionId: session.id, promptIds: [second.id, first.id] }, db);
    expect(
      parseQueuedPrompts((await getChatSession(session.id, db))?.queuedPromptsJson).map(
        (prompt) => prompt.id,
      ),
    ).toEqual([second.id, first.id]);
  });

  it("persists a context start index without trimming visible messages", async () => {
    const session = await createChatSession(
      {
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "one" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
          { id: "u2", role: "user", parts: [{ type: "text", text: "three" }] },
        ],
      },
      db,
    );

    await setChatContextStartIndex({ sessionId: session.id, contextStartIndex: 2 }, db);

    const saved = await getChatSession(session.id, db);
    expect(saved?.contextStartIndex).toBe(2);
    expect(parseChatMessages(saved?.messagesJson)).toHaveLength(3);
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
