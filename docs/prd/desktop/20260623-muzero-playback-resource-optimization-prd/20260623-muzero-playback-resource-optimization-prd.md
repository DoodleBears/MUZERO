# PRD: Playback Resource Optimization (CPU / GPU / Memory / Disk I/O)

**Status:** Draft
**Created:** 2026-06-23
**Author:** MUZERO / DoodleBears
**Module:** Player / Now-Playing render pipeline / dev perf harness

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | Measurement instrument (per-process disk I/O + steady-state report) | ✅ Done (reproduced & root-caused, §1.5) | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | Disk storm = **NCM lazy-metadata hydration** (paced) — **idle read −85% (150→23 MB/s)** | ✅ Done | [deltas.md](deltas.md) |
| 2 | GPU / CPU render pipeline — measured: diffuse, not the visualizer; **no safe UX-invariant lever** | ⏸️ Deferred | [deltas.md](deltas.md) |
| 3 | Memory (~1 GB) — WebGL/compositing working set, not a leak; Phase 1 already trimmed 1310→1131 MB | ⏸️ Deferred | [deltas.md](deltas.md) |
| 4 | Paused-idle — subsumed by Phase 1 (paused storm was the same NCM hydration, now paced → converges to ~0) | ✅ via P1 | [deltas.md](deltas.md) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Field observation (Windows 11, Electron build) while playing a **streamed MV** ("MENTE MÁ · Nakama/MC Staff"):

| State | Total CPU | Total Mem | Disk | GPU |
|-------|-----------|-----------|------|-----|
| **Playing** (图1) | ~17.4% | ~1064 MB | **~108 MB/s** | ~19.7% |
| **Paused** (图2) | ~1.2% | ~1026 MB | **~12 MB/s** | 0% |

Per-process highlights while playing: one renderer 754 MB (no GPU, 0 disk); GPU process 176 MB @ 19.7% GPU; the window-owning renderer (shows the song title) 118 MB @ 3.9% CPU **and ~108 MB/s disk**.

Architectural fact that frames everything: streamed tracks use **download-before-play** ([`player-store.ts:4733`](../../../../src/stores/player-store.ts)) — the whole song/MV is pulled into one in-memory `Blob`, fed to the media element as an object URL, and cached to OPFS. So steady-state playback runs from a **memory blob**, which is why **network is 0 Mbps** during playback. That makes the resource picture:

- **CPU ~17% / GPU ~20% playing → ~0 paused**: *explainable.* The Now-Playing backdrop composites multiple full-screen layers every rAF — foreground `<video>`, a background pipeline that can run a **second `<video>` decode** ([`PlainBackgroundVideo`, now-playing-background.tsx:733](../../../../src/components/player/now-playing-background.tsx)) or Pixi WebGL, **plus two independent WebGL `VisualizerHost` contexts** (spectrum [:619](../../../../src/components/player/now-playing-background.tsx) + flow [:586](../../../../src/components/player/now-playing-background.tsx)) blended with `mix-blend-mode`. The pause→0 collapse proves the rAF/visibility-pause logic is correct; the absolute level is just high. Prior prod profiling already identified the visualizer/flow canvas rAF as the residual continuous playback cost (memory: `perf-control-endpoint-harness`).
- **Memory ~1 GB, flat across play/pause**: *high, and a known concern* (see [`20260612-muzero-memory-perf-audit-prd`](../../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md)). Flatness ⇒ it is **resident**, not playback-transient: full song/MV blobs held by object URLs, preloaded prev + next-2 blobs ([`use-playback-warmup.ts:42`](../../../../src/hooks/use-playback-warmup.ts)), cover caches, decoded bitmaps, WebGL textures.
- **Disk ~108 MB/s playing, ~12 MB/s paused**: **the anomaly.** A player streaming from a memory blob should be ~0 disk in steady state. The rate **collapses in lockstep with GPU** (108→12 as 20%→0), so the disk I/O tracks the **render/decode loop**, not audio buffering. Even ~12 MB/s while *paused* is abnormal for an idle player.

