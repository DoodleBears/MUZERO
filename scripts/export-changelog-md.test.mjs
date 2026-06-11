// @vitest-environment node
// esbuild (used by the loader path) needs a real Node environment.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderChangelogMarkdown } from "./export-changelog-md.mjs";

const ROOT = process.cwd();

const RELEASES = [
  {
    version: "0.7.0",
    date: "2026-06-11",
    title: { en: "Newer" },
    summary: { en: "The newest one." },
    items: [
      { area: "visualizer", category: "highlight", platform: "all", title: { en: "Flow bg" }, description: { en: "Aurora." } },
      { area: "streaming", category: "feature", platform: "desktop", title: { en: "Online sources" } },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-06-10",
    title: { en: "Older" },
    items: [{ area: "lyrics", category: "fix", platform: "all", title: { en: "Lyric fix" } }],
  },
];

describe("renderChangelogMarkdown", () => {
  it("renders a Keep-a-Changelog-style doc grouped by category", () => {
    const md = renderChangelogMarkdown(RELEASES);
    expect(md).toMatch(/^# Changelog/);
    expect(md).toContain("## v0.7.0 — 2026-06-11 · Newer");
    expect(md).toContain("The newest one.");
    expect(md).toContain("### Highlights");
    expect(md).toContain("- **visualizer** Flow bg — Aurora.");
    expect(md).toContain("### Added");
    expect(md).toContain("_(desktop)_"); // platform tag for non-"all"
    expect(md.endsWith("\n")).toBe(true);
  });

  it("orders releases as given (newest-first) and categories in fixed order", () => {
    const md = renderChangelogMarkdown(RELEASES);
    expect(md.indexOf("## v0.7.0")).toBeLessThan(md.indexOf("## v0.6.0"));
    expect(md.indexOf("### Highlights")).toBeLessThan(md.indexOf("### Added"));
  });
});

describe("export-changelog-md.mjs", () => {
  it("generates CHANGELOG.md from the real backfilled releases", () => {
    execFileSync("node", [join(ROOT, "scripts/export-changelog-md.mjs")], { cwd: ROOT });
    const md = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    expect(md).toContain("## v0.7.0");
    expect(md).toContain("## v0.1.0");
    // newest-first
    expect(md.indexOf("## v0.7.0")).toBeLessThan(md.indexOf("## v0.1.0"));
  });
});
