# PRD: System Global Shortcuts

**Status:** Completed
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** Shortcuts - Electron-first OS-level media controls while MUZERO is not foreground

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Action contract and shared dispatcher | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Electron global-shortcut adapter | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Settings UI and persistence | Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Platform QA and polish | Completed | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has a registry-driven keyboard shortcut system in [`src/shortcuts/`](../../../src/shortcuts/) and a Settings customizer. Those shortcuts are **in-app shortcuts**: they fire only while the WebView is focused and the app is in front.

Product now needs a second capability: **system global shortcuts** that can control playback while MUZERO is running but not foreground. Typical examples:

- Play / Pause
- Previous track
- Next track
- Volume up / down
- Toggle shuffle
- Like current track
- Cycle repeat mode

Important terminology:

- `ShortcutScope = "global"` currently means **app-wide while MUZERO is focused**.
- **System global shortcut** means an OS-level accelerator registered by the desktop shell, active while another app is foreground.

These must remain separate concepts. Reusing the existing `global` scope as the persistence model for OS-level shortcuts would create confusing behavior and unsafe defaults.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Keyboard-first listener | Wants to control MUZERO while writing, browsing, gaming, or presenting | Enable and configure system global shortcuts |
| Desktop power user | Has muscle-memory media hotkeys and wants MUZERO to respond in the background | Configure chords per action and inspect conflicts |
| Safety-conscious user | Does not want MUZERO to capture OS-wide keys accidentally | Keep feature disabled, remove individual bindings, or reset all |

### 1.3 Core Value

1. **Background control:** MUZERO can be used like a real desktop music player, not only a focused web app.
2. **Safe opt-in:** OS-level shortcuts are disabled until the user explicitly enables them in visible Settings.
3. **Shared action semantics:** System shortcuts call the same playback actions as in-app shortcuts, so behavior does not fork.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Settings row (IndexedDB)
  └─ systemShortcutBindings
        │
        ▼
sanitizeSystemShortcutSettings()
        │
        ▼
SystemShortcutRegistryHost
  ├─ Web / unsupported platform: no-op + unavailable status
  └─ Electron desktop: main-process globalShortcut register/unregister
        │
        ▼
OS global accelerator event
        │
        ▼
renderer IPC event / bridge callback
        │
        ▼
runShortcutAction(actionId)
        │
        ├─ playback.toggle  -> playerStore.togglePlay()
        ├─ playback.next    -> playerStore.next()
        ├─ playback.prev    -> playerStore.prev()
        ├─ playback.like    -> setTrackLiked(...)
        └─ ...
```

The feature extends the existing shortcut architecture:

- Keep [`src/shortcuts/registry.ts`](../../../src/shortcuts/registry.ts) as the stable action-id source.
- Add a system-global eligibility layer rather than duplicating action ids.
- Extract the action execution logic currently embedded in [`src/hooks/use-shortcut-dispatch.ts`](../../../src/hooks/use-shortcut-dispatch.ts) into a shared dispatcher used by both in-app and OS-level shortcuts.
- Register OS-level shortcuts first in Electron desktop. Browser dev mode, Tauri, and mobile are unsupported in v1 and should fail gracefully.

Electron is the primary desktop distribution path for this feature. The expected implementation direction is:

- Use Electron main-process `globalShortcut` registration after `app.whenReady()`.
- Add a small Electron module such as `electron/global-shortcuts.cjs` and wire it from [`electron/main.cjs`](../../../electron/main.cjs).
- Expose a minimal bridge in [`electron/preload.cjs`](../../../electron/preload.cjs) for renderer -> main registration sync and main -> renderer action events.
- Keep the renderer action execution local so Electron never needs direct access to IndexedDB or Zustand internals.

Implementation must verify the exact current Electron globalShortcut API from the installed Electron version before coding. Tauri parity can be a later PRD/phase if Tauri desktop becomes the target shell again.

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Desktop shell | Electron main-process `globalShortcut` | OS-level accelerator registration belongs to the shell, not DOM keydown |
| Frontend settings | React + existing Settings shortcuts UI | Users already manage shortcuts in Settings |
| Persistence | Dexie `AppSettings` row | Local-first, device-local, no backend |
| Runtime execution | Existing Zustand player store + shared dispatcher | One source of truth for playback actions |
| Tests | Vitest with fake adapter | Registration lifecycle can be deterministic without OS hooks |

### 2.3 Project Structure

```
src/
├── shortcuts/
│   ├── registry.ts                  # stable action ids, in-app defaults
│   ├── system-global.ts             # eligible action ids + accelerator validation
│   └── system-global.test.ts
├── hooks/
│   ├── use-shortcut-dispatch.ts     # in-app keydown, reuses shared dispatcher
│   └── use-system-shortcuts.ts      # sync desired OS shortcuts through Electron bridge
├── components/settings/
│   └── shortcuts-settings.tsx       # System Global section / status / recorder
├── db/
│   └── types.ts                     # AppSettings.systemShortcutBindings
└── lib/
    └── platform.ts                  # Electron bridge detection helpers if needed

