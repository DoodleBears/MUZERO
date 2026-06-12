# PRD: MUZERO Visualizer Per-Style Tuning & Parameter Help

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** Player / Settings - visualizer tuning UX, Now Playing tuning panel, i18n help text

> Product request: Visualizer tuning values currently behave like one shared preset across every visualizer style. That feels wrong: users expect Bars, Waveform, LED, Radial, and registered scene/layer styles to remember their own tuning. Every parameter also needs a Question Circle icon with user-friendly guidance. Settings and the Now Playing visualizer panel must expose the same controls in the same order; today a few checkboxes exist in one surface but not the other.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Current-State Audit + PRD | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Per-Style Tuning Data Model + Resolver | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Shared Visualizer Controls UI + Help Icons | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings / Now Playing Panel Parity | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Tests, i18n, and Visual QA | ✅ Completed | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has a pluggable visualizer registry (`src/visualizer/registry.ts`) and a reusable tuning component (`src/components/player/visualizer-tuning-controls.tsx`). The current tuning fields live directly on `AppSettings`:

- analyser parameters: `visualizerFftSize`, `visualizerSmoothing`, `visualizerMinDecibels`, `visualizerMaxDecibels`;
- render parameters: `visualizerIntensity`, `visualizerMotion`, `visualizerDetail`, `visualizerSpread`, `visualizerMirror`;
- background composite parameters: `visualizerBackgroundOpacity`, `visualizerBackgroundDim`, `visualizerBgOpacityLyrics`, `visualizerBgDimLyrics`.

This means a user can tune Bars to be dense and bright, switch to Waveform, and Waveform inherits the same density values even though the visual language is different. Product managers and users perceive this as broken customization: each visualizer style should feel like it has its own memory.

There is also a UI parity issue. `VisualizerSettings` in Settings and `VisualizerTuningPanel` on Now Playing both edit visualizer behavior, but their order and available checkboxes differ. The same mental model should appear in both places.

### 1.2 Target Users

| Role | Description | Need |
|------|-------------|------|
| Listener tuning the Now Playing screen | Adjusts visualizer while music plays. | Fast experimentation without losing each style's preferred look. |
| Desktop power user | Uses Settings for precise configuration. | A complete, stable control list with clear explanations. |
| Mobile / touch user | Long-presses or taps into visual controls. | Help icons that work with tap/focus, not hover only. |
| PM / QA reviewer | Compares Settings and Now Playing panel. | Identical control order and coverage, so regressions are obvious. |

### 1.3 Core Value

1. **Style memory:** each visualizer style remembers its own tuning, so switching styles is reversible and predictable.
2. **Understandable controls:** every parameter has a Question Circle icon explaining the effect in listener language, including "higher means..." and "lower means..." where useful.
3. **Two surfaces, one model:** Settings and the Now Playing visualizer tab use the same control ordering and labels.
4. **Low-risk architecture:** extend existing `AppSettings` and resolver helpers; no backend, no telemetry, no hidden flag.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
AppSettings
  ├─ visualizerStyle                        # active style
  ├─ visualizerTuningByStyle[styleId]        # per-style tuning memory
  ├─ legacy global visualizer* fields        # fallback + migration seed
  └─ global placement / mode toggles

visualizer-effect-settings.ts
  ├─ resolveVisualizerTuning(settings, style)
  ├─ patchVisualizerTuning(settings, style, patch)
  └─ default tuning from registry meta + legacy fields

VisualizerControlsConfig
  ├─ canonical control sequence
  ├─ per-control visibility by active style
  ├─ i18n label keys
  └─ i18n help keys

Settings Visualizer pane
  └─ Shared VisualizerControls

Now Playing Visualizer panel tab 1
  └─ Shared VisualizerControls
