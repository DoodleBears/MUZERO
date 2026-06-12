# PRD: Tab-Scoped Keyboard Shortcuts

**Status:** Draft
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** Shortcuts - per-tab / per-surface key ownership for playback, library, queue, and inspector shortcuts

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Scoped binding model | Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Now Playing arrow transport | Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Settings UI by surface | Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Tooltip and cheat-sheet parity | Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has a registry-driven configurable keyboard shortcut system in
[`src/shortcuts/`](../../../src/shortcuts/) and a Settings cheat-sheet/customizer. It replaced the old hard-coded transport shortcuts and supports coarse scopes:

- `global`: transport, tabs, queue, search, visualizer, lyrics
- `library`: gallery/list navigation
- `inspector`: memory/editor-like surfaces

This solved discoverability and rebinding, but a product mismatch remains: users experience MUZERO as a set of tabs/surfaces, not as one flat app. The same physical key can be correct in one tab and wrong in another.

Concrete example:

- In **Now Playing**, `ArrowLeft` / `ArrowRight` should naturally mean previous / next track.
- In **Library/Search/Sets**, `ArrowLeft` / `ArrowRight` already mean back / open.
- Today playback prev/next defaults are `Q` / `E`, while arrows are reserved for library navigation in the `library` scope.

The best practice is to make shortcut ownership explicit per active surface, rather than changing arrows globally and breaking library navigation.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Keyboard-first listener | Wants natural transport keys on the Now Playing surface | Use and rebind tab-scoped shortcuts |
| Library curator | Uses arrows/WASD to navigate sets, albums, artists, and track lists | Keep library-specific arrow behavior intact |
| Power user | Wants the same action to have different shortcuts in different surfaces | Configure bindings by surface in Settings |

### 1.3 Core Value

1. **Surface-correct defaults:** arrows can switch tracks in Now Playing without stealing arrows from Library.
2. **No action duplication:** keep stable action ids such as `playback.prev`; attach additional scoped bindings instead of creating fake duplicate actions.
3. **Predictable conflict rules:** conflicts are only conflicts inside the same effective surface; cross-surface reuse is intentional shadowing.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Active UI state
  ├─ nav tab: now | search | settings
  ├─ queue drawer open?
  ├─ library surface active?
  └─ inspector/editor active?
          │
          ▼
resolveActiveShortcutScopes()
          │
          ▼
matchAction(event, activeScopes, mergedBindings)
          │
          ├─ now:     ArrowLeft  -> playback.prev
          ├─ now:     ArrowRight -> playback.next
          ├─ library: ArrowLeft  -> library.back
          └─ library: ArrowRight -> library.open
```

The design extends the current shortcut system, not a replacement:

- Keep [`src/shortcuts/registry.ts`](../../../src/shortcuts/registry.ts) as the source of truth.
- Keep [`src/shortcuts/engine.ts`](../../../src/shortcuts/engine.ts) pure and test-first.
- Keep user overrides in the local IndexedDB `settings` row.
- Keep rollback as `git revert`, not hidden flags.

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Shortcut engine | Pure TypeScript | Existing tested engine already owns merge, identity, conflicts, and display chips |
| Persistence | Dexie `AppSettings.shortcutOverrides` | Local-first, visible Settings, no backend |
| Runtime state | Zustand nav/UI stores + module-scope resolver | Active surface is derived from existing UI state; no duplicated keymap state |
| UI | Existing Settings Shortcuts UI + `ControlTooltip` | Reuse current rebind rows and Kbd chip affordances |

### 2.3 Project Structure

```
src/
├── shortcuts/
│   ├── registry.ts              # extend scope vocabulary + default scoped bindings
│   ├── engine.ts                # merge/match/conflict for scoped bindings
│   ├── engine.test.ts           # surface precedence + conflict tests
│   └── keymap-io.ts             # import/export version handling
├── hooks/
│   └── use-shortcut-dispatch.ts # resolve active scopes from nav/UI state
├── components/settings/
│   └── shortcuts-settings.tsx   # group editable bindings by surface
└── components/player/
    ├── track-identity-row.tsx   # tooltip shows drag + surface shortcuts
    └── transport controls       # hints use scoped/default display rows
