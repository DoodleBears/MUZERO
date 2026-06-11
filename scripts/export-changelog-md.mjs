#!/usr/bin/env node
/**
 * Render the type-checked changelog (src/content/changelog/releases/*.ts) into a
 * repo-standard CHANGELOG.md (English, Keep-a-Changelog-ish, grouped by category).
 * The TS modules stay the single source of truth; CHANGELOG.md is a generated
 * artifact for GitHub/readers. Run `make changelog-md` after editing a release.
 *
 * The release files only `import type` + `export default {...}`, so esbuild can
 * transform each to JS and we load it via a data: URI (no import.meta.glob, which
 * is Vite-only). See the release PRD §6.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { cmpVersion } from "./publish-release.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES_DIR = join(ROOT, "src/content/changelog/releases");

const CATEGORY_ORDER = ["highlight", "feature", "improvement", "fix", "breaking"];
const CATEGORY_HEADING = {
  highlight: "Highlights",
  feature: "Added",
  improvement: "Changed",
  fix: "Fixed",
  breaking: "Breaking",
};

const en = (field) => (field && field.en) || "";

/** Pure: render an array of releases (newest-first) to a CHANGELOG.md string. */
export function renderChangelogMarkdown(releases) {
  const lines = [
    "# Changelog",
    "",
    "All notable changes to MUZERO. Generated from `src/content/changelog` — do not edit by hand (`make changelog-md`).",
    "",
  ];
  for (const release of releases) {
    const title = en(release.title);
    lines.push(`## v${release.version} — ${release.date}${title ? ` · ${title}` : ""}`, "");
    const summary = en(release.summary);
    if (summary) lines.push(summary, "");
    for (const category of CATEGORY_ORDER) {
      const items = release.items.filter((i) => i.category === category);
      if (items.length === 0) continue;
      lines.push(`### ${CATEGORY_HEADING[category]}`);
      for (const item of items) {
        const desc = en(item.description);
        const platform = item.platform !== "all" ? ` _(${item.platform})_` : "";
        lines.push(`- **${item.area}** ${en(item.title)}${desc ? ` — ${desc}` : ""}${platform}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function loadRelease(file) {
  const src = readFileSync(join(RELEASES_DIR, file), "utf8");
  const { code } = await transform(src, { loader: "ts", format: "esm" });
  const mod = await import(`data:text/javascript,${encodeURIComponent(code)}`);
  return mod.default;
}

async function main() {
  const files = readdirSync(RELEASES_DIR).filter((f) => /^\d.*\.ts$/.test(f));
  const releases = (await Promise.all(files.map(loadRelease))).sort((a, b) =>
    cmpVersion(a.version, b.version),
  );
  const md = renderChangelogMarkdown(releases);
  writeFileSync(join(ROOT, "CHANGELOG.md"), md);
  process.stdout.write(`Wrote CHANGELOG.md (${releases.length} releases).\n`);
}

if (process.argv[1]?.endsWith("export-changelog-md.mjs")) {
  await main();
}
