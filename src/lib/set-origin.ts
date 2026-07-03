/**
 * Classify where a 歌单 (set) came from, for the library's origin filter
 * (voice-DJ PRD §12 Phase 12): AI-made, hand-built, or imported. Prefers the
 * explicit {@link DjSession.origin} stamp; falls back to provenance signals for
 * legacy rows written before the field existed.
 */

import type { DjSession, SetOrigin } from "@/db/types";

export const SET_ORIGINS: SetOrigin[] = ["ai", "human", "imported"];

type SetOriginInput = Pick<
  DjSession,
  "origin" | "seedPrompt" | "streamPlaylistRef" | "cloudSource"
>;

/**
 * `origin` when stamped, else inferred:
 *  - `imported` — bound to an external playlist (`streamPlaylistRef`) or a cloud
 *    drive (`cloudSource`).
 *  - `ai` — has a DJ vibe/seed (`seedPrompt`), i.e. the DJ drives it.
 *  - `human` — otherwise (hand-built / uploaded set).
 * `config.autoExtend` is intentionally NOT a signal — it defaults to true, so it
 * would misclassify plain hand-made sets.
 */
export function resolveSetOrigin(session: SetOriginInput): SetOrigin {
  if (session.origin) return session.origin;
  if (session.streamPlaylistRef || session.cloudSource) return "imported";
  if ((session.seedPrompt?.trim().length ?? 0) > 0) return "ai";
  return "human";
}

/** Keep only sets matching `filter`; `"all"` (or undefined) passes everything. */
export function filterSetsByOrigin<T extends SetOriginInput>(
  sessions: readonly T[],
  filter: SetOrigin | "all" | undefined,
): T[] {
  if (!filter || filter === "all") return [...sessions];
  return sessions.filter((s) => resolveSetOrigin(s) === filter);
}
