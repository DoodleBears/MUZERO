# PRD: MUZERO AMLL-Style Lyrics Layout Engine

**Status:** Draft
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** Lyrics / Now Playing - Apple Music-like continuous lyric motion

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Research Baseline + Engine Contract | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Pure Layout Solver + TDD Fixtures | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | rAF DOM Driver + React Integration | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Word Fill / Secondary Lines / Click Seek Parity | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Performance QA + Rollout Cleanup | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO currently renders synced lyrics in [`src/components/player/synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx) using React rows, Motion transforms, and a scroll-follow controller. This supports highlighting, click-to-seek, translation / romanization, and word-by-word fill, but the attempted `classic / inertial / cascade` modes do not reproduce the Apple Music-like feeling users expect:

- Cascade is hard to perceive because it is a one-shot row transform rather than a continuous layout engine.
- Track changes can regress into many row-level Motion animations if the implementation relies on per-row imperative controllers.
- The primary movement remains `scrollTop` updates, so row-level delays are visually swallowed by the scroll container.

LyciaMusic was reviewed as a reference implementation. Its README describes lyrics support as "based on AMLL" and its `package.json` depends on `@applemusic-like-lyrics/core`, `@applemusic-like-lyrics/lyric`, and `@applemusic-like-lyrics/vue`. Its app-level wrapper (`AmlLyricPlayer.vue`) creates a patched AMLL DOM player, runs `player.update(delta)` every `requestAnimationFrame`, and forwards `currentTime`, lyric lines, and `enableSpring / enableBlur / enableScale` props. The real Apple Music-like effect lives in a continuous layout engine: every frame computes target line position, opacity, blur, scale, and per-line delay, then writes `translateY(...) scale(...)` and `filter: blur(...)` directly to DOM.

This PRD proposes a MUZERO-native, clean-room implementation of that architecture: React owns data and static DOM; a small lyrics layout engine owns per-frame transforms for the visible lyric rows.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Listener** | Plays uploaded or generated tracks and expects lyrics to feel alive, legible, and smooth. | Can toggle lyrics settings and seek by tapping lines. |
| **Power listener** | Uses translations, romanization, word timing, and immersive lyrics surfaces. | Can tune lyric appearance without introducing hidden flags. |
| **Developer** | Maintains lyrics rendering, parsing, and playback synchronization. | Can extend the layout engine under deterministic tests. |

### 1.3 Core Value

1. **Real Apple Music-like motion**: Lyrics move as a continuously laid-out stack with delayed follow, scale, blur, and opacity, not isolated row entrance animations.
2. **Lower jank risk**: Avoid React re-render / Motion controller storms during track changes by updating transform-only DOM styles inside a scoped rAF driver.
3. **Preserve MUZERO features**: Keep existing LRCLIB / rich lyrics parsing, translation / romanization, word-by-word fill, click seek, and local-first settings.
4. **License-safe reference**: Learn from LyciaMusic / AMLL architecture without copying AGPL application code.

---

## 2. Reference Research

### 2.1 LyciaMusic Implementation Summary

| Area | LyciaMusic Observation | MUZERO Implication |
|------|------------------------|--------------------|
| Dependency | Uses AMLL packages (`@applemusic-like-lyrics/core`, `@applemusic-like-lyrics/lyric`, `@applemusic-like-lyrics/vue`). | We should either adopt AMLL package APIs after license review or build a clean-room engine. This PRD chooses clean-room first. |
| Runtime owner | Vue wrapper creates `PatchedLyricPlayer`, appends its DOM element, and runs `player.update(delta)` in rAF. | React should not animate every row via state. Use a module-scoped / component-scoped rAF driver. |
| Data contract | Converts app lyrics into AMLL lines with `words`, `translatedLyric`, `romanLyric`, `startTime`, `endTime`. | Add a MUZERO `LyricRenderLine` adapter from existing `LyricLine`. |
| Layout | `calcLayout()` computes `curPos`, active/buffered lines, per-line `targetOpacity`, `blurLevel`, `targetScale`, and `delay`. | Extract pure layout solver so tests can verify positions and stagger without DOM. |
| DOM writes | Writes `transform`, `filter`, `transformOrigin`, and `willChange` directly to line elements. | Runtime should update only `transform / opacity / filter` on row refs. |
| Recovery | Recalculates layout after mount, resize, settings changes, and lyric changes. | Use ResizeObserver and a bounded recovery loop, but avoid perpetual layout thrashing. |

### 2.2 Source Links

| Source | Notes |
|--------|-------|
| [LyciaMusic repository](https://github.com/Billy636/LyciaMusic) | README states AMLL-based lyric display and credits AMLL usage. |
| [LyciaMusic package.json](https://raw.githubusercontent.com/Billy636/LyciaMusic/main/package.json) | Shows AMLL package dependencies. |
| [AMLL upstream](https://github.com/amll-dev/applemusic-like-lyrics) | Upstream engine family referenced by LyciaMusic NOTICE. |

### 2.3 License Boundary

LyciaMusic is AGPL-3.0-only and its NOTICE says lyrics-related code is derived from AMLL. MUZERO must not copy LyciaMusic source code. Implementation must be one of:

- **Preferred for this PRD:** clean-room engine based on observed behavior and public package/API concepts.
- **Alternative:** direct dependency on AMLL packages only after confirming AMLL package license, bundle impact, React integration feasibility, and attribution requirements.

No source from LyciaMusic `src/lib/amll/PatchedLyricPlayer.ts` should be copied verbatim into MUZERO.

---

## 3. System Architecture

### 3.1 Architecture Overview

```
MediaEngine currentTime
        │
        ▼
useActiveLyricLine / rAF clock
        │
        ▼
LyricRenderLine[] adapter
        │
        ▼
Pure layout solver
  - active index
  - measured line heights
  - viewport height
  - align position
  - line gap
  - mode config
        │
        ▼
LyricsMotionDriver rAF
  - spring per line
  - stagger/delay
  - blur/scale/opacity
        │
        ▼
DOM style writes
  transform / opacity / filter
```

### 3.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **React rendering** | Existing React 19 components | Keep current app architecture and i18n/settings hooks. |
| **Animation runtime** | Clean-room TypeScript rAF + spring integrator | Avoid row-level React/Motion churn; deterministic and testable. |
| **DOM measurement** | ResizeObserver + row refs | Need real line heights for translation / romanization / wrapped lyrics. |
| **Data source** | Existing `ResolvedLyrics` / `LyricLine` | Reuse current LRCLIB and rich lyrics pipeline. |
| **Reduced motion** | `matchMedia("(prefers-reduced-motion: reduce)")` | Disable spring/blur/scale under accessibility preference. |

### 3.3 Project Structure

```
src/
├── lyrics/
│   ├── lyric-layout-engine.ts          # pure solver: positions, opacity, scale, blur, stagger
│   ├── lyric-layout-engine.test.ts
│   ├── lyric-render-line.ts            # adapter from model LyricLine to render line contract
│   └── lyric-render-line.test.ts
└── components/player/
    ├── synced-lyrics-view.tsx          # React host + refs + driver lifecycle
    └── synced-lyrics-view.test.tsx
```

New files are justified because the current row-level component is too entangled for a testable layout engine, and the clean-room solver/adapter should remain independent from React.

---

## 4. Data Model Design

### 4.1 Core Concepts

```
LyricLine (existing parsed model)
        │ adapter
        ▼
LyricRenderLine
  id
  startMs
  endMs
  text
  words[]
  translation?
  roman?
        │ solver input
        ▼
LyricLineLayout
  y
  opacity
  scale
  blurPx
  delaySec
  active / buffered / passed
```

### 4.2 Database Schema

No IndexedDB schema changes.

- `AppSettings.lyricsMotionMode` may remain as the visible mode selector.
- No hidden localStorage / URL / global flags.
- If new tuning values become necessary, add visible settings only after a follow-up PRD or a PRD update.

### 4.3 Type Contracts

```typescript
export interface LyricRenderLine {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  words?: Array<{ text: string; startMs: number; endMs: number }>;
  translation?: string;
  roman?: string;
}

export interface LyricLayoutFrame {
  index: number;
  y: number;
  opacity: number;
  scale: number;
  blurPx: number;
  delaySec: number;
  state: "passed" | "active" | "upcoming" | "distant";
}
```

---

## 5. Frontend Design

### 5.1 Current Implementation

Primary surface:

- [`src/components/player/synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx)

