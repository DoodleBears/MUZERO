.PHONY: help install update node-check
.PHONY: dev web desktop tauri electron-dev electron-preview electron-build electron-profile perf-profile ios ios-init android android-init mobile-info tauri-info
.PHONY: build preview deploy pages-project pages-deploy pages-deploy-preview desktop-build desktop-debug mac win linux ios-build android-build desktop-locate
.PHONY: version-bump changelog-check version-sync release-check release-show release-build release-mac release-win release-linux release-publish release-publish-dry release-locate changelog-md
.PHONY: test test-watch typecheck lint format check react-doctor react-doctor-perf
.PHONY: icons ui ui-coss ui-theme clean clean-dist
.PHONY: site site-build site-preview

# MUZERO — local-first AI DJ music player (Tauri 2 desktop + mobile).
# The app is the root package, so its targets call pnpm scripts directly (no
# --filter). The marketing/docs site is a workspace package (packages/site) —
# its `site*` targets use --filter @muzero/site.
# Mirrors the doodlekuma.com Makefile conventions: grouped `help`, ?=/:= vars,
# thin recipes. Run `make` (or `make help`) for the menu.

# Auto-load a gitignored .env if present (forward-compat; MUZERO is BYOK so keys
# live in-app/IndexedDB, not here — nothing required today).
ifneq (,$(wildcard ./.env))
include .env
export
endif

PM ?= pnpm
REQUIRED_NODE ?= 24.16.0
# Dev-server ports. The browser loop (make dev) and the Tauri desktop shell
# (make desktop) use different ports so they can run side by side. Override like
# `make desktop DESKTOP_PORT=1440`. Vite reads MUZERO_DEV_PORT; Tauri's devUrl is
# overridden to match via --config (mobile HMR uses 41731, so desktop=41732).
WEB_PORT ?= 41730
DESKTOP_PORT ?= 41732
# Marketing/docs site (packages/site) dev/preview port — Astro's default 4321,
# matched in .claude/launch.json (site-dev). Separate from the app dev ports.
SITE_PORT ?= 4321
DEV_URL ?= http://localhost:$(WEB_PORT)
# Renderer CPU-profiling loop (make electron-profile → make perf-profile). 39222 not 9222
# (Windows reserves 9222 via Hyper-V excluded ranges). See PRD 20260616-agent-cpu-profiling.
DBG_PORT ?= 39222
PROFILE_SCENARIO ?= pingpong
BUNDLE_DIR := src-tauri/target/release/bundle
ifeq ($(OS),Windows_NT)
UNAME := Windows_NT
SET_ENV = set "$(1)=$(2)"&&
else
UNAME := $(shell uname)
SET_ENV = $(1)=$(2)
endif
WRANGLER_LOG_PATH ?= $(CURDIR)/.wrangler/logs
CLOUDFLARE_ACCOUNT_ID ?= 332e72d480d7cb3e60ee671d3ca0cad0
export WRANGLER_LOG_PATH CLOUDFLARE_ACCOUNT_ID

# --- Release distribution (Electron → R2). See the release PRD. Decisions Q2/Q3:
# official public bucket served at assets.mu0.app, transport via rclone. The S3
# write creds live in the build machine's env / CI secret — NEVER in the bundle.
RELEASE_R2_BUCKET ?= muzero-releases
RELEASE_R2_PREFIX ?= desktop
RELEASE_BASE_URL ?= https://assets.mu0.app/desktop
RELEASE_RCLONE_REMOTE ?= r2:
RELEASE_CHANNEL ?= stable
export RELEASE_R2_BUCKET RELEASE_R2_PREFIX RELEASE_BASE_URL RELEASE_RCLONE_REMOTE RELEASE_CHANNEL

.DEFAULT_GOAL := help

help:
	@node scripts/print-help.mjs "$(DEV_URL)" "$(DESKTOP_PORT)"

# ---------------------------------------------------------------- Setup ----

node-check:
	@node -e "const required='$(REQUIRED_NODE)'; const current=process.versions.node.split('.').map(Number); const target=required.split('.').map(Number); const tooOld=current[0]<target[0] || (current[0]===target[0] && (current[1]<target[1] || (current[1]===target[1] && current[2]<target[2]))); if (tooOld) { console.error('ERROR: MUZERO uses Node.js >= ' + required + ' for Electron dev. Current: ' + process.versions.node + '. Run: fnm install && fnm use'); process.exit(1); }"

install:
	$(PM) install

update:
	$(PM) update --latest

# -------------------------------------------------------------- Develop ----

# Fast browser loop (no Rust). Works with the offline mock music provider.
dev web:
	$(call SET_ENV,MUZERO_DEV_PORT,$(WEB_PORT)) $(PM) dev