electron/
├── main.cjs                         # wire global shortcut module
├── preload.cjs                      # expose narrow global-shortcut bridge
└── global-shortcuts.cjs             # register/unregister accelerators + emit action events
```

Net-new files are acceptable here because system global shortcuts are a separate runtime boundary from DOM keydown. Keep them small and pure where possible.

---

## 3. Data Model Design

### 3.1 Core Concepts

Existing in-app shortcut shape:

```ts
type ShortcutScope = "global" | "now" | "library" | "queue" | "inspector";

interface ScopedShortcutBinding {
  scope: ShortcutScope;
  gesture: ShortcutGesture;
}

interface AppSettings {
  shortcutOverrides?: Record<string, ScopedShortcutBinding[]>;
}
```

Proposed system global shape:

```ts
type SystemShortcutActionId =
  | "playback.toggle"
  | "playback.prev"
  | "playback.next"
  | "playback.volumeUp"
  | "playback.volumeDown"
  | "playback.toggleShuffle"
  | "playback.like"
  | "playback.cycleRepeat";

interface SystemShortcutBinding {
  enabled: boolean;
  gesture?: ShortcutGesture; // key only, converted to Electron accelerator string
}

interface AppSettings {
  systemShortcutsEnabled?: boolean;
  systemShortcutBindings?: Partial<Record<SystemShortcutActionId, SystemShortcutBinding>>;
}
```

Best-practice constraints:

- Disabled by default.
- Each action is opt-in. Do not silently register all eligible actions on upgrade.
- Only allow key gestures that can be represented as OS accelerators.
- Prefer modifier chords or media keys. Bare letters, bare digits, bare arrows, Space, and Enter should be rejected for system-global bindings unless the OS exposes them as dedicated media keys.
- Existing in-app `shortcutOverrides` are not automatically promoted to system global shortcuts.

### 3.2 Database Schema

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) `AppSettings`.
- **Required Change:** add optional `systemShortcutsEnabled` and `systemShortcutBindings`.
- **Data Migration:** no Dexie version bump required if fields are optional and default to disabled. If future validation requires explicit default rows, add a small DB upgrade that initializes disabled settings only.
- **Privacy:** shortcut bindings are local preferences, no secrets, no PII.
- **Rollback:** `git revert`; older builds ignore unknown optional fields.

### 3.3 Data Relationship Diagram

```
SHORTCUT_ACTIONS
  └─ eligible subset
        │
        ▼
AppSettings.systemShortcutBindings
        │
        ▼
adapter.register(accelerator, actionId)
        │
        ▼
runShortcutAction(actionId)
```

---

## 4. API Design

No network API.

### 4.1 Internal Interfaces

| Symbol | Description |
|--------|-------------|
| `SYSTEM_GLOBAL_SHORTCUT_ACTIONS` | Ordered allowlist of action ids eligible for OS-level shortcuts |
| `sanitizeSystemShortcutBindings` | Drops unknown actions, malformed gestures, disabled invalid entries |
| `systemGestureToAccelerator` | Converts a safe `ShortcutGesture` into an Electron accelerator string |
| `registerSystemShortcuts` | Adapter lifecycle: unregister stale accelerators, register enabled ones, return status map |
| `runShortcutAction` | Shared imperative action dispatcher used by focused and system shortcuts |
| `window.muzero.systemShortcuts` | Electron preload bridge for registration sync and action events |

### 4.2 Registration Lifecycle

1. On app startup, read `AppSettings`.
2. If `systemShortcutsEnabled !== true`, unregister any registered accelerators and mark feature idle.
3. If enabled and running in supported Electron desktop environment:
   - sanitize bindings
   - convert gestures to accelerators
   - send desired registration map to Electron main through the preload bridge
   - unregister stale accelerators before registering replacements in the main process
   - register accelerators one by one so partial failures can be surfaced per action
4. On Settings changes, diff current vs desired registration set.
5. On Electron `will-quit`, unregister all accelerators owned by MUZERO.
6. On a registered accelerator event, Electron main sends the stable `actionId` to the renderer; the renderer runs `runShortcutAction(actionId)`.

### 4.3 Error Handling

- If the OS/plugin rejects a shortcut, keep the setting but show `Failed to register` with a reason if available.
- Never silently fall back to a different chord.
- If a duplicate accelerator is assigned to two eligible system actions, block save in Settings before registration.
- If the platform is unsupported, show unavailable state and do not render a fake working toggle.
- If the app is already foreground, the system global event should not double-fire with DOM keydown. The runtime should de-dupe by execution source or ensure the OS event path is the only source for that accelerator.

---

## 5. Frontend Design

### 5.1 Page Structure

Settings -> Shortcuts gains a dedicated section:

```text
Keyboard shortcuts
├─ In-app shortcuts
│  ├─ Global
│  ├─ Now Playing
│  ├─ Library
│  └─ Inspector
└─ System global shortcuts
   ├─ Enable system global shortcuts [toggle]
   ├─ Play / Pause
   ├─ Previous track
   ├─ Next track
   ├─ Volume up / down
   ├─ Toggle shuffle
   ├─ Like current track
   └─ Cycle repeat
