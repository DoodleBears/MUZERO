import { getAppFetch } from "@/lib/platform";
import { r2PresenceIndexSchema } from "./r2-manifest-schema";
import { type R2Presence, r2PresenceSchema } from "./r2-presence";
import type { SyncFetch } from "./r2-subscription";
import { resolveRemoteObjectUrl } from "./r2-url";

/**
 * Read side of currently-playing presence (PRD §3.9 / §5.5). Reads the
 * owner-maintained `presence/index.json` discovery list, then fetches each
 * referenced per-device `presence/devices/<id>.json` object. Presence is
 * best-effort: a missing index, missing device object, or schema mismatch is
 * skipped rather than thrown, so a partially-published library still renders.
 * Defaults its fetch to `getAppFetch()` so browser/Tauri/Electron share one path.
 */
const DEFAULT_PRESENCE_INDEX_PATH = "presence/index.json";

export interface ReadRemotePresenceInput {
  baseUrl: string;
  /** Manifest `presenceIndex`, if it points somewhere other than the default. */
  presenceIndexPath?: string;
}

export interface ReadRemotePresenceOptions {
  fetcher?: SyncFetch;
}

export async function readRemotePresence(
  input: ReadRemotePresenceInput,
  options: ReadRemotePresenceOptions = {},
): Promise<R2Presence[]> {
  const fetcher = options.fetcher ?? (await getAppFetch());
  const indexUrl = resolveRemoteObjectUrl(
    input.baseUrl,
    input.presenceIndexPath ?? DEFAULT_PRESENCE_INDEX_PATH,
  );

  const indexRaw = await fetchJsonOrNull(indexUrl, fetcher);
  if (indexRaw === null) return [];
  const parsedIndex = r2PresenceIndexSchema.safeParse(indexRaw);
  if (!parsedIndex.success) return [];

  const rows: R2Presence[] = [];
  for (const entry of parsedIndex.data.devices) {
    const url = resolveRemoteObjectUrl(input.baseUrl, entry.presence);
    const raw = await fetchJsonOrNull(url, fetcher);
    if (raw === null) continue;
    const parsed = r2PresenceSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
  }
  return rows;
}

async function fetchJsonOrNull(url: string, fetcher: SyncFetch): Promise<unknown | null> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
