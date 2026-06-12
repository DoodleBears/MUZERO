# PRD: Pinned Lyrics OBS Overlay

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** Desktop Shell / Now Playing - Electron always-on-top, click-through, and lyrics-only idle overlay

> Product request: Add a cross-platform desktop pin button in the header. On hover/focus near the centered `MUZERO` logo, the pin control appears to the right of the logo and cycles three states: unpinned, pinned always-on-top, and pinned with window click-through where supported. Also extend the `V` visualizer mode cycle with a `ScanText` mode that, when idle, hides foreground UI, background media, visualizer spectrum, flow effects, and memory overlays so only lyrics remain. Primary use case: place MUZERO lyrics over OBS.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Current-State Audit + PRD | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Desktop Pin / Click-Through Bridge | Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Header Logo Pin UI + i18n | Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Lyrics-Only Visualizer Placement | Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | OBS-Oriented QA + Regression Tests | Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has the pieces this feature should compose:

- Electron is the primary desktop shell in `package.json`, while Tauri is still kept runnable behind the desktop bridge.
- Electron frameless Windows controls live in [`src/components/shell/windows-window-controls.tsx`](../../../src/components/shell/windows-window-controls.tsx), but the new pin control should live near the centered header logo so it can be shared across desktop platforms.
- The desktop bridge in [`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts) is the required boundary for native capabilities.
- Electron window IPC is exposed from [`electron/preload.cjs`](../../../electron/preload.cjs) and handled in [`electron/ipc.cjs`](../../../electron/ipc.cjs).
- The visualizer placement cycle is centralized in [`src/visualizer/placement.ts`](../../../src/visualizer/placement.ts) and invoked by both [`src/shortcuts/actions.ts`](../../../src/shortcuts/actions.ts) and [`src/components/player/visualizer-mode-button.tsx`](../../../src/components/player/visualizer-mode-button.tsx).
- The immersive lyrics surface already exists as [`src/components/player/immersive-lyrics-overlay.tsx`](../../../src/components/player/immersive-lyrics-overlay.tsx).
- Background media, visualizer spectrum, and flow effects are composed inside [`src/components/player/now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx).

The current `V` cycle is:

```text
off -> background -> idle-only visualizer -> off
```

The requested OBS use case needs a fourth placement:

```text
off -> background -> idle-only visualizer -> lyrics-only idle -> off
```

In lyrics-only idle mode, the app should become a lyric overlay rather than a full player stage. That means the idle state must hide more than the normal immersive visualizer mode: it must also hide the background image/video, flow layer, spectrum layer, memory popover, header, dock, and Now Playing foreground.

### 1.2 Target Users

| Role | Description | Need |
|------|-------------|------|
| OBS / livestream user | Captures MUZERO lyrics as an overlay in OBS or another compositor. | Always-on-top lyrics that can pass mouse clicks through to the app underneath. |
| Desktop listener | Wants the player visible above other windows while working. | A hover/focus-revealed pin control beside the centered MUZERO logo. |
| Karaoke / lyrics-first user | Uses MUZERO as a dedicated lyric screen. | A fast `V` mode that leaves only readable lyrics after idle. |
| QA / developer | Verifies shell behavior without scattering Electron calls. | A bridge-level state machine and deterministic tests. |

### 1.3 Core Value

1. **OBS-ready overlay:** MUZERO can act as a transparent, always-on-top lyric layer without background visuals.
2. **Safe click-through:** Users can pass mouse input through the window without being trapped in an unclickable app.
3. **One visualizer mode model:** The `V` shortcut, Now Playing mode button, and settings labels all describe the same placement cycle.
4. **Shell boundary discipline:** Electron behavior is exposed through the existing desktop bridge; app code does not import Electron directly.

---

## 2. System Architecture

### 2.1 Architecture Overview

