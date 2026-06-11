#!/usr/bin/env node
/**
 * Verify the app version is identical across the THREE lockstep files
 * (package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml). bump-version.mjs
 * writes all three, but a hand-edit or a bad merge can still drift them — this
 * guard catches that before a release ships a mismatched version. A prerequisite
 * of every release-* target. See the release PRD §6.
 *
 * Usage: node scripts/check-version-sync.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read the version field from each lockstep file. Cargo's is the first `version = "..."`. */
export function collectVersions(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null;
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).version ?? null;
  const cargo = /^version\s*=\s*"([^"]*)"/m.exec(readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8"));
  return {
    "package.json": pkg,
    "tauri.conf.json": tauri,
    "Cargo.toml": cargo ? cargo[1] : null,
  };
}

/** True only if every file has the same non-empty version. */
export function versionsInSync(versions) {
  const values = Object.values(versions);
  return values.every((v) => Boolean(v) && v === values[0]);
}

function main() {
  const versions = collectVersions();
  if (versionsInSync(versions)) {
    process.stdout.write(`✓ version in sync: ${Object.values(versions)[0]}\n`);
    return;
  }
  process.stderr.write("✗ version drift across the three lockstep files:\n");
  for (const [file, v] of Object.entries(versions)) {
    process.stderr.write(`  ${file}: ${v ?? "(not found)"}\n`);
  }
  process.stderr.write("  Run 'make version-bump TYPE=…' (writes all three), or fix by hand.\n");
  process.exit(1);
}

if (process.argv[1]?.endsWith("check-version-sync.mjs")) main();
