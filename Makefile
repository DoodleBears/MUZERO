.PHONY: help install update
.PHONY: dev web desktop tauri ios ios-init android android-init mobile-info tauri-info
.PHONY: build preview desktop-build desktop-debug mac win linux ios-build android-build desktop-locate
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
DEV_URL ?= http://localhost:1420
BUNDLE_DIR := src-tauri/target/release/bundle
UNAME := $(shell uname)

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
	@echo "  make desktop      - Tauri DESKTOP with hot reload (Vite HMR + Rust shell)"
	@echo "  make ios          - Run on iOS simulator/device (needs Xcode; run ios-init once)"
	@echo "  make ios-init     - Generate the iOS project (one-time)"
	@echo "  make android      - Run on Android emulator/device (needs SDK/NDK; run android-init once)"
	@echo "  make android-init - Generate the Android project (one-time)"
	@echo "  make tauri-info   - Print the Tauri/Rust/toolchain doctor report"
	@echo ""
	@echo "Build & package:"
	@echo "  make build        - Build the web frontend → dist/ (tsc + vite)"
	@echo "  make preview      - Preview the production web build locally"
	@echo "  make desktop-build- Package the desktop app for THIS OS (release)"
	@echo "  make desktop-debug- Package the desktop app for THIS OS (debug, faster)"
	@echo "  make mac          - Build macOS .app + .dmg (Mac only)"
	@echo "  make win          - Build Windows installer (.exe/NSIS) (run on Windows)"
	@echo "  make linux        - Build Linux AppImage + .deb (run on Linux)"
	@echo "  make ios-build    - Build a signed iOS app (Mac + Xcode)"
	@echo "  make android-build- Build an Android APK/AAB"
	@echo "  make desktop-locate - Show where packaged artifacts landed"
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
	$(PM) dev

# Desktop app with hot reload: Vite HMR drives the WebView, and the Rust shell
# rebuilds on src-tauri changes. This is the main desktop dev command.
desktop tauri:
	$(PM) tauri dev

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