```text
Header logo hover/focus pin button
        |
        v
DesktopBridge.windowControls.setPinMode / cyclePinMode
        |
        v
Electron preload IPC
        |
        v
electron/ipc.cjs
        |
        v
BrowserWindow
  - setAlwaysOnTop(...)
  - setIgnoreMouseEvents(...)
        |
        v
window state event
        |
        v
renderer updates icon / tooltip / dataset
```

```text
V shortcut / VisualizerModeButton
        |
        v
nextVisualizerPlacementPatch(settings)
        |
        v
AppSettings
  - visualizerAsBackground
  - visualizerIdleOnly
  - visualizerLyricsOnlyIdle
        |
        v
App idle orchestration
        |
        +--> normal mode: full Now Playing stage
        +--> idle visualizer: hide foreground, keep background + flow + spectrum
        +--> lyrics-only idle: hide foreground + background + flow + spectrum + memories, keep lyrics
```

### 2.2 Current Implementation References

| Area | File | Notes |
|------|------|-------|
| App-level idle/chrome orchestration | [`src/App.tsx`](../../../src/App.tsx) | Computes `idle`, `chromeHidden`, `foregroundHidden`, `dockHidden`, `immersiveMemoryActive`, `immersiveLyricsActive`. |
| Header chrome UI | [`src/App.tsx`](../../../src/App.tsx), optionally a small shell component | Header currently centers the MUZERO logo and hides during idle. Pin should appear to the right of the logo on hover/focus. |
| Window controls UI | [`src/components/shell/windows-window-controls.tsx`](../../../src/components/shell/windows-window-controls.tsx) | Current Electron Windows cluster renders minimize / maximize / close only and should remain focused on OS window controls. |
| Electron bridge types | [`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts) | Extend `DesktopWindowState` and `DesktopWindowControls`; no direct Electron imports in `src/**`. |
| Electron bridge implementation | [`src/lib/desktop/electron.ts`](../../../src/lib/desktop/electron.ts) | Wrap new preload functions. |
| Electron IPC | [`electron/preload.cjs`](../../../electron/preload.cjs), [`electron/ipc.cjs`](../../../electron/ipc.cjs) | Add pin mode channels and include state in `muzero:window:state`. |
| Visualizer placement | [`src/visualizer/placement.ts`](../../../src/visualizer/placement.ts) | Extend placement union and cycle order. |
| Visualizer button | [`src/components/player/visualizer-mode-button.tsx`](../../../src/components/player/visualizer-mode-button.tsx) | Add `ScanText` icon and label. |
| Lyrics overlay | [`src/components/player/immersive-lyrics-overlay.tsx`](../../../src/components/player/immersive-lyrics-overlay.tsx) | Reuse for lyrics-only mode; add overlay-safe behavior if needed. |
| Background / flow / spectrum | [`src/components/player/now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) | Must be hidden in lyrics-only idle mode. |

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Desktop shell | Electron `BrowserWindow` APIs first; Tauri desktop bridge can add parity later | Always-on-top and click-through are native window capabilities. Product expectation is cross-platform desktop UI, with capability-based behavior per shell. |
| Bridge | Existing `DesktopBridge` | Keeps Electron/Tauri/web branching out of UI code. |
| UI | React + existing button / tooltip primitives | Matches current window-control implementation. |
| Icons | `lucide-react` (`Pin`, `PinOff`, `MousePointerClick` or equivalent, `ScanText`) | Existing icon system; no custom SVG. |
| Persistence | Dexie `AppSettings` optional fields | Local-first settings, no backend. |
| Idle visual state | Existing `useIdle` + `useDockIdle` orchestration | Lyrics-only is an additional placement, not a new visualizer renderer. |

---

## 3. Product Requirements

### 3.1 Window Pin State Machine

The header pin button has three effective states. The UI is desktop cross-platform; each shell reports whether it can apply always-on-top and click-through.

| State | Native behavior | Pointer behavior | Icon intent | Persistence |
|-------|-----------------|------------------|-------------|-------------|
| `off` | `alwaysOnTop = false` | normal | unpinned | persistent default |
| `pin` | `alwaysOnTop = true` | normal | pinned | persistent |
| `pin-click-through` | `alwaysOnTop = true` | clicks pass through to windows behind MUZERO | pinned + passthrough | session-only substate |

Required behavior:

- The button is anchored to the centered header logo group: when the user hovers or focuses the `MUZERO` logo area, the pin button appears immediately to the logo's right.
- The pin button is not part of the Windows minimize / maximize / close cluster; those controls stay in their current OS-control area.
- The control should work anywhere the desktop bridge exposes pin support. Electron should implement it first across Windows / macOS / Linux where the native APIs behave; Tauri desktop can add parity through the same bridge contract later.
- Clicking the button cycles `off -> pin -> pin-click-through -> off`.
- Entering `pin-click-through` must not leave the user trapped:
  - When the MUZERO window receives focus through Alt-Tab, taskbar activation, or equivalent OS focus, Electron must downgrade `pin-click-through` to `pin`.
  - While `setIgnoreMouseEvents(..., { forward: true })` still forwards hover/move events, hovering the header/logo region should exit idle and reveal the pin control so the user can see the current state.
  - Tooltips for the click-through state must mention focus/hover recovery in localized text.
- `pin-click-through` should not be restored after app restart or renderer reload. A cold start may restore `pin`, but not click-through.
- Unsupported shells hide the pin button rather than showing a broken control. Shells that support always-on-top but not click-through may expose only `off <-> pin` and report click-through as unavailable.

Implementation notes:

- Prefer a single helper in Electron main, for example `applyWindowPinMode(win, mode)`, so all IPC, focus recovery, and state events use identical behavior.
- Use `win.setAlwaysOnTop(mode !== "off")` for Electron.
- Use `win.setIgnoreMouseEvents(mode === "pin-click-through", { forward: true })` where supported. Recovery must not depend solely on forwarded mouse events.
- Include pin state in the existing `muzero:window:state` event payload.

### 3.2 Lyrics-Only Visualizer Placement

Add one visualizer placement:

```ts
type VisualizerPlacement = "off" | "background" | "idle" | "lyrics";
```

This is a placement mode, not a visualizer style:

- Do not add `lyrics` / `scanText` to `VisualizerStyleId`.
- Do not register a renderer in [`src/visualizer/registry.ts`](../../../src/visualizer/registry.ts).
- Preserve the user's selected visualizer style so switching back to background / idle uses the same style.

Cycle order:

```text
off -> background -> idle -> lyrics -> off
```

State mapping:

| Placement | `visualizerAsBackground` | `visualizerIdleOnly` | `visualizerLyricsOnlyIdle` |
|-----------|---------------------------|----------------------|-----------------------------|
| `off` | `false` | `false` | `false` |
| `background` | `true` | `false` | `false` |
| `idle` | `true` | `true` | `false` |
| `lyrics` | `true` | `true` | `true` |

Required behavior in `lyrics` placement:

- Before idle: the app behaves like the normal Now Playing screen so users can interact and tune settings.
- After idle on the Now Playing tab:
  - Header and PlayerDock are hidden.
  - Now Playing foreground panel is hidden.
  - `NowPlayingBackground` visual content is hidden, including background image/video, blur/pixel renderers, flow layer, spectrum visualizer, and dim masks.
  - `ImmersiveMemoryOverlay` is suppressed.
  - `ImmersiveLyricsOverlay` remains mounted and centered.
  - The overlay should render even when `nowPlayingRightRailCollapsed` is true; entering lyrics-only mode must not mutate that setting.
  - The Electron transparent shell should be able to show only lyric pixels, with the app/root background transparent while lyrics-only idle is active.
- Leaving idle through pointer movement, keyboard input, or tab change restores the normal app surface.

No-lyrics behavior:

- If the current track has no displayable lyrics, render nothing in the OBS overlay.
- Do not show interactive search panels, footer controls, fallback copy, or large empty-state UI in lyrics-only idle mode.

### 3.3 UI Copy and Icons

Add i18n keys in all four catalogs: `en`, `zh`, `ja`, `ko`.

Window controls:

- `windowControls.pinOff`
- `windowControls.pinOn`
- `windowControls.pinClickThrough`
- `windowControls.pinClickThroughHint`
- `windowControls.pinAlwaysOnTopUnavailable` if a desktop shell exposes the button but only click-through / always-on-top is unavailable

Visualizer:

- `visualizer.modeLyricsOnly`
- `visualizer.help.lyricsOnly` if Settings / tooltip help needs a description

Icon expectations:

- Header logo pin:
  - `off`: `PinOff` or equivalent
  - `pin`: `Pin`
  - `pin-click-through`: `MousePointerClick` or equivalent combined with pin styling
- Visualizer button:
  - `lyrics`: `ScanText`
  - Existing mapping remains `off = EyeOff`, `background = Eye`, `idle = ScanEye`.

All visible user text must go through `useTranslation()`; no raw English strings in components.

---

## 4. Data Model Design

### 4.1 Core Concepts

```text
DesktopWindowPinMode
  ├─ off
  ├─ pin
  └─ pin-click-through

VisualizerPlacement
  ├─ off
  ├─ background
  ├─ idle
  └─ lyrics
```

### 4.2 Settings Schema

Add optional settings only; no Dexie version bump is required if existing `getSettings()` merge behavior supplies defaults.

```ts
export type PersistedDesktopWindowPinMode = "off" | "pin";

export interface AppSettings {
  /**
   * Persistent desktop always-on-top preference. Click-through is deliberately
   * session-only and restores as "pin" on reload/cold start.
   */
  desktopWindowPinMode?: PersistedDesktopWindowPinMode;

  /**
   * Fourth visualizer placement: when true with visualizerIdleOnly, idle hides
   * all visuals and leaves only lyrics.
   */
  visualizerLyricsOnlyIdle?: boolean;
}
```

Recommended defaults:

```ts
desktopWindowPinMode: "off";
visualizerLyricsOnlyIdle: false;
```

### 4.3 Bridge Types

Extend the desktop bridge types:

```ts
export type DesktopWindowPinMode = "off" | "pin" | "pin-click-through";

