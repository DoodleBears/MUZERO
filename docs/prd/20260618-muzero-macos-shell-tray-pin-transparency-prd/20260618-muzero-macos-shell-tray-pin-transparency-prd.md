# PRD: MUZERO macOS Desktop Shell Fixes — Tray Icon Size, Always‑On‑Top Button, Lyrics‑Only Transparency

**Status:** Draft
**Created:** 2026-06-18
**Author:** MUZERO
**Module:** Desktop Shell (Electron) — macOS parity for system tray, window controls, and transparent lyrics capture

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | macOS menu‑bar tray icon sizing (template image) | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | macOS top‑right always‑on‑top (pin) button | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | macOS lyrics‑only transparent window backing | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> **Decisions locked (2026-06-18):** all Open Questions resolved per "best practice + align with Windows" — see [§10](#10-open-questions). Summary: (Q1) macOS needs a window created transparent up front, `titleBarStyle: "hiddenInset"` + native traffic lights retained, native shadow/corners repainted in DOM; (Q2) **Option A** — always‑transparent macOS window, symmetric to Windows, no helper window; (Q3) dedicated **monochrome template** tray asset; (Q4) macOS pin button matches the Windows header pin button exactly (`off`/`pin` only; `pin-click-through` Lock stays the separate lyrics‑overlay action); (Q5) extend the existing win32 DOM‑painted rounded‑corner + accent‑border chrome to macOS.

---

## 1. Overview

### 1.1 Background

The desktop shell pivoted to Electron as the primary target (Tauri retained for mobile + fallback). Three macOS‑specific regressions surfaced once the Electron build was exercised on macOS. All three are **platform‑parity gaps**: behavior that was wired correctly for Windows but never given a macOS path (or was given a path that is wrong for macOS conventions).

The reported symptoms:

1. **System tray icon is huge on macOS.** The menu‑bar icon renders many times larger than the macOS menu bar height, overflowing/clipping the bar instead of sitting as a small ~16–18pt glyph.
2. **No always‑on‑top (pin / 置顶) button on macOS.** On Windows the custom window‑control cluster includes a pin button (top‑right). On macOS that cluster is suppressed entirely — which is correct for minimize/maximize/close (those are native traffic lights at top‑left and should NOT be re‑drawn) but it also drops the pin button, so macOS users have no way to keep the window on top. The desired state: **macOS top‑right shows the pin button only** (no custom min/max/close).
3. **Lyrics‑only ("subtitle only") fully‑transparent mode still shows a black background in Electron on macOS.** When the Now‑Playing surface collapses to a lyrics‑only capture (for OBS / overlay use), the DOM goes fully transparent, but on macOS the user sees a near‑black rectangle instead of a see‑through window.

This PRD records the **root cause of each** and proposes the fix. It is a desktop‑shell bug‑fix / parity PRD; mobile (no tray, no desktop window chrome) is out of scope, and Windows is already correct.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **macOS desktop listener** | Runs MUZERO as a background music player on macOS; expects a normal-sized menu‑bar icon and macOS‑native window chrome | Restore from tray, native traffic‑light controls |
| **macOS streamer / overlay user** | Uses the lyrics‑only pinned capture as a transparent OBS source over gameplay/desktop | Pin window on top, transparent lyrics capture |
| **Power user** | Wants the window always‑on‑top while working in other apps | Toggle always‑on‑top from the window chrome |

### 1.3 Core Value

1. **Native‑feeling macOS chrome**: the menu‑bar icon obeys macOS sizing/template conventions; window controls follow macOS conventions (traffic lights left, pin right).
2. **Feature parity**: the always‑on‑top capability already exists end‑to‑end on macOS — this surfaces it so the macOS UI isn't strictly worse than Windows.
3. **Transparent lyrics capture works on every desktop OS**: the lyrics‑only overlay is genuinely see‑through on macOS, not just Windows, so OBS/overlay use is cross‑platform.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                         ┌─────────────────────────────────────────────┐
                         │ Electron main process (electron/*.cjs)        │
                         │                                               │
  tray glyph  ───────────┤  tray.cjs       new Tray(iconPath)            │  ← Issue #1
  (menu bar)             │  main.cjs       createTrayController({iconPath:│
                         │                   appIconPath(DEFAULT)})       │  1120×1120 PNG
                         │                                               │
  window backing ────────┤  main.cjs       new BrowserWindow({           │  ← Issue #3
  (transparent?)         │                   transparent: isWindows,     │  false on mac
                         │                   backgroundColor:#09090b })   │  opaque near‑black
                         │                                               │
  always-on-top ─────────┤  ipc.cjs        muzero:window:setPinMode      │  ← Issue #2 (works,
  (capability)           │  window-pin.cjs win.setAlwaysOnTop(...)        │     not surfaced)
                         └───────────────────────────┬───────────────────┘
                                                      │ contextBridge (preload.cjs, cross-platform)
                         ┌────────────────────────────┴──────────────────┐
                         │ Renderer (React)                                │
                         │  desktop-window-store  pinSupported (✓ mac)     │
                         │                        windowsControlsSupported │  win32-only → gates
                         │  WindowsWindowControls ─ HeaderPinButton  ───────┘  pin off on mac  ← #2
                         │  App.tsx  data-muzero-lyrics-overlay  ───────────── CSS sets DOM
                         │  styles.css  .app-shell{background:transparent}     transparent ← #3
                         └─────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Desktop shell** | Electron main process (`electron/*.cjs`) | Primary desktop target; owns native Tray + BrowserWindow |
| **Native image** | Electron `nativeImage` + `Tray.setImage` / `setTemplateImage` | Correct macOS menu‑bar sizing & dark/light adaptation |
| **Window controls** | `BrowserWindow.setAlwaysOnTop`, `titleBarStyle` | macOS traffic lights + always‑on‑top |
| **Renderer bridge** | `contextBridge` preload → `resolveDesktopBridge()` | All native access via the desktop bridge abstraction (Rule 10) |
| **Transparency** | `BrowserWindow({ transparent, backgroundColor })` + CSS `background: transparent` | Window backing must be transparent for DOM transparency to show through |

### 2.3 Project Structure (files touched)

```
electron/
├── main.cjs            # BrowserWindow opts (transparent/backgroundColor/titleBarStyle); trayController wiring   [#1 #3]
├── tray.cjs            # new Tray(iconPath) — needs resize + setTemplateImage on macOS                            [#1]
└── app-icon.cjs        # appIconPath() returns full-res logo (1120×1120) — wrong size for menu bar                [#1]
src/
├── App.tsx                                   # header chrome; mounts WindowsWindowControls; lyrics-overlay dataset [#2 #3]
├── stores/desktop-window-store.ts            # windowsControlsSupported (win32-only) vs pinSupported (cross-plat)  [#2]
├── components/shell/windows-window-controls.tsx  # win32-gated cluster that owns HeaderPinButton                  [#2]
├── components/shell/header-pin-button.tsx    # platform-agnostic pin button (reusable on macOS)                   [#2]
└── styles.css                                # data-muzero-lyrics-overlay transparency (not win32-gated)          [#3]
```

---

## 3. Root Cause Analysis

> This section replaces the template's "Data Model" — these are shell bugs, not data changes. Each issue has a confirmed root cause with file references.

### 3.1 Issue #1 — Huge system tray icon on macOS

**Symptom:** the macOS menu‑bar (status bar) icon is enormous.

**Root cause (confirmed):**

- [electron/main.cjs:24-30](../../../electron/main.cjs#L24-L30) builds the tray controller with `iconPath: appIconPath(DEFAULT_APP_ICON)`.
- [electron/app-icon.cjs:60-62](../../../electron/app-icon.cjs#L60-L62) `appIconPath()` resolves to the full‑resolution **app/dock logo** PNG. The resolved asset (`public/muzero-logo-dark.png` / `dist/muzero-logo-dark.png`) is **1120×1120**; the legacy fallback (`electron/assets/app-icon-dark.png`) is **512×512**. These are dock/window icon sizes, not menu‑bar sizes.
- [electron/tray.cjs:20-32](../../../electron/tray.cjs#L20-L32) does `new Tray(iconPath)` with that raw path and never resizes.

On macOS, `Tray` does **not** auto‑downsample the image to the menu‑bar height the way it visually fits on Windows/Linux. It renders the image at its logical point dimensions, so a 1120×1120 (or 512×512) PNG paints as a giant glyph that overflows the ~22px menu bar. macOS menu‑bar icons should be ~16–18pt (with an `@2x` variant) and, ideally, a **template image** (monochrome + alpha) so macOS recolors it for light/dark menu bars and selection state.

**Why Windows looks fine:** Windows/Linux tray rendering scales the icon into the tray slot, so the oversized source is not visually catastrophic there (still not ideal, but not "huge").

**Fix direction (decided — Q3 = monochrome template, best practice):** ✅ **Implemented**
- Load the tray image via `nativeImage.createFromPath(...)`, `.resize({ width: 16, height: 16 })`, and on macOS call `image.setTemplateImage(true)` for a monochrome menu‑bar glyph that adapts to dark/light + selection state. Then `new Tray(image)`.
- **Implementation note (refines Q3):** rather than ship a new binary asset, the transform reuses the **existing logo's alpha silhouette** as the template. All `muzero-logo*.png` variants are 1120×1120 **with an alpha channel**, and a macOS template image only uses the alpha channel (the OS recolors the silhouette for the menu bar) — so resizing the existing icon + `setTemplateImage(true)` already yields a correct monochrome menu‑bar glyph with **no new binary asset**. A hand‑tuned 16px asset (+`@2x` for retina crispness) remains an optional future refinement.
- Implemented in [tray.cjs `buildTrayIcon()`](../../../electron/tray.cjs) (injected `nativeImage`, falls back to the raw path when missing/empty) + [main.cjs](../../../electron/main.cjs) (passes `nativeImage`). The dock icon path ([app-icon.cjs](../../../electron/app-icon.cjs)) is unchanged. Tests: [scripts/electron-tray.test.mjs](../../../scripts/electron-tray.test.mjs) (macOS template, Windows non‑template, two fallbacks).
- Keep the dock icon path ([app-icon.cjs](../../../electron/app-icon.cjs) `applyAppIcon` → `app.dock.setIcon`) unchanged; it is correctly sized for the dock. The tray and the dock are separate surfaces with separate size requirements.

### 3.2 Issue #2 — No always‑on‑top (pin) button on macOS

**Symptom:** macOS shows no top‑right pin button; Windows does. Desired: macOS top‑right shows the **pin button only** (min/max/close stay native traffic lights, top‑left).

**Root cause (confirmed):**

- The pin button [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx) is rendered **only** as a child of [WindowsWindowControls](../../../src/components/shell/windows-window-controls.tsx#L48).
- [windows-window-controls.tsx:33](../../../src/components/shell/windows-window-controls.tsx#L33) early‑returns `null` unless `windowsControlsSupported` is true.
- [desktop-window-store.ts:94-95](../../../src/stores/desktop-window-store.ts#L94-L95) computes `windowsControlsSupported = bridge.kind === "electron" && isWindowsRuntime(bridge) && Boolean(controls)`. On macOS `isWindowsRuntime` is false ⇒ the **entire cluster, including the pin button, is suppressed**.
- The window is created with `titleBarStyle: isMac ? "hiddenInset" : undefined` ([main.cjs:213](../../../electron/main.cjs#L213)) and `frame: !isWindows` ([main.cjs:206](../../../electron/main.cjs#L206)), so macOS has native traffic lights at top‑**left**. Re‑drawing min/max/close would be wrong on macOS — but the pin button has no native equivalent and the top‑**right** is empty.

**Key finding — the capability already works on macOS; only the surfacing is missing:**
- The preload exposes `windowControls.setPinMode` / `getState` with `platform: process.platform` for all platforms ([preload.cjs:22,41-65](../../../electron/preload.cjs#L41-L65)).
- The IPC handler `muzero:window:setPinMode` → `windowPin.applyMode(win, mode)` → `win.setAlwaysOnTop(mode !== "off")` is **not** mac‑gated ([ipc.cjs:364-370](../../../electron/ipc.cjs#L364-L370), [window-pin.cjs:113-135](../../../electron/window-pin.cjs#L113-L135)).
- `pinSupported` is computed **independently of platform**: `Boolean(controls?.setPinMode && controls.getState)` ([desktop-window-store.ts:92](../../../src/stores/desktop-window-store.ts#L92)) — already true on macOS.
- `App.tsx` already drives pin mode from settings cross‑platform via `useDesktopWindowPinMode` ([App.tsx:529-536](../../../src/App.tsx#L529-L536)).

So the fix is purely **UI surfacing**: render a standalone pin button on macOS, gated on `pinSupported` (not `windowsControlsSupported`).

**Fix direction:**
- Introduce a macOS pin affordance anchored **top‑right**, reusing [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx) (already platform‑agnostic). Gate it on `kind === "electron" && platform === "darwin" && pinSupported`.
- Do **not** render min/max/close on macOS (those remain native traffic lights). The `WindowsWindowControls` cluster stays Windows‑only; only the pin button gets a macOS mount point.
- Mind the macOS layout: traffic lights are top‑left, so a top‑right pin button does not collide. Ensure it carries `[-webkit-app-region:no-drag]` (already on `HeaderPinButton`) so it stays clickable over the drag region, and reveal/idle behavior matches the macOS title bar (the header already fades with `headerHidden`).
- Consider extracting the platform decision into the store (e.g. a `macControlsSupported` / `standalonePinSupported` selector) so the gate is declared once, not branched in the component (mirrors the existing `windowsControlsSupported` pattern and Rule 10's "no scattered `if (isMac)`").
- **Behavior parity (decided — Q4 = align with Windows):** the macOS pin button reuses the exact same model as the Windows header pin button — it toggles `off` ⇄ `pin` only and persists `desktopWindowPinMode`. The `pin-click-through` (lyrics Lock) state is **not** a third button state on either platform; it stays the separate in‑overlay Lock action ([FloatingUnpinButton](../../../src/components/player/floating-unpin-button.tsx) inside the lyrics overlay), which already works on macOS. Result: identical pin UX across Windows and macOS.

### 3.3 Issue #3 — Lyrics‑only transparent mode shows black on macOS

**Symptom:** in lyrics‑only / "subtitle only" mode the DOM is fully transparent but macOS shows a near‑black rectangle.

**Root cause (confirmed):**

- Lyrics‑only transparency is purely a **DOM/CSS** effect: [App.tsx:425-434](../../../src/App.tsx#L425-L434) sets `document.documentElement.dataset.muzeroLyricsOverlay = "true"`, and [styles.css:291-303](../../../src/styles.css#L291-L303) sets `html`, `body`, `#root`, and `.app-shell` to `background-color: transparent`. These rules are **not** gated to win32 — they apply on macOS too, so the DOM does go transparent on macOS.
- But the macOS **native window backing is opaque**. The window is created with:
  - `transparent: isWindows` → **false on macOS** ([main.cjs:214](../../../electron/main.cjs#L214))
  - `backgroundColor: isWindows ? "#00000000" : "#09090b"` → **opaque near‑black `#09090b` on macOS** ([main.cjs:202](../../../electron/main.cjs#L202))

A transparent DOM over an opaque window backing shows the backing color — `#09090b` — i.e. black. On Windows it works because the window is created `transparent: true` with a fully transparent `#00000000` backing, so the see‑through DOM lets the desktop behind show through.

**Critical Electron constraint:** `BrowserWindow.transparent` **must be set at creation** and **cannot be toggled at runtime**. So we cannot "turn on transparency" only when entering lyrics‑only mode — the window has to be created transparent up front (exactly like the Windows path), then paint an opaque app background via the DOM in all normal (non‑lyrics) states.

**macOS complications to design around (these are why this isn't a one‑line `transparent: true`):**
- `transparent: true` interacts with `titleBarStyle: "hiddenInset"` and the **native traffic lights** — a fully transparent macOS window historically drops its native shadow and rounded corners, and traffic‑light rendering on a transparent surface needs verification.
- macOS transparent windows do not support `vibrancy` simultaneously, and `backgroundColor` with alpha behaves differently than on Windows.
- The Windows shell already paints its own rounded corners + accent border in CSS (`#root::after`, `.app-shell` clip‑path) precisely because it runs transparent+frameless. macOS would need the equivalent **DOM‑painted background** for normal states so the window doesn't look chrome‑less/shadow‑less when NOT in lyrics mode.

**Fix direction (decided — Option A, symmetric to Windows):**

- **Decision (Q2):** create the macOS window **`transparent: true`** with a transparent/no‑opaque `backgroundColor` (`#00000000`), and let the normal (non‑lyrics) app background be painted by the DOM (`.app-shell` `bg-background`) — which it already is. The existing `data-muzero-lyrics-overlay` CSS path then "just works" on macOS exactly as on Windows. **No second helper window** (Option B rejected: `transparent` can't be toggled at runtime, and a second always‑transparent capture window doubles the renderer/state for no benefit).
- **Decision (Q1 — macOS‑specific window setup):** keep `titleBarStyle: "hiddenInset"` so the **native traffic lights stay top‑left** (the user's original ask: macOS doesn't need custom min/max/close, just the pin button). A transparent macOS window **loses the native drop shadow and OS‑provided rounded‑corner mask** — this is the macOS‑specific gotcha behind "fine on Windows, black on macOS." Compensate by painting shadow + rounded corners in the DOM (next decision). Implementation must verify traffic‑light rendering under `transparent: true`; if `hiddenInset` + transparent proves unstable on the target macOS versions, fall back to `frame: false` + the standalone macOS pin control from Issue #2 (no native min/max/close needed anyway).
- **Decision (Q5 — window chrome):** extend the existing **win32 DOM‑painted rounded‑corner + accent‑border treatment** ([styles.css:219-289](../../../src/styles.css#L219-L289)) to macOS by widening those selectors to also match `[data-desktop-platform="darwin"]` (or a shared `[data-desktop-shell="electron"]:not(...win-specific)`), since a transparent macOS window has no native shadow/corners. Painting chrome in the DOM keeps Windows and macOS visually consistent (Q4 spirit) and is the best‑practice way to restore corners/shadow lost to transparency.
- The CSS at [styles.css:291-303](../../../src/styles.css#L291-L303) (the lyrics‑overlay transparency) is already correct and cross‑platform; the substantive change is in **window creation** ([main.cjs:198-225](../../../electron/main.cjs#L198-L225)) plus the chrome selectors above. Maximized/fullscreen must still drop the DOM corners/border (the win32 rules at [styles.css:265-281](../../../src/styles.css#L265-L281) already do this — extend them to macOS too).

---

## 4. Behavior & Acceptance

### 4.1 Expected behavior

| # | Surface | Before (macOS) | After (macOS) |
|---|---------|----------------|---------------|
| 1 | Menu‑bar tray icon | Giant, overflowing the menu bar | ~16–18pt template glyph, adapts to dark/light, crisp on retina |
| 2 | Window top‑right | Empty (pin missing); min/max/close not shown | Pin / always‑on‑top button only; min/max/close remain native traffic lights (top‑left) |
| 3 | Lyrics‑only capture | Near‑black opaque rectangle | Fully see‑through window (desktop/OBS shows through) |

### 4.2 Error / edge handling

- **Tray asset missing/unreadable**: fall back to the existing resolved icon path (don't crash); log via main‑process console (Rule 8 applies to `src/**`, not `electron/**`, but keep it quiet/intentional). Tray creation already wraps `new Tray` in try/catch ([tray.cjs:21-27](../../../electron/tray.cjs#L21-L27)).
- **Pin button on a shell without `setPinMode`**: `pinSupported` is false ⇒ button not rendered (existing guard in [header-pin-button.tsx:37](../../../src/components/shell/header-pin-button.tsx#L37)).
- **Transparent window + maximize/fullscreen**: the macOS DOM background must remain opaque in normal/maximized states (only lyrics‑only is transparent); verify no transparent "hole" appears when maximized or when the OS composites the window shadow.
- **Tauri parity**: this PRD targets the Electron shell. Tauri already controls transparency via `tauri.conf.json`; document any divergence but do not block on Tauri.

### 4.3 Telemetry & logging

- No new telemetry. Local‑first, no backend (Hard Rule 1). Any diagnostics stay in the main‑process dev log.

---

## 5. Frontend / Shell Design

### 5.1 Components & files

- **Tray (main process)** — [electron/tray.cjs](../../../electron/tray.cjs) + [electron/main.cjs](../../../electron/main.cjs): build a resized, template‑flagged `nativeImage` for the tray; add a dedicated small tray asset under `electron/assets/`.
- **macOS pin button (renderer)** — reuse [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx); add a macOS mount in [App.tsx](../../../src/App.tsx#L334) (or a new small `MacWindowControls`/`MacPinButton` wrapper) gated by a new store selector; keep [WindowsWindowControls](../../../src/components/shell/windows-window-controls.tsx) Windows‑only.
- **Window transparency (main process)** — [electron/main.cjs `createWindow`](../../../electron/main.cjs#L198-L225): extend `transparent` / `backgroundColor` (and verify `titleBarStyle`) to cover macOS.

### 5.2 State management

- `desktop-window-store`: add a platform‑aware selector for the standalone macOS pin affordance (e.g. `macPinControlSupported = kind === "electron" && platform === "darwin" && pinSupported`). Pin state (`pinMode`) and persistence (`desktopWindowPinMode` in settings) already exist and are cross‑platform — no new state shape.
- No data‑model / Dexie changes. `AppSettings.desktopWindowPinMode` already persists the pin choice.

---

## 6. Implementation Plan

### Phase 1: macOS menu‑bar tray icon sizing

**Goal:** the macOS tray icon renders as a correctly sized template glyph. ✅ **Completed**

**Tasks:**
- [x] ~~Add a dedicated small tray asset~~ → reuse the existing logo's alpha silhouette as the template (no new binary asset; see §3.1 implementation note). Hand‑tuned 16px asset deferred.
- [x] In [tray.cjs `buildTrayIcon()`](../../../electron/tray.cjs), load via `nativeImage.createFromPath`, `.resize({width:16,height:16})`, and `setTemplateImage(true)` on macOS; pass the resized `nativeImage` to `new Tray(...)` (injected `nativeImage` from [main.cjs](../../../electron/main.cjs)).
- [x] Keep Windows/Linux using a resized (non‑template) icon; dock icon path unaffected.

### Phase 1 Checklist
- [x] macOS tray icon is downscaled to 16pt + template image (adapts to dark/light menu bar). _Retina @2x crispness = optional future refinement._
- [x] Windows/Linux tray icon resized to 16px, not marked template (verified by test).
- [x] Dock icon (`app.dock.setIcon`) path unchanged.
- [x] Graceful fallback to the raw icon path when `nativeImage` is absent or the asset decodes empty (verified by tests).

### Phase 2: macOS top‑right always‑on‑top button

**Goal:** macOS surfaces the pin button (and only the pin button) in the top‑right.

**Tasks:**
- [ ] Add a platform‑aware selector in [desktop-window-store.ts](../../../src/stores/desktop-window-store.ts) for the standalone macOS pin affordance.
- [ ] Mount [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx) on macOS (top‑right, no‑drag), without rendering min/max/close.
- [ ] Confirm `setPinMode` round‑trips on macOS (already wired) and persists via `desktopWindowPinMode`.

### Phase 2 Checklist
- [ ] macOS shows a working pin button top‑right; traffic lights remain native top‑left.
- [ ] Toggling pin sets `setAlwaysOnTop` and survives focus changes (per [window-pin.cjs](../../../electron/window-pin.cjs)).
- [ ] Windows behavior unchanged (cluster still owns its pin button).

### Phase 3: macOS lyrics‑only transparent backing

**Goal:** lyrics‑only mode is genuinely transparent on macOS (decided approach: Option A — always‑transparent window).

**Tasks:**
- [ ] In [main.cjs `createWindow`](../../../electron/main.cjs#L198-L225), create the macOS window `transparent: true` + `backgroundColor: "#00000000"` (extend the current `isWindows` branches to also cover macOS), keeping `titleBarStyle: "hiddenInset"` for native traffic lights.
- [ ] Extend the win32 DOM‑painted chrome (rounded corners + accent border + maximized/fullscreen reset) in [styles.css:219-289](../../../src/styles.css#L219-L289) to also match `[data-desktop-platform="darwin"]`, restoring the shadow/corners lost to transparency.
- [ ] Verify native traffic lights render under transparency; if unstable on target macOS versions, fall back to `frame:false` + the Issue‑#2 standalone pin control.
- [ ] Verify normal/maximized states paint an opaque DOM background (no transparent hole); confirm existing `data-muzero-lyrics-overlay` CSS yields a see‑through capture on macOS with **no change** to [styles.css:291-303](../../../src/styles.css#L291-L303).

### Phase 3 Checklist
- [ ] Lyrics‑only / pinned capture is fully see‑through on macOS (OBS/desktop shows through).
- [ ] Non‑lyrics states look correct (background opaque, DOM‑painted shadow/corners present, traffic lights working).
- [ ] Maximized/fullscreen drops corners + border on macOS (parity with win32).
- [ ] No regression to Windows transparency path.

---

## 7. Out of Scope

- Mobile (iOS/Android): no system tray, no desktop window chrome.
- Tauri shell parity (tracked separately; Electron is the primary desktop target).
- Redesigning the tray menu contents / player controls (covered by [20260613 System Tray Player Controls PRD](../20260613-muzero-system-tray-player-controls-prd/20260613-muzero-system-tray-player-controls-prd.md)).
- Windows window chrome (already correct).
- New always‑on‑top *modes* beyond the existing `off` / `pin` / `pin-click-through`.

---

## 8. Security Considerations

- No new IPC surface for Issues #1/#2 (pin + tray IPC already exist and are sandbox‑safe via `contextBridge`, `contextIsolation:true`, `sandbox:true`).
- Tray icon asset must be a bundled allowlisted file — never a renderer‑supplied path (consistent with [app-icon.cjs](../../../electron/app-icon.cjs)'s fixed allowlist).
- Transparency change touches only `BrowserWindow` creation options; it must **not** require `webSecurity:false` or any CSP relaxation (Hard Rule 10).
- No keys, no telemetry, no backend (Hard Rules 1 & 2).

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260613 System Tray Player Controls PRD](../20260613-muzero-system-tray-player-controls-prd/20260613-muzero-system-tray-player-controls-prd.md) | Tray menu model, close‑to‑tray lifecycle (this PRD fixes the macOS icon **sizing** of that tray) |
| [CLAUDE.md Rule 10](../../../CLAUDE.md) | Desktop shell abstraction (Electron/Tauri/web) — all native access via `resolveDesktopBridge()` |
| [electron/main.cjs](../../../electron/main.cjs) | BrowserWindow creation, tray controller wiring |
| [electron/tray.cjs](../../../electron/tray.cjs) | Tray controller (`new Tray`) |
| [src/stores/desktop-window-store.ts](../../../src/stores/desktop-window-store.ts) | `pinSupported` vs `windowsControlsSupported` gating |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | For Issue #3, does `transparent: true` + `titleBarStyle: "hiddenInset"` keep working native traffic lights + window shadow on macOS, or must we move to `frame:false` + the standalone macOS controls from Issue #2? | ✅ Resolved | macOS needs a window created **transparent up front** (can't toggle at runtime — this is the macOS‑specific setup that Windows didn't need). Keep `hiddenInset` + native traffic lights (top‑left); accept loss of native shadow/corners and repaint them in the DOM (Q5). Verify traffic lights under transparency in impl; fall back to `frame:false` + custom controls only if unstable. |
| 2 | Should the macOS window be **always** transparent (symmetric to Windows, Option A) or should lyrics‑only capture use a dedicated transparent helper window (fallback)? | ✅ Resolved | **Option A** — always‑transparent macOS window, symmetric to Windows. No helper window. |
| 3 | Dedicated tray asset: monochrome **template** image vs full‑color small logo? | ✅ Resolved | **Monochrome template** (`…Template.png` + `@2x`, `setTemplateImage(true)`) — macOS‑native convention; dock icon keeps full color. |
| 4 | Should the macOS pin button also expose `pin-click-through` (lyrics Lock), or only `off`/`pin` like the Windows header button? | ✅ Resolved | **Align with Windows** — `off`/`pin` only; `pin-click-through` stays the separate in‑overlay Lock action on both platforms. |
| 5 | When the macOS window is transparent, does the rounded‑corner / accent‑border treatment (currently win32‑only) need a macOS variant, or rely on the native frame? | ✅ Resolved | Needs a macOS variant — **extend the win32 DOM‑painted chrome** ([styles.css:219-289](../../../src/styles.css#L219-L289)) to `[data-desktop-platform="darwin"]`, because a transparent window has no native shadow/corners. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | MUZERO | Initial draft — root‑cause analysis for macOS tray icon size, missing always‑on‑top button, and lyrics‑only transparency |
| 2026-06-18 | MUZERO | Resolved all 5 Open Questions ("best practice + align with Windows"): Option A always‑transparent macOS window (`hiddenInset` + native traffic lights + DOM‑painted chrome), monochrome template tray icon, macOS pin button matches Windows `off`/`pin`. Folded decisions into §3.1/§3.2/§3.3 and Phase 3 |
| 2026-06-18 | MUZERO | **Phase 1 complete** (TDD): tray icon resized to 16pt + `setTemplateImage(true)` on macOS via injected `nativeImage` in [tray.cjs](../../../electron/tray.cjs); reuses the existing logo's alpha silhouette (no new asset). 4 new tests in [electron-tray.test.mjs](../../../scripts/electron-tray.test.mjs) |

---

> **Note:** This PRD emphasizes modifying existing shell code (window creation, tray controller, pin surfacing) over new structures. All three issues are macOS parity gaps against an already‑correct Windows path; the underlying capabilities (tray, always‑on‑top, lyrics transparency CSS) already exist.
