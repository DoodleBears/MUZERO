#!/usr/bin/env node
/**
 * Publish desktop release artifacts to the official R2 distribution bucket and
 * additively merge them into manifest.json (the full version-history index that
 * drives the in-app download center).
 *
 * Because each OS publishes independently (mac on a Mac, win/linux on a Windows
 * box + WSL2), the manifest is merged per-platform: pull the current manifest →
 * fold THIS platform's asset into releases[version].platforms[<plat>] (other
 * platforms preserved) → push it back. Transport is rclone (decision Q3); the
 * merge is pure JSON. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §3.5/§4.2.
 *
 * Usage:
 *   node scripts/publish-release.mjs                 # upload release/* + merge manifest (needs rclone + R2 env)
 *   node scripts/publish-release.mjs --dry-run --dir <path>   # scan + print merged manifest, no network
 *
 * Env: RELEASE_BASE_URL, RELEASE_R2_BUCKET, RELEASE_R2_PREFIX (desktop),
 *      RELEASE_RCLONE_REMOTE (r2:), RELEASE_CHANNEL (stable|beta).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = "muzero-release-manifest-v1";

export function emptyManifest() {
  return {
    schema: SCHEMA,
    productName: "MUZERO",
    latest: "0.0.0",
    updatedAt: "",
    releases: [],
  };
}

function parseSemverParts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** Newest-first comparison; a release ranks above its prerelease. */
export function cmpVersion(a, b) {
  const pa = parseSemverParts(a);
  const pb = parseSemverParts(b);
  if (!pa || !pb) return a < b ? 1 : a > b ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pb.nums[i] - pa.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return -1; // release first (newest)
  if (pb.pre === null) return 1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** Map an electron-builder artifact filename to a manifest platform key (or null = not a primary download). */
export function platformKeyFor(filename) {
  const f = filename.toLowerCase();
  if (f.endsWith(".dmg")) {
    if (f.includes("arm64")) return "mac-arm64";
    if (f.includes("x64") || f.includes("x86_64")) return "mac-x64";
    return "mac-arm64";
  }
  if (f.endsWith(".exe")) return "win-x64";
  if (f.endsWith(".appimage")) return "linux-x64-appimage";
  if (f.endsWith(".deb")) return "linux-x64-deb";
  return null; // .zip / .blockmap / .yml are updater/feed artifacts, not list entries
}

function isPrerelease(version) {
  return version.includes("-");
}

/** Additively merge one platform's asset into the manifest. Pure. */
export function mergeRelease(manifest, entry, updatedAt) {
  const next = { ...manifest, releases: manifest.releases.map((r) => ({ ...r })) };
  let release = next.releases.find((r) => r.version === entry.version);
  if (!release) {
    release = { version: entry.version, date: entry.date, channel: entry.channel, notesRef: entry.notesRef, platforms: {} };
    next.releases.push(release);
  } else {
    release.date = entry.date;
    release.channel = entry.channel;
    release.notesRef = entry.notesRef;
    release.platforms = { ...release.platforms };
  }
  release.platforms[entry.platform] = entry.asset;

  next.releases.sort((a, b) => cmpVersion(a.version, b.version));
  const stable = next.releases.filter((r) => !isPrerelease(r.version));
  const beta = next.releases.filter((r) => isPrerelease(r.version));
  next.latest = stable[0]?.version ?? next.releases[0]?.version ?? "0.0.0";
  if (beta[0]) next.latestBeta = beta[0].version;
  next.updatedAt = updatedAt;
  return next;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Scan a build-output dir → asset entries for each primary installer. Pure-ish (reads files). */
export function scanArtifacts(dir, version, baseUrl) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const platform = platformKeyFor(name);
    if (!platform) continue;
    const full = join(dir, name);
    out.push({
      platform,
      asset: {
        file: `${version}/${name}`,
        url: `${baseUrl}/${version}/${name}`,
        size: statSync(full).size,
        sha256: sha256File(full),
      },
    });
  }
  return out;
}

function readPackageVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? true) : undefined;
}

function nowIso() {
  return new Date().toISOString();
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const dir = arg("--dir") || join(ROOT, "release");
  const version = arg("--version") || readPackageVersion();
  const channel = process.env.RELEASE_CHANNEL === "beta" ? "beta" : "stable";
  const baseUrl = (process.env.RELEASE_BASE_URL || "https://assets.mu0.app/desktop").replace(/\/$/, "");

  if (!existsSync(dir)) {
    process.stderr.write(`No build-output dir at ${dir} — run a release-* build first.\n`);
    process.exit(1);
  }

  const found = scanArtifacts(dir, version, baseUrl);
  if (found.length === 0) {
    process.stderr.write(`No installer artifacts found in ${dir}.\n`);
    process.exit(1);
  }

  // Read the changelog date for this version if present (best-effort).
  const date = nowIso().slice(0, 10);

  if (dryRun) {
    let manifest = emptyManifest();
    for (const { platform, asset } of found) {
      manifest = mergeRelease(manifest, { version, date, channel, notesRef: version, platform, asset }, nowIso());
    }
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }

  // --- Live path: rclone transport + manifest merge ---
  const bucket = process.env.RELEASE_R2_BUCKET;
  const remote = process.env.RELEASE_RCLONE_REMOTE || "r2:";
  const prefix = process.env.RELEASE_R2_PREFIX || "desktop";
  if (!bucket) {
    process.stderr.write("RELEASE_R2_BUCKET is required for a live publish.\n");
    process.exit(1);
  }
  const dest = (key) => `${remote}${bucket}/${prefix}/${key}`;

  // 1. Upload every artifact in the dir (binaries + .yml feeds + .blockmap).
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isFile()) continue;
    const isFeed = /\.ya?ml$/.test(name);
    const key = isFeed ? name : `${version}/${name}`;
    const cacheControl = isFeed
      ? "no-cache, max-age=0, must-revalidate"
      : "public, max-age=31536000, immutable";
    const contentType = isFeed ? "text/yaml" : "application/octet-stream";
    execFileSync(
      "rclone",
      ["copyto", full, dest(key), "--header-upload", `Content-Type: ${contentType}`, "--header-upload", `Cache-Control: ${cacheControl}`],
      { stdio: "inherit" },
    );
  }

  // 2. Pull current manifest (if any), merge this platform's assets, push back.
  const tmp = mkdtempSync(join(tmpdir(), "muzero-manifest-"));
  const localManifest = join(tmp, "manifest.json");
  let manifest = emptyManifest();
  try {
    execFileSync("rclone", ["copyto", dest("manifest.json"), localManifest], { stdio: "ignore" });
    manifest = JSON.parse(readFileSync(localManifest, "utf8"));
  } catch {
    // First publish — start from an empty manifest.
  }
  for (const { platform, asset } of found) {
    manifest = mergeRelease(manifest, { version, date, channel, notesRef: version, platform, asset }, nowIso());
  }
  writeFileSync(localManifest, `${JSON.stringify(manifest, null, 2)}\n`);
  execFileSync(
    "rclone",
    ["copyto", localManifest, dest("manifest.json"), "--header-upload", "Content-Type: application/json", "--header-upload", "Cache-Control: no-cache, max-age=0, must-revalidate"],
    { stdio: "inherit" },
  );

  process.stdout.write(`Published ${version} (${found.map((f) => f.platform).join(", ")}) → ${baseUrl}/\n`);
}

if (process.argv[1]?.endsWith("publish-release.mjs")) {
  main();
}