```

UI principles:

- Make the feature visibly opt-in.
- Explain that shortcuts work while MUZERO is running in the background, not when the app is quit.
- Show per-action registration status: active, disabled, conflict, unsupported, failed.
- Use the existing recorder UI where possible, but apply stricter validation for OS-level accelerators.
- Keep in-app and system-global sections visually distinct to prevent accidental mental model mixing.

### 5.2 UI Components

- [`components/settings/shortcuts-settings.tsx`](../../../src/components/settings/shortcuts-settings.tsx)
  - add System Global section under in-app shortcuts
  - expose feature toggle
  - render eligible action rows
  - show status chips
- [`components/settings/shortcut-recorder-dialog.tsx`](../../../src/components/settings/shortcut-recorder-dialog.tsx)
  - add mode or wrapper for system-global recording
  - reject unsafe bare keys
- [`hooks/use-shortcut-hint.ts`](../../../src/hooks/use-shortcut-hint.ts)
  - optional future: display system-global hint rows separately; do not mix them into in-app tooltips by default
- [`electron/global-shortcuts.cjs`](../../../electron/)
  - new Electron main-process owner for OS accelerator lifecycle
- [`electron/preload.cjs`](../../../electron/preload.cjs)
  - expose a narrow, typed-ish bridge; do not expose raw `ipcRenderer`

### 5.3 State Management

- Persist settings in IndexedDB through existing repository functions.
- Keep live registration state outside Zustand if it is adapter-owned and not needed for broad UI rendering.
- UI can subscribe to a narrow status store or hook result for per-row status.
- Do not put raw OS key events into logs or persistent state.

---

## 6. Implementation Plan

### Phase 1: Action Contract And Shared Dispatcher

**Goal:** Define which existing actions can be invoked from system global shortcuts and share execution logic with in-app shortcuts.

**Tasks:**
- [x] Add `SYSTEM_GLOBAL_SHORTCUT_ACTIONS` allowlist.
- [x] Extract `runShortcutAction(actionId, ctx)` from `useShortcutDispatch`.
- [x] Add pure validation for safe system-global gestures.
- [x] Add tests proving unsupported actions cannot be registered.

### Phase 1 Checklist

- [x] In-app shortcuts still dispatch exactly as before.
- [x] Eligible system action ids are stable existing ids.
- [x] Navigation/search/library actions are not eligible.
- [x] Bare letters/arrows are rejected for system global registration.

**Phase 1 Verification:**
- `vitest run src/shortcuts/system-global.test.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.test.tsx`
- `tsc --noEmit`
- `biome check src/shortcuts/actions.ts src/shortcuts/system-global.ts src/shortcuts/actions.test.ts src/shortcuts/system-global.test.ts src/hooks/use-shortcut-dispatch.ts`

### Phase 2: Electron Global-Shortcut Adapter

**Goal:** Register and unregister OS-level accelerators in Electron desktop with deterministic lifecycle behavior.

**Tasks:**
- [x] Add `electron/global-shortcuts.cjs` using Electron main-process `globalShortcut`.
- [x] Wire module from `electron/main.cjs` after `app.whenReady()` and clean up on `will-quit`.
- [x] Add IPC / preload bridge methods for registration sync and action event subscription.
- [x] Build a renderer-side adapter with fake implementation for tests.
- [x] Add lifecycle hook to sync settings -> registered accelerators.

### Phase 2 Checklist

- [x] Web/browser dev mode reports unsupported without throwing.
- [x] Electron desktop registers enabled accelerators.
- [x] Changing a binding unregisters the old accelerator before registering the new one.
- [x] Failed registration is surfaced per action.
- [x] App teardown unregisters owned accelerators.

**Phase 2 Verification:**
- `vitest run scripts/electron-global-shortcuts.test.mjs src/hooks/use-system-shortcuts.test.tsx src/shortcuts/system-global.test.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.test.tsx`
- `tsc --noEmit`
- `biome check src/hooks/use-system-shortcuts.ts src/hooks/use-system-shortcuts.test.tsx src/lib/desktop/bridge.ts src/lib/desktop/electron.ts src/hooks/use-shortcut-dispatch.ts src/shortcuts/actions.ts src/shortcuts/system-global.ts src/shortcuts/actions.test.ts src/shortcuts/system-global.test.ts`
- `node --check electron/global-shortcuts.cjs`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`