```

---

## 3. Data Model Design

### 3.1 Core Concepts

Current model:

```ts
interface ShortcutActionDef {
  id: string;
  scope: "global" | "library" | "inspector";
  defaultBindings: ShortcutGesture[];
}

type ShortcutOverrides = Record<actionId, ShortcutGesture[]>;
```

Target model:

```ts
type ShortcutScope =
  | "global"
  | "now"
  | "library"
  | "queue"
  | "inspector";

interface ScopedShortcutBinding {
  scope: ShortcutScope;
  gesture: ShortcutGesture;
}

interface ShortcutActionDef {
  id: string;
  category: ShortcutCategory;
  labelKey: string;
  defaultBindings: ScopedShortcutBinding[];
  allowUserBindings?: boolean;
  protected?: boolean;
  keywords?: readonly string[];
}

type ShortcutOverridesV2 = Record<actionId, ScopedShortcutBinding[]>;
```

Best-practice default examples:

```ts
playback.prev:
  global: Q
  now: ArrowLeft

playback.next:
  global: E
  now: ArrowRight

library.back:
  library: A
  library: ArrowLeft

library.open:
  library: D
  library: ArrowRight
  library: Enter
```

### 3.2 Database Schema

No backend and no cloud sync.

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) `AppSettings.shortcutOverrides`
- **Required Change:** support a v2 shortcut override shape with per-binding `scope`
- **Migration Strategy:** read both shapes
  - old value: `Record<actionId, ShortcutGesture[]>`
  - new value: `Record<actionId, ScopedShortcutBinding[]>`
  - when reading old values, attach each gesture to the action's legacy/default scope
  - when saving from Settings, write the new shape
- **DB Version:** prefer no Dexie version bump if the field remains optional and backward-compatible; if TypeScript/schema validation requires explicit versioning, add a small `muzero-db` upgrade that leaves existing JSON untouched.
- **Rollback:** `git revert`; old v2 values should be ignored safely by older code if treated as malformed overrides and defaulted.

### 3.3 Relationship Diagram

```
SHORTCUT_ACTIONS[]
  └─ default scoped bindings
        │
        ▼
sanitizeOverrides(v1 | v2)
        │
        ▼
mergeBindings()
        │
        ▼
