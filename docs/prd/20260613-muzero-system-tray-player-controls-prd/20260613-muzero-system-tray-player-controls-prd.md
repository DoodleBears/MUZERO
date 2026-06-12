# PRD: MUZERO System Tray Player Controls And Close-To-Tray

**Status:** Draft
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** Desktop Shell - System tray menu, background window lifecycle, and player controls

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Tray action contract and menu model | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Native tray icon and close-to-tray lifecycle | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Player-aware tray controls | Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Platform QA and polish | Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

Product feedback: desktop users expect MUZERO to behave like a real music player that keeps running from the system tray. The tray icon should expose quick player controls similar to the reference screenshot: current song information, previous / play-pause / next, red-heart like, repeat settings, supported playback/display options, Settings, and Exit.

The second requirement is lifecycle-critical: clicking the top-right close button must no longer quit the app. It should hide the main window and remove it from the taskbar, while playback and the DJ loop continue. The tray icon becomes the recovery surface: clicking it, double-clicking it, or choosing "Open MUZERO" shows the window again. The explicit tray "Exit" action is the way to actually quit the desktop app.

This PRD covers desktop shells only. **V1 targets Electron desktop temporarily**; Tauri parity is deferred until the Electron behavior is proven. Mobile platforms do not have a system tray and are out of scope.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Background listener | Keeps music playing while working in other apps and wants MUZERO out of the taskbar | Hide window to tray, restore from tray, control playback |
| Desktop music-player user | Expects quick tray controls without reopening the full app | Previous / play / next, like, repeat, current track info |
| Power user | Uses MUZERO as a long-running local-first library and DJ session | Continue playback/generation after closing the window, quit explicitly |

### 1.3 Core Value

1. **Desktop-native presence:** MUZERO feels like a music player, not a browser tab that disappears when closed.
2. **Low-friction control:** Users can switch tracks, pause, heart the current track, and change repeat mode from the tray.
3. **Safe lifecycle semantics:** Close hides; Exit quits. Users do not lose playback by accidentally closing the window.
4. **Local-first discipline:** Tray state is derived from local player/DB state only; no backend, no telemetry, no hidden flags.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Renderer player state / Dexie live data
  ├─ usePlayerStore narrow selectors
  ├─ current Track liked bit via Dexie live query
  └─ i18next localized labels
        │
        ▼
buildTraySnapshot()
        │  sanitized, no secrets, no media bytes
        ▼
DesktopBridge.tray.update(snapshot)
        │
        ├─ Electron adapter: Tray + Menu + IPC bridge
        ├─ Tauri adapter: native tray/menu/window events
        └─ Web adapter: no-op unsupported
        │
        ▼
Native tray menu / tray click
        │
        ▼
Tray action event
        │
        ├─ shell-owned: window.show / window.hide / app.quit
        └─ renderer-owned: playback.toggle / next / prev / like / repeat / displayMode / settings
```

Ownership rule:

- The **renderer owns player semantics** because playback, repeat, liked state, and current queue live in Zustand + IndexedDB.
- The **desktop shell owns OS lifecycle** because tray creation, taskbar visibility, close interception, and actual app quit are native responsibilities.
- Communication uses stable action ids and a sanitized tray snapshot. Native code must not read IndexedDB, inspect `usePlayerStore`, or know `TrackBrief`.

The current repo already routes native capabilities through [`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts), with Electron, Tauri, and web implementations. This feature should extend that bridge instead of scattering shell checks through UI code.

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Desktop shell | Electron Tray/Menu first; Tauri parity later | Tray and close interception are native shell responsibilities; product decision is Electron-first for v1 |
| Renderer state | Zustand `usePlayerStore` + Dexie `useLiveQuery` | Existing player and liked-state sources of truth |
| Persistence | Existing IndexedDB settings/play queue rows | No new backend; repeat/display mode already persist through existing repo/store paths |
| UI copy | i18next en/zh/ja/ko | Tray labels shown to users must be localized |
| Tests | Vitest pure helpers + fake desktop bridge; packaged desktop manual QA | Menu model/action mapping can be deterministic; OS tray behavior needs packaged verification |

Implementation must verify the exact current Electron tray API before coding. Tauri API verification belongs to a later parity pass.

### 2.3 Project Structure

