/**
 * Build-time changelog — reuse the desktop app's changelog as the single source
 * of truth. Each `src/content/changelog/releases/<v>.ts` is a self-contained TS
 * module (it only imports its sibling `../types`), so we can glob them straight
 * from the app tree without the app's `@/` alias or its index.ts (which depends
 * on `@/lib/compare-semver`). Vite compiles + bundles the data at build time.
 *
 * Path: this file is packages/site/src/lib/changelog.ts → four levels up is the
 * repo root, then into the app's src/.
 */
import type {
  ChangelogLocale,
  ChangelogRelease,
} from "../../../../src/content/changelog/types";

const modules = import.meta.glob<ChangelogRelease>(
  "../../../../src/content/changelog/releases/*.ts",
  { eager: true, import: "default" },
);

function parts(v: string): [number, number, number, string] {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) return [0, 0, 0, ""];
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
}

/** Newest-first; a final release ranks above its own prerelease. */
function cmpDesc(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return (pb[i] as number) - (pa[i] as number);
  }
  if (pa[3] === pb[3]) return 0;
  if (!pa[3]) return -1; // a is final → newer
  if (!pb[3]) return 1;
  return pa[3] < pb[3] ? -1 : 1;
}

/** All releases, newest-first. */
export const changelog: ChangelogRelease[] = Object.values(modules).sort((a, b) =>
  cmpDesc(a.version, b.version),
);

export const LOCALES = ["en", "zh", "ja", "ko"] as const;

export const LOCALE_LABEL: Record<ChangelogLocale, string> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
  ko: "한국어",
};

/** Short chip label for the switcher. */
export const LOCALE_SHORT: Record<ChangelogLocale, string> = {
  en: "EN",
  zh: "中",
  ja: "あ",
  ko: "한",
};

/** Resolve a localized string with en fallback (mirrors the app's localize()). */
export function localize(
  field: Partial<Record<ChangelogLocale, string>> | undefined,
  locale: ChangelogLocale,
): string {
  if (!field) return "";
  return field[locale] ?? field.en ?? "";
}

export type { ChangelogLocale, ChangelogRelease };
