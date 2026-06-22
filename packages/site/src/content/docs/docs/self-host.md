---
title: Self-host & deploy
description: Run the project locally, build it as static files, and deploy your own web build to Cloudflare Pages. No MUZERO account required for local use.
sidebar:
  order: 5
---

MUZERO is a Vite app. You can run it locally, build it as static files, and deploy
your own web build. The project does not require a MUZERO account for local
playback, local library management, or user-owned cloud-drive sync.

## Run locally

Requirements:

- Node.js 24.16+ and pnpm
- Rust + Tauri prerequisites for Tauri desktop/mobile builds
- Xcode for iOS, Android SDK/NDK for Android

```bash
fnm install
fnm use
make install
make dev          # web dev server → http://localhost:41730
```

For the desktop shell:

```bash
make electron-dev   # Electron (primary desktop shell)
make desktop        # Tauri parity
```

Quality gate:

```bash
make check          # typecheck + lint + test
```

## Build & deploy

```bash
make build          # tsc + vite build → dist/
```

Deploy `dist/` to **Cloudflare Pages** for a personal web build. Some desktop-only
capabilities — especially online-source playback that needs custom request
headers — work best in the Electron desktop shell.

## Hosted vs self-hosted

- **`mu0.app`** is the official, free hosted surface (marketing + docs +
  downloads). The app itself lives at **`my.mu0.app`**.
- The optional **share-link control plane** is designed for Cloudflare Workers +
  D1 + KV and can be self-hosted when that phase lands.
- Core data stays local; cross-device sync uses **your own** R2 / S3-compatible
  storage (or future WebDAV).

## Next

- [Architecture](/docs/architecture/)