```
src/
├── lib/
│   └── desktop/
│       ├── bridge.ts                 # add tray/window lifecycle capability contract
│       ├── electron.ts               # Electron tray adapter bridge methods for v1
│       ├── tauri.ts                  # unsupported/deferred tray adapter for v1
│       └── web.ts                    # unsupported no-op
├── tray/
│   ├── actions.ts                    # stable tray action ids + renderer dispatcher
│   ├── menu-model.ts                 # build localized tray menu snapshot/model
│   ├── menu-model.test.ts
│   └── use-tray-sync.ts              # subscribe to narrow player/DB state and sync shell
├── components/shell/
│   └── windows-window-controls.tsx   # close button should call hide-to-tray semantics
└── i18n/locales/{en,zh,ja,ko}/common.json

electron/
├── main.cjs                          # create Tray/Menu, intercept close, show/hide/quit
├── preload.cjs                       # expose narrow tray bridge
└── ipc.cjs                           # tray update/action IPC handlers if kept separate

src-tauri/
├── src/lib.rs                        # v1 no-op/deferred; parity later
├── Cargo.toml                        # no tray dependency for Electron-first v1
└── capabilities/default.json         # no tray permission changes for Electron-first v1
```

New files under `src/tray/` are acceptable because tray menu modeling is a new shell boundary. Keep player action execution shared and thin; do not fork playback behavior from existing player controls.

---

## 3. Data Model Design

### 3.1 Core Concepts

No IndexedDB schema change is required for v1. Tray state is derived from existing state.

```ts
type TrayActionId =
  | "window.show"
  | "window.hide"
  | "app.quit"
  | "nav.now"
  | "nav.settings"
  | "playback.toggle"
  | "playback.prev"
  | "playback.next"
  | "track.toggleLike"
  | "playback.repeat.off"
  | "playback.repeat.all"
  | "playback.repeat.one"
  | "display.mode.video"
  | "display.mode.cover"
  | "display.mode.title";

interface TraySnapshot {
  supported: boolean;
  currentTrack?: {
    id: string;
    title: string;
    subtitle: string;
    liked: boolean;
  };
  isPlaying: boolean;
  repeat: "off" | "one" | "all";
  displayMode: "video" | "cover" | "title";
  canControlPlayback: boolean;
  labels: Record<string, string>;
}
```

Snapshot constraints:

- No API keys, endpoints, prompts, notes, tags, lyrics text, local file paths, media bytes, cover bytes, or Blob URLs.
- Current title/subtitle are local user-visible metadata only; do not log them from native code.
- Labels must be localized in the renderer and passed to the shell so native menu copy stays aligned with i18n. Do not hardcode user-facing tray/menu text in Electron main/preload code.
- Unknown action ids from native events must be ignored and logged only as sanitized ids.

### 3.2 Database Schema

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) already contains `Track.liked`, queue repeat, and session display mode.
- **Required Changes:** none for v1.
- **Data Migration:** none.
- **Rollback:** `git revert`; older builds ignore any new bridge code and keep current close behavior.
- **Privacy:** tray snapshot is local process memory only. Do not persist tray snapshots.

If product later adds visible preferences such as "launch minimized to tray" or "show rich tray panel", store them in `AppSettings` via Dexie and add an explicit visible Settings control. Do not use hidden `localStorage`, URL flags, `window.*`, or environment toggles.

### 3.3 Data Relationship Diagram

```
Track.liked + current queue item
        │
PlayQueue.repeat + session.displayMode
        │
useTraySync()
        │
TraySnapshot
        │
Native tray menu
        │
TrayActionId
        │
renderer dispatcher / shell lifecycle action
```

---

## 4. API Design

No network API.

### 4.1 Internal Interfaces

| Symbol | Description |
|--------|-------------|
| `DesktopBridge.tray` | Optional desktop tray capability; absent in web/mobile unsupported environments |
| `tray.update(snapshot)` | Renderer pushes current localized menu model/state to shell |
| `tray.onAction(callback)` | Shell emits stable tray action ids to renderer |
| `windowControls.hideToTray()` | Hide main window without quitting; removes taskbar presence where platform supports it |
| `windowControls.showFromTray()` | Show, restore if minimized, focus main window |
| `windowControls.quitApp()` | Explicit app quit path used by tray Exit and native quit commands |
| `buildTraySnapshot()` | Pure helper deriving menu state from current player/DB/i18n data |
| `dispatchTrayAction()` | Renderer-owned action dispatcher for player/nav actions |

