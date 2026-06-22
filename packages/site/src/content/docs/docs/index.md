---
title: MUZERO docs
description: Your private, local-first music museum — upload, annotate, sync, play from every source, and let an AI DJ keep the queue moving.
---

MUZERO is a **local-first music and video player** for people whose songs are also
memories. It brings your private library, scattered online sources, visual
playback, your-own-cloud sync, and an LLM-powered DJ into one app.

## Four experiences, one library

- **Private music museum** — upload audio and music videos, annotate every track
  with notes, tags, and cover photos, and return to the moment a song belongs to.
- **Multi-source hub** — search and play from NetEase Cloud Music, Bilibili, and
  YouTube on desktop, then keep those tracks in your MUZERO library.
- **Visual player** — Poweramp-inspired surfaces, cover-driven palettes, reactive
  backgrounds, and audio visualizers.
- **Agent DJ** — connect a model, let it search your library, curate sets, take
  requests, or generate the next song.

## The promise

| Principle | What it means |
|-----------|---------------|
| **Local-first** | Tracks, sets, notes, tags, covers, settings, and playback stats live in a device-local database (`muzero-db`). |
| **No MUZERO media backend** | MUZERO never hosts your library. Cloud sync points at storage you configure and own. |
| **BYOK** | LLM keys, music-generation keys, source logins, and storage credentials are stored locally on your device. |
| **Free hosted service** | [mu0.app](https://mu0.app) exists for distribution, web access, and optional share links — not for taking custody of your library. |

## Start here

- [Getting started](/docs/getting-started/) — open the app and import your first tracks.
- [Sources & importing](/docs/sources/) — uploads + NetEase, Bilibili, YouTube.
- [Cloud sync](/docs/sync/) — keep every device on the same library.
- [Agent DJ](/docs/agent-dj/) — connect a model and let it run the queue.
- [Self-host & deploy](/docs/self-host/) — run the web build yourself.
- [Architecture](/docs/architecture/) — how it fits together (for contributors).

> Just want the app? Open [my.mu0.app](https://my.mu0.app) or grab a desktop
> build from the [download page](/download/).