matchAction(activeScopes)
```

---

## 4. API Design

No network API.

### 4.1 Pure Engine Surface

| Symbol | Required Change |
|--------|-----------------|
| `mergeBindings` | Return scoped bindings per action |
| `findConflicts` | Compare conflicts only within the same `scope` |
| `matchAction` | Match by active scope precedence, using each binding's own scope |
| `actionBindingChips` | Accept optional `scope` filter so tooltips can show the relevant binding |
| `sanitizeOverrides` | Accept v1 and v2 stored shapes |
| `serializeKeymap` / `parseKeymap` | Version export schema to preserve scoped bindings |

### 4.2 Scope Precedence

Proposed precedence:

```ts
const SCOPE_PRECEDENCE = [
  "inspector",
  "queue",
  "library",
  "now",
  "global",
] as const;
```

Rules:

- `global` is always active.
- `now` is active when the selected tab is Now Playing and no higher-priority surface owns the key.
- `library` is active on Search/Sets/Tracks/Albums/Artists surfaces.
- `queue` is active while the queue drawer/panel has focus or is open.
- `inspector` is active while memory/annotation/editor-like UI owns input.

### 4.3 Error Handling

- If a stored override has no scope, migrate it using the action's legacy/default scope.
- If a scoped override uses an unknown scope, drop it.
- If an action id is unknown, drop it.
- If a user binds `ArrowLeft` to both `playback.prev@now` and `library.back@library`, this is allowed.
- If a user binds `ArrowLeft` to both `playback.prev@now` and another action in `now`, Settings must surface a same-scope conflict.

---

## 5. Frontend Design

### 5.1 Page Structure

Settings -> Shortcuts remains the canonical home.

Required UI change: group shortcut rows by **Surface** first, then category/action:

```text
Shortcuts
├─ Global
│  ├─ Play / Pause
│  ├─ Previous track: Q
│  └─ Next track: E
├─ Now Playing
│  ├─ Previous track: ←
│  └─ Next track: →
├─ Library
│  ├─ Back: A, ←
│  └─ Open / play focused: D, →, Enter
├─ Queue
└─ Inspector
```

Each row edits one `(actionId, scope)` binding group, not merely one action id.

### 5.2 UI Components

- [`components/settings/shortcuts-settings.tsx`](../../../src/components/settings/shortcuts-settings.tsx)
  - add surface grouping
  - show cross-scope reuse as normal, not as conflict
  - show same-scope conflicts in recorder
- [`components/settings/shortcut-recorder-dialog.tsx`](../../../src/components/settings/shortcut-recorder-dialog.tsx)
  - recorder target includes `actionId + scope`
  - displacement chain only traverses same-scope collisions
- [`hooks/use-shortcut-hint.ts`](../../../src/hooks/use-shortcut-hint.ts)
  - allow `hint("prev", { scope: "now" })`
  - keep existing global fallback for controls outside a known surface
- [`components/player/track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)
  - tooltip can show Now Playing arrow bindings when active

### 5.3 State Management

Active scopes are derived from existing app state:

- `useNavStore((s) => s.tab)` for Now Playing vs Library/Settings
- `useUiStore((s) => s.queueOpen)` for queue ownership
- existing editor/panel stores for inspector ownership

Do not put merged bindings into Zustand. Continue deriving them from Dexie settings and memoized pure functions.

---

## 6. Implementation Plan

### Phase 1: Scoped Binding Model

**Goal:** Extend the shortcut engine to understand per-binding scopes while keeping old keymaps readable.

**Tasks:**
- [ ] Extend `ShortcutScope` to include `now` and `queue`.
- [ ] Replace action-level scoped bindings with per-binding scoped bindings.
- [ ] Add v1 -> v2 sanitizer for stored overrides.
- [ ] Update conflict detection to compare `(scope, gestureIdentity)`.
- [ ] Update import/export schema with version handling.

### Phase 1 Checklist

- [ ] Existing user overrides still load.
- [ ] Same key in `now` and `library` is not a conflict.
- [ ] Same key in the same scope is a conflict.
- [ ] `registry.test.ts` confirms default bindings are conflict-free per scope.

### Phase 2: Now Playing Arrow Transport

**Goal:** Make `ArrowLeft` / `ArrowRight` previous/next in Now Playing without breaking Library.

**Tasks:**
- [ ] Add `playback.prev@now = ArrowLeft`.
- [ ] Add `playback.next@now = ArrowRight`.
- [ ] Resolve active scopes in `useShortcutDispatch`.
- [ ] Ensure Search/Library capture handlers still route `ArrowLeft` / `ArrowRight` to back/open.
- [ ] Update Now Playing/Dock tooltip hints to show scoped arrows.

### Phase 2 Checklist

- [ ] On Now Playing, `ArrowLeft` calls `prev`.
- [ ] On Now Playing, `ArrowRight` calls `next`.
- [ ] On Library, `ArrowLeft` still calls `library.back`.
- [ ] On Library, `ArrowRight` still calls `library.open`.
- [ ] Typing targets and dialogs still suppress global/surface shortcuts.

### Phase 3: Settings UI By Surface

**Goal:** Let users see and edit shortcuts per surface.

