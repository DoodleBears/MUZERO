---
title: Architecture
description: How MUZERO fits together — the data model, the DJ → generation → queue loop, the desktop shells, and the project map. For contributors.
sidebar:
  order: 6
---

A high-level map of how MUZERO is put together, for contributors and the curious.

## Data flow

```text
local files / online sources / AI generation
              |
              v
        Track + MediaBlob
              |
              v
 IndexedDB `muzero-db`  <---->  optional user-owned cloud drive
              |
              v
        Player + visualizer
              |
              v
        Agent DJ / search / share
```

Tracks are lightweight rows; audio, video, and cover **bytes live in a separate
`mediaBlobs` store**, never in the track row — so list queries stay fast and
virtualization is meaningful.

## The DJ loop

```text
memory + vibe + recent tracks
          |
          v
    LLM agent writes TrackBrief
          |
          v
 music-generation provider renders audio
          |
          v
 pending track -> ready track -> queue refill
```

`TrackBrief` is the single contract between the DJ, the music-generation provider,
and the database. The DJ writes provider-agnostic briefs; an adapter translates
them, so no vendor concept leaks into the DJ or the DB.

## Shells

The whole app is the frontend. It runs behind a desktop shell abstraction:

- **Electron** — the primary desktop shell (CORS-free fetch, local file access).
- **Tauri 2** — kept runnable and used for mobile.
- **Web** — the browser build.

All native access goes through one bridge, so providers, the player, and the UI
never branch on which shell they're in.

## Tech stack

Tauri 2, Electron, Vite, React 19, TypeScript, Tailwind CSS v4, COSS UI, Base UI,
Dexie, IndexedDB, Zustand, TanStack Query, TanStack Virtual, Vercel AI SDK, Zod,
Vitest, Biome, Cloudflare R2, and Cloudflare Workers for the optional hosted
control plane.

## Source map

The code lives in the [MUZERO repository](https://github.com/DoodleBears/MUZERO).
Key areas: the AI DJ engine, music-generation providers, online-source providers,
the local database, cloud sync, visualizers, and the Electron / Tauri shells.

> Contributing? See the repo's `CLAUDE.md` / `AGENTS.md` for the full architecture
> manual and house rules.