# Desktop app with hot reload: Vite HMR drives the WebView, and the Rust shell
# rebuilds on src-tauri changes. This is the main desktop dev command. Runs its
# own Vite on DESKTOP_PORT (default 41732) with a matching --config devUrl, so it
# can run at the same time as `make dev` (port 41730).
desktop tauri:
	$(call SET_ENV,MUZERO_DEV_PORT,$(DESKTOP_PORT)) $(PM) exec tauri dev --config '{"build":{"devUrl":"http://localhost:$(DESKTOP_PORT)"}}'

# Electron is the primary desktop shell (WebView2/WKWebView instability pushed us
# off Tauri's bundled webview). `make desktop` still runs Tauri behind the
# src/lib/desktop bridge for parity testing.
# The launcher starts Vite if needed, then runs electronmon for main-process
# restarts; the renderer still hot-reloads via Vite.
electron-dev: node-check
	node scripts/electron-dev.mjs --port "$(WEB_PORT)" --url "$(DEV_URL)"

electron-preview: node-check build
	$(PM) exec electron electron/main.cjs

# Prod-build CPU profiling: builds a production renderer that keeps the control bridge
# (VITE_MUZERO_PROFILE) + launches Electron with the renderer debug port + control
# endpoint, so `node scripts/perf-profile.mjs <scenario> --port 39222` attaches CDP and
# drives a real switch over a CLEAN prod build (no jsxDEV / dev-React / trace-observer
# noise). dev-only; never shipped. See PRD 20260616-agent-cpu-profiling-harness.
electron-profile: node-check
	$(call SET_ENV,MUZERO_REMOTE_DEBUG_PORT,$(DBG_PORT)) node scripts/electron-profile.mjs

# Capture a CPU flame graph from the running prod-profile app (start it first with
# `make electron-profile`, in another terminal). Writes .logs/perf-profiles/<name>.cpuprofile
# (DevTools/speedscope-openable) + .analysis.json (top self/total time the agent reads).
# Override: make perf-profile PROFILE_SCENARIO=switch DBG_PORT=39222
perf-profile:
	node scripts/perf-profile.mjs $(PROFILE_SCENARIO) --port $(DBG_PORT)

electron-build: node-check build
	$(PM) exec electron-builder

ios-init:
	$(PM) tauri ios init

ios:
	$(PM) tauri ios dev

android-init:
	$(PM) tauri android init

android:
	$(PM) tauri android dev

tauri-info:
	$(PM) tauri info

# ----------------------------------------------------------------- Site ----
# Marketing + docs site (packages/site, Astro + Starlight). A workspace package
# served on its own port so it runs alongside the app dev servers. Ships to its
# own Cloudflare Pages project (mu0-site); the app keeps mu0-app. See the web PRD.
site:
	$(PM) --filter @muzero/site dev --port $(SITE_PORT)

site-build:
	$(PM) --filter @muzero/site build

site-preview: site-build
	$(PM) --filter @muzero/site preview --port $(SITE_PORT)

# ------------------------------------------------------- Build & package ----

build:
	$(PM) build

preview: build
	$(PM) preview

deploy: pages-deploy

pages-project:
	$(PM) run pages:project:create

pages-deploy:
	$(PM) run pages:deploy

pages-deploy-preview:
	$(PM) run pages:deploy:preview

desktop-build:
	$(PM) tauri build

# Unoptimized desktop bundle — much faster to produce while iterating on packaging.
desktop-debug:
	$(PM) tauri build --debug

mac:
	@node -e "if (process.platform !== 'darwin') { console.error('ERROR: macOS bundles can only be built on a Mac.'); process.exit(1) }"
	$(PM) tauri build --bundles app,dmg

win:
	$(PM) tauri build --bundles nsis

linux:
	$(PM) tauri build --bundles appimage,deb

ios-build:
	@node -e "if (process.platform !== 'darwin') { console.error('ERROR: iOS builds require macOS + Xcode.'); process.exit(1) }"
	$(PM) tauri ios build

android-build:
	$(PM) tauri android build