```

### 2.2 Current Implementation References

| Area | File | Current issue |
|------|------|---------------|
| Settings visualizer pane | `src/components/settings/visualizer-settings.tsx` | Has style picker, tuning controls, cover color, background, idle-only, memory overlay; order differs from Now Playing panel. |
| Now Playing panel tab 1 | `src/components/player/visualizer-tuning-panel.tsx` | Has preview-only, style picker, background/idle toggle buttons, blend mode, tuning controls; missing some Settings checkboxes and uses a different order. |
| Tuning controls | `src/components/player/visualizer-tuning-controls.tsx` | Reads/writes global settings fields, so all styles share values. |
| Resolver | `src/lib/visualizer-effect-settings.ts` | Resolves global `AppSettings` fields only. |
| Style registry | `src/visualizer/registry.ts` | Already owns style metadata and should stay the source for style ids/default analyser meta. |
| Settings data | `src/db/types.ts` | Add optional per-style tuning shape without renaming stable ids. |
| i18n | `src/i18n/locales/{en,zh,ja,ko}/common.json` | Add help text keys for each visible parameter. |

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Persistence | Dexie `AppSettings` in IndexedDB `muzero-db` | Tuning is local user preference; no backend or cloud dependency. |
| UI | React + existing COSS/shadcn-compatible primitives | Reuse current Select, Slider, Button, Tooltip components. |
| Icons | `lucide-react` Question Circle icon (`CircleHelp` / `CircleQuestionMark`, whichever exists in installed lucide) | Matches existing icon system; no custom SVG. |
| Tooltips | `src/components/ui/tooltip.tsx` | Existing accessible tooltip primitive. |
| i18n | i18next catalogs | All labels/help text must be localized in en/zh/ja/ko. |

---

## 3. Data Model Design

### 3.1 Core Concepts

```
VisualizerStyleId
  └─ owns one VisualizerTuning object

VisualizerTuning
  ├─ analyser: fftSize / smoothing / minDb / maxDb
  ├─ render: intensity / motion / detail / spread / mirror
  └─ background composite: opacity / dim / lyrics opacity / lyrics dim

Global visualizer settings
  ├─ visualizerStyle
  ├─ visualizerUseCoverColor
  ├─ visualizerAsBackground
  ├─ visualizerBlendMode
  ├─ visualizerIdleOnly
  └─ immersiveMemoryOverlay
```

### 3.2 Database Schema

Add an optional map to `AppSettings`:

```ts
export interface VisualizerStyleTuning {
  fftSize?: 256 | 512 | 1024 | 2048;
  smoothing?: number;
  minDecibels?: number;
  maxDecibels?: number;
  intensity?: number;
  motion?: number;
  detail?: number;
  spread?: number;
  mirror?: number;
  backgroundOpacity?: number;
  backgroundDim?: number;
  bgOpacityLyrics?: number;
  bgDimLyrics?: number;
}

export interface AppSettings {
  visualizerTuningByStyle?: Partial<Record<VisualizerStyleId, VisualizerStyleTuning>>;
}
```

Required behavior:

- New installs use style defaults from `VISUALIZER_META` + `VISUALIZER_EFFECT_DEFAULTS`.
- Existing users seed the active style from legacy global fields when a per-style entry is missing.
- Legacy global fields remain readable for backward compatibility during rollout.
- Saving any tuning parameter writes only to `visualizerTuningByStyle[activeStyle]`.
- No DB version bump is required if this remains an additive optional `settings` field merged through `getSettings()`.

### 3.3 Data Relationship Diagram

```
settings.id = "app"
  ├─ visualizerStyle = "bars"
  └─ visualizerTuningByStyle
       ├─ bars: { detail: 2, smoothing: 0.82 }
       ├─ radial: { intensity: 1.6, spread: 1 }
       └─ waveform: { detail: 3, mirror: 0.5 }
```

---

## 4. API Design

No network API changes. All work is local-first UI + IndexedDB settings.

### 4.1 Internal Helper API

Extend `src/lib/visualizer-effect-settings.ts`:

```ts
export function resolveVisualizerStyleTuning(
  settings: AppSettings,
  style: VisualizerStyleId,
): VisualizerStyleTuning;

