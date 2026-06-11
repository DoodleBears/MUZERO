/**
 * Build-time changelog loader. Every `releases/<version>.ts` module is eagerly
 * globbed by Vite, sorted newest-first with the prerelease-aware comparator, and
 * exposed as `changelog` + `latestVersion`. No network, no database — pure
 * bundled data. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §3.1.
 */
import { compareSemver } from "@/lib/compare-semver";
import type {
  ChangelogLocale,
  ChangelogRelease,
  LocalizedOptional,
  LocalizedRequired,
} from "./types";

const modules = import.meta.glob<ChangelogRelease>("./releases/*.ts", {
  eager: true,
  import: "default",
});

/** All releases, newest-first. */
export const changelog: ChangelogRelease[] = Object.values(modules).sort((a, b) =>
  compareSemver(b.version, a.version),
);

/** The newest release version (or 0.0.0 if somehow none are present). */
export const latestVersion: string = changelog[0]?.version ?? "0.0.0";

/** Resolve a localized string with en fallback for missing locales. */
export function localize(
  field: LocalizedRequired | LocalizedOptional | undefined,
  locale: ChangelogLocale,
): string {
  if (!field) return "";
  return field[locale] ?? field.en ?? "";
}