desktop-locate:
	@echo "Desktop bundles (if built):"
	@ls -1 $(BUNDLE_DIR)/*/* 2>/dev/null || echo "  none yet — run 'make desktop-build' (or mac/win/linux)"

# -------------------------------------------------------------- Release ----
# Multi-platform Electron release + R2 distribution (see
# docs/prd/20260611-muzero-release-pipeline-changelog-prd). Targets grow per PRD
# phase: version-bump (P1) → changelog gate (P2) → release-* build + publish (P3/P4).

# Bump the app version across the THREE files that must stay in lockstep —
# package.json (source of truth) + src-tauri/tauri.conf.json + src-tauri/Cargo.toml.
# Then write the changelog for the new version and commit all of it together.
# Run `make version-bump` with no TYPE for an interactive picker (shows the
# resulting version for patch/minor/major/beta), or pass TYPE=major|minor|patch|beta.
version-bump:
	node scripts/bump-version.mjs $(TYPE)

# Release gate — fail if there's no changelog releases/<version>.ts for the
# current package.json version.
changelog-check:
	node scripts/check-changelog.mjs

# Fail if the version drifts across package.json / tauri.conf.json / Cargo.toml.
version-sync:
	node scripts/check-version-sync.mjs

# Regenerate the repo-standard CHANGELOG.md from the typed changelog source.
changelog-md:
	node scripts/export-changelog-md.mjs

# The total pre-release gate: changelog present + versions in lockstep. A
# dependency of every release-* build.
release-check: changelog-check version-sync

# Print the current release status: version + lockstep sync + changelog presence.
release-show:
	@printf 'MUZERO version: '; node -e "process.stdout.write(require('./package.json').version + '\n')"
	@node scripts/check-version-sync.mjs || true
	@node scripts/check-changelog.mjs || true

# Shared: build the renderer (dist/) + bundle the Electron main (dist-electron/).
# No tsc here — type-safety is a separate gate (make typecheck / lefthook); a
# release build shouldn't be blocked by unrelated type debt.
release-build: node-check release-check
	$(PM) exec vite build
	node scripts/build-electron-main.mjs

# Per-OS installers. mac MUST run on a Mac; win/linux run on the Windows box
# (win native, linux in WSL2 — decision Q1). Each emits its own latest*.yml feed
# (per-platform, no cross-OS collision) into release/.
release-mac:
	@node -e "if (process.platform !== 'darwin') { console.error('ERROR: macOS bundles can only be built on a Mac.'); process.exit(1) }"
	@$(MAKE) --no-print-directory release-build
	CSC_IDENTITY_AUTO_DISCOVERY=false $(PM) exec electron-builder --mac
	@$(MAKE) --no-print-directory release-locate

release-win:
	@node -e "if (process.platform === 'darwin') console.warn('WARN: building Windows on macOS is unreliable — run on Windows (or WSL2 + Wine).')"
	@$(MAKE) --no-print-directory release-build
	$(PM) exec electron-builder --win
	@$(MAKE) --no-print-directory release-locate

release-linux:
	@$(MAKE) --no-print-directory release-build
	$(PM) exec electron-builder --linux
	@$(MAKE) --no-print-directory release-locate

# Upload release/* to R2 (rclone, per-extension cache headers) + additively merge
# this platform's assets into manifest.json. Needs rclone + an 'r2:' remote and
# RELEASE_R2_BUCKET. Run once per OS after its release-* build.
release-publish:
	@node -e "const{execFileSync}=require('child_process');try{execFileSync(process.platform==='win32'?'where':'which',['rclone'],{stdio:'ignore'})}catch{console.error('ERROR: rclone required — install rclone and configure an $(RELEASE_RCLONE_REMOTE) R2 remote.');process.exit(1)}"
	node scripts/publish-release.mjs

# Preview the merged manifest for what's in release/ without uploading anything.
release-publish-dry:
	node scripts/publish-release.mjs --dry-run

release-locate:
	@node scripts/locate-release-artifacts.mjs

# -------------------------------------------------------------- Quality ----

check: typecheck lint test
	@echo "✓ typecheck + lint + test passed"

test:
	$(PM) test

test-watch:
	$(PM) test:watch

typecheck:
	$(PM) typecheck

lint:
	$(PM) lint

format:
	$(PM) exec biome format --write src

# React Doctor — deterministic React health scan (state/effects, performance,
# a11y, security). Report-only; --no-telemetry skips the external score/share URL.
# `make react-doctor` = full scan; `make react-doctor-perf` = Performance + Bugs only.
# NOT part of `make check` (798-finding backlog); for CI, gate new issues with
# `react-doctor --scope changed --blocking error`.
react-doctor:
	$(PM) react-doctor
react-doctor-perf:
	$(PM) run react-doctor:perf

# ----------------------------------------------------------- UI & assets ----

# Add a single COSS UI component: `make ui C=card` → shadcn add @coss/card.
ui:
	@node -e "if (!'$(C)') { console.error('Usage: make ui C=<component>   (e.g. make ui C=button)'); process.exit(1) }"
	$(PM) dlx shadcn@latest add @coss/$(C)

ui-coss:
	$(PM) dlx shadcn@latest add @coss/ui

ui-theme:
	$(PM) dlx shadcn@latest add @coss/style

# Regenerate the full desktop/iOS/Android icon set from the default dark logo PNG.
icons:
	$(PM) tauri icon public/muzero-logo-dark.png

# ---------------------------------------------------------- Maintenance ----

clean: clean-dist
	rm -rf node_modules

clean-dist:
	rm -rf dist src-tauri/target
