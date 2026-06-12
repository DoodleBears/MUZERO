# PRD: MUZERO 播放 Trace 性能微优化

**Status:** Completed
**Created:** 2026-06-12
**Author:** Codex
**Module:** Playback performance - remote playback cache / visualizer cover palette

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Trace audit and measurement | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Playback cache handoff optimization | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Cover palette duplicate suppression | Completed | [Phase 3 Checklist](#phase-3-checklist) |

---

## 1. Overview

### 1.1 Background

A 33-second trace captured on 2026-06-12 showed healthy playback latency overall: three manual track switches reached `play.resolved` in roughly 330-470ms and no `WARN` / `ERROR` entries appeared. The trace did reveal two repeated patterns that waste work during playback:

1. `media.load.remote.cache` appears twice for a single remote track switch when the target track is already cached.
2. `cover.palette.track-metadata` appears several times for the same track and palette target during mount / track switch.

This PRD follows the performance guidance in `.cursor/commands/prd-create.md`: record the measurement method first, then apply narrow optimizations that are directly verifiable from trace output.

### 1.2 Target Users

| Role | Description | Affected Scenario |
|------|-------------|-------------------|
| Desktop listener | Uses MUZERO as a long-running local-first player | Rapid next / previous across remote synced tracks |
| Cloud drive listener | Plays R2 / remote subscribed-manifest tracks | Cached remote tracks should start without redundant IndexedDB blob reads |
| Visualizer user | Enables cover-driven visualizer colors | Cover palette state should not re-apply repeatedly for the same target |

### 1.3 Core Value

1. **Lower switch overhead:** Avoid reading the same cached remote media blob twice during the same handoff.
2. **Cleaner trace signal:** Suppress duplicate cover palette state logs so real palette extraction and fallback events stand out.
3. **No behavior change:** Preserve local-first playback, BYOK boundaries, and the existing visual transition model.

---

## 2. Measurement Methodology

### 2.1 Source Trace

Input trace: `/Users/doodlebear/.codex/attachments/87ff6fea-9a56-4f5b-913e-6a951cde1db1/pasted-text.txt`

Observed baseline:

| Signal | Baseline Observation | Interpretation |
|--------|----------------------|----------------|
| `playback.start` -> `play.resolved` | About 330-470ms across three switches | Healthy; no evidence of major playback stall |
| `WARN` / `ERROR` | None | No failing retry loop or crash signal |
| `media.load.remote.cache` | Two entries for one cached remote handoff | Redundant cache read |
| `cover.palette.track-metadata` | 3-7 repeated entries for same track | Duplicate state application / log noise |
| DB requery | `listAllTracks` once, `memoryNotesByTrack` once | No query storm in this trace |

### 2.2 Acceptance Metrics

| Metric | Target |
|--------|--------|
| Cached remote handoff | One `media.load.remote.cache` event per cached target switch |
| Network fetch | Cached remote handoff does not call remote fetch |
| Media load | Cached remote handoff still calls `mediaEngine.loadBlob` exactly once |
| Cover palette target | Re-applying the same key/rgb/palette skips transition and duplicate trace log |
| Playback behavior | Existing player-store tests remain green |

### 2.3 Measurement Discipline

- Use production builds for user-facing performance numbers; dev StrictMode can double-run mount effects and should not be used as the final performance baseline.
- Use trace events as before/after ground truth. Do not add hidden localStorage, URL, or global flags.
- Keep the optimization scoped to existing modules: `player-store` and `visualizer-dynamic-color`.

---

## 3. System Architecture

```
Remote track switch
  -> playIndex()
      -> optional readRemotePlaybackCache()
      -> preparedRemotePlayback
  -> ensureLoadedAndPlay()
      -> consume prepared blob first
      -> fallback to cache read
      -> fallback to network fetch
      -> MediaEngine.loadBlob()

Cover color update
  -> useVisualizerCoverColorCss()
      -> metadata/cache/thumbhash/extraction
      -> applyVisualizerCoverColorTarget()
          -> skip if target signature is unchanged
          -> transitionVisualizerCoverColor()
```

---

## 4. Implementation Plan

### Phase 1: Trace audit and measurement

**Goal:** Confirm whether the supplied trace shows a severe performance issue or narrow repeated work.

**Tasks:**
- [x] Inspect trace line count and timeline.
- [x] Check for `WARN`, `ERROR`, long-running retries, and repeated events.
- [x] Compare playback start / resolve timing across track switches.

### Phase 1 Checklist

- [x] Baseline findings recorded in this PRD.
- [x] No severe playback stall identified from this trace.

### Phase 2: Playback cache handoff optimization

**Goal:** Avoid the second cache read when `playIndex()` has already prepared the cached remote blob.

**Tasks:**
- [x] Change `ensureLoadedAndPlay()` remote path to consume `preparedRemotePlayback` before calling `readRemotePlaybackCache()`.
- [x] Keep cache fallback and network fetch fallback unchanged.
- [x] Add a regression test that counts `media.load.remote.cache` trace events for a cached handoff.

### Phase 2 Checklist

- [x] Cached remote handoff emits one cache-load trace event.
- [x] Cached remote handoff does not fetch from the network.
- [x] Cached remote handoff still plays through `loadBlob`.

### Phase 3: Cover palette duplicate suppression

**Goal:** Avoid repeated visualizer cover color transitions and duplicate palette metadata logs for identical targets.

**Tasks:**
- [x] Add a module-level target signature for the last applied cover color.
- [x] Route cover color transitions through a small dedupe helper.
- [x] Log metadata/cache/fallback events only when the target actually changes.

### Phase 3 Checklist

- [x] Same key/rgb/palette target is skipped.
- [x] Theme changes still apply because RGB signature changes.
- [x] No hidden flags or runtime toggles added.

---

## 5. Out of Scope

- Full frame cadence / Long Tasks instrumentation beyond the existing trace pipeline.
- Large media streaming redesign or OPFS storage changes.
- React StrictMode mount behavior changes.
- Broader DB liveQuery batching or search worker incremental updates.

---

## 6. Security Considerations

- No new outbound requests.
- No API key, URL query, or user media data is added to logs.
- Existing trace URL sanitization remains in place.
- All data remains local-first; playback cache continues using local IndexedDB storage.

---

## 7. Related Documents

| Document | Description |
|----------|-------------|
| [prd-create.md](../../../.cursor/commands/prd-create.md) | PRD workflow and performance measurement requirements |
| [Structured diagnostics trace PRD](../20260611-muzero-structured-diagnostics-trace-prd/20260611-muzero-structured-diagnostics-trace-prd.md) | Existing trace recorder design |
| [Memory perf audit PRD](../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md) | Broader performance audit context |

---

## 8. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should cover palette duplicate counts become an explicit perf counter? | Resolved | Not for this phase; trace cleanup is sufficient. |
| 2 | Should remote cache handoff support streaming instead of Blob for large video? | Deferred | Covered by larger OPFS / large media PRDs, not this micro-optimization. |

---

## 9. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | Codex | Initial PRD and completed implementation scope |
