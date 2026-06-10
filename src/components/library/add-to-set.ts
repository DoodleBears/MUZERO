import type { DjSession } from "@/db/types";

type SetOption = Pick<DjSession, "id" | "name">;

/**
 * Candidate sets for a batch "add to set" picker: every set except the one you're
 * already in, plus whether to offer creating a new set from the typed name (only
 * for a non-empty name that doesn't already match a set, case-insensitive). Pure so
 * the exclude / create-offer logic is unit-tested apart from the Popover UI.
 */
export function addToSetCandidates<T extends SetOption>(
  sessions: readonly T[],
  excludeSetId: string | undefined,
  query: string,
): { sets: T[]; offerCreate: boolean } {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const nameExists = sessions.some((s) => s.name.trim().toLowerCase() === lower);
  return {
    sets: sessions.filter((s) => s.id !== excludeSetId),
    offerCreate: trimmed.length > 0 && !nameExists,
  };
}
