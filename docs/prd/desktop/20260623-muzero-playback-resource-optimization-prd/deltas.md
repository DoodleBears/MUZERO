# Performance Deltas — measured via the Electron harness (prod profile build)

Method: `scripts/perf-resource.mjs` / `scripts/perf-video.mjs` + per-PID CIM
(`Win32_PerfFormattedData_PerfProc_Process` for disk/CPU, `…GPUEngine` for GPU)
joined to `app.getAppMetrics()` via `GET /processes`. Throttling OFF
(`--disable-renderer-backgrounding …`). Reads are MB/s summed over the app's
Electron PIDs. Each phase: measure → change one lever → re-measure.

---

## Root-cause correction (what the 108 MB/s actually was)

Black-box reading guessed OPFS-rewrite / video-decode / cover-derivatives. Harness
measurement on the **real library** (6124 tracks) disproved all three:

- Fresh **audio** track: ~7 MB/s. Warm **video** MV: 7.6 MB/s playing, **0 paused**. So
  neither steady playback, video decode, nor on-stage covers storm.
- **App IDLE, no playback: sustained 96–198 MB/s for 40s+.** Verbose trace (profile build)
  showed it: `cover.worker enqueue/start/success` ×93 driven by
  `player.folderSync / ncm.lazy.metadata` — the **NCM (NetEase) lazy metadata hydration**
  reading every pending `.ncm` file (multi-MB each) back-to-back, 2-concurrent **flat-out**
  (`pumpLazyNcmMetadataHydrations` instantly re-pumped on completion). Independent of
  playback → matches the user's "108 playing / 12 paused" (playback adds the visualizer rAF
  on top of the background storm).

---

## Phase 1 — disk-read storm (NCM lazy metadata hydration)

**Change:** pace the hydration refill instead of flat-out re-pump
([`player-store.ts`](../../../../src/stores/player-store.ts) `scheduleLazyNcmMetadataPump`,
`NCM_METADATA_HYDRATION_PACING_MS = 700`; 0 in tests). Concurrency unchanged (2). Nothing
the user sees changes — titles/covers still fill in, just as a gentle background trickle.
Converges (a hydrated track leaves the pending set, [repositories.ts:500](../../../../src/db/repositories.ts)).

**E2E delta — idle-startup read (no playback), 40s:**

| metric | baseline | Phase 1 | delta |
|---|---|---|---|
| read avg | ~150 MB/s | **22.9 MB/s** | **−85%** |
| read max | ~198 MB/s | 63.3 MB/s | −68% |
| sustained? | saturated 40s+ | quiet gaps (0.1 MB/s) | storm → trickle |
| CPU avg | ~12% | ~3% | −75% |

**Regression checks:** folder-sync specs pass (16 passed, incl. the 1000-track referenced-NCM
import); playback unaffected (アイドル MV still decodes, `gpuVid` active); memory ws 1310→1131 MB.

**Tunable:** raise pacing / drop concurrency to 1 to smooth the residual ~35–63 MB/s drain
bursts further, at the cost of slower metadata fill-in. 700 ms/2 chosen as the balance.

### Phase 1b — playing-aware backoff

Hydration still adds background read during its (one-time) drain, which overlaps with
listening. Make the pump pacing **playback-aware**: 2500 ms while `isPlaying`, 700 ms when
idle/paused (`NCM_METADATA_HYDRATION_PACING_PLAYING_MS`). Still progresses during playback —
just slower — so nothing the user sees changes; the listening session just stays quiet.