export interface DesktopWindowState {
  fullscreen: boolean;
  maximized: boolean;
  pinMode?: DesktopWindowPinMode;
}

export interface DesktopWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<DesktopWindowState>;
  close: () => Promise<void>;
  getState: () => Promise<DesktopWindowState>;
  setPinMode?: (mode: DesktopWindowPinMode) => Promise<DesktopWindowState>;
  cyclePinMode?: () => Promise<DesktopWindowState>;
  onStateChange?: (callback: (state: DesktopWindowState) => void) => () => void;
}
```

Required constraints:

- Tauri and web bridges may omit `setPinMode` / `cyclePinMode`; Tauri desktop should implement the same names when native support is added.
- Renderer code must use optional chaining and hide unsupported UI.
- `pin-click-through` must be represented in `DesktopWindowState` even if it is not persisted in `AppSettings`.

### 4.4 Rollback Plan

- Rollback is `git revert`; do not add hidden localStorage / URL / `window.*` flags.
- Older builds ignore optional `visualizerLyricsOnlyIdle` and `desktopWindowPinMode`.
- If a user has `visualizerLyricsOnlyIdle: true` and opens an older build, the app falls back to the prior `visualizerIdleOnly` behavior because that flag remains true.

---

## 5. API Design

No network API changes. This feature is local-first UI, IndexedDB settings, and Electron IPC.

### 5.1 Desktop Shell IPC / Commands

Electron should add narrow IPC channels first. Other desktop shells should map the same bridge contract to their native command surface when supported.

| Channel | Direction | Description |
|---------|-----------|-------------|
| `muzero:window:setPinMode` | renderer -> main | Applies `off` / `pin` / `pin-click-through` to the sender window. |
| `muzero:window:cyclePinMode` | renderer -> main | Advances the sender window through the three effective states. |
| `muzero:window:getState` | renderer -> main | Existing channel; include `pinMode`. |
| `muzero:window:state` | main -> renderer | Existing event; include `pinMode`. |

Preload surface:

```js
windowControls: {
  minimize: () => ipcRenderer.invoke("muzero:window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("muzero:window:toggleMaximize"),
  setPinMode: (mode) => ipcRenderer.invoke("muzero:window:setPinMode", mode),
  cyclePinMode: () => ipcRenderer.invoke("muzero:window:cyclePinMode"),
  close: () => ipcRenderer.invoke("muzero:window:close"),
  getState: () => ipcRenderer.invoke("muzero:window:getState"),
  onStateChange: ...
}
```

### 5.2 Error Handling

- Invalid pin mode input should be rejected or normalized to `off` in Electron main. Do not trust renderer input.
- If `setIgnoreMouseEvents` throws on a platform, keep `pin` enabled and report `pinMode: "pin"` in state.
- Renderer errors should use [`src/lib/logger.ts`](../../../src/lib/logger.ts), not `console.*` in `src/**`.
- Electron main may continue using its current main-process logging pattern.

---

## 6. Frontend Design

### 6.1 Header Logo Pin Control

Modify the header chrome in [`src/App.tsx`](../../../src/App.tsx) and extract a small shell component if it keeps the header readable:

- Wrap the centered `MUZERO` logo and the pin button in a logo control group.
- Reveal the pin button immediately to the logo's right on hover, focus-within, or when `pinMode !== "off"`.
- Keep the pin button `data-no-drag` and `[-webkit-app-region:no-drag]`.
- Keep the surrounding header empty space draggable.
- Ensure the button remains reachable by keyboard focus even when visually collapsed.
- Do not increase or alter the Windows minimize / maximize / close cluster for this feature.
- Subscribe to `controls.onStateChange` and set local `pinMode` alongside `maximized`.
- Use `aria-label` from i18n and `aria-pressed={pinMode !== "off"}`.

Recommended state styling:

- `off`: same muted treatment as inactive window controls.
- `pin`: active foreground / subtle active background.
- `pin-click-through`: active foreground plus warning/accent ring or pointer icon. Do not rely on color alone.
- The reveal motion should be subtle and layout-stable: reserve enough inline space or use absolute positioning so the centered logo does not jump when the button appears.

### 6.2 Lyrics-Only Idle Surface

Modify [`src/App.tsx`](../../../src/App.tsx) orchestration:

```ts
const placement = resolveVisualizerPlacement(settings);
const lyricsOnlyIdle = idle && placement === "lyrics" && isNowTab;

const visualizerIdleOnly =
  idle && visualizerBackgroundActive && placement === "idle";

const foregroundHidden =
  visualizerPreviewOnly || visualizerIdleOnly || lyricsOnlyIdle;

const immersiveLyricsActive =
  (foregroundHidden && lyricsVisible) || lyricsOnlyIdle;

const immersiveMemoryActive =
  visualizerIdleOnly && !lyricsOnlyIdle && (settings.immersiveMemoryOverlay ?? true);
```

The exact implementation can differ, but acceptance requires the same visible behavior.

For transparency:

- Add a dataset such as `html[data-muzero-lyrics-overlay="true"]` while lyrics-only idle is active.
- CSS under that dataset should make `html`, `body`, `#root`, and `.app-shell` transparent where possible.
- Ensure `.app-shell` border / rounded Electron frame does not leave a visible rectangle in lyrics-only idle. The Electron window border may be hidden or set transparent while the dataset is active.

### 6.3 Visualizer Button and Shortcut

Modify [`src/visualizer/placement.ts`](../../../src/visualizer/placement.ts):

- Extend `VisualizerPlacement` to include `"lyrics"`.
- Extend `PLACEMENTS` order to `["off", "background", "idle", "lyrics"]`.
- Ensure `nextVisualizerPlacementPatch()` clears `visualizerLyricsOnlyIdle` when cycling to `off`, `background`, or `idle`.
- Ensure cycling to `lyrics` sets `visualizerAsBackground: true`, `visualizerIdleOnly: true`, and `visualizerLyricsOnlyIdle: true`.

Modify [`src/components/player/visualizer-mode-button.tsx`](../../../src/components/player/visualizer-mode-button.tsx):

- Add `ScanText` icon for `"lyrics"`.
- Add label mapping to `visualizer.modeLyricsOnly`.
- Keep long-press / right-click behavior opening the tuning panel.

Modify [`src/shortcuts/actions.ts`](../../../src/shortcuts/actions.ts):

- No new shortcut action id is needed. Existing `visualizer.cycleMode` continues to call `nextVisualizerPlacementPatch()`.
- Shortcut cheat sheet copy remains "Cycle visualizer mode" but the mode list/help should include lyrics-only where surfaced.

---

## 7. Implementation Plan

### Phase 1: Current-State Audit + PRD

**Goal:** Document the requested behavior against the current Electron, visualizer, background, and lyrics architecture.

**Tasks:**

- [x] Read PRD workflow and existing PRD conventions.
- [x] Audit header/window-control implementation.
- [x] Audit visualizer placement and `V` shortcut path.
- [x] Audit idle background / lyrics overlay composition.
- [x] Create this PRD.

### Phase 1 Checklist

- [x] PRD created under `docs/prd/20260613-muzero-pinned-lyrics-obs-overlay-prd/`.
- [x] Current code references are linked.
- [x] Click-through recovery path is specified.
- [x] Lyrics-only mode is defined as placement, not a visualizer style.

### Phase 2: Desktop Pin / Click-Through Bridge

**Goal:** Add native window pin state through the existing desktop bridge, with Electron implemented first and room for Tauri desktop parity.

**Tasks:**

- [ ] Extend `DesktopWindowState` / `DesktopWindowControls` types.
- [ ] Add Electron preload methods for `setPinMode` and `cyclePinMode`.
- [ ] Add Electron IPC handlers in `electron/ipc.cjs`.
- [ ] Include `pinMode` in `windowState(win)` and `muzero:window:state`.
- [ ] Add focus recovery from `pin-click-through` to `pin`.
- [ ] Apply persisted `desktopWindowPinMode` on startup or renderer settings load without restoring click-through.
- [ ] Keep the bridge capability-based so Tauri desktop can add always-on-top parity without changing React components.

### Phase 2 Checklist

- [ ] `off` calls `setAlwaysOnTop(false)` and disables ignore-mouse-events.
- [ ] `pin` calls `setAlwaysOnTop(true)` and disables ignore-mouse-events.
- [ ] `pin-click-through` calls `setAlwaysOnTop(true)` and enables ignore-mouse-events.
- [ ] Alt-Tab/taskbar focus downgrades click-through to normal pin.
- [ ] Header/logo hover exits idle and reveals the pin control while click-through mouse-move forwarding is active.
- [ ] Invalid IPC input cannot crash main process.
- [ ] Web bridge stays unsupported; Tauri desktop is allowed to expose partial support when native capability is available.

### Phase 3: Header Logo Pin UI + i18n

**Goal:** Surface the pin control beside the centered logo on hover/focus so the placement is consistent across desktop platforms.

**Tasks:**

- [ ] Add a header logo pin button in or near `App.tsx` shell chrome.
- [ ] Reveal the button on logo/header hover, focus-within, or any active pin state.
- [ ] Preserve the centered logo position without layout jump.
- [ ] Add localized labels / hints in `en`, `zh`, `ja`, `ko`.
- [ ] Add icon mapping and accessible pressed state.
- [ ] Add tests for supported vs unsupported shell rendering if practical.

### Phase 3 Checklist

- [ ] Pin button appears to the right of the centered MUZERO logo on hover/focus.
- [ ] Pin button remains visible while pinned.
- [ ] Button state updates when main-process state events arrive.
- [ ] Tooltip label matches the current state.
- [ ] Click-through state includes recovery hint.
- [ ] No user-visible string is hardcoded in the component.

### Phase 4: Lyrics-Only Visualizer Placement

**Goal:** Extend the `V` cycle with an OBS-friendly lyrics-only idle mode.

**Tasks:**

- [ ] Add `visualizerLyricsOnlyIdle?: boolean` to `AppSettings` and defaults.
- [ ] Extend `VisualizerPlacement` and `nextVisualizerPlacementPatch()`.
- [ ] Update `VisualizerModeButton` with `ScanText` and i18n labels.
- [ ] Update `App.tsx` idle orchestration to compute `lyricsOnlyIdle`.
- [ ] Hide `NowPlayingBackground`, foreground, dock, header, flow, spectrum, and memory overlay during lyrics-only idle.
- [ ] Ensure `ImmersiveLyricsOverlay` is active independent of `nowPlayingRightRailCollapsed`.
- [ ] Add transparent overlay CSS under a stable dataset.
- [ ] Suppress interactive lyrics search/footer UI in OBS overlay if it would otherwise appear.

### Phase 4 Checklist

- [ ] `V` cycles `off -> background -> idle -> lyrics -> off`.
- [ ] The Now Playing visualizer mode button shows `ScanText` in lyrics mode.
- [ ] Lyrics-only idle shows lyrics and no background/flow/spectrum.
- [ ] Moving pointer or pressing a key exits idle and restores normal UI.
- [ ] Lyrics-only placement does not mutate the user's lyrics rail visibility setting.
- [ ] No visualizer registry entry is added for lyrics-only mode.

### Phase 5: OBS-Oriented QA + Regression Tests

**Goal:** Verify desktop shell safety and the OBS capture use case.

**Tasks:**

- [ ] Add unit tests for visualizer placement resolution / cycling.
- [ ] Add Electron IPC tests with a fake BrowserWindow for pin mode transitions.
- [ ] Add component tests for `VisualizerModeButton` labels/icons where feasible.
- [ ] Manually test Electron Windows / macOS / Linux where available: unpinned, pinned, pinned click-through or supported subset, focus recovery.
- [ ] Manually test OBS / transparent capture path on Windows first, then macOS/Linux where compositor support allows.
- [ ] Run `pnpm test -- --run` or targeted Vitest suites.
- [ ] Run `pnpm build` if shell/type changes touch exported types broadly.

### Phase 5 Checklist

- [ ] Click-through passes mouse clicks to an app behind MUZERO.
- [ ] User can recover from click-through without killing the process.
- [ ] OBS capture shows only lyrics after idle, with transparent/empty background where supported.
- [ ] Existing idle visualizer mode still shows background + flow + spectrum.
- [ ] Existing off/background modes are unchanged.
- [ ] No `src/**` direct `console.*` usage is added.

---

## 8. Acceptance Criteria

### Window Pin

- On supported desktop shells, a pin button appears to the right of the centered MUZERO logo on header/logo hover or keyboard focus.
- The pin button remains visible while pinned or pinned click-through is active.
- The pin button cycles through `off`, `pin`, and `pin-click-through`.
- `pin` keeps MUZERO above normal app windows.
- `pin-click-through` keeps MUZERO above normal app windows and allows clicking through to windows underneath.
- When MUZERO is focused again from `pin-click-through`, it downgrades to `pin`.
- Hovering the header/logo region exits idle and reveals the pin control, so users can see and change the current state without a dedicated shortcut.
- `pin-click-through` is not restored after app restart.
- Unsupported or partially supported shells do not show a broken control; they hide unavailable states or omit the button.

### Lyrics-Only OBS Mode

- The `V` shortcut and visualizer button share the same four-state cycle.
- `ScanText` represents the lyrics-only mode.
- In lyrics-only idle mode, only lyrics remain visible; background image/video, flow, spectrum, foreground panels, memory overlay, header, and dock are hidden.
- The overlay uses existing lyrics style settings: size, alignment, shadow, stroke, translation, romanization, and word-by-word fill.
- The mode works even when the normal Now Playing lyrics rail is collapsed.
- Leaving idle restores the normal app without changing persistent lyrics rail state.

### Local-First / Safety

- No backend, telemetry, account, or cloud dependency is introduced.
- No hidden runtime flag is introduced.
- All persistence stays in IndexedDB settings or the desktop shell's existing local window-state path.
- All user-visible text is localized in all four catalogs.

---

## 9. Out of Scope

- OBS plugin integration or OBS WebSocket control.
- Capturing / streaming directly from MUZERO.
- New lyrics providers or lyrics parsing formats.
- Adding `ScanText` as a visualizer renderer style.
- Mobile parity for always-on-top or click-through.
- Tauri desktop implementation if the current release target remains Electron-first; the bridge contract must leave room for it.
- Guaranteed always-on-top over exclusive fullscreen games or protected OS surfaces; OS behavior may vary.
- A new global hotkey system for click-through recovery. Hover/focus recovery is enough for v1.

---

## 10. Security and Privacy Considerations

- No secrets are involved.
- No media bytes or lyrics are sent anywhere.
- Desktop shell commands / Electron IPC must validate pin mode strings because renderer input is not trusted.
- Click-through is powerful and can make the app hard to interact with; recovery behavior is a safety requirement, not polish.
- Do not add hidden localStorage / URL / `window.*` toggles for rollout or rollback.
- Do not log lyrics text, media paths, or user content while debugging overlay state.

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [Player Shell Redesign PRD](../20260607-muzero-player-shell-redesign-prd/20260607-muzero-player-shell-redesign-prd.md) | Header/dock shell context. |
| [Music Reactive Visualizer PRD](../20260607-muzero-music-reactive-visualizer-prd/20260607-muzero-music-reactive-visualizer-prd.md) | Original visualizer registry and background placement context. |
| [Immersive Flow Background PRD](../20260611-muzero-immersive-flow-background-prd/20260611-muzero-immersive-flow-background-prd.md) | Flow/background layering context. |
| [AMLL-Style Lyrics Engine PRD](../20260613-muzero-amll-style-lyrics-engine-prd/20260613-muzero-amll-style-lyrics-engine-prd.md) | Lyrics rendering and motion context. |
| [System Global Shortcuts PRD](../20260613-muzero-system-global-shortcuts-prd/20260613-muzero-system-global-shortcuts-prd.md) | Electron desktop bridge and OS-level safety precedent. |

---

## 12. Resolved Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should the pin button also be visible on macOS/Linux Electron, where native titlebar controls may not match the Windows cluster? | Resolved | Yes. Pin is a cross-platform desktop window feature. Put the button beside the centered header logo on hover/focus instead of inside the Windows control cluster. |
| 2 | Should `pin-click-through` persist exactly across app restart? | Resolved | No. Restore as normal `pin` at most; never cold-start into click-through. |
| 3 | Should no-lyrics OBS mode show a fallback message or nothing? | Resolved | Render nothing. No fallback text, search panel, or footer in lyrics-only idle mode. |
| 4 | Should click-through recovery get an OS-level shortcut? | Resolved | Not for v1. Hovering the header/logo region exits idle and reveals the pin control; focus recovery remains a native safety net. |

---

## 13. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial PRD for Electron pin/click-through and lyrics-only OBS overlay mode. |
| 2026-06-13 | Codex | Resolved open questions: cross-platform logo-adjacent pin control, no click-through persistence, no-lyrics renders nothing, no dedicated recovery shortcut. |