Shared settings:

- [`src/components/player/lyrics-tuning-controls.tsx`](../../../src/components/player/lyrics-tuning-controls.tsx)
- [`src/components/settings/lyrics-settings.tsx`](../../../src/components/settings/lyrics-settings.tsx)

Existing pure helpers:

- [`src/lyrics/lyric-motion.ts`](../../../src/lyrics/lyric-motion.ts)
- [`src/lyrics/lyric-style.ts`](../../../src/lyrics/lyric-style.ts)
- [`src/lyrics/resolve-lyrics.ts`](../../../src/lyrics/resolve-lyrics.ts)

### 5.2 Required UX

The new Cascade mode should visibly behave like an AMLL / Apple Music-like stack:

- Active line sits near an anchor (`~42%` from top by default).
- Upcoming lines below move up with small staggered delay.
- Passed lines fade/blur/scale away instead of abruptly disappearing.
- Translation and romanization move as part of the same line block.
- Word-by-word karaoke fill remains synchronized with playback.
- Click-to-seek remains responsive and should not launch many animations.
- Track changes should show the correct lyric stack immediately, with no mount-time shrink/grow wave.

### 5.3 State Management

React state should not update per frame.

- `useActiveLyricLine` may continue to update only when active line changes.
- The new driver reads current time from `getMediaEngine().getCurrentTime()` inside rAF.
- Row refs are stored in a mutable ref map/array.
- Per-frame style writes are scoped to mounted rows and limited to transform-friendly properties.