| read during drain | before 1b | after 1b |
|---|---|---|
| **while playing** (user's scenario) | ~30–50 MB/s | **16.8 MB/s** |
| idle/paused (drains to converge) | ~23–35 MB/s | 35.4 MB/s (faster) |

Net for the reported "108 MB/s while playing": **108 → ~17 MB/s during drain → ~7 once
converged** (−84% → −94%). folder-sync specs still pass (test mode short-circuits before the
store read).

**Note (follow-up):** genuinely failing `.ncm` hydrations (`ncm.lazy.fail`) stay pending and
re-queue next launch; pacing keeps that gentle, but a durable "attempted/failed" marker would
stop the re-scan entirely. Out of scope for this pass.

---

## Phase 2 — GPU / CPU render pipeline (measured → no safe UX-invariant lever)

**Goal:** reduce the ~15–20% GPU during playback without changing visuals.

**E2E isolation (audio track, so no video-decode confound):**

| condition | gpu3d | cpu | read |
|---|---|---|---|
| viz=bars + flow on (default) | 13.2% | 11.5% | — |
| **viz=off + flow=off** | **13.0%** | 9.7% | — |
| now-playing stage mounted | 15.5% | 13.6% | — |
| **navigated to search tab (stage unmounted)** | **19.0%** | 11.8% | — |
| **paused** (any) | **0.0%** | ~0.5% | — |

**Finding:** the GPU is **not** the visualizer (toggling it off → no change) and **not** the
now-playing stage specifically (nav away → no drop; the 6124-row virtual list composites too).
It is **playback-correlated** (→0 on pause) but **diffuse** across the app's image-heavy
compositing — there is no single wasteful component to remove. The prior "visualizer/flow rAF
is the residual cost / touching it risks 減分" note holds: the spend is the genuine cost of the
playing UI, not waste. **Decision: no change** — any reduction means broad rendering changes
that alter the look/feel, which the hard "no UI/UX change" constraint forbids. Recorded, deferred.

**Phase 3 (memory ~1–1.3 GB; GPU-proc ~750–800 MB private):** same conclusion — it's the WebGL
context + decoded-image/compositing working set, not a leak this pass surfaced (leaks are the
separate `20260612-memory-perf-audit` PRD). The Phase-1 fix already trimmed working set
(1310→1131 MB while playing) as a side effect of not buffering the `.ncm` read storm. No
additional safe lever found. Deferred.

---

## Real 4K-video validation (user-provided track: 星降之海 4K Hi-Res Live)

Confirms the disk fix holds for the heaviest case and re-confirms GPU/memory are inherent.
Element inspection: `<video>` 1920×1080 + `<audio>` driver (both `muzfetch://local-media`;
the `<audio>` decodes audio only, so no double *video* decode) + **3 full-window 2045×1297
canvases** (spectrum + flow + blur background).

| metric (playing, warm) | value | note |
|---|---|---|
| **disk read** | **~9 MB/s** | storm fixed; 53 MB/s blips = hydration backoff waves |
| gpuVid (decode) | 3–79% | inherent 1080p hardware decode (bursty on keyframes) |
| gpu3d | 8–23% | 3 background effect canvases + compositing |
| memory total | 1670 MB | — |
| GPU-proc private | 1165 MB | video frames + cover textures + Chromium GPU baseline, **not** the canvases (~10 MB each) |

**Lever check:** flow-off + spectrum-off → no gpu3d change; capping canvas DPR saves ~16 MB
(negligible vs 1.16 GB). The GPU/memory is the enabled effect stack (video + spectrum + flow +
blur, all user-on) + the decode pipeline — no UX-invariant lever. A user-opt-in "reduce GPU /
power-saver" (lower decorative DPR + fewer effect layers) is the only further move, and it
trades visible quality, so it needs the user's call, not a silent change.

## Summary

The user-visible complaint — **~108 MB/s disk while playing** — was the **NCM lazy-metadata
hydration storm**, now **−85% (150→23 MB/s, idle), with quiet gaps**, one ~700 ms-paced
background trickle that converges. Steady playback is ~7 MB/s. GPU (~15%) and RAM (~1 GB) are
inherent, diffuse costs of the image-heavy playing UI with **no safe UX-invariant lever** —
measured and deferred rather than risk the look/feel.
