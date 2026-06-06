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
- **Your own media too** — like YouTube Music, upload audio/video (MVs, voice memos) into a mixed set. Per-set display mode falls back **video → cover → title**, with an audio-only toggle.
- **Memories** — tag any track, write a note, attach a cover photo. All searchable, and fed back into the DJ so it picks up the mood of what those songs mean to you.
- **Pluggable music generation** — ships with an offline mock synth (zero setup) and a generic **cloud API (BYOK)** provider with an async submit→poll→download flow. Wire your chosen vendor (Replicate / ElevenLabs Music / Suno-style / …) by editing three mapping functions.
- **Local-first** — tracks, audio/video blobs, sets, annotations, and settings persist in IndexedDB (Dexie). No accounts, no telemetry, no servers.
- **BYOK** — your LLM/music API keys are stored on-device and sent only to the provider you choose.
- **Cross-platform** — one codebase → macOS / Windows / Linux / iOS / Android via Tauri 2.

## Stack

Tauri 2 · React 19 · Vite 8 · TypeScript · Tailwind CSS v4 · COSS UI (Base UI) ·
TanStack Query + Virtual · Dexie (IndexedDB) · Zustand · Vercel AI SDK · Zod · Vitest · Biome

## Quick start

`make` (or `make help`) lists everything; the essentials:

```bash
make install        # deps + git hooks
make dev            # browser dev at http://localhost:1420 (fastest loop)
make desktop        # Tauri desktop app with hot reload (Vite HMR + Rust shell)
make check          # full local gate: typecheck + lint + test
```

The app works out of the box with the **offline mock** music provider — start a set and the DJ
fills it immediately. To generate real music, add your LLM API key in **Settings**, switch the
music provider to *Cloud API (BYOK)*, and point it at your provider's endpoint + key. The
request/response mapping for your vendor lives in [`src/musicgen/cloud-provider.ts`](src/musicgen/cloud-provider.ts).

### Mobile

```bash
make ios-init && make ios          # needs Xcode
make android-init && make android  # needs Android SDK + NDK
```

## Project layout

See [`CLAUDE.md`](CLAUDE.md) for the full architecture, hard rules, and navigation map. The short version:

| Area | Where |
|------|-------|
| AI DJ engine (draft → generate → enqueue → refill) | [`src/dj/`](src/dj/) |
| Music-gen providers (mock, cloud BYOK, interface) | [`src/musicgen/`](src/musicgen/) |
| Track brief contract (Zod, single source of truth) | [`src/dj/dj-brief-schema.ts`](src/dj/dj-brief-schema.ts) |
| Local storage (Dexie schema + repositories) | [`src/db/`](src/db/) |
| Player transport + DJ orchestration | [`src/stores/player-store.ts`](src/stores/player-store.ts) |
| Queue math + auto-extend trigger | [`src/player/queue.ts`](src/player/queue.ts) |
| Tauri shell (desktop + mobile) | [`src-tauri/`](src-tauri/) |

## License

Private / unreleased.
