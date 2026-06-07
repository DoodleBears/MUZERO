import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import { newId } from "@/lib/id";
import type { ChatSession, DjChatUIMessage } from "./types";

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
  },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const patch: Partial<ChatSession> = {
    messagesJson: JSON.stringify(input.messages),
    composerDraftRaw: input.composerDraftRaw?.trim() || undefined,
    updatedAt: Date.now(),
  };
  await db.chatSessions.update(input.sessionId, patch);
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
