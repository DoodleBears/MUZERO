/**
 * Portable keymap import / export (PRD Phase 5). Pure serialize/parse over the
 * user's override map; parsing runs the same `sanitizeOverrides` the persistence
 * layer uses, so an imported file can never inject unknown ids, protected-action
 * overrides, or malformed gestures.
 */

import { type ShortcutOverrides, sanitizeOverrides } from "./engine";
import type { Platform } from "./registry";

/** Versioned wrapper so future formats can be detected and migrated. */
export const KEYMAP_SCHEMA = "muzero-shortcuts-v2";
const LEGACY_KEYMAP_SCHEMA = "muzero-shortcuts-v1";

export interface KeymapFile {
  schema: typeof KEYMAP_SCHEMA;
  overrides: ShortcutOverrides;
}

/** Serialize the user's overrides as pretty, versioned keymap JSON. */
export function serializeKeymap(overrides: ShortcutOverrides | undefined): string {
  const file: KeymapFile = { schema: KEYMAP_SCHEMA, overrides: overrides ?? {} };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse + validate an imported keymap. Returns the SANITIZED overrides (unknown
 * ids / protected actions / malformed gestures dropped), or null when the input
 * isn't a v1 keymap file (bad JSON, wrong/absent schema).
 */
export function parseKeymap(json: string, platform: Platform): ShortcutOverrides | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const schema = (data as { schema?: unknown }).schema;
  if (schema !== KEYMAP_SCHEMA && schema !== LEGACY_KEYMAP_SCHEMA) return null;
  return sanitizeOverrides((data as { overrides?: unknown }).overrides, platform);
}
