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
const RCLONE_RETRY_ARGS = ["--retries", "6", "--low-level-retries", "20", "--retries-sleep", "10s", "--contimeout", "30s", "--timeout", "10m"];
const RCLONE_R2_BINARY_ARGS = [
  "--s3-upload-cutoff",
  "16Mi",
  "--s3-chunk-size",
  "16Mi",
  "--s3-upload-concurrency",
  "2",
];

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
  // electron-builder tags arm64 explicitly but leaves the x64 dmg arch-less
  // ("MUZERO-0.7.0.dmg"), so anything that isn't arm64 is x64.
  if (f.endsWith(".dmg")) return f.includes("arm64") ? "mac-arm64" : "mac-x64";
  if (f.endsWith(".exe")) return "win-x64";
  if (f.endsWith(".appimage")) return "linux-x64-appimage";
  if (f.endsWith(".deb")) return "linux-x64-deb";
  return null; // .zip / .blockmap / .yml are updater/feed artifacts, not list entries
}

/**
 * Rewrite an electron-builder update feed (`latest.yml` / `latest-mac.yml` / `beta.yml`)
 * so its file references point into the versioned subfolder the binaries are uploaded
 * to (`<version>/<file>`), matching this script's upload layout.
 *
 * Why this is required: electron-builder writes `url:` / `path:` as BARE filenames,
 * and the `generic` updater resolves them relative to the feed's own location — the
 * prefix root (`…/desktop/latest.yml`). But binaries are uploaded under
 * `…/desktop/<version>/…` (see the upload loop). So a bare reference 404s, the
 * in-app updater fails its post-check download, and the user sees "检查更新失败".
 * Prefixing each reference with `<version>/` makes it resolve to the real object
 * (the derived `<url>.blockmap` then resolves too).
 *
 * Surgical, dependency-free line rewrite: only `url:` / `path:` scalar lines whose
 * value is one of `knownFiles` (the binaries in the release dir) are rewritten —
 * `version:`, `sha512:`, `releaseDate:` etc. are untouched. Idempotent: an
 * already-prefixed value isn't a bare `knownFiles` entry, so it's left alone.
 * Quoting style and trailing CR (CRLF feeds) are preserved.
 */
export function prefixFeedReferences(yamlText, version, knownFiles) {
  const known = knownFiles instanceof Set ? knownFiles : new Set(knownFiles);
  return yamlText
    .split("\n")
    .map((line) => {
      const m = /^([ \t]*-?[ \t]*)(url|path):[ \t]+(['"]?)(.*?)\3([ \t]*\r?)$/.exec(line);
      if (!m) return line;
      const [, indent, key, quote, value, tail] = m;
      if (!known.has(value)) return line;
      return `${indent}${key}: ${quote}${version}/${value}${quote}${tail}`;
    })
    .join("\n");
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

function rcloneCopyTo(source, target, { contentType, cacheControl, multipart = false }) {
  const args = [
    "copyto",
    source,
    target,
    ...RCLONE_RETRY_ARGS,
    ...(multipart ? RCLONE_R2_BINARY_ARGS : []),
    "--header-upload",
    `Content-Type: ${contentType}`,
    "--header-upload",
    `Cache-Control: ${cacheControl}`,
  ];
  execFileSync("rclone", args, { stdio: "inherit" });
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
  // Feeds stay at the prefix root; binaries + blockmaps go under `<version>/`.
  // Because the updater resolves a feed's bare file refs relative to the feed
  // (root), rewrite those refs to `<version>/…` so they reach the real binaries.
  const dirFiles = readdirSync(dir).filter((name) => statSync(join(dir, name)).isFile());
  const binaryNames = new Set(dirFiles.filter((name) => !/\.ya?ml$/.test(name)));
  const feedTmp = mkdtempSync(join(tmpdir(), "muzero-feed-"));
  for (const name of dirFiles) {
    if (name === "builder-debug.yml") continue; // electron-builder debug trace, not a feed
    const full = join(dir, name);
    const isFeed = /\.ya?ml$/.test(name);
    const key = isFeed ? name : `${version}/${name}`;
    const cacheControl = isFeed
      ? "no-cache, max-age=0, must-revalidate"
      : "public, max-age=31536000, immutable";
    const contentType = isFeed ? "text/yaml" : "application/octet-stream";
    let source = full;
    if (isFeed) {
      const rewritten = prefixFeedReferences(readFileSync(full, "utf8"), version, binaryNames);
      source = join(feedTmp, name);
      writeFileSync(source, rewritten);
    }
    rcloneCopyTo(source, dest(key), { contentType, cacheControl, multipart: !isFeed });
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
  rcloneCopyTo(localManifest, dest("manifest.json"), {
    contentType: "application/json",
    cacheControl: "no-cache, max-age=0, must-revalidate",
  });

  process.stdout.write(`Published ${version} (${found.map((f) => f.platform).join(", ")}) → ${baseUrl}/\n`);
}

if (process.argv[1]?.endsWith("publish-release.mjs")) {
  main();
}
