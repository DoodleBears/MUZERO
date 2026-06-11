#!/usr/bin/env node
/**
 * Release gate: fail the build if there is no changelog `releases/<version>.ts`
 * matching the current package.json version. Catches the "forgot to write the
 * changelog" footgun before a release ships with a version the "What's New"
 * modal can't describe. Wired into the `release-*` make targets.
 *
 * Usage: node scripts/check-changelog.mjs [--version X.Y.Z]   (defaults to package.json)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES_DIR = join(ROOT, "src/content/changelog/releases");

function main() {
  const args = process.argv.slice(2);
  const flagIdx = args.indexOf("--version");
  const version =
    flagIdx >= 0 && args[flagIdx + 1]
      ? args[flagIdx + 1]
      : JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

  const file = join(RELEASES_DIR, `${version}.ts`);
  if (!existsSync(file)) {
    process.stderr.write(
      `✗ Missing changelog: src/content/changelog/releases/${version}.ts\n` +
        `  Run 'make version-bump' (which scaffolds it) or 'node scripts/scaffold-changelog.mjs ${version}',\n` +
        `  fill it in, and commit it alongside the version bump.\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`✓ changelog present for ${version}\n`);
}

main();