export function patchVisualizerStyleTuning(
  settings: AppSettings,
  style: VisualizerStyleId,
  patch: Partial<VisualizerStyleTuning>,
): Partial<AppSettings>;
```

Acceptance:

- The resolver clamps values exactly as today.
- `off` returns no tuning controls.
- Unknown future ids fall back through `resolveVisualizerStyle()` before lookup.
- Existing renderers receive the same `VisualizerAnalyserOptions` shape; `VisualizerRenderOptions` no longer includes the removed glow control.

### 4.2 Error Handling

- Invalid stored values are clamped or ignored; never crash the Now Playing screen.
- If `visualizerTuningByStyle[style]` is absent, fallback to legacy globals and then defaults.
- Tooltip/help text missing in any locale should fail i18n key tests or visual QA; no raw English fallback in UI components.

---

## 5. Frontend Design

### 5.1 Canonical Control Order

Settings and Now Playing visualizer tab must render the same order for shared controls:

1. Style picker
2. Preview-only controls where applicable
   - Now Playing: show `previewOnly` because it is an ephemeral panel aid.
   - Settings: do not show `previewOnly` unless a live preview surface is added.
3. Global behavior toggles
   - Use cover color
   - Background placement is default-on and not exposed as a persistent switch
   - Blend mode
   - Hide player UI when idle
   - Show memories while immersive, shown only when idle-only is enabled
4. Per-style tuning controls
   - FFT size
   - Smoothing
   - Min dB
   - Max dB
   - Intensity
   - Motion, if supported by style
   - Density/detail, if supported by style
   - Spread, if supported by style
   - Mirror/reflection, if supported by style
   - Background opacity/dim without lyrics, if background is enabled
   - Background opacity/dim with lyrics, if background is enabled

The only allowed difference between Settings and Now Playing tab 1 is ephemeral preview-only controls. All persistent checkboxes and sliders must match.

### 5.2 Help Icon Requirement

Every parameter row must include a Question Circle icon next to the label:

```
Smoothing: 0.82  (?)        [ slider ]
```

UX requirements:

- Icon sits beside the label/value, not at the far right of the row.
- Icon target is at least 32px on desktop and 44px on touch layouts where possible.
- Tooltip opens on hover, focus, and tap.
- Tooltip copy is written from the user's point of view, not implementation language.
- Tooltip copy should explain the tradeoff:
  - "Higher" and "lower" impact where meaningful.
  - Mention performance/power only when users can act on it.
  - Avoid jargon like "FFT bins" unless the parameter name itself requires it.

Suggested English help copy:

| Parameter | Help copy |
|-----------|-----------|
| FFT size | "Controls how much audio detail the visualizer listens to. Higher can feel more precise but may react a little slower." |
| Smoothing | "Controls how quickly the motion settles. Higher feels calmer and smoother; lower reacts faster to beats." |
| Min dB | "Sets the quietest sound level the visualizer treats as visible. Lower picks up more quiet details; higher ignores background noise." |
| Max dB | "Sets the loud level where motion reaches full strength. Lower makes the visualizer hit harder sooner; higher leaves more headroom." |
| Intensity | "Controls how strongly the music drives the visual. Higher moves more; lower stays restrained." |
| Motion | "Controls animation speed. Higher feels more energetic; lower feels slower and calmer." |
| Density | "Controls how many bars, rays, or points are drawn. Higher looks richer; lower is cleaner and lighter." |
| Spread | "Controls how far the visual opens out from the center. Higher fills more space; lower stays compact." |
| Mirror | "Controls reflection strength. Higher shows more reflection; lower keeps the main shape clearer." |
| Background opacity | "Controls how visible the visualizer layer is over the background." |
| Background dim | "Adds darkness over the visualizer so covers, lyrics, and controls stay readable." |

### 5.3 Shared Component Shape

Create or refactor toward one shared control composition:

```
components/player/
  visualizer-controls.tsx          # canonical controls and ordering
  visualizer-tuning-controls.tsx   # lower-level slider/select rows
  visualizer-help-label.tsx        # label + Question Circle + tooltip
