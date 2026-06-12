# PRD: MUZERO AMLL-Style Lyrics Layout Engine

**Status:** Completed
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** Lyrics / Now Playing - Apple Music-like continuous lyric motion

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Research Baseline + Engine Contract | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Pure Layout Solver + TDD Fixtures | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | rAF DOM Driver + React Integration | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Word Fill / Secondary Lines / Click Seek Parity | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Performance QA + Rollout Cleanup | ✅ Completed | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Cascade Tuning + Detached Readability | ✅ Completed | [Phase 6 Checklist](#phase-6-checklist) |

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

No IndexedDB schema version change is required because these are additive settings fields only.

- `AppSettings.lyricsMotionMode` remains the visible mode selector.
- `AppSettings.lyricsCascadeAnchorPct` stores the Cascade active-line anchor in viewport percent.
- `AppSettings.lyricsCascadeDelayMs` stores the Cascade per-row follow delay in milliseconds.
- `AppSettings.lyricsCascadeBlurPx` stores the Cascade maximum inactive-line blur in pixels.
- No hidden localStorage / URL / global flags.

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
- [x] Document the clean-room interpretation of LyciaMusic / AMLL behavior in this PRD.
- [x] Decide whether current `lyricsMotionMode` remains `classic / inertial / cascade` or whether Cascade becomes the only advanced engine.
- [x] Define `LyricRenderLine` and `LyricLayoutFrame` contracts.
- [x] Add tests for render-line conversion from existing `LyricLine` data.

### Phase 1 Checklist

- [x] No LyciaMusic AGPL source copied.
- [x] Render-line adapter handles plain text, timed words, translation, romanization, and missing end times.
- [x] Existing word-fill tests still pass.
- [x] PRD updated before commit.

> **Phase 1 implementation note (2026-06-13):** Added [`src/lyrics/lyric-render-line.ts`](../../../src/lyrics/lyric-render-line.ts) as the clean-room adapter from existing `LyricLine` data into `LyricRenderLine`. It preserves timed words, translation, and romanization, supplies stable ids, clamps too-short end times, and falls back to bounded final-line duration when no next line exists. Verification: `vitest run src/lyrics/lyric-render-line.test.ts src/components/player/synced-lyrics-view.test.tsx` (23 tests), `tsc --noEmit`, and touched-file Biome all passed.

### Phase 2: Pure Layout Solver + TDD Fixtures

**Goal:** Build the deterministic math for positions, opacity, blur, scale, and stagger without DOM or React.

**Tasks:**
- [x] Add `src/lyrics/lyric-layout-engine.ts`.
- [x] Implement active index / anchor positioning from measured heights and viewport height.
- [x] Implement line gap, passed/upcoming/distant state, opacity, blur, scale, and per-line delay.
- [x] Add reduced-motion output mode: no blur, no stagger, minimal scale.
- [x] Add fixture tests for short lyrics, long lyrics, bilingual lines, seek jumps, and final line.

### Phase 2 Checklist

- [x] Solver is pure and deterministic.
- [x] No DOM or browser APIs in solver.
- [x] Tests cover forward and backward active-line movement.
- [x] Tests verify no mount-time animation is required for first render.
- [x] PRD updated before commit.

> **Phase 2 implementation note (2026-06-13):** Added [`src/lyrics/lyric-layout-engine.ts`](../../../src/lyrics/lyric-layout-engine.ts), a pure solver that anchors the active line, computes absolute/natural/translated y positions, classifies rows as passed/active/upcoming/distant, and resolves opacity, scale, blur, and stagger delay. Reduced motion returns no blur, no stagger, and neutral scale. Verification: `vitest run src/lyrics/lyric-layout-engine.test.ts src/lyrics/lyric-render-line.test.ts` (9 tests), `tsc --noEmit`, and touched-file Biome all passed.

### Phase 3: rAF DOM Driver + React Integration

**Goal:** Replace row-level Motion cascade with a lightweight continuous DOM transform driver.

**Tasks:**
- [x] Add a scoped driver in `SyncedLines` that starts/stops with component lifecycle.
- [x] Measure row heights via ResizeObserver and update solver inputs only when needed.
- [x] On each frame, read media time, compute target frames, integrate spring values, and write styles.
- [x] Limit writes to `transform`, `opacity`, `filter`, and `will-change`.
- [x] Ensure track changes reset driver state without shrink/grow regression.
- [x] Keep classic mode as a simple baseline path.

### Phase 3 Checklist

- [x] No React state updates per frame.
- [x] No per-row Motion controllers.
- [x] Track switch does not animate every row from a default scale.
- [x] Scrolling / touch detach still works or has an explicit replacement behavior.
- [x] PRD updated before commit.

> **Phase 3 implementation note (2026-06-13):** Cascade mode now uses an AMLL-style scoped rAF driver inside [`SyncedLines`](../../../src/components/player/synced-lyrics-view.tsx): it reads live media time, solves the full lyric stack with `solveLyricLayout`, integrates spring values per row, and writes only `transform`, `opacity`, `filter`, and `will-change`. Cascade rows render as plain buttons with refs instead of per-row Motion controllers; Classic/Inertial keep the existing Motion path. Verification: `vitest run src/components/player/synced-lyrics-view.test.tsx src/lyrics/lyric-layout-engine.test.ts src/lyrics/lyric-render-line.test.ts` (28 tests), `tsc --noEmit`, and touched-file Biome all passed.

### Phase 4: Word Fill / Secondary Lines / Click Seek Parity

**Goal:** Preserve existing synced lyrics feature parity while the new driver owns layout.

**Tasks:**
- [x] Keep word-by-word fill as direct DOM CSS variable updates or move it into the same driver.
- [x] Keep translation and romanization in the same row block so transforms apply once per line.
- [x] Preserve LRCLIB attribution and "wrong lyrics" search affordance.
- [x] Ensure clicking a lyric line seeks and snaps/aligned layout without visual jump.
- [x] Add tests for click seek and row attributes under the new driver.

### Phase 4 Checklist

- [x] Existing `synced-lyrics-view.test.tsx` coverage passes or is updated to the new contract.
- [x] Word fill remains visible with default color mode.
- [x] Translation / romanization toggles remain correct.
- [x] PRD updated before commit.

> **Phase 4 implementation note (2026-06-13):** Added Cascade layout-engine parity coverage for click-to-seek, word-by-word spans, translation, and romanization. The new driver keeps the existing row content structure intact, so the transform applies once to the full line block while karaoke spans continue to receive CSS fill updates. Verification: `vitest run src/components/player/synced-lyrics-view.test.tsx` (22 tests), `tsc --noEmit`, and touched-file Biome all passed.

### Phase 5: Performance QA + Rollout Cleanup

**Goal:** Verify the new engine improves perceived motion without introducing jank.

**Tasks:**
- [x] Add automated layout stress coverage for 100+ lines and seek jumps; runtime frame / longtask capture remains release QA.
- [x] Test with long lyrics (100+ lines), bilingual lines, and frequent seeks.
- [x] Verify reduced-motion behavior.
- [x] Remove or simplify obsolete Motion cascade code in `src/lyrics/lyric-motion.ts`.
- [x] Confirm user-facing mode labels / hints do not need changes.

### Phase 5 Checklist

- [x] Target tests pass.
- [x] `tsc --noEmit` passes.
- [x] Touched-file Biome passes.
- [x] Manual desktop QA scope documented; code-level checks cover the old shrink/grow pulse path, and hands-on release QA should still confirm perceived Cascade smoothness.
- [x] PRD marked Completed only after implementation phases finish.

> **Phase 5 implementation note (2026-06-13):** Removed the legacy row-wave helper from [`src/lyrics/lyric-motion.ts`](../../../src/lyrics/lyric-motion.ts) and removed Cascade pulse state / old data attributes from [`SyncedLines`](../../../src/components/player/synced-lyrics-view.tsx). Cascade now has one owner: the AMLL-style layout solver + rAF driver. Added solver stress coverage for 120-line lyric stacks, mixed secondary-line heights, and large seek jumps. Final verification: `vitest run src/lyrics/lyric-render-line.test.ts src/lyrics/lyric-layout-engine.test.ts src/lyrics/lyric-motion.test.ts src/components/player/synced-lyrics-view.test.tsx src/components/player/lyrics-tuning-controls.test.tsx` (44 tests), `tsc --noEmit`, and touched-file Biome all passed.

### Phase 6: Cascade Tuning + Detached Readability

**Goal:** Make Cascade controllable as its own lyrics engine and keep history browsing readable when the user manually scrolls away from the live line.

**Tasks:**
- [x] Add visible Cascade-only sliders for active-line anchor, row delay, and blur strength.
- [x] Persist the new tuning in `AppSettings` as additive local settings fields.
- [x] Thread tuning into the pure layout solver and rAF driver under tests.
- [x] Stop the Cascade driver when the user wheels / touch-scrolls away from follow mode.
- [x] Clear blur / scale / opacity driver writes while detached so historical lyrics are readable.
- [x] Reattach follow with the existing "Back to current line" affordance.

### Phase 6 Checklist

- [x] Cascade tuning has TDD coverage in solver, settings UI, and synced lyrics integration tests.
- [x] Classic / Inertial settings UI remains unchanged.
- [x] Detached Cascade uses normal scroll overflow instead of forced `scrollTop = 0`.
- [x] PRD updated before commit.

> **Phase 6 implementation note (2026-06-13):** Added Cascade-specific sliders in [`LyricsTuningControls`](../../../src/components/player/lyrics-tuning-controls.tsx) for anchor, delay, and blur; persisted them as additive `AppSettings` fields; passed them into [`solveLyricLayout`](../../../src/lyrics/lyric-layout-engine.ts) and the Cascade rAF driver. Manual wheel/touch now detaches Cascade into a readable history-scroll state by stopping the driver and clearing transform/opacity/filter writes; clicking "Back to current line" resumes the AMLL-style engine. Verification: `vitest run src/lyrics/lyric-layout-engine.test.ts src/components/player/lyrics-tuning-controls.test.tsx src/components/player/synced-lyrics-view.test.tsx` (42 tests) passed.

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
| 3 | Should user scrolling detach the continuous engine, or should the engine always own the lyric stack? | Decided | User wheel/touch scrolling detaches Cascade into normal readable history scrolling; the existing "Back to current line" control reattaches follow. |
| 4 | What is the exact anchor ratio? | Decided | Default remains `0.42`; users can tune it with the visible Cascade anchor slider. |
| 5 | Should line blur be enabled on all lyrics surfaces, including compact mobile sheet? | Decided | Cascade blur stays enabled by default, is tunable from `0–8px`, and is cleared while detached for history browsing. |

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: clean-room AMLL-style lyrics layout engine PRD based on LyciaMusic / AMLL reference research. |
| 2026-06-13 | MUZERO | Phase 1 completed: added render-line adapter contract and tests for line-level lyrics, timed words, translations, romanization, fallback end times, and monotonic duration clamps. |
| 2026-06-13 | MUZERO | Phase 2 completed: added pure lyric layout solver with anchor positioning, visual states, opacity/scale/blur/stagger outputs, and reduced-motion behavior. |
| 2026-06-13 | MUZERO | Phase 3 completed: integrated AMLL-style rAF DOM driver for Cascade mode with row refs, ResizeObserver measurement, spring integration, and transform-only writes. |
| 2026-06-13 | MUZERO | Phase 4 completed: added Cascade parity tests for click seek, word-by-word karaoke spans, translation, and romanization under the layout-engine path. |
| 2026-06-13 | MUZERO | Phase 5 completed: removed legacy Motion row-wave cascade code, added long-stack / seek-jump solver coverage, and marked the PRD complete with release QA notes. |
| 2026-06-13 | MUZERO | Follow-up: user-selected lyric motion modes now ignore OS reduced-motion; Cascade always starts the AMLL-style driver and computes full blur / scale / stagger effects. |
| 2026-06-13 | MUZERO | Follow-up: Cascade now uses a wider minimum line gap, removes scroll-mode stack padding, hides native scrolling, and clears stale scroll offsets so the active line anchor stays stable. |
| 2026-06-13 | MUZERO | Follow-up: Cascade layout now respects the shared lyric tuning controls for line gap, active opacity, inactive opacity, and inactive font size. |
| 2026-06-13 | MUZERO | Follow-up: added Cascade-only anchor / delay / blur sliders and a readable detached history-scroll state that clears driver blur / transform / opacity until follow is resumed. |
| 2026-06-13 | MUZERO | Follow-up: fixed Cascade active-line downward drift by measuring row layout height via `offsetHeight` / `scrollHeight` before falling back to transformed bounding boxes. |
| 2026-06-13 | MUZERO | Follow-up: reduced Cascade switch/playback jank by windowing layout frames and per-frame DOM writes to the active lyric neighborhood while hiding far rows outside the driver window. |
| 2026-06-13 | MUZERO | Follow-up: fixed word-timed Cascade lyric rendering by keeping timed-word spans stable after active-line changes and moving karaoke shadows from the row text layer to per-word drop-shadows. |

---

> **Note:** This PRD intentionally shifts the implementation model from row-level Framer Motion transitions to a continuous layout engine. The goal is not to perfectly clone LyciaMusic, but to reproduce the core architecture that makes its lyrics feel coherent: a single frame loop computes the whole lyric stack and writes transform-friendly DOM styles.