Avoid overloading `windowControls.close()` with ambiguous meaning. The PRD-preferred API names are explicit: hide-to-tray, show-from-tray, quit.

### 4.2 Tray Menu Model

Functional v1 menu. All labels must come from i18n catalogs (`en`, `zh`, `ja`, `ko`) before being sent to the native menu:

```text
MUZERO
Current: <Title> - <Artist/Subtitle>        disabled or opens Now Playing
────────────────────────────────────────
Previous
Play / Pause
Next
Like / Unlike current track                 checked/active when liked
────────────────────────────────────────
Repeat
  Off
  Repeat all
  Repeat one
Display mode
  Video
  Cover
  Title
────────────────────────────────────────
Open MUZERO
Open Now Playing
Settings
────────────────────────────────────────
Exit MUZERO
```

Native tray menus may not support the screenshot's exact rich layout of icon rows and custom hover panels on every OS. Do not block the MVP on pixel-level custom UI. If product requires screenshot-level visual fidelity on Windows, build it as a later custom tray popover phase after the native menu behavior ships.

### 4.3 Window Lifecycle

1. App start creates a tray icon for desktop platforms before or alongside the main window.
2. If tray creation succeeds, closing the main window hides it instead of destroying/quitting it.
3. Hidden window is not visible in the taskbar/dock window list where the OS supports that behavior.
4. Playback, DJ generation, media element state, IndexedDB live queries, and queued async jobs continue while hidden.
5. Tray click/double-click and "Open MUZERO" call show/restore/focus.
6. "Exit MUZERO" sets an explicit quitting guard, persists window/player state, then quits the process.
7. If tray creation fails, the app must not hide the only window unrecoverably. Fallback should keep normal close behavior or minimize instead, and log a sanitized warning.
8. macOS native Quit (`Cmd+Q`) should still quit. Window close should hide; app quit should quit.

### 4.4 Error Handling

- If the current track is missing, disable playback-specific items except Open/Settings/Exit.
- If no renderer snapshot has arrived yet, show a minimal safe menu: MUZERO / Open MUZERO / Exit MUZERO.
- If a tray action is received while the renderer is not ready, queue only shell-owned actions; drop renderer-owned playback actions.
- If native menu update fails, retain the last known good menu.
- Never log user track titles/subtitles or local paths from native code.

---

## 5. Frontend Design

### 5.1 User Interaction

Primary desktop behavior:

- Top-right `X` hides MUZERO to tray.
- The taskbar no longer shows MUZERO after hide-to-tray on Windows/Linux where supported.
- The tray icon remains visible while the app is running.
- Clicking or double-clicking the tray icon restores the window.
- Tray menu "Exit MUZERO" is the explicit quit action.

Tray control behavior:

- Current track row shows title and artist/subtitle. Selecting it opens Now Playing.
- Previous / Play-Pause / Next call the same store actions as in-app controls.
- Heart toggles [`setTrackLiked`](../../../src/db/repositories.ts) for the current track.
- Repeat submenu maps to existing repeat modes and preserves semantics from [`src/player/transport.ts`](../../../src/player/transport.ts).
- Display mode submenu maps to existing `displayMode` values used by Now Playing and media stage.
- Settings opens the Settings tab/page and restores the window if hidden.

### 5.2 UI Components

- [`src/components/shell/windows-window-controls.tsx`](../../../src/components/shell/windows-window-controls.tsx)
  - The close button should call explicit hide-to-tray behavior once supported.
  - Minimize remains regular minimize.
  - Maximize/restore unchanged.
- [`src/tray/use-tray-sync.ts`](../../../src/tray/use-tray-sync.ts)
  - Mount once near [`src/App.tsx`](../../../src/App.tsx).
  - Use minimal Zustand selectors; do not subscribe to the whole player store.
  - Use Dexie live query for current track liked bit.
- [`src/tray/menu-model.ts`](../../../src/tray/menu-model.ts)
  - Pure menu/snapshot builder with tests for empty/current/liked/repeat/display states.
- i18n catalogs
  - Add all user-visible tray labels to en/zh/ja/ko.
  - Electron main/preload code must receive labels from renderer snapshots and must not own user-visible menu strings.

### 5.3 State Management

