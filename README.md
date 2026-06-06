<div align="center">

# 🎧 MUZERO

**A local-first AI DJ that never stops the music.**

An LLM acts as your DJ — it writes the brief for each next track (style, lyrics, tempo, key),
calls a music-generation API to render it, and keeps extending the playlist as you listen.
No backend, no cloud. Everything lives on your device. Ships to desktop **and** mobile via Tauri.

</div>

---

## What it does

```
your vibe ──▶ 🤖 AI DJ (LLM) writes a TrackBrief ──▶ 🎵 music-gen renders a song
                     ▲                                          │
                     └────── 续上歌单: refill as the queue drains ◀┘
```

- **AI DJ loop** — the LLM drafts coherent, evolving track briefs that segue from what just played, and auto-extends the set when the queue runs low.
- **Pluggable music generation** — ships with an offline mock synth (zero setup) and an adapter for a **local [ACE-Step](../acestep-local)** server (`:8085`). Add Replicate/Suno/etc. by implementing one interface.
- **Local-first** — tracks, audio blobs, sessions, and settings persist in IndexedDB (Dexie). No accounts, no telemetry, no servers.
- **BYOK** — your LLM API key is stored on-device and sent only to the provider you choose.
- **Cross-platform** — one codebase → macOS / Windows / Linux / iOS / Android via Tauri 2.

## Stack

Tauri 2 · React 19 · Vite 8 · TypeScript · Tailwind CSS v4 · COSS UI (Base UI) ·
TanStack Query + Virtual · Dexie (IndexedDB) · Zustand · Vercel AI SDK · Zod · Vitest · Biome

## Quick start

```bash
pnpm install
pnpm dev            # browser dev at http://localhost:1420
pnpm test           # vitest
pnpm desktop:dev    # run as a Tauri desktop app (needs the Rust toolchain)
```

The app works out of the box with the **offline mock** music provider — start a set and the DJ
fills it immediately. To generate real music, run the sibling [`acestep-local`](../acestep-local)
project (`make serve`), then in **Settings** switch the music provider to *ACE-Step (local)* and
add your LLM API key.

### Mobile

```bash
pnpm ios:init && pnpm ios:dev          # needs Xcode
pnpm android:init && pnpm android:dev  # needs Android SDK + NDK
```

## Project layout

See [`CLAUDE.md`](CLAUDE.md) for the full architecture, hard rules, and navigation map. The short version:

| Area | Where |
|------|-------|
| AI DJ engine (draft → generate → enqueue → refill) | [`src/dj/`](src/dj/) |
| Music-gen providers (mock, ACE-Step, interface) | [`src/musicgen/`](src/musicgen/) |
| Track brief contract (Zod, single source of truth) | [`src/dj/dj-brief-schema.ts`](src/dj/dj-brief-schema.ts) |
| Local storage (Dexie schema + repositories) | [`src/db/`](src/db/) |
| Player transport + DJ orchestration | [`src/stores/player-store.ts`](src/stores/player-store.ts) |
| Queue math + auto-extend trigger | [`src/player/queue.ts`](src/player/queue.ts) |
| Tauri shell (desktop + mobile) | [`src-tauri/`](src-tauri/) |

## License

Private / unreleased.
