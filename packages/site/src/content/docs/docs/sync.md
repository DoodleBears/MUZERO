---
title: Cloud sync
description: Sync sets, tracks, covers, notes, memories, lyrics, and playback metadata across your own devices — using storage you own, with no MUZERO media backend.
sidebar:
  order: 3
---

MUZERO never hosts your library. Cloud sync points at **storage you configure and
own**, so you can keep every device on the same library without handing your media
to anyone.

## How it works

1. **Configure a cloud drive once** in Settings (the current path is Cloudflare
   R2 / S3-compatible object storage).
2. MUZERO **publishes** your library to that storage and **pulls** updates back.
3. Copy a trusted **setup link** to quickly bring another phone or computer into
   the same library.

What syncs: sets, tracks, covers, notes, memories, lyrics, and playback metadata —
across your own devices, with no MUZERO server in the middle.

## Storage backends

- **Today:** Cloudflare R2 / S3-compatible object storage.
- **Roadmap:** WebDAV support for Nextcloud, Synology, rclone serve, and other
  private clouds.

Media bytes are content-addressed, so re-syncing only moves what changed.

## Sharing with friends

- Share read-only library / share links with friends.
- Richer `mu0.app` short links and revocable invites are on the roadmap. Even
  then, **track bytes still come from your configured storage or device** — only
  the share link and permission metadata involve the `mu0` service.

## Credentials stay local

Storage credentials are stored on your device only (BYOK). They are never written
into the app bundle, a committed `.env`, a URL, logs, or telemetry.

## Next

- [Self-host & deploy](/docs/self-host/)
