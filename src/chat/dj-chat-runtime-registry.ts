import { useSyncExternalStore } from "react";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import { DjChatRuntimeActor, type DjChatRuntimeActorOptions } from "./dj-chat-runtime-actor";
import { createChatSession, getChatSession } from "./dj-chat-sessions";
import type { DjChatRuntimeSnapshot } from "./types";

const actors = new Map<string, DjChatRuntimeActor>();

export function getOrCreateDjChatRuntimeActor(
  sessionId: string,
  options: DjChatRuntimeActorOptions = {},
): DjChatRuntimeActor {
  const existing = actors.get(sessionId);
  if (existing) return existing;
  const actor = new DjChatRuntimeActor(sessionId, options);
  actors.set(sessionId, actor);
  return actor;
}

export function getDjChatRuntimeActor(sessionId: string): DjChatRuntimeActor | undefined {
  return actors.get(sessionId);
}

/**
 * Resolve the actor for the CURRENT active chat session (the one the Chat panel
 * shows, `lastChatSessionId`), lazily creating a normal session when there is
 * none. Voice input feeds this so it continues the same conversation rather than
 * opening a dedicated thread (voice-DJ PRD Q4).
 */
export async function getActiveDjChatRuntimeActor(
  db: MuzeroDB = defaultDb,
): Promise<DjChatRuntimeActor> {
  const settings = await getSettings(db);
  let sessionId = settings.lastChatSessionId;
  if (sessionId && !(await getChatSession(sessionId, db))) sessionId = undefined;
  if (!sessionId) sessionId = (await createChatSession({}, db)).id;
  return getOrCreateDjChatRuntimeActor(sessionId, { db });
}

export function clearDjChatRuntimeActors(): void {
  for (const actor of actors.values()) actor.dispose();
  actors.clear();
}

export function useDjChatRuntimeSnapshot(
  sessionId: string | null,
  db: MuzeroDB = defaultDb,
): DjChatRuntimeSnapshot | undefined {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!sessionId) return () => {};
      const actor = getOrCreateDjChatRuntimeActor(sessionId, { db });
      return actor.subscribe(onStoreChange);
    },
    () => (sessionId ? getOrCreateDjChatRuntimeActor(sessionId, { db }).getSnapshot() : undefined),
    () => undefined,
  );
}