**Tasks:**
- [ ] Add surface sections to Settings -> Shortcuts.
- [ ] Let the recorder edit `(actionId, scope)`.
- [ ] Update reset behavior for action+scope vs whole action.
- [ ] Update import/export labels and validation messaging.

### Phase 3 Checklist

- [ ] A user can rebind `playback.next@now` without changing `playback.next@global`.
- [ ] Reset on `Now Playing -> Next track` restores only the `now` binding.
- [ ] Reset all still clears every override.
- [ ] i18n is complete for en/zh/ja/ko.

### Phase 4: Tooltip And Cheat-Sheet Parity

**Goal:** On-screen hints match the active surface and Settings model.

**Tasks:**
- [ ] Add scoped hint helpers for Dock and transport controls.
- [ ] Show Now Playing arrow hints in Now Playing-specific controls.
- [ ] Keep global `Q/E` hints where the control is not surface-specific.
- [ ] Update shortcut cheat-sheet search to include surface names.

### Phase 4 Checklist

- [ ] Dock play tooltip can show both global and Now Playing transport keys when useful.
- [ ] Track identity hover describes drag switching and arrow switching without contradiction.
- [ ] Cheat-sheet search finds `now`, `library`, `arrow`, `previous`, `next`, and localized equivalents.

---

## 7. Out of Scope

- 2-stroke shortcut sequences.
- Per-set or per-playlist keymaps.
- Mobile gesture remapping.
- Telemetry about shortcut usage.
- Hidden runtime flags or localStorage toggles.
- Replacing the entire shortcut Settings UI from scratch.

---

## 8. Security Considerations

- **Authentication / Authorization:** none; local single-user app.
- **Data Protection:** shortcut bindings are local device preferences, no PII, no secrets.
- **Telemetry:** none.
- **Logging:** no raw keyboard event logging. Debug logs, if any, go through [`src/lib/logger.ts`](../../../src/lib/logger.ts).
- **Rollback:** `git revert`, not hidden flags.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260610-muzero-configurable-keyboard-shortcuts-prd](../20260610-muzero-configurable-keyboard-shortcuts-prd/) | Current implemented registry, engine, Settings UI, import/export, presets |
| [20260607-muzero-player-shortcuts-dock-controls-prd](../20260607-muzero-player-shortcuts-dock-controls-prd/) | Earlier playback shortcut and Dock control direction |
| [20260607-muzero-player-shell-redesign-prd](../20260607-muzero-player-shell-redesign-prd/) | Dock/player-first shell context |
| [`src/shortcuts/registry.ts`](../../../src/shortcuts/registry.ts) | Current action registry |
| [`src/shortcuts/engine.ts`](../../../src/shortcuts/engine.ts) | Current pure shortcut engine |
| [`src/hooks/use-shortcut-dispatch.ts`](../../../src/hooks/use-shortcut-dispatch.ts) | Current global dispatcher |
| [`src/pages/search-page.tsx`](../../../src/pages/search-page.tsx) | Current library/gallery scoped handlers |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should `settings` tab have its own shortcut scope? | Resolved | No. Settings should rely on native form navigation plus existing global shortcuts; do not create a dedicated `settings` scope in v1. |
| 2 | Should queue shortcuts activate whenever the drawer is open or only when focused? | Resolved | Activate when the queue drawer/panel is open and the user is not typing, with tests proving it does not steal transport keys outside the queue surface. |
| 3 | Should scoped bindings be displayed as chips on one action row or split into surface rows? | Resolved | Split by surface for clarity |
| 4 | Should old v1 exported keymaps import into global or legacy action scope? | Resolved | Import into each action's legacy/default scope |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: best-practice plan for per-tab/per-surface shortcut ownership, including Now Playing arrow transport without breaking Library arrow navigation |
| 2026-06-13 | MUZERO | Resolved Open Questions 1-2: no dedicated Settings scope in v1; queue scope activates while the queue surface is open and not typing. |
