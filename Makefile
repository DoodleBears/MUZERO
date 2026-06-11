.PHONY: help install update
.PHONY: dev web desktop tauri electron-dev electron-preview electron-build ios ios-init android android-init mobile-info tauri-info
.PHONY: build preview desktop-build desktop-debug mac win linux ios-build android-build desktop-locate
.PHONY: version-bump changelog-check version-sync release-check release-show release-build release-mac release-win release-linux release-publish release-publish-dry release-locate changelog-md
.PHONY: test test-watch typecheck lint format check
.PHONY: icons ui ui-coss ui-theme clean clean-dist

# MUZERO — local-first AI DJ music player (Tauri 2 desktop + mobile).
# Single-package repo, so targets call pnpm scripts directly (no --filter).
# Mirrors the doodlekuma.com Makefile conventions: grouped `help`, ?=/:= vars,
# thin recipes. Run `make` (or `make help`) for the menu.

# Auto-load a gitignored .env if present (forward-compat; MUZERO is BYOK so keys
# live in-app/IndexedDB, not here — nothing required today).
ifneq (,$(wildcard ./.env))
include .env
export
endif

PM ?= pnpm
# Dev-server ports. The browser loop (make dev) and the Tauri desktop shell
# (make desktop) use different ports so they can run side by side. Override like
# `make desktop DESKTOP_PORT=1440`. Vite reads MUZERO_DEV_PORT; Tauri's devUrl is
# overridden to match via --config (mobile HMR already uses 1421, so desktop=1430).
WEB_PORT ?= 1420
DESKTOP_PORT ?= 1430
DEV_URL ?= http://localhost:$(WEB_PORT)
BUNDLE_DIR := src-tauri/target/release/bundle
UNAME := $(shell uname)

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
	@echo "MUZERO — Available Commands"
	@echo "==========================="
	@echo ""
	@echo "Setup:"
	@echo "  make install      - Install dependencies (pnpm) + git hooks"
	@echo "  make update       - Update dependencies to latest"
	@echo ""
	@echo "Develop:"
	@echo "  make dev          - Web dev in the browser, fastest loop ($(DEV_URL))"
	@echo "  make desktop      - Tauri DESKTOP hot reload — runs alongside 'make dev' (port $(DESKTOP_PORT))"
	@echo "  make electron-dev - Electron (primary shell) against existing Vite dev URL ($(DEV_URL))"
	@echo "  make ios          - Run on iOS simulator/device (needs Xcode; run ios-init once)"
	@echo "  make ios-init     - Generate the iOS project (one-time)"
	@echo "  make android      - Run on Android emulator/device (needs SDK/NDK; run android-init once)"
	@echo "  make android-init - Generate the Android project (one-time)"
	@echo "  make tauri-info   - Print the Tauri/Rust/toolchain doctor report"
	@echo ""
	@echo "Build & package:"
	@echo "  make build        - Build the web frontend → dist/ (tsc + vite)"
	@echo "  make preview      - Preview the production web build locally"
	@echo "  make electron-preview - Build web frontend, then open it in Electron (Chromium)"
	@echo "  make electron-build - Package desktop installers via electron-builder → release/"
	@echo "  make desktop-build- Package the desktop app for THIS OS (release)"
	@echo "  make desktop-debug- Package the desktop app for THIS OS (debug, faster)"
	@echo "  make mac          - Build macOS .app + .dmg (Mac only)"
	@echo "  make win          - Build Windows installer (.exe/NSIS) (run on Windows)"
	@echo "  make linux        - Build Linux AppImage + .deb (run on Linux)"
	@echo "  make ios-build    - Build a signed iOS app (Mac + Xcode)"
	@echo "  make android-build- Build an Android APK/AAB"
	@echo "  make desktop-locate - Show where packaged artifacts landed"
	@echo ""
	@echo "Release:"
	@echo "  make version-bump TYPE=minor - Bump version across package.json + tauri.conf + Cargo (lockstep)"
	@echo "  make changelog-check         - Fail if the current version has no changelog file"
	@echo "  make release-check           - Pre-release gate: changelog present + versions in lockstep"
	@echo "  make release-show            - Print version + lockstep sync + changelog status"
	@echo "  make changelog-md            - Regenerate CHANGELOG.md from the typed changelog"
	@echo "  make release-mac             - Build mac dmg+zip installers (Mac only) → release/"
	@echo "  make release-win             - Build Windows nsis installer (run on Windows/WSL2)"
	@echo "  make release-linux           - Build Linux AppImage+deb (run in WSL2/Linux)"
	@echo "  make release-publish         - Upload release/* to R2 + merge manifest.json (needs rclone)"
	@echo "  make release-publish-dry     - Print the merged manifest for release/ without uploading"
	@echo ""
	@echo "Quality:"
	@echo "  make check        - Full local gate: typecheck + lint + test"
	@echo "  make test         - Run vitest once"
	@echo "  make test-watch   - Run vitest in watch mode"
	@echo "  make typecheck    - tsc --noEmit"
	@echo "  make lint         - Biome check"
	@echo "  make format       - Biome format --write"
	@echo ""
	@echo "UI & assets:"
	@echo "  make ui C=button  - Add a COSS UI component (pnpm dlx shadcn add @coss/button)"
	@echo "  make ui-coss      - Add the full COSS UI component set"
	@echo "  make ui-theme     - Add the official COSS theme (@coss/style)"
	@echo "  make icons        - Regenerate Tauri app icons from app-icon.png"
	@echo ""
	@echo "Maintenance:"
	@echo "  make clean        - Remove node_modules, dist, and the Rust target"
	@echo "  make clean-dist   - Remove only dist/ and the Rust target/"

