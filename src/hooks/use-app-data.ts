import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import { type AppSettings, DEFAULT_SETTINGS, type DjSession } from "@/db/types";

/** Reactive app settings (singleton). Falls back to defaults before first write. */
export function useSettings(): AppSettings {
  return useLiveQuery(() => getSettings(db), [], DEFAULT_SETTINGS);
}

/** Reactive list of DJ sessions, newest first. */
export function useSessions(): DjSession[] {
  return useLiveQuery(() => db.sessions.orderBy("updatedAt").reverse().toArray(), [], []);
}

/** Reactive single session. */
export function useSession(id: string | null): DjSession | undefined {
  return useLiveQuery(async () => (id ? db.sessions.get(id) : undefined), [id], undefined);
}