- Do not put tray adapter instances in Zustand.
- Use module-level bridge subscriptions or a hook with cleanup.
- Player actions should call existing `usePlayerStore.getState()` methods and repository functions.
- Native shell actions that reveal/hide/quit should stay in shell adapter code.
- Keep update frequency low: tray snapshot changes only on current track, play/pause, liked, repeat, display mode, or locale changes. Do not sync on every playback progress tick.

---

## 6. Implementation Plan

### Phase 1: Tray Action Contract And Menu Model

**Goal:** Define stable action ids, a sanitized localized tray snapshot, and a renderer dispatcher without touching native shell behavior yet.

**Tasks:**
- [x] Add `src/tray/actions.ts` with allowlisted `TrayActionId` values.
- [x] Add `src/tray/menu-model.ts` pure helper for `TraySnapshot`.
- [x] Add `dispatchTrayAction()` for renderer-owned actions: playback toggle, prev, next, like, repeat, display mode, Now Playing, Settings.
- [x] Add i18n keys for tray labels in en/zh/ja/ko.
- [x] Add unit tests for menu model and unknown action rejection.

### Phase 1 Checklist

- [x] Snapshot contains no secrets, prompts, file paths, notes, tags, lyrics, or media bytes.
- [x] Empty queue disables playback/like items.
- [x] Repeat and display mode states render as mutually exclusive choices.
- [x] Dispatcher reuses existing player/store/repository behavior.
- [x] No `console.*` in `src/**`; use [`src/lib/logger.ts`](../../../src/lib/logger.ts) if needed.

### Phase 2: Native Tray Icon And Close-To-Tray Lifecycle

**Goal:** Ship the core Electron desktop lifecycle: tray exists, close hides, tray restores, Exit quits.

**Tasks:**
- [x] Extend `DesktopBridge` with explicit tray and window lifecycle methods.
- [x] Implement Electron tray creation for v1.
- [x] Intercept native window close requests and hide when tray is available.
- [x] Update the custom Windows close button to call hide-to-tray.
- [x] Add explicit quit guard so tray Exit and native app Quit really quit.
- [x] Add safe fallback if tray creation fails.

### Phase 2 Checklist

- [x] Closing the window does not quit the app.
- [x] Playback continues while the main window is hidden.
- [x] MUZERO disappears from the taskbar after hide-to-tray where supported.
- [x] Tray click or "Open MUZERO" restores and focuses the same window.
- [x] "Exit MUZERO" quits the app process.
- [x] App cannot become unrecoverably hidden if tray creation fails.
- [x] Tauri/web report unsupported and keep recoverable window behavior.

### Phase 3: Player-Aware Tray Controls

**Goal:** Make the tray menu reflect and control current playback state.

**Tasks:**
- [ ] Mount `useTraySync()` once in the app shell.
- [ ] Push localized snapshot updates on current track, play/pause, liked, repeat, display mode, and locale changes.
- [ ] Wire native tray menu items to stable `TrayActionId` events.
- [ ] Support heart toggle through current track id + Dexie repository.
- [ ] Support repeat submenu and display mode submenu.
- [ ] Keep the last known good menu when transient update errors occur.
- [ ] Ensure every native menu label is supplied from i18n renderer snapshot.

### Phase 3 Checklist

- [ ] Tray title/subtitle updates after track changes.
- [ ] Play/Pause label and action match current state.
- [ ] Heart state updates after toggling in either tray or main UI.
- [ ] Repeat mode changes from tray persist and match Now Playing UI.
- [ ] Display mode changes from tray persist and match media stage behavior.
- [ ] Tray sync does not run on every progress tick.
- [ ] Changing app language updates tray menu labels.

### Phase 4: Platform QA And Polish

**Goal:** Verify packaged desktop behavior and finalize product polish.

**Tasks:**
- [ ] Test packaged Electron Windows build: tray icon, taskbar removal, restore, exit, media continues.
- [ ] Test packaged Electron macOS build: menu bar status item behavior, window close vs Cmd+Q.
- [ ] Test packaged Electron Linux where tray/status notifier is available; document distro/window-manager caveats.
- [ ] Verify localized tray labels in en/zh/ja/ko.
- [ ] Verify no native logs contain track titles, file paths, keys, or prompts.
- [ ] Decide whether a custom Windows tray popover is needed for screenshot-level visual fidelity.

### Phase 4 Checklist