```

This PRD allows adding one small helper component if it prevents duplicated order and tooltip code. Avoid a parallel Settings-only implementation.

### 5.4 Visual Design

- Use checkbox/switch-style rows for persistent binary preferences in both Settings and Now Playing tab 1. Background and idle-only are not a mutually exclusive segmented choice; idle-only depends on background being enabled, so checkbox/switch rows communicate the hierarchy better than two equal toggle buttons.
- Use familiar icon-only question control, not a text pill.
- Keep sliders full-width and stable; help icon must not resize the row on hover.
- In compact Now Playing panel, tooltip content should wrap to 220-280px.
- On desktop Settings, tooltip side can be right/top; in the floating panel, prefer left/right based on available space.
- Do not add instructional paragraphs under every control once the help icon exists; reduce repeated hint text where the tooltip carries it.
- Add a `Reset this style` action near the tuning heading, using a small icon+text button (`RotateCcw` if available). It resets only the active style's per-style tuning back to defaults and must not change global preferences such as cover color, background placement, idle-only, blend mode, or memory overlay.

---

## 6. Implementation Plan

### Phase 1: Current-State Audit + PRD

**Goal:** Document the product requirement and current gaps.

**Tasks:**
- [x] Confirm current global tuning fields in `AppSettings`.
- [x] Confirm Settings vs Now Playing panel parity gaps.
- [x] Create this PRD.

### Phase 1 Checklist

- [x] PRD path follows `YYYYMMDD-*-prd` convention.
- [x] Existing code references are included.

### Phase 2: Per-Style Tuning Data Model + Resolver

**Goal:** Store and resolve tuning per visualizer style.

**Tasks:**
- [x] Add `VisualizerStyleTuning` and `visualizerTuningByStyle` to `src/db/types.ts`.
- [x] Update `DEFAULT_SETTINGS` only if a seeded empty map is valuable; otherwise rely on resolver defaults.
- [x] Refactor `resolveVisualizerRenderOptions` and `resolveVisualizerAnalyserOptions` to accept resolved per-style tuning.
- [x] Add helper for saving a patch into the active style's tuning map.
- [x] Add helper for deleting/resetting the active style's tuning entry so defaults take over.
- [x] Preserve legacy global fields as fallback.

### Phase 2 Checklist

- [x] Bars tuning does not change Waveform tuning.
- [x] Waveform density does not reuse Bars bands/octave values unless intentionally copied.
- [x] Existing users keep their current active-style tuning on first use.
- [x] Invalid persisted numbers are clamped.
- [x] Resetting one style does not change any other style's saved tuning.

### Phase 3: Shared Visualizer Controls UI + Help Icons

**Goal:** Add help icons and remove duplicated ordering logic.

**Tasks:**
- [x] Define a canonical control config for visualizer controls.
- [x] Add `VisualizerHelpLabel` using lucide Question Circle icon + existing Tooltip primitives.
- [x] Add help icons to select rows, slider rows, and persistent checkbox/toggle rows.
- [x] Add a `Reset this style` action to the shared controls, visually grouped with the per-style tuning section.
- [x] Add i18n keys for every help tooltip in en/zh/ja/ko.
- [x] Ensure touch/focus accessibility.

### Phase 3 Checklist

- [x] Every visible persistent parameter has a help icon.
- [x] Tooltip text avoids implementation-only wording.
- [x] Keyboard focus reaches the help control.
- [x] Reset action has a clear label, accessible name, and no accidental one-click destructive ambiguity beyond the current style.
- [x] No user-visible text is hardcoded outside i18n catalogs.

### Phase 4: Settings / Now Playing Panel Parity

**Goal:** Make Settings and Now Playing visualizer tab 1 show the same persistent controls in the same order.

**Tasks:**
- [x] Refactor `VisualizerSettings` to use the shared controls.
- [x] Refactor `VisualizerTuningPanel` visualizer tab to use the same shared controls.
- [x] Keep `previewOnly` in Now Playing as an explicit panel-only preview aid.
- [x] Add missing persistent checkboxes to Now Playing tab 1: cover color, idle-only, memory overlay.
- [x] Replace Now Playing background/idle-only toggle buttons with the same checkbox/switch-style rows used by Settings, preserving the compact panel layout.
- [x] Align background blend/tuning placement between both surfaces.
- [x] Remove the obsolete "Use as Now Playing background" switch from shared controls; background remains default-on.

### Phase 4 Checklist

- [x] Settings and Now Playing tab 1 have identical persistent control order.
- [x] The only intentional difference is Now Playing preview-only behavior.
- [x] Controls remain usable in the 360px floating panel.
- [x] No checkbox exists in Settings without an equivalent persistent control in Now Playing.
- [x] Reset appears in both Settings and Now Playing in the same section position.

### Phase 5: Tests, i18n, and Visual QA

**Goal:** Verify behavior and polish.

**Tasks:**
- [x] Unit test per-style resolver and patch helper.
- [x] Unit test reset helper deletes only the active style's tuning entry.
- [x] Component test that active-style edits preserve independent values.
- [x] Component test that reset restores the active style defaults without changing global visualizer toggles.
- [x] Component test or snapshot that both surfaces render the same persistent control ids in order.
- [x] Run typecheck and relevant Vitest files.
- [x] Manually verify Settings visualizer controls at 1180x780; Now Playing panel entrance requires an active track, so panel parity is covered by component DOM-order verification.

### Phase 5 Checklist

- [x] `tsc --noEmit` passes.
- [x] Relevant Vitest tests pass.
- [x] No visible overlap between help icons, labels, and slider values in the Settings visualizer screenshot.
- [x] Tooltip triggers are present and keyboard-focusable through shared help buttons.
- [x] Reset affordance is visible but visually secondary to active tuning controls.

### Phase 5 Validation Notes

- Focused Vitest command passed: `node_modules\.bin\vitest.cmd run src\components\player\visualizer-controls-parity.test.tsx src\components\player\visualizer-tuning-controls.test.tsx src\lib\visualizer-effect-settings.test.ts`.
- TypeScript validation passed: `node_modules\.bin\tsc.cmd --noEmit`.
- Edge headless visual check passed for Settings / Visualizer at 1180x780; DOM control order was `style`, `use-cover-color`, `blend-mode`, `idle-only`, `tuning`.
- Now Playing panel real-entry screenshot was not available in the empty-player state because the visualizer mode button is not rendered without an active track; component parity test covers the same persistent control order with `preview-only` as the only extra panel control.
- Follow-up bug fix: background opacity/dim controls for both no-lyrics and with-lyrics states now resolve through the same per-style tuning map used by the sliders; the Now Playing background renderer no longer reads only legacy global fields.
- Follow-up product tuning: all registered styles default to 70% visualizer opacity and 30% visualizer dim for both no-lyrics and with-lyrics states.
- Follow-up product tuning: Radial defaults to spread `1` and intensity `1.6`; LED + reflection defaults to 5 bands per octave.
- Follow-up product pruning: Aura/Glow, Liquid, and Aurora are removed from registered/user-selectable visualizer effects. Legacy stored ids resolve through the registry fallback to Bars.

---

## 7. Out of Scope

- New visualizer styles or shader effects.
- Import/export visualizer presets.
- Cloud sync of visualizer tuning.
- Telemetry for which styles or parameters users tune.
- A runtime kill switch or hidden localStorage flag.
- Rewriting the visualizer registry or renderer architecture.

---

## 8. Security Considerations

- **Authentication:** Not applicable; all settings are local.
- **Authorization:** Not applicable; no remote API.
- **Data Protection:** Tuning preferences contain no media bytes, filenames, prompts, or API keys.
- **Audit Logging:** Do not add telemetry. Debug logs, if any, must use `src/lib/logger.ts` and avoid per-frame spam.
- **Local-first:** All persistence stays in IndexedDB `muzero-db`.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260607-muzero-music-reactive-visualizer-prd`](../20260607-muzero-music-reactive-visualizer-prd/20260607-muzero-music-reactive-visualizer-prd.md) | Original visualizer registry, style, and shader architecture. |
| [`20260613-muzero-settings-information-architecture-prd`](../20260613-muzero-settings-information-architecture-prd/20260613-muzero-settings-information-architecture-prd.md) | Settings IA refresh that this PRD should align with. |
| [`src/components/player/visualizer-tuning-controls.tsx`](../../../src/components/player/visualizer-tuning-controls.tsx) | Current tuning UI and style visibility logic. |
| [`src/components/player/visualizer-tuning-panel.tsx`](../../../src/components/player/visualizer-tuning-panel.tsx) | Now Playing tab 1 visualizer panel. |
| [`src/components/settings/visualizer-settings.tsx`](../../../src/components/settings/visualizer-settings.tsx) | Settings visualizer pane. |
| [`src/lib/visualizer-effect-settings.ts`](../../../src/lib/visualizer-effect-settings.ts) | Current resolver and clamp logic. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should background opacity/dim be per-style or global? | Resolved in this PRD | Treat as per-style because it is shown inside tuning and users judge it per visual style. |
| 2 | Should "Use cover color" be per-style? | Resolved in this PRD | Keep global; it is a color-source preference, not a style tuning parameter. |
| 3 | Should Now Playing use checkboxes or segmented/toggle buttons for background/idle? | Resolved | Use checkbox/switch-style rows in both Settings and Now Playing tab 1. Per UI/UX best practice, segmented controls are for mutually exclusive modes; background and idle-only are persistent binary preferences with a dependency, so matching rows are clearer and keep both surfaces aligned. |
| 4 | Should there be a "Reset this style" action? | Resolved | Yes, include it in v1. Add `Reset this style` beside the tuning section; it resets only the active style's per-style tuning values and leaves global visualizer preferences untouched. |
| 5 | Should "Use as Now Playing background" remain a visible option? | Resolved | No. Background placement is the default product behavior, so the shared Settings/Now Playing controls no longer expose this switch. Existing placement state remains available to lower-level mode shortcuts. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial draft for per-style visualizer tuning, help icons, and Settings/Now Playing parity. |
| 2026-06-13 | Codex | Resolved UI control pattern and added v1 reset-this-style requirement. |
| 2026-06-13 | Codex | Completed Phase 2 data model, resolver, patch, reset, and host resolution work. |
| 2026-06-13 | Codex | Verified Phase 2 with focused visualizer-effect-settings tests. |
| 2026-06-13 | Codex | Implemented Phase 3 help icons, reset action, per-style tuning saves, and focused UI tests. |
| 2026-06-13 | Codex | Completed Phase 4 shared visualizer controls, Settings/Now Playing parity, and focused parity tests. |
| 2026-06-13 | Codex | Added localized help text for shared visualizer style, preview, color, background, blend, idle, and memory controls. |
| 2026-06-13 | Codex | Completed Phase 5 validation with focused Vitest, TypeScript check, and Edge headless Settings visual QA. |
| 2026-06-13 | Codex | Removed the obsolete visible "Use as Now Playing background" switch from shared visualizer controls and updated parity coverage. |
| 2026-06-13 | Codex | Fixed no-lyrics / with-lyrics background opacity and dim values so the renderer consumes per-style tuning values instead of stale global settings. |
| 2026-06-13 | Codex | Updated visualizer product defaults to opacity 70% / dim 30%, set Radial and LED + reflection defaults, and removed Aura/Glow, Liquid, and Aurora from registered visualizer effects. |
