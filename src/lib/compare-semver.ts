/**
 * Prerelease-aware semver comparison — the single source of version-ordering
 * truth shared by the changelog (newest-first sort + unseen-set computation) and
 * the desktop update feed compare. A plain `localeCompare(numeric)` mis-orders
 * prerelease tags (`0.8.0-beta.1` must sort BELOW `0.8.0`), so we follow the
 * semver §11 precedence rules instead. See
 * `docs/prd/20260611-muzero-release-pipeline-changelog-prd`.
 */

export interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers; numerics kept as numbers. */
  prerelease: ReadonlyArray<string | number>;
}

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(version: string): ParsedSemver {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid semver: "${version}"`);
  }
  const [, major, minor, patch, pre] = match;
  const prerelease = pre ? pre.split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [];
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease,
  };
}

function cmpNum(a: number, b: number): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compare two prerelease identifier lists per semver §11.4:
 * - a version WITH prerelease has lower precedence than one WITHOUT,
 * - numeric identifiers compare numerically and rank below alphanumeric ones,
 * - a larger set of identifiers wins when all preceding ones are equal.
 */
function comparePrerelease(
  a: ReadonlyArray<string | number>,
  b: ReadonlyArray<string | number>,
): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // release > prerelease
  if (b.length === 0) return -1; // prerelease < release

  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === y) continue;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) return cmpNum(x, y);
    if (xNum) return -1; // numeric < alphanumeric
    if (yNum) return 1;
    return x < y ? -1 : 1; // both strings, lexical ASCII
  }
  return cmpNum(a.length, b.length);
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  return (
    cmpNum(pa.major, pb.major) ||
    cmpNum(pa.minor, pb.minor) ||
    cmpNum(pa.patch, pb.patch) ||
    comparePrerelease(pa.prerelease, pb.prerelease)
  );
}

/** True when `candidate` outranks `base`. A null/empty base = first-ever install → everything is newer. */
export function isNewerVersion(candidate: string, base: string | null | undefined): boolean {
  if (!base) return true;
  return compareSemver(candidate, base) > 0;
}
