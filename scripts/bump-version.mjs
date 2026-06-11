#!/usr/bin/env node
/**
 * Bump the app version across the THREE files that must stay in lockstep, so the
 * version never drifts again (today they're hand-synced at 0.1.0):
 *   - package.json            "version"          (single source of truth)
 *   - src-tauri/tauri.conf.json "version"
 *   - src-tauri/Cargo.toml     [package] version
 *
 * Usage:
 *   node scripts/bump-version.mjs [major|minor|patch|beta] [--dry-run]
 *
 * With no type it runs INTERACTIVELY (in a TTY): prints the resulting version for
 * each bump and lets you pick one. `make version-bump` (no TYPE=) uses this.
 *
 * `beta` semantics: from a release X.Y.Z it starts the next-minor prerelease
 * X.(Y+1).0-beta.1; from X.Y.Z-beta.N it increments to X.Y.Z-beta.(N+1).
 *
 * Does NOT git-commit — the version bump + the matching changelog file are meant
 * to land in the same commit (see scaffold-changelog.mjs / check-changelog.mjs).
 * See docs/prd/20260611-muzero-release-pipeline-changelog-prd §4.3.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUMP_TYPES = ["major", "minor", "patch", "beta"];
// Menu order: patch → minor → major → beta (ascending impact, beta last).
const MENU_ORDER = ["patch", "minor", "major", "beta"];

/** Compute the next version string. Pure. */
export function nextVersion(current, type) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(current);
  if (!m) throw new Error(`Cannot bump unrecognized version "${current}"`);
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  const beta = m[4] === undefined ? null : Number(m[4]);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "beta":
      return beta === null
        ? `${major}.${minor + 1}.0-beta.1`
        : `${major}.${minor}.${patch}-beta.${beta + 1}`;
    default:
      throw new Error(`Unknown bump type "${type}" (expected ${BUMP_TYPES.join("|")})`);
  }
}

/** The interactive menu rows: 1-indexed key + type + resulting version. Pure. */
export function bumpOptions(current) {
  return MENU_ORDER.map((type, i) => ({ key: String(i + 1), type, next: nextVersion(current, type) }));
}

/** Map a user's answer (menu number or type name, case-insensitive) to a bump type, or null. */
export function resolveSelection(input, options) {
  const value = String(input).trim().toLowerCase();
  if (!value) return null;
  const byKey = options.find((o) => o.key === value);
  if (byKey) return byKey.type;
  const byType = options.find((o) => o.type === value);
  return byType ? byType.type : null;
}

async function promptBumpType(current) {
  const options = bumpOptions(current);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  try {
    process.stdout.write(`\nCurrent version: ${current}\n\n`);
    for (const o of options) {
      process.stdout.write(`  ${o.key}) ${o.type.padEnd(6)} →  ${o.next}\n`);
    }
    process.stdout.write("\n");
    for (let attempt = 0; attempt < 5; attempt++) {
      const answer = await ask(`Bump type [1-${options.length} or name]: `);
      const type = resolveSelection(answer, options);
      if (type) return type;
      process.stdout.write(`  ✗ "${String(answer).trim()}" not recognized — enter 1-${options.length} or ${BUMP_TYPES.join("/")}.\n`);
    }
    return null;
  } finally {
    rl.close();
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonVersion(path, version, dryRun) {
  const obj = readJson(path);
  obj.version = version;
  if (!dryRun) writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
}

function writeCargoVersion(path, version, dryRun) {
  const text = readFileSync(path, "utf8");
  // Replace the first `version = "..."` line — in a Cargo.toml that's the
  // [package] version (deps that pin a version use inline tables / come later).
  let replaced = false;
  const next = text.replace(/^version\s*=\s*"[^"]*"/m, () => {
    replaced = true;
    return `version = "${version}"`;
  });
  if (!replaced) throw new Error(`No [package] version line found in ${path}`);
  if (!dryRun) writeFileSync(path, next);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  let type = args.find((a) => !a.startsWith("--"));

  if (type && !BUMP_TYPES.includes(type)) {
    process.stderr.write(`Unknown bump type "${type}" (expected ${BUMP_TYPES.join("|")}).\n`);
    process.exit(1);
  }

  const pkgPath = join(ROOT, "package.json");
  const tauriPath = join(ROOT, "src-tauri/tauri.conf.json");
  const cargoPath = join(ROOT, "src-tauri/Cargo.toml");
  const current = readJson(pkgPath).version;

  if (!type) {
    if (!process.stdin.isTTY) {
      process.stderr.write(
        `Usage: node scripts/bump-version.mjs <${BUMP_TYPES.join("|")}> [--dry-run]\n` +
          "  (or run in a terminal with no type for the interactive picker)\n",
      );
      process.exit(1);
    }
    type = await promptBumpType(current);
    if (!type) {
      process.stderr.write("Aborted — no valid bump type selected.\n");
      process.exit(1);
    }
  }

  const next = nextVersion(current, type);
  const files = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"];

  writeJsonVersion(pkgPath, next, dryRun);
  writeJsonVersion(tauriPath, next, dryRun);
  writeCargoVersion(cargoPath, next, dryRun);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ current, next, type, files }, null, 2)}\n`);
    return;
  }

  // Scaffold the matching changelog file so the version bump and its changelog
  // land in the same commit (and `make changelog-check` passes).
  execFileSync("node", [join(ROOT, "scripts/scaffold-changelog.mjs"), next], { stdio: "inherit" });

  process.stdout.write(
    [
      `Bumped ${current} → ${next} (${type}) in:`,
      ...files.map((f) => `  - ${f}`),
      "",
      `Next: fill in src/content/changelog/releases/${next}.ts (all 4 locales), then`,
      "commit package.json + tauri.conf.json + Cargo.toml + the changelog together.",
      "",
    ].join("\n"),
  );
}

// Only run when invoked as a script (so tests can import the pure helpers).
if (process.argv[1]?.endsWith("bump-version.mjs")) {
  void main();
}
