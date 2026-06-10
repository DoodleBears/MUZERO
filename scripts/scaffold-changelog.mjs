#!/usr/bin/env node
/**
 * Generate an empty `releases/<version>.ts` changelog skeleton (all 4 locales
 * stubbed; en is the type-required one). Idempotent — never overwrites an
 * existing file. Invoked by bump-version.mjs after a bump, or standalone.
 *
 * Usage: node scripts/scaffold-changelog.mjs [version]   (defaults to package.json version)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES_DIR = join(ROOT, "src/content/changelog/releases");

/** Pure: the skeleton file contents for a version. */
export function changelogSkeleton(version) {
  return `import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "${version}",
  date: "TODO-YYYY-MM-DD",
  title: { en: "", zh: "", ja: "", ko: "" },
  summary: { en: "", zh: "", ja: "", ko: "" },
  items: [
    {
      area: "app",
      category: "feature",
      platform: "all",
      title: { en: "", zh: "", ja: "", ko: "" },
      description: { en: "", zh: "", ja: "", ko: "" },
    },
  ],
};

export default release;
`;
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

function main() {
  const version = process.argv[2] ?? readPackageVersion();
  const file = join(RELEASES_DIR, `${version}.ts`);
  if (existsSync(file)) {
    process.stdout.write(`changelog releases/${version}.ts already exists — skipping\n`);
    return;
  }
  writeFileSync(file, changelogSkeleton(version));
  process.stdout.write(
    `Scaffolded releases/${version}.ts — fill in the title/summary/items (all 4 locales).\n`,
  );
}

if (process.argv[1]?.endsWith("scaffold-changelog.mjs")) {
  main();
}
