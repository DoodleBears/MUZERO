import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import { newId } from "@/lib/id";
import type { ChatSession, DjChatQueuedPrompt, DjChatUIMessage } from "./types";

const UNTITLED_CHAT = "New DJ chat";
const TITLE_LIMIT = 48;

export function deriveChatTitle(text: string | undefined): string {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return UNTITLED_CHAT;
  return normalized.length > TITLE_LIMIT ? `${normalized.slice(0, TITLE_LIMIT - 1)}…` : normalized;
}

export function parseChatMessages(messagesJson: string | undefined): DjChatUIMessage[] {
  if (!messagesJson) return [];
  try {
    const parsed = JSON.parse(messagesJson);
    return Array.isArray(parsed) ? (parsed as DjChatUIMessage[]) : [];
  } catch {
    return [];
  }
}

export function parseQueuedPrompts(queuedPromptsJson: string | undefined): DjChatQueuedPrompt[] {
  if (!queuedPromptsJson) return [];
  try {
    const parsed = JSON.parse(queuedPromptsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((prompt) => {
      if (
        typeof prompt !== "object" ||
        prompt === null ||
        typeof prompt.id !== "string" ||
        typeof prompt.composerRaw !== "string" ||
        typeof prompt.createdAt !== "number"
      ) {
        return [];
      }
      const composerRaw = prompt.composerRaw.trim();
      return composerRaw ? [{ id: prompt.id, composerRaw, createdAt: prompt.createdAt }] : [];
    });
  } catch {
    return [];
  }
}

export async function createChatSession(
  input: {
    firstUserText?: string;
    messages?: DjChatUIMessage[];
    title?: string;
  } = {},
  db: MuzeroDB = defaultDb,
): Promise<ChatSession> {
  const now = Date.now();
  const session: ChatSession = {
    id: newId("cht"),
    title: input.title?.trim() || deriveChatTitle(input.firstUserText),
    createdAt: now,
    updatedAt: now,
    messagesJson: JSON.stringify(input.messages ?? []),
  };
  await db.chatSessions.put(session);
  await saveSettings({ lastChatSessionId: session.id }, db);
  return session;
}

export function getChatSession(
  id: string,
  db: MuzeroDB = defaultDb,
): Promise<ChatSession | undefined> {
  return db.chatSessions.get(id);
}

export function listChatSessions(db: MuzeroDB = defaultDb): Promise<ChatSession[]> {
  return db.chatSessions.orderBy("updatedAt").reverse().toArray();
}

export async function searchChatSessions(
  query: string,
  db: MuzeroDB = defaultDb,
): Promise<ChatSession[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return listChatSessions(db);
  const sessions = await listChatSessions(db);
  return sessions.filter((session) => {
    if (session.title.toLowerCase().includes(needle)) return true;
    return parseChatMessages(session.messagesJson).some(
      (message) =>
        message.role === "user" &&
        message.parts.some(
          (part) => part.type === "text" && part.text.toLowerCase().includes(needle),
        ),
    );
  });
}

export async function branchChatSession(
  input: { parentSessionId: string; forkedFromIndex: number; title?: string },
  db: MuzeroDB = defaultDb,
): Promise<ChatSession> {
  const parent = await getChatSession(input.parentSessionId, db);
  if (!parent) throw new Error(`Chat session ${input.parentSessionId} not found`);
  const parentMessages = parseChatMessages(parent.messagesJson);
  const forkedFromIndex = Math.min(
    Math.max(0, input.forkedFromIndex),
    Math.max(0, parentMessages.length - 1),
  );
  const messages = structuredClone(parentMessages.slice(0, forkedFromIndex + 1));
  const now = Date.now();
  const branch: ChatSession = {
    id: newId("cht"),
    title: input.title?.trim() || `${parent.title} fork`,
    createdAt: now,
    updatedAt: now,
    messagesJson: JSON.stringify(messages),
    parentSessionId: parent.id,
    forkedFromIndex,
  };
  await db.chatSessions.put(branch);
  await saveSettings({ lastChatSessionId: branch.id }, db);
  return branch;
}

export async function saveChatSessionSnapshot(
  input: {
    sessionId: string;
    messages: DjChatUIMessage[];
    composerDraftRaw?: string;
    queuedPrompts?: DjChatQueuedPrompt[];
    contextStartIndex?: number;
  },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const current = await getChatSession(input.sessionId, db);
  const currentMessages = parseChatMessages(current?.messagesJson);
  const shouldKeepExistingMessages = input.messages.length === 0 && currentMessages.length > 0;
  const patch: Partial<ChatSession> = {
    messagesJson: JSON.stringify(shouldKeepExistingMessages ? currentMessages : input.messages),
    composerDraftRaw: input.composerDraftRaw?.trim() || undefined,
    updatedAt: Date.now(),
  };
  if (input.queuedPrompts) {
    patch.queuedPromptsJson = JSON.stringify(input.queuedPrompts);
  }
  if (input.contextStartIndex !== undefined) {
    patch.contextStartIndex = sanitizeContextStartIndex(input.contextStartIndex);
  }
  if (current?.title === UNTITLED_CHAT) {
    patch.title = deriveChatTitle(
      firstUserText(shouldKeepExistingMessages ? currentMessages : input.messages),
    );
  }
  await db.chatSessions.update(input.sessionId, patch);
}

export async function enqueueChatPrompt(
  input: { sessionId: string; composerRaw: string; now?: () => number },
  db: MuzeroDB = defaultDb,
): Promise<DjChatQueuedPrompt | undefined> {
  const composerRaw = input.composerRaw.trim();
  if (!composerRaw) return undefined;
  const session = await getChatSession(input.sessionId, db);
  if (!session) throw new Error(`Chat session ${input.sessionId} not found`);
  const prompt: DjChatQueuedPrompt = {
    id: newId("cqp"),
    composerRaw,
    createdAt: input.now?.() ?? Date.now(),
  };
  const queuedPrompts = [...parseQueuedPrompts(session.queuedPromptsJson), prompt];
  await saveQueuedPrompts(input.sessionId, queuedPrompts, db);
  return prompt;
}

export async function removeQueuedPrompt(
  input: { sessionId: string; promptId: string },
  db: MuzeroDB = defaultDb,
): Promise<DjChatQueuedPrompt | undefined> {
  const session = await getChatSession(input.sessionId, db);
  if (!session) throw new Error(`Chat session ${input.sessionId} not found`);
  const queuedPrompts = parseQueuedPrompts(session.queuedPromptsJson);
  const removed = queuedPrompts.find((prompt) => prompt.id === input.promptId);
  if (!removed) return undefined;
  await saveQueuedPrompts(
    input.sessionId,
    queuedPrompts.filter((prompt) => prompt.id !== input.promptId),
    db,
  );
  return removed;
}

export async function reorderQueuedPrompts(
  input: { sessionId: string; promptIds: string[] },
  db: MuzeroDB = defaultDb,
): Promise<DjChatQueuedPrompt[]> {
  const session = await getChatSession(input.sessionId, db);
  if (!session) throw new Error(`Chat session ${input.sessionId} not found`);
  const queuedPrompts = parseQueuedPrompts(session.queuedPromptsJson);
  const byId = new Map(queuedPrompts.map((prompt) => [prompt.id, prompt]));
  const ordered = input.promptIds.flatMap((id) => {
    const prompt = byId.get(id);
    if (!prompt) return [];
    byId.delete(id);
    return [prompt];
  });
  const next = [...ordered, ...queuedPrompts.filter((prompt) => byId.has(prompt.id))];
  await saveQueuedPrompts(input.sessionId, next, db);
  return next;
}

export async function setChatContextStartIndex(
  input: { sessionId: string; contextStartIndex: number },
  db: MuzeroDB = defaultDb,
): Promise<number> {
  const contextStartIndex = sanitizeContextStartIndex(input.contextStartIndex);
  await db.chatSessions.update(input.sessionId, {
    contextStartIndex,
    updatedAt: Date.now(),
  } satisfies Partial<ChatSession>);
  return contextStartIndex;
}

async function saveQueuedPrompts(
  sessionId: string,
  queuedPrompts: DjChatQueuedPrompt[],
  db: MuzeroDB,
): Promise<void> {
  await db.chatSessions.update(sessionId, {
    queuedPromptsJson: JSON.stringify(queuedPrompts),
    updatedAt: Date.now(),
  } satisfies Partial<ChatSession>);
}

function sanitizeContextStartIndex(contextStartIndex: number): number {
  if (!Number.isFinite(contextStartIndex)) return 0;
  return Math.max(0, Math.floor(contextStartIndex));
}

function firstUserText(messages: DjChatUIMessage[]): string | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return undefined;
}

export async function renameChatSession(
  id: string,
  title: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const clean = title.trim();
  await db.chatSessions.update(id, {
    title: clean || UNTITLED_CHAT,
    updatedAt: Date.now(),
  });
}

export async function deleteChatSession(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.chatSessions.delete(id);
}
