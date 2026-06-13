#!/usr/bin/env node
/**
 * Print Electron release artifacts in a shell-portable way.
 *
 * Make may run recipes through cmd.exe on Windows, so the release pipeline should
 * not depend on POSIX find/sed/grep just to show the files that electron-builder
 * already emitted.
 *
 * Usage:
 *   node scripts/locate-release-artifacts.mjs [dir]
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_EXTENSIONS = [".dmg", ".zip", ".exe", ".AppImage", ".deb", ".yml"];

export function releaseArtifacts(dir = join(ROOT, "release")) {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => ARTIFACT_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile())
    .sort((a, b) => a.localeCompare(b));
}

function displayPath(path) {
  const rel = relative(ROOT, path) || path;
  return rel.split(sep).join("/");
}

function main() {
  const dir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(ROOT, "release");
  process.stdout.write("Electron release artifacts (release/):\n");

  const artifacts = releaseArtifacts(dir);
  if (artifacts.length === 0) {
    process.stdout.write("  none yet - run 'make release-mac' (or release-win / release-linux)\n");
    return;
  }

  for (const path of artifacts) {
    process.stdout.write(`${displayPath(path)}\n`);
  }
}

if (process.argv[1]?.endsWith("locate-release-artifacts.mjs")) {
  main();
}