---

## 6. Implementation Plan

### Phase 1: Research Baseline + Engine Contract

**Goal:** Freeze the intended behavior and define a testable engine contract before implementation.

**Tasks:**
- [ ] Document the clean-room interpretation of LyciaMusic / AMLL behavior in this PRD.
- [ ] Decide whether current `lyricsMotionMode` remains `classic / inertial / cascade` or whether Cascade becomes the only advanced engine.
- [ ] Define `LyricRenderLine` and `LyricLayoutFrame` contracts.
- [ ] Add tests for render-line conversion from existing `LyricLine` data.

### Phase 1 Checklist

- [ ] No LyciaMusic AGPL source copied.
- [ ] Render-line adapter handles plain text, timed words, translation, romanization, and missing end times.
- [ ] Existing word-fill tests still pass.
- [ ] PRD updated before commit.

### Phase 2: Pure Layout Solver + TDD Fixtures

**Goal:** Build the deterministic math for positions, opacity, blur, scale, and stagger without DOM or React.

**Tasks:**
- [ ] Add `src/lyrics/lyric-layout-engine.ts`.
- [ ] Implement active index / anchor positioning from measured heights and viewport height.
- [ ] Implement line gap, passed/upcoming/distant state, opacity, blur, scale, and per-line delay.
- [ ] Add reduced-motion output mode: no blur, no stagger, minimal scale.
- [ ] Add fixture tests for short lyrics, long lyrics, bilingual lines, seek jumps, and final line.

### Phase 2 Checklist

- [ ] Solver is pure and deterministic.
- [ ] No DOM or browser APIs in solver.
- [ ] Tests cover forward and backward active-line movement.
- [ ] Tests verify no mount-time animation is required for first render.
- [ ] PRD updated before commit.

### Phase 3: rAF DOM Driver + React Integration

**Goal:** Replace row-level Motion cascade with a lightweight continuous DOM transform driver.

**Tasks:**
- [ ] Add a scoped driver in `SyncedLines` that starts/stops with component lifecycle.
- [ ] Measure row heights via ResizeObserver and update solver inputs only when needed.
- [ ] On each frame, read media time, compute target frames, integrate spring values, and write styles.
- [ ] Limit writes to `transform`, `opacity`, `filter`, and `will-change`.
- [ ] Ensure track changes reset driver state without shrink/grow regression.
- [ ] Keep classic mode as a simple baseline path.

### Phase 3 Checklist

- [ ] No React state updates per frame.
- [ ] No per-row Motion controllers.
- [ ] Track switch does not animate every row from a default scale.
- [ ] Scrolling / touch detach still works or has an explicit replacement behavior.
- [ ] PRD updated before commit.

### Phase 4: Word Fill / Secondary Lines / Click Seek Parity

**Goal:** Preserve existing synced lyrics feature parity while the new driver owns layout.

**Tasks:**
- [ ] Keep word-by-word fill as direct DOM CSS variable updates or move it into the same driver.
- [ ] Keep translation and romanization in the same row block so transforms apply once per line.
- [ ] Preserve LRCLIB attribution and "wrong lyrics" search affordance.
- [ ] Ensure clicking a lyric line seeks and snaps/aligned layout without visual jump.
- [ ] Add tests for click seek and row attributes under the new driver.

### Phase 4 Checklist

- [ ] Existing `synced-lyrics-view.test.tsx` coverage passes or is updated to the new contract.
- [ ] Word fill remains visible with default color mode.
- [ ] Translation / romanization toggles remain correct.
- [ ] PRD updated before commit.

### Phase 5: Performance QA + Rollout Cleanup

**Goal:** Verify the new engine improves perceived motion without introducing jank.