# ---------------------------------------------------------------- Setup ----

install:
	$(PM) install

update:
	$(PM) update --latest

# -------------------------------------------------------------- Develop ----

# Fast browser loop (no Rust). Works with the offline mock music provider.
dev web:
	MUZERO_DEV_PORT=$(WEB_PORT) $(PM) dev

# Desktop app with hot reload: Vite HMR drives the WebView, and the Rust shell
# rebuilds on src-tauri changes. This is the main desktop dev command. Runs its
# own Vite on DESKTOP_PORT (default 1430) with a matching --config devUrl, so it
# can run at the same time as `make dev` (port 1420).
desktop tauri:
	MUZERO_DEV_PORT=$(DESKTOP_PORT) $(PM) exec tauri dev --config '{"build":{"devUrl":"http://localhost:$(DESKTOP_PORT)"}}'

# Electron is the primary desktop shell (WebView2/WKWebView instability pushed us
# off Tauri's bundled webview). `make desktop` still runs Tauri behind the
# src/lib/desktop bridge for parity testing.
electron-dev:
	MUZERO_ELECTRON_URL=$(DEV_URL) $(PM) exec electron electron/main.cjs

electron-preview: build
	$(PM) exec electron electron/main.cjs

electron-build: build
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

# ------------------------------------------------------- Build & package ----

build:
	$(PM) build

preview: build
	$(PM) preview

desktop-build:
	$(PM) tauri build

# Unoptimized desktop bundle — much faster to produce while iterating on packaging.
desktop-debug:
	$(PM) tauri build --debug

mac:
	@[ "$(UNAME)" = "Darwin" ] || { echo "ERROR: macOS bundles can only be built on a Mac."; exit 1; }
	$(PM) tauri build --bundles app,dmg

win:
	$(PM) tauri build --bundles nsis

linux:
	$(PM) tauri build --bundles appimage,deb

ios-build:
	@[ "$(UNAME)" = "Darwin" ] || { echo "ERROR: iOS builds require macOS + Xcode."; exit 1; }
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
# TYPE = major | minor | patch | beta.
version-bump:
	@[ -n "$(TYPE)" ] || { echo "Usage: make version-bump TYPE=major|minor|patch|beta"; exit 1; }
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
release-build: release-check
	$(PM) exec vite build
	node scripts/build-electron-main.mjs

# Per-OS installers. mac MUST run on a Mac; win/linux run on the Windows box
# (win native, linux in WSL2 — decision Q1). Each emits its own latest*.yml feed
# (per-platform, no cross-OS collision) into release/.
release-mac:
	@[ "$(UNAME)" = "Darwin" ] || { echo "ERROR: macOS bundles can only be built on a Mac."; exit 1; }
	@$(MAKE) --no-print-directory release-build
	$(PM) exec electron-builder --mac
	@$(MAKE) --no-print-directory release-locate

release-win:
	@[ "$(UNAME)" != "Darwin" ] || echo "WARN: building Windows on macOS is unreliable — run on Windows (or WSL2 + Wine)."
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
	@command -v rclone >/dev/null 2>&1 || { echo "ERROR: rclone required — 'brew install rclone' + configure an '$(RELEASE_RCLONE_REMOTE)' R2 remote."; exit 1; }
	node scripts/publish-release.mjs

# Preview the merged manifest for what's in release/ without uploading anything.
release-publish-dry:
	node scripts/publish-release.mjs --dry-run

release-locate:
	@echo "Electron release artifacts (release/):"
	@ls -1 release/*.dmg release/*.zip release/*.exe release/*.AppImage release/*.deb release/*.yml 2>/dev/null || echo "  none yet — run 'make release-mac' (or release-win / release-linux)"

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

# ----------------------------------------------------------- UI & assets ----

# Add a single COSS UI component: `make ui C=card` → shadcn add @coss/card.
ui:
	@[ -n "$(C)" ] || { echo "Usage: make ui C=<component>   (e.g. make ui C=button)"; exit 1; }
	$(PM) dlx shadcn@latest add @coss/$(C)

ui-coss:
	$(PM) dlx shadcn@latest add @coss/ui

ui-theme:
	$(PM) dlx shadcn@latest add @coss/style

# Regenerate the full desktop/iOS/Android icon set from the source PNG.
icons:
	$(PM) tauri icon app-icon.png

# ---------------------------------------------------------- Maintenance ----

clean: clean-dist
	rm -rf node_modules

clean-dist:
	rm -rf dist src-tauri/target