### 1.2 Target Users

| Role | Description | Impact |
|------|-------------|--------|
| **Desktop listener (laptop)** | Plays long sessions on battery | 20% GPU + high disk = fans, heat, battery drain, SSD wear |
| **Desktop listener (low-RAM)** | 8 GB machines | ~1 GB resident + large video blobs risks pagefile thrash |
| **Maintainer** | Profiles/optimizes the app | Needs a per-process disk metric the current harness lacks |

### 1.3 Core Value

1. **Quiet when idle**: paused playback approaches ~0 CPU/GPU/disk.
2. **Lighter when playing**: cut redundant decode/WebGL work and resident memory **with zero visible UI/UX change**.
3. **Measurable**: a repeatable per-process CPU/Mem/**Disk** instrument so every change is proven by before/after numbers, not vibes.

### 1.4 Hard Constraints (non-negotiable)

- **No UI/UX change.** Same visuals (covers, blur, flow, spectrum, video), same interactions, same transitions. Optimizations must be invisible. Any change that alters appearance or feel is out of scope here.
- **Measurement-driven, on a PROD build.** Dev-build numbers invert the ranking (jsxDEV + trace-observer noise). Always profile via the profile build (`make electron-profile`). (memory: `perf-control-endpoint-harness`.)
- **Guard the fragile visualizer.** Prior work flagged that touching the visualizer/flow rAF "risks 減分" (regression). Every render-path change must pass the switch-fps regression bars (`toFrame` / `longTask` / `fpsLow` no worse) AND a visual screenshot parity check.
- **Local-first / codename layer unchanged.** No new backend, no DB name / id-prefix / provider-id churn (CLAUDE.md hard rules 1, 4, 5, 10).

### 1.5 Measured findings (2026-06-23) — diagnosis CORRECTED

Built the harness (`scripts/perf-resource.mjs` + per-PID CIM disk/GPU + CDP profiling) and measured the **real library** on a prod profile build. This **overturns** the original code-reading hypotheses (OPFS streaming re-write / pagefile). Evidence:

1. **The "video set" is all audio.** The 13-track set has `displayMode:"video"` but **no track has video media** — all fall back to covers. The screenshotted tracks (MENTE MÁ, PASSO BEM SOLTO) play from `muzfetch://local-media` (disk file) or `blob:` (memory). So the 108 MB/s was **never video decode**.

2. **Steady playback is disk-quiet.** A 28 s time-series on MENTE MÁ (window throttled): **~0 MB/s read** after a 0.9 MB/s startup blip. The disk I/O is **not inherent to playback**.

3. **The window must actually render to reproduce it.** The harness window is backgrounded/occluded → Chromium throttles rAF → CPU/GPU/disk all ~0 (misleading). Relaunching with `--disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-features=CalculateNativeWinOcclusion` reproduced the field numbers: **playing GPU ~30 %, CPU ~12 %, read 27–66 MB/s; paused CPU ~10 %, read 94–140 MB/s** (visualizer GPU correctly 0 when paused, but the **read keeps going** — so it's not the visualizer).

4. **It's a cover-derivative/palette DB storm, not streaming.** CDP showed **zero network requests** during the 100 MB/s read → not a re-fetch. A renderer CPU profile attributed it to **`resolveMediaBlob` ([media-blob-storage.ts](../../../../src/db/media-blob-storage.ts)) + Dexie `transaction`/`get`/`getAll`/`put` + a repositories worker + 16 % GC** (Blob/arrayBuffer/slice churn). It runs **regardless of background/visualizer settings** and **even when paused**. It is **intermittent**: high while sweeping all 13 tracks (cold derivative cache), then **~0 once cached** — i.e. it's **cover palette/backlight/thumbnail derivative generation** re-reading full cover blobs and writing derivatives, on cold cache / track changes. The candidate feedback shape is a Dexie `useLiveQuery` whose resolve **writes** a table it observes → re-fire loop (see [visualizer-dynamic-color.tsx:398-420](../../../../src/components/player/visualizer-dynamic-color.tsx), [cover-derivatives](../../../../src/db/cover-derivatives.ts)).

5. **Memory signal:** even on a *fresh* build the **GPU process holds ~800–1340 MB private** (multi-canvas WebGL: 2× ~1995×1240 fullscreen contexts + cover canvases). This — not streaming blobs — is the dominant memory line, and grows the working set toward the user's ~1 GB.

6. **(Update — video tracks) The 108 MB/s on a real MV is video DECODE re-reading the file.** Library has **6124 tracks, 23 `kind:"video"`** with real `video/mp4` media (6–184 MB). Playing アイドル (YOASOBI MV) reproduced the field numbers exactly: **CPU 15–20 %, GPU 20–43 %, read 95–159 MB/s, RAM 1331 MB**. Decisive test: 15 s in (cover settled) read stays **95–159 MB/s, ~entirely on the Browser/main process**; **pause → 0**. So it's decode, not the cover storm. Element inspection: **two media elements both on `muzfetch://local-media`** — the engine's audio **driver** + the muted **video** visual = the **same file decoded twice** ([media-engine.ts](../../../../src/player/media-engine.ts) `loadSource` sets both `audioEl.src` and `videoEl.src`). Both report `readyState:4` / fully buffered, yet the main process re-reads at ~150 MB/s (≫ the ~2 Mbps bitrate) because Chromium **doesn't cache the custom-scheme (`muzfetch://`) media response** → the `<video>` element re-reads ranges from disk via [fetch-proxy.cjs `handleLocalMedia` → `fs.createReadStream`](../../../../electron/fetch-proxy.cjs). Single audio-only local-media tracks read ~0; the **video element is the re-reader**, and the second (audio) element doubles it.

**Reprioritized root causes (TWO real disk causes):**
- **Disk-A — cover derivative/palette generation read+write storm** (audio + video tracks; only **342 / 3367** covers have derivatives → mostly ungenerated → runs constantly; throttled → 12 MB/s paused / 108 MB/s foreground). This is what the user's **audio** screenshots (MENTE MÁ / PASSO BEM SOLTO) were. Fix: derivatives generate **once and stick** (durable cache, no full-blob re-read, no liveQuery write-feedback, off the hot path).
- **Disk-B — video MV decode re-reads the `muzfetch://local-media` file** (~150 MB/s, decode-tied, doubled by audio+video both decoding the same file). Fix: (a) make the local-media media response **cacheable/seekable** so Chromium buffers once (Cache-Control + privileged scheme caching), and/or (b) **don't decode the file twice** for video tracks (drive audio from the single video element, or extract the audio track) — see CLAUDE.md "mediabunny 音轨抽取是后续增强".
- **GPU ~20–43 % playing = visualizer + flow (audio) + video decode (video).** Phase 2.
- **GPU-process ~0.8–1.3 GB = WebGL canvas/texture footprint + video frames.** Phase 3.
- The **OPFS-streaming-re-write** and **pagefile** hypotheses are **disproven**.

> Harness gotcha (now a hard rule): **measure with throttling disabled**, else a backgrounded window reads ~0 and inverts the picture. Use CIM `Win32_PerfFormattedData_*` (non-localized) for disk/GPU on zh-Windows. Profile/settings changes **persist to the shared `%APPDATA%` userData** — restore them after a run.

---

## 2. System Architecture

### 2.1 Measurement loop

```
            ┌──────────────────────────── PROD profile build ───────────────────────────┐
            │  make electron-profile  (VITE_MUZERO_PROFILE=1 vite build + Electron via    │
            │  app://, MUZERO_PERF_CONTROL=1, MUZERO_REMOTE_DEBUG_PORT=39222)             │
            └───────────────┬─────────────────────────────────────────┬──────────────────┘
                            │ HTTP 127.0.0.1:7345 (token)              │ CDP :39222
                            ▼                                          ▼
   scripts/perf-resource.mjs ──┬─ GET /processes  → per-proc CPU + mem (app.getAppMetrics)
   (NEW, Phase 0)              ├─ Windows Get-Counter by PID → per-proc DISK bytes/s (NEW)
                              └─ POST /player/* , /settings → drive paused vs playing
                            │
                            ▼
            .logs/perf-reports/resource-*.json   (paused | playing | delta, per process type)
                            │
        measure ──▶ change one lever ──▶ re-measure ──▶ assert no UX/FPS regression ──▶ keep/revert
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Per-proc CPU/Mem** | `app.getAppMetrics()` via existing `GET /processes` ([`perf-control.cjs:371`](../../../../electron/perf-control.cjs)) | Already wired; returns CPU% + working/private MB per process, grouped by type, with PIDs |
| **Per-proc Disk** | Windows `Get-Counter '\Process V2(*)\IO Data Bytes/sec'` keyed by PID | `app.getAppMetrics()` has **no** disk; PowerShell perf counters give per-PID I/O; PIDs come from `/processes` |
| **Renderer JS heap** | CDP `Performance.getMetrics` ([`perf-playback-memory.mjs`](../../../../scripts/perf-playback-memory.mjs)) | Separates JS heap from native/process RSS |
| **FPS / longtask / switch** | existing `perf-frames.mjs` / `perf-drive.mjs` | Regression bars for UX-invariance |
| **CPU flame** | existing `perf-profile.mjs` (`.cpuprofile` + analysis) | Attribute CPU to functions when a lever is unclear |

### 2.3 Touched files (modify-first; reference, not rewrite)

```
electron/
  perf-control.cjs                 # (maybe) add disk to /processes, else keep disk OS-side in the script
scripts/
  perf-resource.mjs                # NEW Phase-0 driver: paused vs playing, CPU/Mem/Disk per process
  lib/cdp-client.mjs               # reuse
src/
  components/player/
    now-playing-background.tsx     # Phase 2: dedup PlainBackgroundVideo decode; gate layers
    pixi-pixel-background.tsx      # Phase 2: texture-source / rAF review
  visualizer/
    host.tsx (VisualizerHost)      # Phase 2: single rAF / single GL context for spectrum+flow
  player/
    media-engine.ts                # Phase 3: video from OPFS file handle vs in-RAM blob
    playback-cache.ts              # Phase 1: OPFS write path (one-shot, no re-write)
    playback-preload.ts            # Phase 3: don't warm full *video* blobs into RAM
  hooks/use-playback-warmup.ts     # Phase 3: bound video warmup
  stores/player-store.ts           # Phase 1/4: cache-write trigger; paused-idle quiescence
  sync/r2-presence-*               # Phase 4: confirm idle when paused
```

---

## 3. Data Model Design

No schema change. `playbackCache` ([`playback-cache.ts`](../../../../src/player/playback-cache.ts)) and `mediaBlobs` stay as-is. DB name `muzero-db`, id prefixes, provider ids unchanged (CLAUDE.md rule 4). If Phase 3 plays video from the OPFS cache file instead of an in-RAM blob, it reuses the **existing** `PlaybackCacheEntry.fileName` / OPFS dir — no new table, no migration.

---

## 4. API Design

Dev-only control endpoint only (never ships — `shouldEnablePerfControl` stays gated, [`perf-control.cjs:31`](../../../../electron/perf-control.cjs)). Optional additive route:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/processes` | GET | **existing** — per-process CPU + memory snapshot |
| `/processes?disk=1` | GET | *optional* — if disk is sampled in-main; otherwise disk stays OS-side in `perf-resource.mjs` (preferred: no app-code coupling) |

Decision default: **keep disk sampling in the script (PowerShell), not in app code** — zero product-code surface, mirrors the "DEV automation seam, not a backend" principle.

### 4.3 Error Handling / Telemetry

- Harness only. If `Get-Counter` instance↔PID mapping is ambiguous (multiple "MUZERO" instances), resolve via `\Process V2(*)\ID Process` and match on PID; log unmatched PIDs rather than silently dropping.
- Product logging stays on [`src/lib/logger.ts`](../../../../src/lib/logger.ts) (rule 8). No new always-on logging added by this PRD.

---

## 5. Frontend Design

### 5.1 / 5.2 UI Components — **invariant**

No new UI. No visible change to Now-Playing, dock, settings, covers, blur, flow, spectrum, or video. The only *optional* user-facing addition considered is a **"reduce GPU / power saver"** toggle in Settings (rule 3 / rule 9: a runtime toggle must be a visible Settings control, never a hidden flag) — and even that is **deferred / out of scope unless** Phase 2 cannot hit targets without a user-selectable quality drop. Default behavior and appearance do not change.

### 5.3 State Management

Render-path levers operate below the React tree (decode dedup, GL-context consolidation, rAF cadence) or in non-reactive singletons (`MediaEngine`, `VisualizerHost`), so they don't add store subscriptions (rule 6). Memory levers change *where bytes live* (OPFS file vs RAM blob), not what the UI reads.

---

## 6. Implementation Plan

> Every phase is **measure → change ONE lever → re-measure → assert no UX/FPS regression → keep or revert.** Targets are set against the Phase-0 baseline (filled in once captured).

### Phase 0: Measurement instrument

**Goal:** A repeatable per-process **CPU / Memory / Disk** report for paused vs playing, on a prod profile build, so the disk anomaly is attributable and every later change is provable.

**Tasks:**
- [ ] `scripts/perf-resource.mjs`: read `/processes` (CPU+mem+PIDs); sample Windows per-PID disk via `Get-Counter` over an N-second window; drive paused→playing via `/player/*`; emit `.logs/perf-reports/resource-<scenario>.json` with per-process-type paused/playing/delta for CPU%, workingSet MB, private MB, **disk read/write B/s**.
- [ ] Reproduce the field numbers (playing ~108 MB/s disk / ~20% GPU / ~1 GB; paused ~12 MB/s) on the streamed-MV scenario, so the baseline matches reality.
- [ ] Attribute disk: cross-check OPFS write bursts (Phase-1 hypothesis A) vs pagefile/standby (hypothesis B) using `Get-Counter '\Process V2(*)\Working Set'` + `'\Memory\Pages Output/sec'` alongside per-proc IO.

### Phase 0 Checklist
- [ ] Baseline JSON committed under the PRD folder (`baseline/`).
- [ ] Numbers reproduce the Task-Manager screenshots within ~±20%.
- [ ] Disk root-cause hypothesis ranked with evidence (A: OPFS re-write, B: pagefile, C: per-frame read).

### Phase 1: The two disk-read causes (the 108 MB/s)

**Disk-B — video MV decode re-read (highest impact for video tracks):**
- [ ] Make the `muzfetch://local-media` media response **cacheable/seekable** so Chromium buffers it once instead of re-reading per frame ([fetch-proxy.cjs `handleLocalMedia`](../../../../electron/fetch-proxy.cjs)): add `Cache-Control`, verify the privileged scheme is registered with caching (`registerSchemesAsPrivileged` flags), confirm 206/range round-trips are cache-reused. Re-measure read while a 1080p MV plays.
- [ ] **Don't decode the file twice** for video tracks ([media-engine.ts](../../../../src/player/media-engine.ts)): the audio **driver** + muted **video** visual both decode the same file. Drive audio from the single video element while it's mounted (or extract the audio track), keeping the "audio keeps playing when video unmounts" guarantee. Verify playback/seek/visuals unchanged.
- [ ] Target: video-track steady read ≪ 150 MB/s (ideally ~bitrate); CPU/GPU down from the second decode.

**Disk-A — cover derivative/palette generation storm:**

**Goal:** Cover derivative/palette generation reads each cover blob **once, ever**, and stops re-reading during steady rendering. Foreground read while rendering → near-0 once the cache is warm; no read storm on track change after first pass. (Note: only 342/3367 covers have derivatives — a one-time backfill may be worth it so the storm doesn't recur per-track.)

**Root cause (measured, §1.5):** `resolveMediaBlob` + Dexie `get/getAll/put` + repositories worker + 16 % GC, running continuously while the window renders (even paused), independent of background/visualizer toggles. Intermittent — high on cold derivative cache, ~0 once warm. Strong signature of a `useLiveQuery` whose resolver **writes** an observed table (re-fire feedback) and/or per-track derivative regeneration that doesn't durably cache.

**Investigation tasks (confirm exact loop before changing code):**
- [ ] Profile the **repositories worker** target (not just the page) to attribute the `put`/`getAll` to a specific derivative (palette vs backlight vs thumbhash). Files: [cover-derivatives.ts](../../../../src/db/cover-derivatives.ts), [visualizer-dynamic-color.tsx](../../../../src/components/player/visualizer-dynamic-color.tsx), [use-media.ts](../../../../src/hooks/use-media.ts).
- [ ] Instrument (dev-only) a counter of `resolveMediaBlob` calls/sec + Dexie `put` calls/sec to confirm the rate and which table is written; check whether the written table is observed by the same `useLiveQuery` (feedback loop) or whether a `shouldResolve*` guard fails to flip after the write.

**Fix candidates (pick by evidence, minimal change):**
- [ ] Make the derivative write **idempotent + durable** so `shouldResolve*` flips to false after the first generation (no regeneration on revisit). If a liveQuery observes the table it writes, move the write **out of the observed query** (resolve in an effect, write once, read via a non-observing path) — kills the feedback loop.
- [ ] Don't re-read the **full** cover blob for palette when a cached palette / thumbhash exists ([visualizer-color-store](../../../../src/stores/visualizer-color-store.ts) / `coverPalette` column).
- [ ] Throttle/idle-schedule generation off the render hot path; cap concurrency.

### Phase 1 Checklist
- [ ] `resolveMediaBlob`/`put` rate during steady foreground render ≈ 0 after warm; no regeneration when revisiting a track.
- [ ] Foreground playing read ≪ baseline (target < ~5 MB/s steady); GC share down.
- [ ] No regression in `perf-frames` / switch-fps bars; **cover/palette/flow colors visually identical** (screenshot parity).

### Phase 2: GPU / CPU render-pipeline reduction (UX-invariant)

**Goal:** Lower playing GPU% and CPU% with identical output. Levers, each measured independently:
- [ ] **Dedup video decode for MV tracks:** `PlainBackgroundVideo` decodes the *same* source as the foreground stage. Sample the foreground video into the background (one decode) instead of a second `<video>` — pixel-identical result.
- [ ] **Consolidate the two WebGL contexts:** spectrum + flow are separate `VisualizerHost` instances blended via CSS `mix-blend-mode`. Evaluate one GL context / one rAF rendering both passes (same composite) to halve context overhead.
- [ ] **rAF cadence:** confirm a single shared rAF; verify visibility/occlusion pause covers the background layer too; consider an internal-resolution cap on the flow scene that is visually indistinguishable when blurred/dimmed.

> Guardrail: visualizer is fragile ("減分" risk). Each lever ships only if FPS bars hold AND screenshots match. Revert any lever that doesn't clearly win.

### Phase 2 Checklist
- [ ] Playing GPU% and CPU% reduced vs baseline.
- [ ] `toFrame` / `longTask` / `fpsLow` no worse than baseline.
- [ ] Screenshot parity for cover / blur / flow / spectrum / MV.

### Phase 3: Memory footprint

**Goal:** Cut resident MB (esp. for video MV) without changing playback behavior.
- [ ] **Play video from the OPFS cache file**, not an in-RAM `Blob` object URL: once cached, feed the media element from the `PlaybackCacheEntry.fileName` handle (range-seekable) so the multi-tens-of-MB video isn't pinned in RAM. Audio (small) can stay as-is.
- [ ] **Bound warmup for video:** [`use-playback-warmup.ts`](../../../../src/hooks/use-playback-warmup.ts) warms prev + next-2 full blobs; for *video* tracks, warm cover only (or stream from OPFS), don't pull multiple tens-of-MB videos into RAM.
- [ ] Re-check object-URL lifetimes against the memory-audit PRD's blob-URL live counter ([`perf-counters.ts`](../../../../src/lib/perf-counters.ts)).

### Phase 3 Checklist
- [ ] Resident working-set + JS-heap reduced vs baseline (target set in Phase 0).
- [ ] Scrub / seek / prev / next still instant (download-before-play seekability preserved).
- [ ] If disk was pagefile-driven (Phase-1 B), playing disk now also drops.

### Phase 4: Paused-idle quiescence

**Goal:** A paused player is genuinely idle (CPU ~0, GPU 0, disk ~0).
- [ ] Trace the residual ~12 MB/s paused disk (presence / r2-sync / liveQuery / autosave). Ensure presence/sync coalesce and idle when `!isPlaying`.
- [ ] Confirm all rAF loops + intervals stop on pause / document-hidden.

### Phase 4 Checklist
- [ ] Paused disk ≈ 0, paused CPU ≈ baseline-best.
- [ ] No functional loss (presence still updates on the next play/seek).

---

## 7. Out of Scope

- Any visible UI/UX or behavior change (this is a pure resource pass).
- Streaming **vendor** changes, DJ loop, search, sync features.
- Mobile (separate native track, memory: `mobile-native-port-direction`).
- A user-facing "power saver" toggle — only revisited if Phase 2 can't hit targets invisibly.
- Tauri shell (Electron is the desktop target).

---

## 8. Security Considerations

- The perf-control endpoint and `perf-resource.mjs` are **dev-only**, loopback-only, token-gated, and can never ship (`shouldEnablePerfControl` truth table + prod regression test). No new product attack surface.
- No keys/PII in reports; `Get-Counter` reads OS perf counters only (process IO/memory rates, no payload). Local-first unchanged.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260612-muzero-memory-perf-audit-prd](../../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md) | Prior memory audit (blob-URL leaks, F-1…); Phase 3 builds on it |
| [20260615 dev-control-endpoint-automation-harness](../../20260615-muzero-dev-control-endpoint-automation-harness-prd/) | The harness this extends |
| [20260613 now-playing switch background perf](../../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | Background pipeline switch-cost analysis |
| memory `perf-control-endpoint-harness` | Launch gotchas, prod-vs-dev profiling, "減分" guardrail |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Is the 108 MB/s disk OPFS re-write, pagefile thrash, or per-frame read? | Open | Resolved in Phase 0 by attribution |
| 2 | Can spectrum + flow share one GL context without any visual diff? | Open | Prototype + screenshot-diff in Phase 2 |
| 3 | Does playing video from an OPFS file handle keep scrub/seek instant? | Open | Validate in Phase 3 |
| 4 | Source of the 12 MB/s paused disk? | Open | Phase 4 trace |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-23 | DoodleBears | Initial draft — observations, constraints, 5-phase measure-driven plan |

---

> **Method note:** modify existing files, reference real code, change one lever at a time, and let the harness (per-process CPU/Mem/**Disk** + FPS bars + screenshot parity) decide keep-vs-revert. Profile a **prod** build. Preserve UI/UX exactly.