**Tasks:**
- [ ] Add dev-only measurement helper or test harness for frame interval and longtask capture if practical.
- [ ] Test with long lyrics (100+ lines), bilingual lines, and frequent seeks.
- [ ] Verify reduced-motion behavior.
- [ ] Remove or simplify obsolete Motion cascade code in `src/lyrics/lyric-motion.ts`.
- [ ] Update user-facing mode labels/hints only if behavior changes.

### Phase 5 Checklist

- [ ] Target tests pass.
- [ ] `tsc --noEmit` passes.
- [ ] Touched-file Biome passes.
- [ ] Manual desktop QA: no track-switch shrink/grow, no obvious frame hitch, Cascade visually distinct.
- [ ] PRD marked Completed only after implementation phases finish.

---

## 7. Performance Methodology

This feature is animation/performance sensitive. Verification must include more than unit tests.

| Metric | Target | Measurement |
|--------|--------|-------------|
| React renders during playback | No per-frame re-render of lyrics tree | React profiler / structural code review |
| DOM writes per frame | Mounted lyric rows only; transform-friendly props | Driver code inspection |
| Long tasks | No new repeatable ≥50ms long task during normal playback | PerformanceObserver / DevTools |
| Frame cadence | No visible periodic hitch with 100+ lyric rows | rAF interval sampling in prod build |
| Track switch | No mass shrink/grow animation | Manual QA + regression test where possible |

Dev mode is not sufficient for final performance sign-off. Final QA should run against a production build or desktop dev shell with HMR overhead understood.

---

## 8. Out of Scope

- Directly copying LyciaMusic AGPL source code.
- Replacing MUZERO's lyrics parser / LRCLIB pipeline.
- Changing IndexedDB lyric storage.
- Desktop floating lyrics window parity beyond existing `SyncedLyricsView` consumers.
- GPU shader effects for lyrics.
- Hidden runtime flags for rollout or kill-switch behavior.

---

## 9. Security / Privacy / License Considerations

- **Local-first:** No network calls are added.
- **Privacy:** Lyrics content stays local; no telemetry of lyric text, filenames, prompt data, or media bytes.
- **License:** LyciaMusic code is reference-only. If AMLL package dependency is considered later, perform license review and attribution planning before implementation.
- **Accessibility:** Reduced motion must disable springy cascade, blur, and scale exaggeration.
- **Logging:** Do not log lyric text. Use [`src/lib/logger.ts`](../../../src/lib/logger.ts) for any warnings/errors.

---

## 10. Related Documents

| Document | Description |
|----------|-------------|
| [Lyrics Motion Effects PRD](../20260613-muzero-lyrics-motion-effects-prd/20260613-muzero-lyrics-motion-effects-prd.md) | Existing Framer/Motion mode PRD; this new PRD supersedes Cascade implementation direction if approved. |
| [Synced Lyrics LRCLIB PRD](../20260610-muzero-synced-lyrics-lrclib-prd/20260610-muzero-synced-lyrics-lrclib-prd.md) | Original synced lyrics data and UI foundation. |
| [Rich Lyrics Formats PRD](../20260611-muzero-rich-lyrics-formats-prd/20260611-muzero-rich-lyrics-formats-prd.md) | Word timing, translation, and romanization context. |
| [LyciaMusic](https://github.com/Billy636/LyciaMusic) | Reference app using AMLL-based lyric display. |
| [AMLL upstream](https://github.com/amll-dev/applemusic-like-lyrics) | Upstream Apple Music-like Lyrics project family. |

---

## 11. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should MUZERO adopt AMLL packages directly instead of clean-room implementation? | Open | Default is clean-room until license/bundle/API review says otherwise. |
| 2 | Should Classic / Inertial remain visible modes after the new engine lands? | Open | Classic should remain as regression baseline; Inertial may become a parameter preset of the same engine. |
| 3 | Should user scrolling detach the continuous engine, or should the engine always own the lyric stack? | Open | Needs UX decision after prototype. |
| 4 | What is the exact anchor ratio? | Open | Start at `0.42` based on LyciaMusic's usage; tune in QA. |
| 5 | Should line blur be enabled on all lyrics surfaces, including compact mobile sheet? | Open | Reduced-motion and mobile performance must decide. |

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: clean-room AMLL-style lyrics layout engine PRD based on LyciaMusic / AMLL reference research. |

---

> **Note:** This PRD intentionally shifts the implementation model from row-level Framer Motion transitions to a continuous layout engine. The goal is not to perfectly clone LyciaMusic, but to reproduce the core architecture that makes its lyrics feel coherent: a single frame loop computes the whole lyric stack and writes transform-friendly DOM styles.
