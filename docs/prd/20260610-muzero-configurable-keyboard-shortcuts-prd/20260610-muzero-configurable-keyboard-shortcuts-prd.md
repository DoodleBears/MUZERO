# PRD: Configurable Keyboard Shortcuts (registry + cheat-sheet + cyclic-conflict rebind)

**Status:** Draft
**Created:** 2026-06-10
**Author:** MUZERO
**Module:** Shortcuts — a single source of truth for every key/gesture binding, a discoverable "view all shortcuts" surface in Settings, and per-action rebinding with multi-binding + cascading ("循环") conflict resolution.

> Reference design: ClipCombo (`doodlekuma.com/packages/clipcombo`) — `src/lib/clip-editor-shortcuts.ts` (pure engine), `src/stores/clip-editor-shortcuts.ts` (persistence), `src/components/editor/EditorShortcutHelpDialog.tsx` (recorder + cyclic resolution UI), `src/hooks/useEditorKeyboardShortcutResolver.ts` (dispatch). This PRD adapts that architecture to MUZERO's local-first / no-backend / no-telemetry / 4-locale constraints.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Registry + pure engine + persistence | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2a | Global dispatch (transport + tabs) via registry | ✅ Completed | [Phase 2a Checklist](#phase-2a-checklist) |
| 2b | Scoped surfaces (library/inspector/gallery) + hint swap | 🔲 Pending | [Phase 2b Checklist](#phase-2b-checklist) |
| 3 | "View all shortcuts" — read-only cheat-sheet (Settings + `?` overlay) | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Customization — recorder, multi-binding, cyclic conflict, reset | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Stretch — presets, 2-stroke sequences, import/export | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO's keyboard surface grew organically and is now substantial — transport (Q/E/Space/Shift+Q/E/F/R/Alt+R/Cmd+↑↓), a WASD+arrows library-navigation scheme (W/S/↑↓ focus, A/← back, D/→/Enter open, trackpad swipe-back), tab nav (Cmd+1/2/3), gallery-mode cycle (`` ` ``), global search (`/`, Cmd+F), and contextual editors (T/N memory, Enter-to-commit). An audit found:

- **No discoverability.** There is **no "view all shortcuts" surface**. Disclosure is piecemeal — a few tooltips ([`player-hints.ts`](../../../src/lib/player-hints.ts)), the NavFab `⌘+1/2/3` chips, the gallery `~` ModeTab tooltip, the global-search `Enter`/`Shift+Enter` footer. Most bindings (all WASD nav, `A/←` back, swipe-back, `T/N`, `F` fullscreen, `/`) have **zero** on-screen hint.
- **No configurability.** Every chord is a hard-coded literal across ~10 handlers. Users on AZERTY/Dvorak, or who dislike Q/E, cannot rebind anything.
- **Scattered, partly-buggy dispatch.** Bindings are decoded in [`player-shortcuts.ts`](../../../src/player/player-shortcuts.ts), [`library-nav.ts`](../../../src/lib/library-nav.ts), [`shortcuts.ts`](../../../src/lib/shortcuts.ts), [`memory-shortcuts.ts`](../../../src/lib/memory-shortcuts.ts), plus inline handlers in [`search-page.tsx`](../../../src/pages/search-page.tsx), [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx), [`use-back-gesture.ts`](../../../src/hooks/use-back-gesture.ts), [`App.tsx`](../../../src/App.tsx), [`nav-fab.tsx`](../../../src/components/nav/nav-fab.tsx). Two scope bugs surfaced: the gallery `` ` `` toggle fires even while typing in the gallery search box ([`search-page.tsx`](../../../src/pages/search-page.tsx) `isGalleryModeToggle`, missing `isTypingTarget`), and `T`/`N` memory is a window-global listener weakly scoped to "panel mounted" ([`track-memory-notes-panel.tsx`](../../../src/components/track/track-memory-notes-panel.tsx)).

ClipCombo already solved the registry + multi-binding + cyclic-conflict + recorder problem cleanly (dependency-light, pure-function core, fully unit-tested). This PRD replicates that best practice for MUZERO.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Keyboard-first listener** | Drives playback + library nav without the mouse; wants to learn and trust the shortcuts | View cheat-sheet; rebind any non-protected action |
| **Non-QWERTY / accessibility user** | AZERTY/Dvorak layout, or RSI-driven remapping; current Q/E/WASD positions don't fit | Rebind to chords that fit their layout/hands |
| **New user** | Doesn't know shortcuts exist | Discover them via Settings → Shortcuts and the `?` overlay |

### 1.3 Core Value

1. **Discoverability**: one authoritative, searchable, grouped list of every binding — no more hunting tooltips.
2. **Customization**: rebind any action, bind **multiple** chords to one action, with **non-destructive** cascading conflict resolution (assigning an occupied chord guides you to relocate the displaced one, never silently steals).
3. **One source of truth**: defaults, display hints, dispatch, and the cheat-sheet all read from a single typed registry — eliminating the current drift and the two scope bugs.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                 ┌────────────────────────────────────────────────┐
                 │  src/shortcuts/registry.ts  (pure, no DOM)      │
                 │  ── SHORTCUT_ACTIONS: ShortcutActionDef[]       │  ← codename layer (stable ids)
                 │     id · scope · category · defaultBindings[]   │
                 │     labelKey · protected · allowUserBindings    │
                 └───────────────┬───────────────────┬────────────┘
                                 │                   │
        ┌────────────────────────▼──────┐   ┌────────▼─────────────────────────┐
        │ src/shortcuts/engine.ts (pure)│   │ AppSettings.shortcutOverrides     │
        │ mergeBindings(reg, overrides) │◄──┤ (Dexie settings row; sparse map)  │
        │ gestureIdentity(g, platform)  │   │ override > default  (2-tier merge) │
        │ findConflicts(scope, gesture) │   └───────────────────────────────────┘
        │ matchAction(event, scope, …)  │
        └───────┬───────────────────────┬───────────────────────────┬──────────┘
                │ (dispatch)            │ (recorder/conflict)        │ (display)
   ┌────────────▼───────────┐  ┌────────▼───────────────┐  ┌────────▼─────────────────┐
   │ useShortcutDispatch()  │  │ Settings → Shortcuts    │  │ shortcutHint(actionId)    │
   │ one window keydown,    │  │  · grouped + searchable │  │ → Kbd chips in tooltips   │
   │ scope-aware, calls     │  │  · per-action recorder  │  │   (replaces player-hints) │
   │ action handlers        │  │  · cyclic conflict draft│  └───────────────────────────┘
   └────────────────────────┘  │  · reset / reset-all    │
                               │  + `?` global overlay   │
                               └─────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Registry + engine** | Pure TS (no React/DOM), exhaustively unit-tested | Mirrors MUZERO's existing pure-resolver discipline (`player-shortcuts.ts`, `library-nav.ts`); the hard logic (merge/identity/conflict/match) is testable without a DOM |
| **Persistence** | Dexie `muzero-db` `settings` row (`AppSettings.shortcutOverrides`) | Hard rule #1/#3: structured config lives in IndexedDB, surfaced by a **visible Settings control**, never a hidden flag. (Diverges from ClipCombo's `localStorage` + env kill-switch.) |
| **Dispatch** | Single window `keydown` (capture) wired once from `App.tsx`, scope-parameterized | Collapses ~10 scattered listeners into one ordered path; fixes capture-precedence + the T/N & backtick scope bugs |
| **UI** | Settings detail section + reused `?` overlay; COSS/Base-UI primitives already in repo | Reuse `Kbd`/`KbdGroup`, `Input`, `Dialog`, existing settings two-column shell |
| **i18n** | i18next, 4 locales (en/zh/ja/ko) | Labels/categories/descriptions/search-terms per CLAUDE.md i18n rule |
| **State** | Dexie `useLiveQuery` for overrides; module-scope merged-binding cache | Hard rule #6: bindings derive from DB, not duplicated into Zustand |

### 2.3 Project Structure

```
src/
├── shortcuts/                       # NEW — the registry + engine seam
│   ├── registry.ts                  # SHORTCUT_ACTIONS[] + types (codename layer)
│   ├── registry.test.ts             # invariants: unique ids, default-bindings conflict-free
│   ├── engine.ts                    # mergeBindings / gestureIdentity / findConflicts / matchAction
│   ├── engine.test.ts               # merge, identity (mac/win), conflict, dispatch matching
│   ├── conflict.ts                  # cascading-displacement fixpoint (the "循环" resolver)
│   ├── conflict.test.ts             # cyclic chains, protected blocks, termination
│   ├── format.ts                    # gesture → Kbd-friendly label (⌘/Ctrl/↑/Space …)
│   └── recorder.ts                  # KeyboardEvent → gesture, reserved-key warnings (pure)
├── hooks/
│   └── use-shortcut-dispatch.ts     # NEW — single keydown router; replaces use-player-shortcuts wiring
├── components/settings/
│   └── shortcuts-settings.tsx       # NEW — "view all + customize" Settings detail
├── components/shortcuts/
│   ├── shortcut-help-overlay.tsx    # NEW — `?` cheat-sheet (reuses the list component)
│   └── shortcut-recorder-dialog.tsx # NEW — capture + cyclic conflict drafts
└── (refactored) player/player-shortcuts.ts · lib/library-nav.ts · lib/shortcuts.ts ·
    lib/memory-shortcuts.ts · lib/player-hints.ts → re-expressed as registry actions/lookups
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
ShortcutActionDef (static, in registry.ts — the SOURCE OF TRUTH)
  ├─ id            "playback.next"     ← codename, STABLE across brand pivots (hard rule #4)
  ├─ scope         "global" | "library" | "inspector"
  ├─ category      "playback" | "navigation" | "library" | "search" | "memory"
  ├─ defaultBindings  ShortcutGesture[]        (multi-binding: e.g. volumeUp = [↑, ⌘↑])
  ├─ allowUserBindings?  false = display-only (swipe-back, cover-swipe gestures)
  ├─ protected?    true = cannot be rebound or displaced (e.g. search.openGlobal Cmd+F)
  └─ labelKey / descriptionKey / keywords

ShortcutGesture (serializable, stored in overrides)
  └─ kind:"key"  → stroke: { code, keyLabel, primaryKey?, ctrlKey?, metaKey?, altKey?, shiftKey? }
     kind:"wheel"→ { modifier, direction }   (display-only; swipe/wheel gestures)

AppSettings.shortcutOverrides   (Dexie settings row — the ONLY persisted state)
  └─ Record<actionId, ShortcutGesture[]>   sparse; [] = explicitly unbound; absent = use default
```

Live binding for an action = `overrides[id] ?? action.defaultBindings` (2-tier merge; 3-tier with presets in Phase 5). Everything else — display hints, dispatch table, the cheat-sheet — derives from this. **Identity** (equality / conflict / de-dup / React keys) is a normalized string with fixed modifier order (`Alt+Ctrl+Meta+Shift+code`), with `primaryKey` resolving to `Meta` on mac and `Ctrl` elsewhere — so the same physical chord matches across platforms (copied directly from ClipCombo's `editorShortcutStrokeIdentity`).

> **Why `event.code`, not `event.key`** (a deliberate change from today's `event.key.toLowerCase()`): the WASD scheme is *positional*; `code` (`KeyW`/`KeyA`/`KeyS`/`KeyD`) keeps W/A/S/D under the same fingers on AZERTY/Dvorak, and matches the gallery toggle which already uses `event.code === "Backquote"`. `keyLabel` (from `event.key`) is kept for display only.

### 3.2 Database Schema

⚠️ **Prefer modifying existing structures.** This is an **additive optional field** on the existing singleton `settings` row — **no `muzero-db` version bump, no migration** (same pattern as the many other optional `AppSettings` fields, e.g. `visualizerStyle`, `importFolders`).

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) `AppSettings` (Dexie singleton `id:"app"`), defaults in `DEFAULT_SETTINGS`.
- **Required Changes:** add one optional field:
  ```ts
  // src/db/types.ts → AppSettings
  /**
   * User keyboard-shortcut overrides, keyed by stable action id (codename layer).
   * Sparse: only actions the user changed appear. An empty array = explicitly
   * UNBOUND (distinct from "absent → use the built-in default"). Device-local.
   */
  shortcutOverrides?: Record<string, ShortcutGesture[]>;
  ```
- **Data Migration:** none. Absent field → all defaults. Reset-to-default = `delete overrides[id]`; reset-all = clear the map.
- **Constraints & Invariants:** action ids written to overrides are validated against the registry on read; **unknown ids are dropped** (forward/back-compat when actions are added/removed). Gestures are re-normalized + de-duped on read. Malformed value → treated as no overrides (defaults).
- **Privacy & Retention:** device-local only; **never synced** (excluded from the R2 manifest, like `r2CredentialsByDriveId`). No PII. Captured keydowns are matched and discarded — never logged.
- **Rollback Plan:** feature is code; rollback = `git revert` + redeploy (hard rule #3). Stored `shortcutOverrides` becomes inert (ignored) if the field/registry is reverted; no data loss for other settings.

### 3.3 Data Relationship Diagram

```
SHORTCUT_ACTIONS[]  ──(defaults)──┐
                                  ▼
AppSettings.shortcutOverrides ──► mergeBindings() ──► BindingsByActionId  ──► { dispatch · cheat-sheet · hints }
        (override wins)                                  (source-tagged: "custom" | "default")
```

---

## 4. API Design

No network endpoints (local-first, no backend). The "API" is the pure engine surface in `src/shortcuts/`.

### 4.1 Engine surface

| Symbol | Signature | Description |
|--------|-----------|-------------|
| `mergeBindings` | `(overrides) => Record<id, {gesture, source}[]>` | 2-tier merge (override > default), source-tagged for UI |
| `gestureIdentity` | `(g, platform) => string` | normalized identity; `primaryKey`→Meta(mac)/Ctrl |
| `gestureFromEvent` | `(e: KeyboardEvent) => ShortcutGesture` | build a single-stroke gesture from a live event |
| `findConflicts` | `(actionId, gesture, bindings, platform) => Conflict[]` | same-scope collisions for a candidate chord |
| `matchAction` | `(e, activeScope, bindings, platform) => actionId \| null` | dispatch: resolve a live event to an action, honoring scope precedence |
| `resolveDisplacement` | `(drafts, bindings, platform) => Preview` | the cascading "循环" fixpoint (Phase 4) |
| `formatGesture` | `(g, platform) => string[]` | Kbd-chip labels |
| `reservedWarning` | `(g, platform) => WarningKey \| null` | flags OS-reserved chords (Cmd+W/Ctrl+W/Cmd+R…) |

### 4.2 Scope & conflict model (the key adaptation)

MUZERO's surfaces are **mutually exclusive and shadow each other** — unlike ClipCombo's partitioned editor panels. At any instant you're in exactly one library surface, but `global` is always live. So:

- **Scopes:** `global` (transport/tabs/search/gallery-cycle — always active), `library` (focus nav / open / back — active on the gallery wall, a track list, or a detail), `inspector` (T/N — active while the track inspector is mounted).
- **Precedence (dispatch):** `inspector` > `library` > `global`. The most-specific *active* scope that has a binding for the chord wins. This is exactly today's runtime behavior — e.g. bare `↑` is `library.focusPrev` on the gallery wall (capture handler consumes it) but `playback.volumeUp` on Now Playing — now expressed as data instead of capture-order luck.
- **Conflict (rebind):** two actions in the **same scope** sharing a chord is a conflict (→ cyclic resolution). The **same chord across different scopes is intentional shadowing, not a conflict** (e.g. `↑` = volumeUp in `global` AND focusPrev in `library`). This is the deliberate divergence from ClipCombo's "global overlaps everything" rule, required to keep MUZERO's surface-shadowing nav legal.

```ts
// dispatch precedence (engine.ts)
const SCOPE_PRECEDENCE = ["inspector", "library", "global"] as const;
function matchAction(e, activeScopes /* Set */, bindings, platform) {
  const id = gestureIdentity(gestureFromEvent(e), platform);
  for (const scope of SCOPE_PRECEDENCE) {
    if (!activeScopes.has(scope)) continue;
    for (const action of actionsInScope(scope))
      if (bindings[action.id].some((b) => gestureIdentity(b.gesture, platform) === id)) return action.id;
  }
  return null;
}
```

### 4.3 Error / edge handling

- **Typing & modals:** dispatch bails when `isTypingTarget(e.target) || hasModalDialogOpen()` (shared [`dom-keys.ts`](../../../src/lib/dom-keys.ts)). This finally fixes the `` ` `` gallery-toggle-while-typing bug uniformly.
- **OS-reserved chords:** the recorder shows a non-blocking amber warning for `Cmd/Ctrl+W` (close window — the Cmd+W landmine we already hit), `Cmd/Ctrl+R`, `Cmd/Ctrl+N/T/L/P`, etc. — it does not hard-block (the user may know their shell frees it).
- **Protected actions:** `search.openGlobal` (Cmd+F), `Escape`-to-close, and gesture-only entries are `protected`/`allowUserBindings:false` — shown in the cheat-sheet, not rebindable; if a displacement chain hits one, **Save is hard-blocked** with an explanatory message.
- **Empty / fully-unbound:** an action may be left with `[]` (unbound) deliberately; the cheat-sheet shows an "Unassigned" pill.
- **No telemetry.** ClipCombo emits `shortcut_binding_add` / `shortcut_conflict_resolved` events; MUZERO emits **none** (hard rule #1). Logging goes through [`logger.ts`](../../../src/lib/logger.ts) at debug level only.

---

## 5. Frontend Design

### 5.1 Page Structure

```
Settings (settings-page.tsx, two-column sidebar→detail, nav-store.settingsItem)   ← CANONICAL HOME
└── new item "shortcuts" (键盘快捷键)
    └── components/settings/shortcuts-settings.tsx
        ├── search Input (fuzzy over label/description/keywords/chord text)
        ├── configurable sections (playback · navigation · library · search · memory)
        │   └── ShortcutRow:  label · [Kbd chips + ✕ remove] · [+ add / 🔒] · [↺ reset]
        ├── "Reference" section (read-only, NOT rebindable — Q7):
        │   └── Esc-to-close · search-overlay ↑↓/Enter/Shift+Enter · slider/scrubber ←→↑↓/Home/End ·
        │       text-commit Enter · gestures (swipe-back, cover-swipe)   → label + Kbd chips, no controls
        └── footer: "Reset all to defaults"
Global `?` (Shift+/)  →  (OPTIONAL, Q8) components/shortcuts/shortcut-help-overlay.tsx — reuses the same
                          list read-only with a "Customize in Settings" link; no separate dock affordance
```

### 5.2 UI Components

- **Current Implementation:** Settings shell [`settings-page.tsx`](../../../src/pages/settings-page.tsx); `Kbd`/`KbdGroup` ([`ui/kbd.tsx`](../../../src/components/ui/kbd.tsx)); existing piecemeal hints in [`player-hints.ts`](../../../src/lib/player-hints.ts), NavFab tooltips, ModeTab tooltip.
- **Required Changes:**
  - Add a `shortcuts` entry to the Settings sidebar (alongside appearance/etc.).
  - `ShortcutRow` (modeled on ClipCombo's `ShortcutHelpRow`): renders each current binding as a `Kbd` chip with an inline remove (✕) when editable; a `+` button (opens the recorder) that renders as a `Lock` icon and is disabled when `protected`/`allowUserBindings:false`; a reset (↺) enabled only when an override exists.
  - `ShortcutRecorderDialog` (modeled on ClipCombo's recorder): a `role="textbox"` capture target — modifier-only keys buffer + preview ("⌘⇧…"), a non-modifier finalizes the chord; `Escape` cancels; live conflict panel grows extra "relocate X" draft sections (the **cyclic chain**); Save disabled until every draft is filled and no conflict remains.
  - Replace `playerShortcutHint(action)` with a registry-backed `shortcutHint(actionId)` so transport tooltips show the user's *actual* bound chord (today they're hard-coded to `Q`/`E`/`↑↓`).
- **UI/Interaction:** grouped + searchable list; rebind via "press your keys" capture; non-destructive conflict flow (never silently steals); reset per-row and reset-all; reduced-motion respected (MotionConfig already app-wide).

### 5.3 State Management

- **Overrides** read via `useLiveQuery` over the settings row; writes via a thin repo helper (`setShortcutOverride(id, gestures)` / `resetShortcut(id)` / `resetAllShortcuts()`) that updates `AppSettings.shortcutOverrides`.
- **Merged bindings** computed by `mergeBindings()` and memoized at module scope (recomputed on override change), consumed by both dispatch and UI — never copied into Zustand (hard rule #6).
- **Recorder drafts** are ephemeral component state (the cyclic fixpoint runs purely in `conflict.ts`, mirroring ClipCombo's `while(changed)` displacement loop); only the final, conflict-free binding set is committed on Save.

---

## 6. Implementation Plan

### Phase 1: Registry + pure engine + persistence

**Goal:** Establish the single source of truth and the testable core, with no behavior change yet.

**Tasks:**
- [ ] `src/shortcuts/registry.ts`: types (`ShortcutActionDef`, `ShortcutGesture`, `ShortcutStroke`, scopes, categories) + `SHORTCUT_ACTIONS[]` enumerating every configurable action (transport ×10, nav/tabs/gallery-cycle/search ×5, library focus/open/back ×4, memory ×1) with `defaultBindings` matching today's keys; display-only gesture entries (swipe-back, cover-swipe) with `allowUserBindings:false`.
- [ ] `src/shortcuts/engine.ts`: `mergeBindings`, `gestureIdentity` (platform-normalized), `gestureFromEvent`, `findConflicts`, `matchAction` (scope-precedence), `formatGesture`.
- [ ] `AppSettings.shortcutOverrides` field + repo helpers (`setShortcutOverride`/`resetShortcut`/`resetAllShortcuts`) + read-time validation (drop unknown ids, re-normalize).
- [ ] i18n: `shortcuts.category.*`, `shortcuts.action.*` label/description keys in **en** first, then zh/ja/ko.

#### Phase 1 Checklist
- [x] Every current binding (from the audit) has a registry action with the exact same default chord(s). → [`registry.ts`](../../../src/shortcuts/registry.ts)
- [x] `registry.test.ts`: action ids unique; default bindings have **no same-scope conflicts** (the registry is self-consistent).
- [x] `engine.test.ts`: merge precedence; identity equality for `Cmd+F` → `Meta+KeyF` (mac) / `Ctrl+KeyF` (win); `matchAction` honors `inspector>library>global`; cross-scope same chord (`↑`) is NOT a conflict but resolves per active scope.
- [x] Overrides round-trip through Dexie; unknown-id + malformed values are dropped safely (`sanitizeOverrides` + `setShortcutOverride`/`resetShortcut`/`resetAllShortcuts` in [`repositories.ts`](../../../src/db/repositories.ts)).
- [x] i18n `shortcuts.category.*` / `shortcuts.action.*` / `shortcuts.gesture.*` added for all 4 locales (en/zh/ja/ko).

> **Done 2026-06-10.** 56 tests green (`src/shortcuts/`, `repositories.test.ts`); typecheck + Biome clean. `AppSettings.shortcutOverrides` is an additive optional field (no DB version bump). No dispatch change yet — Phase 2 routes live keys through `matchAction`.

### Phase 2: Dispatch unification (behavior-preserving)

**Goal:** Make the registry the *live* source of truth — every key is matched via `matchAction`, defaults unchanged, two scope bugs fixed. Split into **2a** (global, stable files — done) and **2b** (the churning library/inspector surfaces + hint swap).

> **Why split:** the library files (`search-page.tsx`, `virtual-track-list.tsx`, `entity-grid.tsx`) are under active concurrent editing for the album/artist-delete feature. Refactoring their key-matching now would conflict, so the high-value global dispatch lands first; the scoped surfaces follow once that work settles.

#### Phase 2a — global dispatch (transport + tabs) ✅

**Tasks:**
- [x] `src/hooks/use-shortcut-dispatch.ts`: one window `keydown` (bubble), guarded by `isTypingTarget` + `defaultPrevented`; `matchAction(gestureFromEvent(e), {global}, mergeBindings(sanitizeOverrides(settings.shortcutOverrides)))` → imperative action handler. Library/inspector surfaces keep their own capture handlers and preempt this one (existing `stopImmediatePropagation`/`defaultPrevented` contract → no scope tracker needed).
- [x] Fold transport + tab nav: deleted `player-shortcuts.ts` / `use-player-shortcuts.ts` (+ test); removed `useNavShortcuts` from [`nav-fab.tsx`](../../../src/components/nav/nav-fab.tsx); App wires `useShortcutDispatch()`.
- [x] `isTypingTarget` already consolidated onto [`dom-keys.ts`](../../../src/lib/dom-keys.ts) (Phase-0 of this work); the dispatcher imports it.

##### Phase 2a Checklist
- [x] DOM test (`use-shortcut-dispatch.test.tsx`): default chords (Q/E/Space/↑) hit the right player-store actions; **a user override remaps live** (prev→Z frees Q); Ctrl+digit switches tabs; stands down while typing; ignores unbound keys.
- [x] Transport is now **rebindable** (overrides flow through `matchAction`); defaults byte-for-byte unchanged.
- [x] No double-fire on `↑/↓` (bubble dispatcher + `defaultPrevented` + library capture-preemption contract preserved); typecheck + Biome clean (61 tests green).

> **Done 2026-06-10.** Headline win: transport + tab shortcuts are configurable. Scoped surfaces (below) still use their hard-coded defaults until 2b.

#### Phase 2b — scoped surfaces + hint swap 🔲

**Tasks:**
- [ ] Route the **library** keys through the registry: gallery roving + `` ` `` toggle in [`search-page.tsx`](../../../src/pages/search-page.tsx), row nav in [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx), `A/←` in [`use-back-gesture.ts`](../../../src/hooks/use-back-gesture.ts) — replace `libraryNavKey(e.key)` checks with `matchesActionEvent(e, "library.*", bindings)`. Keep the per-surface DOM effects (focus movement, swipe).
- [ ] Route `nav.cycleGalleryMode` + the search-open keys through the registry where they're handled (SearchPage / App).
- [ ] Route `memory.quickAdd` (`T/N`) in [`track-memory-notes-panel.tsx`](../../../src/components/track/track-memory-notes-panel.tsx); fix its weak scope (guard `hasModalDialogOpen`, scope to the active inspector).
- [ ] Fix the gallery-cycle-while-typing bug (gate on `isTypingTarget`).
- [ ] Swap `playerShortcutHint` → registry-backed `shortcutHint(actionId)`; tooltips reflect live bindings.

##### Phase 2b Checklist
- [ ] `library-nav.test.ts` still green (or its logic migrates to the registry); WASD/arrow nav + swipe-back unchanged at defaults but now override-aware.
- [ ] `` ` `` no longer flips gallery mode while typing; `T/N` only fires with the inspector active and no modal open.
- [ ] Rebinding e.g. `library.focusNext` to `J` works live in a focused list.

### Phase 3: "View all shortcuts" (read-only cheat-sheet)

**Goal:** Ship discoverability before editability (low risk, high value). **Settings → Shortcuts is the canonical home (Q8).**

**Tasks:**
- [ ] `components/settings/shortcuts-settings.tsx`: grouped (by category) + searchable list, each row showing label + current `Kbd` chips (read-only). Add `shortcuts` to the Settings sidebar.
- [ ] **Reference section (Q7):** render the read-only intrinsic widget keys (Esc-to-close, search-overlay `↑↓/Enter/Shift+Enter`, slider/scrubber `←→↑↓/Home/End`, text-commit `Enter`) and display-only gestures (swipe-back, cover-swipe) as a non-editable group — best-practice discoverability without making them rebindable. Model these as `protected` "reference" registry entries (display metadata only, no dispatch path).
- [ ] `components/shortcuts/shortcut-help-overlay.tsx` (**optional, Q8**): a `?` (Shift+/) global action opening the same list as an overlay with a "Customize in Settings" link. Register `help.openShortcuts` as a `global` action. No separate dock affordance.
- [ ] i18n complete for all 4 locales; fuzzy search includes chord text + `keywords`.

#### Phase 3 Checklist
- [ ] Every configurable registry action appears exactly once, under the right category, with its live chips.
- [ ] The Reference section lists the intrinsic widget keys + display-only gestures (swipe-back, cover-swipe) with chips and **no edit/remove/reset controls**.
- [ ] If shipped, the `?` overlay opens/closes (Escape), is reduced-motion friendly; the Settings entry is the discovery point on desktop + mobile (touch).

### Phase 4: Customization — recorder + cyclic conflict + reset

**Goal:** Rebinding, multi-binding, and the non-destructive "循环" conflict flow.

**Tasks:**
- [ ] `src/shortcuts/recorder.ts` (pure): `gestureFromEvent` capture rules (buffer modifiers, finalize on non-modifier, ignore `repeat`), `reservedWarning`.
- [ ] `src/shortcuts/conflict.ts` (pure): the cascading-displacement fixpoint — assigning an occupied chord seeds a forced "relocate the displaced action" draft; a `while(changed)` loop chains it through downstream collisions; `protected`/fixed collisions hard-block Save. (Direct port of ClipCombo's `shortcutRecorderActiveDraftKeys` + `…SettingsWithDrafts`, scoped to MUZERO's same-scope rule.)
- [ ] `components/shortcuts/shortcut-recorder-dialog.tsx`: capture target, live preview, growing conflict-draft sections, Save gating, reserved-key warning.
- [ ] Wire `ShortcutRow` edit affordances (+ add binding, ✕ remove binding, ↺ reset) and "Reset all".
- [ ] Commit on Save: write the whole resolved chain atomically via the repo helpers.

#### Phase 4 Checklist
- [ ] `conflict.test.ts`: A→B displacement spawns a relocate-A draft; multi-hop chains (A→B, B's old chord→C) terminate; a chain into a `protected` action blocks Save with the right message; stale drafts prune when the user backs out.
- [ ] Multi-binding: an action can hold ≥2 chords; adding a duplicate de-dupes; removing the last leaves "Unassigned".
- [ ] A rebind takes effect **live** (dispatch reads merged bindings) without reload; reset restores the default; reset-all clears the map.
- [ ] `Cmd+W` (and friends) show the reserved warning; saving them is allowed but flagged.

### Phase 5: Stretch (out of v1 scope unless prioritized)

**Goal:** Parity extras from ClipCombo that aren't required for the core ask.

**Tasks:**
- [ ] **Presets** (e.g. "Default", "Arrows-for-transport") → 3-tier merge (`override > preset > default`) + a preset `Select` with a preview dialog. Adds `AppSettings.shortcutPresetId`.
- [ ] **2-stroke sequences** ("G then S") — type is already forward-compatible; needs a 450 ms sequence timer in dispatch + a "Then" slot in the recorder.
- [ ] **Import / Export** the keymap as JSON (local file via the desktop bridge), for sharing/backup.

#### Phase 5 Checklist
- [ ] Presets never silently apply (preview + confirm); applying a preset clears overrides.
- [ ] Sequence dispatch handles the "chord is both a complete shortcut and a sequence prefix" case (deferred single-key action).

---

## 7. Out of Scope

- **Intrinsic widget keys are not _rebindable_** (not in the configurable registry): text-input `Enter`/`Escape`/`,` (tag/name/desc/memory/chat composers), slider/scrubber `←→↑↓/Home/End` ([`slider.tsx`](../../../src/components/ui/slider.tsx), [`progress-scrubber.tsx`](../../../src/components/player/progress-scrubber.tsx), [`playback-spectrum.tsx`](../../../src/components/player/playback-spectrum.tsx)), in-overlay search-result `↑↓/Enter/Shift+Enter` ([`global-track-search.tsx`](../../../src/components/search/global-track-search.tsx)), and Base-UI primitive behaviors (Dialog/Popover/Command/Select). These are component-local affordances, like ClipCombo excludes cmdk + undo/redo from *its* registry. **However (Q7, best practice): the common ones ARE surfaced read-only in the cheat-sheet's "Reference" section** (Phase 3) — discoverable but not editable. Defining them as `protected` "reference" entries (display metadata only, no `defaultBindings` dispatch path) is the cleanest way to render them in the list.
- **Presets, 2-stroke sequences, import/export** — Phase 5 / future.
- **Per-set or per-context custom shortcuts** — single global keymap only.
- **Telemetry / analytics on shortcut usage** — forbidden (hard rule #1).
- **Env/localStorage kill-switch** — ClipCombo's `VITE_..._ENABLED` flag is intentionally **not** ported (hard rule #3); the feature ships as a visible Settings control, rollback = `git revert`.
- **Mobile gesture remapping** — swipe-back / cover-swipe are display-only, not rebindable.

---

## 8. Security Considerations

- **Authentication / Authorization:** none — local-only, single-user device; no backend.
- **Data Protection:** `shortcutOverrides` is device-local config (action ids + chords); no PII, no secrets, **never synced** (excluded from R2 manifest like other device-local settings). Captured keydowns are matched then discarded — never persisted or logged at info+.
- **Audit Logging:** none beyond debug-level `logger` traces; no telemetry events (unlike ClipCombo).
- **Abuse surface:** a user can bind an OS-reserved chord (e.g. Cmd+W); the recorder warns but the OS/Electron menu still wins — documented, non-destructive (the binding simply never fires).

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260607-muzero-player-shortcuts-dock-controls-prd](../20260607-muzero-player-shortcuts-dock-controls-prd/) | Original transport-shortcuts + dock controls PRD (the bindings this generalizes) |
| [20260607-muzero-dock-nav-gallery-redesign-prd](../20260607-muzero-dock-nav-gallery-redesign-prd/) | Gallery/nav surface where library WASD nav + `` ` `` toggle live |
| ClipCombo `clip-editor-shortcuts.ts` / `EditorShortcutHelpDialog.tsx` (doodlekuma.com) | Reference architecture (registry, 3-tier merge, cyclic conflict, recorder, dispatch) |
| [CLAUDE.md](../../../CLAUDE.md) | Hard rules #1 (no backend/telemetry), #3 (no hidden flags), #4 (codename stability), #6 (Zustand discipline), i18n |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Adopt `event.code` (positional) over `event.key` for identity? | Resolved | **Yes** — positional fits WASD + matches the existing `Backquote` check; `keyLabel` retained for display |
| 2 | Should bare `↑/↓` (volume) and library `↑/↓` (focus) be modeled as a conflict? | Resolved | **No** — cross-scope shadowing via `inspector>library>global` precedence; conflicts are same-scope only |
| 3 | Ship presets in v1? | Resolved | **No** — Phase 5; v1 is single keymap (override > default) |
| 4 | Support 2-stroke sequences ("G then S") in v1? | Resolved | **No** — type is forward-compatible; dispatch/recorder support deferred to Phase 5 |
| 5 | Port ClipCombo's env kill-switch? | Resolved | **No** — violates hard rule #3; visible Settings control + `git revert` |
| 6 | Does adding `shortcutOverrides` need a DB version bump? | Resolved | **No** — additive optional field on the `settings` row |
| 7 | Are `Escape`-to-close and Base-UI primitive keys in the registry? | Resolved | **Not** in the *rebindable* registry, but **shown read-only** in the cheat-sheet's "Reference" section (Esc-to-close, search-overlay `↑↓/Enter/Shift+Enter`, slider/scrubber `←→↑↓/Home/End`, text-commit `Enter`) — best-practice discoverability without making intrinsic widget keys editable |
| 8 | Where does the cheat-sheet live / how is it opened? | Resolved | **Settings → Shortcuts is the canonical home** (sidebar entry); no extra dock affordance. The `?` (Shift+/) overlay is an **optional** convenience that opens the same list and links into Settings |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | MUZERO | Initial draft — adapts ClipCombo's shortcut-customization architecture (registry + multi-binding + cyclic conflict + recorder + cheat-sheet) to MUZERO's local-first / no-telemetry / no-hidden-flag / 4-locale constraints; 5-phase plan, infrastructure-first |
| 2026-06-10 | MUZERO | Resolved Q7 (intrinsic widget keys: not rebindable, but shown read-only in a cheat-sheet "Reference" section) and Q8 (Settings → Shortcuts is the canonical home; `?` overlay optional, no dock affordance) — propagated into §5.1, §6 Phase 3, §7 |
| 2026-06-10 | MUZERO | Phase 1 shipped (registry + engine + persistence + i18n, 56 tests). Phase 2 split into 2a (global transport+tab dispatch via registry — shipped, transport now rebindable; deleted `player-shortcuts`/`use-player-shortcuts`) and 2b (library/inspector/gallery surfaces + hint swap — pending, deferred around concurrent library-delete edits) |

---

> **Note:** This PRD favors modifying the existing pure-resolver seams (`player-shortcuts.ts`, `library-nav.ts`, `shortcuts.ts`, `memory-shortcuts.ts`, `player-hints.ts`) over greenfield rewrites — they collapse into one registry-driven engine. Action ids are a **codename layer** (hard rule #4): stable across brand pivots, like provider ids and `trk_`/`ses_` prefixes, so stored user keymaps survive renames.
