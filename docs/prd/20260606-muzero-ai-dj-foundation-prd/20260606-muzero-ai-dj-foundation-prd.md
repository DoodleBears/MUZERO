# PRD: MUZERO — AI DJ Foundation (v0.1)

**Status:** Final
**Created:** 2026-06-06
**Author:** MUZERO
**Module:** Core — AI DJ loop, local persistence, Tauri shell

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Scaffold + core loop (mock provider) | ✅ Completed | this doc |
| 2 | Cloud music API (BYOK) integration | 🔲 Pending | §6 |
| 3 | LLM DJ polish (continuity, taste) | 🔲 Pending | §6 |
| 4 | Mobile builds (iOS / Android) | 🔲 Pending | §6 |
| 5 | Library, likes, export, i18n wiring | 🔲 Pending | §6 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Music players play a fixed library; AI music tools generate one song at a time. MUZERO closes the
loop: an LLM **DJ** continuously authors track briefs and drives a music-generation API so the
playlist never ends and stays coherent with a vibe. It must run fully on-device (desktop + mobile),
with no backend and no cloud dependency beyond the user's own BYOK model endpoints.

### 1.2 Target Users

| Role | Description |
|------|-------------|
| **Listener** | Wants an endless, vibe-driven, generative radio station they control. |
| **Tinkerer** | Brings their own cloud music + LLM API keys and wants a great front-end to drive them. |

### 1.3 Core Value

1. **Endless & coherent** — the DJ segues, evolves, and refills the queue automatically (续上歌单).
2. **Local-first & private** — tracks, audio, settings all in IndexedDB; keys never leave the device except to the chosen model API.
3. **Provider-agnostic** — one `TrackBrief` contract drives any music backend.

---

## 2. System Architecture

### 2.1 The loop

```
seed/vibe ─▶ DjBrain (LLM, generateObject) ─▶ TrackBrief[]
                                                  │
                              DjEngine.draft  ────┤ create pending Track, append to session queue
                                                  │
                        DjEngine.materializeNext ─┤ MusicGenProvider.generate ─▶ WAV Blob ─▶ mediaBlobs
                                                  │
                       player consumes queue; upcoming ≤ refillThreshold
                                                  │
                       DjEngine.refillIfNeeded ───┘ (back to draft)
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Shell | Tauri 2 | One Rust-hosted WebView → desktop + mobile; `http` plugin gives CORS-free local/BYOK calls |
| UI | React 19 + Vite 8 + Tailwind v4 + COSS UI (Base UI) | Fast, modern, accessible primitives via shadcn registry |
| Async | TanStack Query | Request/response calls (provider health, future hosted providers) |
| Reactive reads | Dexie `useLiveQuery` | IndexedDB rows stream into the UI as generation completes |
| Local state | Zustand | Player transport + DJ orchestration, with minimal selectors |
| Virtualization | TanStack Virtual | Endless sets → only visible rows mount |
| Persistence | Dexie 4 (IndexedDB) | The entire datastore; DB name `muzero-db` |
| AI | Vercel AI SDK (`ai` v6) | `generateObject` for structured TrackBriefs, BYOK |
| Validation | Zod 4 | `TrackBrief` is the single DJ↔musicgen↔DB contract |
| Test | Vitest + fake-indexeddb | Integration-cover the loop without a model/network |

### 2.3 Project Structure

See [`CLAUDE.md`](../../../CLAUDE.md) §项目结构.

---

## 3. Data Model Design

`muzero-db` (Dexie v1), defined in [`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts):

- **tracks** `id, sessionId, status, createdAt, liked` — one row per generated song; audio excluded.
- **mediaBlobs** `id, trackId` — the WAV bytes, kept out of the hot `tracks` table so list queries stay light.
- **sessions** `id, status, updatedAt` — a DJ run: `seedPrompt`, ordered `trackIds` (the queue), `config`.
- **settings** `id` — singleton: LLM provider/model/keys (BYOK), music provider + cloud API url/key/model (BYOK), locale, resume point.

**Invariants:** audio bytes never live on `tracks`; `TrackBrief` shape changes go through the Zod schema only; codename layer (`muzero-db`, table names, id prefixes, provider ids) is stable across brand changes.

---

## 4. Key Interfaces

- **`TrackBrief`** ([`src/dj/dj-brief-schema.ts`](../../../src/dj/dj-brief-schema.ts)) — title, caption (style), lyrics, duration, bpm, key, time-sig, vocal language, djNote.
- **`DjBrain`** ([`src/dj/dj-engine.ts`](../../../src/dj/dj-engine.ts)) — `draftBriefs(ctx) → TrackBrief[]`. Real impl wraps the LLM; tests inject a canned brain.
- **`MusicGenProvider`** ([`src/musicgen/provider.ts`](../../../src/musicgen/provider.ts)) — `generate({ brief }) → { blob, mime, durationSec }`. Impls: `mock` (offline), `cloud` (BYOK cloud API, async submit→poll→download).

---

## 5. Acceptance (Phase 1 — done)

- [x] `pnpm test` green: queue math, WAV encode, and the full draft→materialize→refill loop (fake-indexeddb + mock provider + canned brain).
- [x] `pnpm typecheck`, `pnpm build`, `pnpm lint` clean.
- [x] App boots, starts a set, the mock DJ fills + plays the queue, visualizer reacts, queue auto-extends, settings persist.
- [x] Tauri 2 scaffold (desktop + mobile config, icons, capabilities) in place.

## 6. Roadmap (next phases)

- **Phase 2 — Cloud music API (BYOK)**: pick the vendor, fill in `mapBriefToBody` / `parseCreate` / `parseStatus` in `cloud-provider.ts`; surface generation progress + cancellation; handle rate limits, long jobs, and audio-format variance (mp3/wav/ogg).
- **Phase 3 — DJ taste**: stronger continuity (key/tempo segue rules), de-dup memory across a long set, per-session "energy arc", optional user steering mid-set.
- **Phase 4 — Mobile**: `ios:init` / `android:init`, safe-area + transport-in-notification, background audio entitlements, on-device storage quotas.
- **Phase 5 — Library/UX**: cross-session library, likes/export (download WAV), i18n wiring (en/zh/ja/ko catalogs already seeded), full COSS UI adoption.

## 7. Non-goals (v0.1)

- No cloud sync / accounts / server. No telemetry. No hidden runtime flags (rollback = `git revert`).
- No specific cloud vendor wired yet (interface + generic submit→poll→download flow are ready; mapping functions are the single edit point). Local/on-device models are out of scope.
