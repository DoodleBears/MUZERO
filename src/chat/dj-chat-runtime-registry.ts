import { useSyncExternalStore } from "react";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { DjChatRuntimeActor, type DjChatRuntimeActorOptions } from "./dj-chat-runtime-actor";
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
