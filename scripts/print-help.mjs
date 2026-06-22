#!/usr/bin/env node

const [devUrl = "http://localhost:41730", desktopPort = "41732"] = process.argv.slice(2);

const supportsColor =
  process.env.NO_COLOR === undefined && (process.env.FORCE_COLOR !== undefined || process.stdout.isTTY);

const paint = (code, value) => (supportsColor ? `\x1b[${code}m${value}\x1b[0m` : value);
const title = (value) => paint("1;36", value);
const section = (value) => paint("1;33", value);
const command = (value) => paint("32", value);
const dim = (value) => paint("2", value);

const groups = [
  {
    name: "Setup",
    commands: [
      ["install", "Install dependencies (pnpm) + git hooks"],
      ["update", "Update dependencies to latest"],
    ],
  },
  {
    name: "Develop",
    commands: [
      ["dev", `Web dev in the browser, fastest loop (${devUrl})`],
      ["desktop", `Tauri DESKTOP hot reload — runs alongside 'make dev' (port ${desktopPort})`],
      ["electron-dev", `Electron dev shell; starts/reuses Vite at ${devUrl}`],
      ["ios", "Run on iOS simulator/device (needs Xcode; run ios-init once)"],
      ["ios-init", "Generate the iOS project (one-time)"],
      ["android", "Run on Android emulator/device (needs SDK/NDK; run android-init once)"],
      ["android-init", "Generate the Android project (one-time)"],
      ["tauri-info", "Print the Tauri/Rust/toolchain doctor report"],
    ],
  },
  {
    name: "Build & package",
    commands: [
      ["build", "Build the web frontend -> dist/ (tsc + vite)"],
      ["preview", "Preview the production web build locally"],
      ["deploy", "Build + deploy dist/ to Cloudflare Pages production (mu0.app)"],
      ["pages-project", "Create the Cloudflare Pages project mu0-app (one-time)"],
      ["pages-deploy", "Same as make deploy"],
      ["pages-deploy-preview", "Build + deploy dist/ to a Pages preview branch"],
      ["electron-preview", "Build web frontend, then open it in Electron (Chromium)"],
      ["electron-build", "Package desktop installers via electron-builder -> release/"],
      ["desktop-build", "Package the desktop app for THIS OS (release)"],
      ["desktop-debug", "Package the desktop app for THIS OS (debug, faster)"],
      ["mac", "Build macOS .app + .dmg (Mac only)"],
      ["win", "Build Windows installer (.exe/NSIS) (run on Windows)"],
      ["linux", "Build Linux AppImage + .deb (run on Linux)"],
      ["ios-build", "Build a signed iOS app (Mac + Xcode)"],
      ["android-build", "Build an Android APK/AAB"],
      ["desktop-locate", "Show where packaged artifacts landed"],
    ],
  },
  {
    name: "Site (marketing + docs)",
    commands: [
      ["site", "Marketing + docs site dev server (Astro, http://localhost:4321)"],
      ["site-build", "Build the site -> packages/site/dist"],
      ["site-preview", "Build + preview the production site locally"],
    ],
  },
  {
    name: "Release",
    commands: [
      ["version-bump", "Pick patch/minor/major/beta interactively (or pass TYPE=)"],
      ["changelog-check", "Fail if the current version has no changelog file"],
      ["release-check", "Pre-release gate: changelog present + versions in lockstep"],
      ["release-show", "Print version + lockstep sync + changelog status"],
      ["changelog-md", "Regenerate CHANGELOG.md from the typed changelog"],
      ["release-mac", "Build mac dmg+zip installers (Mac only) -> release/"],
      ["release-win", "Build Windows nsis installer (run on Windows/WSL2)"],
      ["release-linux", "Build Linux AppImage+deb (run in WSL2/Linux)"],
      ["release-publish", "Upload release/* to R2 + merge manifest.json (needs rclone)"],
      ["release-publish-dry", "Print the merged manifest for release/ without uploading"],
    ],
  },
  {
    name: "Quality",
    commands: [
      ["check", "Full local gate: typecheck + lint + test"],
      ["test", "Run vitest once"],
      ["test-watch", "Run vitest in watch mode"],
      ["typecheck", "tsc --noEmit"],
      ["lint", "Biome check"],
      ["format", "Biome format --write"],
    ],
  },
  {
    name: "UI & assets",
    commands: [
      ["ui C=button", "Add a COSS UI component (pnpm dlx shadcn add @coss/button)"],
      ["ui-coss", "Add the full COSS UI component set"],
      ["ui-theme", "Add the official COSS theme (@coss/style)"],
      ["icons", "Regenerate Tauri app icons from public/muzero-logo-dark.png"],
    ],
  },
  {
    name: "Maintenance",
    commands: [
      ["clean", "Remove node_modules, dist, and the Rust target"],
      ["clean-dist", "Remove only dist/ and the Rust target/"],
    ],
  },
];

const commandWidth = Math.max(...groups.flatMap((group) => group.commands.map(([name]) => name.length)));
const lines = [title("MUZERO — Available Commands"), title("==========================="), ""];

for (const group of groups) {
  lines.push(`${section(`${group.name}:`)}`);
  for (const [name, description] of group.commands) {
    lines.push(`  make ${command(name.padEnd(commandWidth))}  ${dim("-")} ${description}`);
  }
  lines.push("");
}

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);