### Phase 3: Settings UI And Persistence

**Goal:** Let users enable, bind, disable, reset, and inspect system global shortcuts.

**Tasks:**
- [x] Add `AppSettings.systemShortcutsEnabled`.
- [x] Add `AppSettings.systemShortcutBindings`.
- [x] Add repository functions for per-action update/reset.
- [x] Add Settings section with enable toggle and eligible rows.
- [x] Add i18n for en/zh/ja/ko.

### Phase 3 Checklist

- [x] Feature defaults to disabled.
- [x] Enabling with no bindings does not register anything.
- [x] User can bind Play/Pause, Prev, Next, Volume, Shuffle, Like, Repeat.
- [x] Duplicate system-global accelerators are blocked before save.
- [x] Reset all system global shortcuts does not reset in-app shortcuts.

**Phase 3 Verification:**
- `vitest run scripts/electron-global-shortcuts.test.mjs src/hooks/use-system-shortcuts.test.tsx src/shortcuts/system-global.test.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.test.tsx src/db/repositories.test.ts src/components/settings/shortcuts-settings.test.tsx src/components/settings/shortcuts-settings-import.test.tsx`
- `tsc --noEmit`
- `biome check --write src/App.tsx src/db/types.ts src/db/repositories.ts src/db/repositories.test.ts src/components/settings/shortcuts-settings.tsx src/components/settings/shortcuts-settings.test.tsx src/hooks/use-system-shortcuts.ts src/hooks/use-system-shortcuts.test.tsx src/shortcuts/system-global.ts src/shortcuts/system-global.test.ts src/shortcuts/actions.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.ts src/lib/desktop/bridge.ts src/lib/desktop/electron.ts`
- `JSON.parse` validation for `src/i18n/locales/{en,zh,ja,ko}/common.json`

### Phase 4: Platform QA And Polish

**Goal:** Validate OS behavior and edge cases before shipping.

**Tasks:**
- [x] Test Electron Windows packaged build path.
- [x] Test Electron macOS packaged build, including OS-reserved accelerator failures.
- [x] Test Electron Linux packaged build where supported by Electron/window manager.
- [x] Add docs/help copy in Settings.
- [x] Confirm no raw key logging.

### Phase 4 Checklist

- [x] Shortcuts fire while another app is foreground.
- [x] Shortcuts do not fire after MUZERO quits.
- [x] Foreground use does not double-trigger.
- [x] OS-reserved conflicts are visible to the user.
- [x] Unsupported platform state is clear and non-blocking.

**Phase 4 Verification:**
- `vitest run scripts/electron-global-shortcuts.test.mjs src/hooks/use-system-shortcuts.test.tsx src/shortcuts/system-global.test.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.test.tsx src/db/repositories.test.ts src/components/settings/shortcuts-settings.test.tsx src/components/settings/shortcuts-settings-import.test.tsx`
- `tsc --noEmit`
- `biome check src/App.tsx src/db/types.ts src/db/repositories.ts src/db/repositories.test.ts src/components/settings/shortcuts-settings.tsx src/components/settings/shortcuts-settings.test.tsx src/hooks/use-system-shortcuts.ts src/hooks/use-system-shortcuts.test.tsx src/shortcuts/system-global.ts src/shortcuts/system-global.test.ts src/shortcuts/actions.ts src/shortcuts/actions.test.ts src/hooks/use-shortcut-dispatch.ts src/lib/desktop/bridge.ts src/lib/desktop/electron.ts`
- `vite build`
- `node scripts/build-electron-main.mjs`
- `node --check electron/global-shortcuts.cjs`
- `node --check electron/main.cjs`
- `node --check electron/preload.cjs`
- `JSON.parse` validation for `src/i18n/locales/{en,zh,ja,ko}/common.json`
- `rg "console\\.|raw key|rawKey|event\\.key.*log|log\\..*event\\.key" src/shortcuts src/hooks/use-system-shortcuts.ts src/components/settings/shortcuts-settings.tsx electron/global-shortcuts.cjs` returned no matches.

