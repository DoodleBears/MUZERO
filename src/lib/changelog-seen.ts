/**
 * "What's New" seen-tracking. Pure decision logic + thin localStorage helpers.
 * Records ONLY what the user has acknowledged — never gates any feature (hard
 * rule #3, no hidden flags). See
 * docs/prd/20260611-muzero-release-pipeline-changelog-prd §3.2/§3.3.
 */

import type { ChangelogRelease } from "@/content/changelog/types";
import { compareSemver, isNewerVersion } from "@/lib/compare-semver";

const LAST_SEEN_KEY = "muzero:changelog:lastSeenVersion";
const LAST_SHOWN_KEY = "muzero:changelog:lastShownAt";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private-mode / non-DOM shell: treat as unset
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private-mode / non-DOM shell: best-effort, ignore
  }
}

export function getLastSeenVersion(): string | null {
  return safeGet(LAST_SEEN_KEY);
}

export function setLastSeenVersion(version: string): void {
  safeSet(LAST_SEEN_KEY, version);
}

export function recordChangelogShownAt(isoTimestamp: string): void {
  safeSet(LAST_SHOWN_KEY, isoTimestamp);
}

/** Newest version among the releases, or null if there are none. */
export function latestOf(releases: ChangelogRelease[]): string | null {
  if (releases.length === 0) return null;
  return releases.reduce(
    (max, r) => (compareSemver(r.version, max) > 0 ? r.version : max),
    releases[0].version,
  );
}

export interface AutoOpenDecision {
  /** Whether to auto-open the "What's New" modal now. */
  open: boolean;
  /** Unseen releases, newest-first, to show grouped. */
  unseen: ChangelogRelease[];
  /** Non-null on a first-ever visit: caller persists this as lastSeen (no backlog wall). */
  seedLastSeen: string | null;
}

export function resolveChangelogAutoOpen(
  releases: ChangelogRelease[],
  lastSeen: string | null,
): AutoOpenDecision {
  const latest = latestOf(releases);
  if (!latest) return { open: false, unseen: [], seedLastSeen: null };
  if (!lastSeen) return { open: false, unseen: [], seedLastSeen: latest };
  const unseen = releases
    .filter((r) => isNewerVersion(r.version, lastSeen))
    .sort((a, b) => compareSemver(b.version, a.version));
  return { open: unseen.length > 0, unseen, seedLastSeen: null };
}
