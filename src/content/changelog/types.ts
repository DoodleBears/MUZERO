/**
 * Changelog data model. Each release is a type-checked TS module under
 * `releases/<version>.ts` (not markdown) so the compiler enforces every item has
 * a valid area/category/platform enum + an English title. Loaded at build time
 * via import.meta.glob (see index.ts). i18n: en is required, zh/ja/ko fall back
 * to en. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §3.1.
 */

/** The KIND of change — drives the colored icon chip. Render order is fixed below. */
export type ChangelogCategory = "highlight" | "feature" | "improvement" | "fix" | "breaking";

/** The MUZERO feature AREA — the prominent chip the user scans first. */
export type ChangelogArea =
  | "dj"
  | "player"
  | "library"
  | "sets"
  | "memory"
  | "lyrics"
  | "visualizer"
  | "search"
  | "streaming"
  | "sync"
  | "settings"
  | "app";

/** Which shell a change affects (§2.5 renderer-vs-native split). */
export type ChangelogPlatform = "web" | "desktop" | "all";

export type ChangelogLocale = "en" | "zh" | "ja" | "ko";

/** en is required; the other locales are optional and fall back to en at render. */
export type LocalizedRequired = { en: string } & Partial<Record<ChangelogLocale, string>>;
export type LocalizedOptional = Partial<Record<ChangelogLocale, string>>;

export interface ChangelogItem {
  area: ChangelogArea;
  category: ChangelogCategory;
  platform: ChangelogPlatform;
  title: LocalizedRequired;
  description?: LocalizedOptional;
}

export interface ChangelogRelease {
  /** semver — MUST equal the filename and package.json at the release commit. */
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  title: LocalizedOptional;
  summary?: LocalizedOptional;
  items: ChangelogItem[];
}

/** Fixed render order within a release section. */
export const CHANGELOG_CATEGORY_ORDER: readonly ChangelogCategory[] = [
  "highlight",
  "feature",
  "improvement",
  "fix",
  "breaking",
];

export const CHANGELOG_CATEGORIES: readonly ChangelogCategory[] = CHANGELOG_CATEGORY_ORDER;

export const CHANGELOG_AREAS: readonly ChangelogArea[] = [
  "dj",
  "player",
  "library",
  "sets",
  "memory",
  "lyrics",
  "visualizer",
  "search",
  "streaming",
  "sync",
  "settings",
  "app",
];

export const CHANGELOG_PLATFORMS: readonly ChangelogPlatform[] = ["web", "desktop", "all"];

export const CHANGELOG_LOCALES: readonly ChangelogLocale[] = ["en", "zh", "ja", "ko"];