- [ ] Windows close button and OS close button both hide to tray.
- [ ] Restore works from tray while a track is playing and while paused.
- [ ] Exit works while hidden.
- [ ] App restart after Exit restores persisted queue/repeat state as before.
- [ ] Tray menu remains usable with no current track.
- [ ] Unsupported tray environments fail safely.
- [ ] Tauri parity remains explicitly deferred and does not block Electron release.

---

## 7. Out of Scope

- Mobile tray behavior.
- Tauri desktop tray parity in v1.
- Running MUZERO controls when the app process is not running.
- Auto-start at login or start minimized.
- Global media-key registration; see the separate system global shortcuts PRD.
- Rich custom tray popover matching the screenshot pixel-for-pixel across all platforms.
- Cover art thumbnails inside tray menu.
- Lyrics rendering inside the tray popover.
- Hidden localStorage / URL / environment feature flags.
- Telemetry for tray opens or tray actions.

---

## 8. Security Considerations

- **Authentication / Authorization:** none; local single-user desktop app.
- **Data Protection:** no keys or BYOK endpoints are exposed to tray snapshot/native menu.
- **Local Privacy:** track title/subtitle may appear in the OS tray menu by user action; do not log it.
- **Filesystem:** no local media path or cover path is sent to the tray.
- **Quit Safety:** tray Exit is explicit and should persist existing window/play queue state before process exit where current code already does so.
- **No Hidden Flags:** close-to-tray is product behavior. Any future user preference must be a visible Settings control.
- **Rollback:** operational rollback is `git revert` and rebuild, not runtime kill switches.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260613-muzero-system-global-shortcuts-prd](../20260613-muzero-system-global-shortcuts-prd/) | Separate OS-level keyboard shortcut requirements |
| [20260607-muzero-player-shortcuts-dock-controls-prd](../20260607-muzero-player-shortcuts-dock-controls-prd/) | Existing playback controls, repeat semantics, and shortcut hints |
| [`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts) | Existing native capability abstraction |
| [`src/lib/desktop/tauri.ts`](../../../src/lib/desktop/tauri.ts) | Current Tauri bridge implementation |
| [`src/lib/desktop/electron.ts`](../../../src/lib/desktop/electron.ts) | Current Electron bridge implementation |
| [`src-tauri/src/lib.rs`](../../../src-tauri/src/lib.rs) | Tauri shell entry point |
| [`electron/main.cjs`](../../../electron/main.cjs) | Electron main-process window lifecycle |
| [`src/components/shell/windows-window-controls.tsx`](../../../src/components/shell/windows-window-controls.tsx) | Current custom close/minimize/maximize controls |
| [`src/stores/player-store.ts`](../../../src/stores/player-store.ts) | Playback actions, repeat, display mode, queue state |
| [`src/components/player/favorite-control-button.tsx`](../../../src/components/player/favorite-control-button.tsx) | Existing current-track like behavior |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Which desktop shell is the release target for this feature: Tauri desktop, Electron desktop, or both? | Resolved | V1 is temporarily Electron-first. Tauri parity is deferred and must not block Electron release. |
| 2 | Should single-click tray icon restore the window, or should single-click open the menu and double-click restore on Windows? | Resolved | Left-click restores, right-click opens menu on Windows/Linux; macOS follows status item conventions. |
| 3 | Should closing while a generation/download is in progress show any first-run hint? | Resolved | No modal in v1; rely on tray icon and clear Exit semantics. |
| 4 | Is screenshot-level custom tray popover required for v1? | Resolved | Native menu first; custom popover is a later enhancement only if product insists on rich layout. |
| 5 | Should display mode controls appear only when the active set contains video/cover-capable media? | Resolved | Show current display mode always; disable impossible choices only if user testing shows confusion. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | MUZERO | Initial draft: system tray player controls, close-to-tray lifecycle, tray restore, and explicit Exit semantics. |
| 2026-06-13 | MUZERO | Resolved open questions: Electron-first v1, left-click restore/right-click menu, no progress modal, native menu before custom popover, always show display mode. Strengthened tray/menu i18n as a hard requirement. |
| 2026-06-13 | MUZERO | Completed Phase 1: tray action allowlist/dispatcher, pure menu model, four-locale tray labels, and TDD coverage. |
| 2026-06-13 | MUZERO | Completed Phase 2: Electron tray lifecycle, close-to-tray behavior, restore/quit IPC, DesktopBridge tray/window methods, safe tray failure fallback, and Electron build verification. |