**Manual / Environment Notes:**
- Windows unpacked packaging was attempted with `electron-builder --dir --win --config.electronVersion=42.4.0`; Electron 42.4.0 downloaded successfully, but the managed worktree environment repeatedly failed on `EPERM` while renaming `win-unpacked.tmp` to `win-unpacked`, including a clean `.packtest` output directory. This is recorded as an environment blocker for release-machine QA, not an application compile failure.
- macOS and Linux packaged runtime checks require those OS/window-manager environments. The code path is covered by Electron registry lifecycle tests and should be verified on release machines before publishing installers.
- Foreground/background fire behavior is covered at the adapter boundary: Electron main emits one action event per registered accelerator, renderer filters to the eligible action allowlist, and `will-quit` unregisters owned accelerators. True OS foreground/background behavior still belongs to release-machine QA.

---

## 7. Out of Scope

- Running global shortcuts when MUZERO is not running.
- Auto-start at login.
- Mobile global shortcuts.
- Tauri desktop parity; v1 is Electron-only.
- Per-set or per-playlist system shortcut profiles.
- Remapping OS media keys globally outside MUZERO.
- Hidden localStorage / URL / environment feature flags.
- Telemetry for shortcut usage.

---

## 8. Security Considerations

- **Authentication / Authorization:** none; local single-user app.
- **Data Protection:** bindings are local preferences in IndexedDB.
- **Key Capture Boundary:** use OS accelerator registration only; do not implement a keylogger or raw background key listener.
- **Logging:** do not log raw key events. Registration errors may log action id + sanitized accelerator through [`src/lib/logger.ts`](../../../src/lib/logger.ts) at warn level.
- **User Consent:** disabled by default and controlled through visible Settings.
- **Rollback:** `git revert`, not hidden runtime flags.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260613-muzero-tab-scoped-shortcuts-prd](../20260613-muzero-tab-scoped-shortcuts-prd/) | Existing per-surface in-app shortcut ownership |
| [20260610-muzero-configurable-keyboard-shortcuts-prd](../20260610-muzero-configurable-keyboard-shortcuts-prd/) | Base configurable shortcut registry and Settings customizer |
| [`src/shortcuts/registry.ts`](../../../src/shortcuts/registry.ts) | Stable action registry |
| [`src/hooks/use-shortcut-dispatch.ts`](../../../src/hooks/use-shortcut-dispatch.ts) | Current focused-window dispatcher |
| [`electron/main.cjs`](../../../electron/main.cjs) | Electron main-process shell |
| [`electron/preload.cjs`](../../../electron/preload.cjs) | Existing Electron renderer bridge |
| [`electron/ipc.cjs`](../../../electron/ipc.cjs) | Existing Electron IPC registration pattern |
| [`package.json`](../../../package.json) | Electron scripts and build configuration |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should system global shortcuts have default enabled bindings? | Open | Recommended: no; default disabled and no registered accelerators until explicit user choice. |
| 2 | Should hardware media keys be offered as first-class bindings if Electron supports them consistently across platforms? | Open | Verify Electron/platform support before committing. |
| 3 | Should app volume shortcuts control MUZERO volume or OS volume when registered globally? | Open | Recommended: MUZERO volume only, with explicit Settings copy. |
| 4 | Should Tauri builds support the same feature? | Open | Electron first; Tauri parity only after Electron UX and settings model are proven. |
| 5 | How should duplicate foreground/background events be de-duped on each OS? | Open | Needs adapter spike in Phase 2. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: opt-in OS-level global shortcut support for playback controls while MUZERO is not foreground. |
| 2026-06-13 | MUZERO | Updated product direction to Electron-first implementation with Tauri parity explicitly out of v1 scope. |
| 2026-06-13 | MUZERO | Completed Phase 1: added system-global action allowlist, safe accelerator validation, shared shortcut action runner, and focused shortcut regression tests. |
| 2026-06-13 | MUZERO | Completed Phase 2: added Electron globalShortcut registration, preload/DesktopBridge adapter, renderer sync hook, and lifecycle tests. |
| 2026-06-13 | MUZERO | Completed Phase 3: added settings persistence, App-level sync, Settings UI, duplicate/safety validation, and en/zh/ja/ko copy. |
| 2026-06-13 | MUZERO | Completed Phase 4: added unsupported-platform Settings state, final QA checks, raw-key logging scan, and packaged-build environment notes. |
