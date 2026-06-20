# PRD: MUZERO macOS Desktop Shell Fixes — Tray Icon Size, Always‑On‑Top Button, Lyrics‑Only Transparency

**Status:** Review (all 3 phases implemented + TDD; pending real‑Mac verification)
**Created:** 2026-06-18
**Author:** MUZERO
**Module:** Desktop Shell (Electron) — macOS parity for system tray, window controls, and transparent lyrics capture

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | macOS menu‑bar tray icon sizing (template image) | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | macOS top‑right always‑on‑top (pin) button | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | macOS lyrics‑only transparent window backing | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> **Decisions locked (2026-06-18):** all Open Questions resolved per "best practice + align with Windows" — see [§10](#10-open-questions). Summary: (Q1) macOS needs a window created transparent up front, `titleBarStyle: "hiddenInset"` + native traffic lights retained, native shadow/corners repainted in DOM; (Q2) **Option A** — always‑transparent macOS window, symmetric to Windows, no helper window; (Q3) ~~monochrome template tray asset~~ → **revised 2026-06-19 per user feedback**: keep the **colored logo** in the menu bar (resized only, **no** template image — a template stripped the brand mark to a flat silhouette); (Q4) macOS pin button matches the Windows header pin button exactly (`off`/`pin` only; `pin-click-through` Lock stays the separate lyrics‑overlay action); (Q5) extend the existing win32 DOM‑painted rounded‑corner + accent‑border chrome to macOS.

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

**Fix direction:** ✅ **Implemented** (Q3 revised 2026-06-19 per user feedback)
- Load the tray image via `nativeImage.createFromPath(...)`, `.resize({ width: 16, height: 16 })`, then `new Tray(image)` — fixes the "huge icon" by downscaling the 1120×1120 logo to menu‑bar size.
- **Q3 revision — colored logo, NOT a template image.** The first implementation marked it `setTemplateImage(true)` (the macOS‑native convention). On the real menu bar that rendered the logo as a flat monochrome **silhouette** — the user reported "图案不对" (wrong pattern / not the logo). A macOS template image only uses the alpha channel and recolors it black/white, discarding the logo's color + interior detail. **Decision: drop `setTemplateImage` and keep the resized colored logo**, so the actual brand mark shows. Tradeoff: a colored icon does **not** auto‑recolor for light/dark menu bars; the logo's alpha + contrast carries it on both. (If a future variant reads poorly on one menu‑bar theme, the alternatives are a per‑theme asset swap or re‑introducing the template as an opt‑in.)
- Implemented in [tray.cjs `buildTrayIcon()`](../../../electron/tray.cjs) (injected `nativeImage`, falls back to the raw path when missing/empty) + [main.cjs](../../../electron/main.cjs) (passes `nativeImage`). The dock icon path ([app-icon.cjs](../../../electron/app-icon.cjs)) is unchanged. Tests: [scripts/electron-tray.test.mjs](../../../scripts/electron-tray.test.mjs) (macOS + Windows both resize, no template; two fallbacks).
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

**Fix direction:** ✅ **Implemented**
- New [MacWindowControls](../../../src/components/shell/mac-window-controls.tsx): a top‑right body‑portal that renders **only** [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx) (no min/max/close — those stay native traffic lights top‑left). Mirrors the Windows cluster's portal + hover‑reveal so pin UX matches across platforms.
- Gate via a new store selector [`macControlsSupported`](../../../src/stores/desktop-window-store.ts) = `kind === "electron" && isMacRuntime(bridge) && pinSupported` (declared once in the store, mirroring `windowsControlsSupported` — Rule 10's "no scattered `if (isMac)`"). Added `isMacRuntime(bridge)` alongside `isWindowsRuntime`.
- Mounted in [App.tsx](../../../src/App.tsx) next to `WindowsWindowControls`; carries `[-webkit-app-region:no-drag]` so it stays clickable over the drag region; traffic lights (top‑left) don't collide with the top‑right pin.
- Pin state/persistence (`pinMode`, `desktopWindowPinMode`) and the IPC path were already cross‑platform — no main‑process change needed.
- Tests: [mac-window-controls.test.tsx](../../../src/components/shell/mac-window-controls.test.tsx) (renders pin on mac+electron; only the pin control; hidden on Windows; hidden on web).
- **Unfocused-window trail (fixed 2026-06-19 per feedback):** once shadows/filters were stripped, QA found the residue is **focus-dependent** — clean while the window is focused, trails the moment it's unfocused (the normal state for an OBS/desktop overlay). macOS throttles/stops compositing an unfocused transparent window, so the moving lyrics stop getting cleared. Fix: (1) `backgroundThrottling: false` on the window ([main.cjs](../../../electron/main.cjs)) so the renderer keeps running at full rate while visible-but-unfocused, and (2) [`useContinuousTransparentRepaint`](../../../src/hooks/use-transparent-window-repaint.ts) drives `webContents.invalidate()` **every animation frame** while the lyrics capture is *playing* ([App.tsx](../../../src/App.tsx), gated `lyricsOnlyIdle && isPlaying`), forcing the surface to clear each frame regardless of focus. Idles when paused/hidden. Tests: [use-transparent-window-repaint.test.tsx](../../../src/hooks/use-transparent-window-repaint.test.tsx).
- **Motion-trail ghost (fixed 2026-06-19 per feedback):** even in idle (unpinned) lyrics-only mode, scrolling/cascading lyrics left overlapping stale-frame trails (two lyric lines smeared over each other). Root cause: a **fully transparent** macOS window backing (`#00000000`) makes the Chromium compositor skip clearing the surface, so moving content leaves trails — and one-shot repaints / shadow strips can't fix *continuous* motion. Fix: give the macOS window a **1/255-alpha backing** (`#01010101`, format-agnostic) in [window-chrome.cjs](../../../electron/window-chrome.cjs) — Chromium then clears the surface every frame. Visually invisible (~0.4% black) and only ever shown in the lyrics-only transparent state (the opaque DOM background covers it otherwise). Windows keeps pure `#00000000` (it clears fine). Test updated: [electron-window-chrome.test.mjs](../../../scripts/electron-window-chrome.test.mjs).
- **Shadow-residue ghost (fixed 2026-06-19 per feedback):** a *shadow-shaped* residue smeared from the lyrics and control bar. **QA pinpointed the mechanism:** on a transparent window the `text-shadow` / `drop-shadow` / `box-shadow` / `backdrop-filter` is promoted to its **own compositing layer that the OS does not keep in sync with the text layer's transform** — so as the lyrics move the shadow stays frozen behind them, *and a hidden (opacity-0) layer's detached shadow keeps painting on its own* (the Now Playing in-page lyrics, hidden under the immersive overlay, were the main frozen-shadow source). There's no reliable way to force the shadow layer to track the text on a transparent window (a Chromium bug), so the fix removes the detachable effects. **Initially scoped** to the visible overlay (`.lyrics-immersive-surface`), then **broadened document-wide** to `[data-muzero-lyrics-overlay="true"] *` ([styles.css](../../../src/styles.css)) so the hidden in-page lyrics' detached shadow is killed too — zeroes `text-shadow`/`box-shadow`/`backdrop-filter` everywhere in the capture (and `filter` on karaoke `[data-word]` spans, without touching the cascade per-row blur). The control bar also drops its own `shadow-lg` + `backdrop-blur` ([floating-unpin-button.tsx](../../../src/components/player/floating-unpin-button.tsx)), and its fade gets the repaint nudge ([App.tsx](../../../src/App.tsx) `useTransparentWindowRepaint(..., { fadeMs: 200 })`). Solid text fill repaints cleanly; a non-blurred text **stroke** (painted in the glyph's own layer) is the kept, ghost-free legibility aid.
- **Locked-overlay reveal precision (added 2026-06-19 per feedback):** when LOCKED (pin-click-through, the OBS capture state) the control bar must reveal ONLY when the cursor is over its centered region — previously `revealed = !idle || clickThroughHover` let *any* pointer activity flash the bar's translucent background, so the capture stopped being fully transparent. New pure helper [`resolveLyricsOverlayRevealed`](../../../src/lib/lyrics-overlay-reveal.ts): locked → `clickThroughHover` only (the OS cursor-poll region signal); merely pinned → keeps `!idle || clickThroughHover` so the unpin control stays easy to find. Wired in [App.tsx](../../../src/App.tsx) via the live window `pinMode`. The bar already registers its exact rect as the interactive region ([floating-unpin-button.tsx](../../../src/components/player/floating-unpin-button.tsx)). Tests: [lyrics-overlay-reveal.test.ts](../../../src/lib/lyrics-overlay-reveal.test.ts).
- **Cross-Space follow (added 2026-06-19 per feedback):** a pinned (always-on-top) window vanished when switching macOS Spaces, because an always-on-top window stays on the Space it was pinned in. [window-pin.cjs `applyMode`](../../../electron/window-pin.cjs) now also calls `win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true })` — so a pinned overlay follows the user across every Space and stays visible over other apps' fullscreen, and reverts to normal per-Space behavior on unpin. No-op on Windows. Re-applied at boot via [`useDesktopWindowPinMode`](../../../src/App.tsx) when the saved pin mode is restored. Tests: [scripts/electron-window-pin.test.mjs](../../../scripts/electron-window-pin.test.mjs).
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

**Fix direction (decided — Option A, symmetric to Windows):** ✅ **Implemented** (real‑device verification pending — see Q1 note below)

- **Decision (Q2):** create the macOS window **`transparent: true`** with a transparent/no‑opaque `backgroundColor` (`#00000000`), and let the normal (non‑lyrics) app background be painted by the DOM (`.app-shell` `bg-background`) — which it already is. The existing `data-muzero-lyrics-overlay` CSS path then "just works" on macOS exactly as on Windows. **No second helper window** (Option B rejected: `transparent` can't be toggled at runtime, and a second always‑transparent capture window doubles the renderer/state for no benefit).
- **Decision (Q1 — macOS‑specific window setup):** keep `titleBarStyle: "hiddenInset"` so the **native traffic lights stay top‑left** (the user's original ask: macOS doesn't need custom min/max/close, just the pin button). A transparent macOS window **loses the native drop shadow and OS‑provided rounded‑corner mask** — this is the macOS‑specific gotcha behind "fine on Windows, black on macOS." Compensate by painting shadow + rounded corners in the DOM (next decision). Implementation must verify traffic‑light rendering under `transparent: true`; if `hiddenInset` + transparent proves unstable on the target macOS versions, fall back to `frame: false` + the standalone macOS pin control from Issue #2 (no native min/max/close needed anyway).
- **Decision (Q5 — window chrome):** extend the existing **win32 DOM‑painted rounded‑corner + accent‑border treatment** ([styles.css:219-289](../../../src/styles.css#L219-L289)) to macOS by widening those selectors to also match `[data-desktop-platform="darwin"]` (or a shared `[data-desktop-shell="electron"]:not(...win-specific)`), since a transparent macOS window has no native shadow/corners. Painting chrome in the DOM keeps Windows and macOS visually consistent (Q4 spirit) and is the best‑practice way to restore corners/shadow lost to transparency.
- The CSS at [styles.css:296-308](../../../src/styles.css#L296-L308) (the lyrics‑overlay transparency) is already correct and cross‑platform; the substantive change is in **window creation** plus the chrome selectors above. Maximized/fullscreen drops the DOM corners/border on macOS too (the win32 reset rules were extended to darwin).

- ⚠️ **Follow‑up bug (fixed 2026-06-19) — transparent‑window "stale frame" ghost.** After pinning, once the ambient background faded out, a *fixed* ghost of the prior frame remained on screen. Diagnosis: **not** a duplicate DOM layer — lyrics render through a single stack ([synced-lyrics-view.tsx](../../../src/components/player/synced-lyrics-view.tsx) `SyncedLines` → one `LyricLineButton` per line) and the background already unmounts when inactive ([now-playing-background.tsx:76](../../../src/components/player/now-playing-background.tsx#L76) `{active ? … : null}`). The ghost is a macOS transparent‑window **compositor artifact**: when the heavy Pixi/visualizer/canvas background layer is torn down, Chromium doesn't reliably repaint the freed region to transparent, so the last painted frame stays stuck. **Fix:** force a full window repaint (`webContents.invalidate()`) after the fade settles — new IPC `muzero:window:repaint` ([ipc.cjs](../../../electron/ipc.cjs)) → bridge `windowControls.repaint` ([bridge.ts](../../../src/lib/desktop/bridge.ts), [electron.ts](../../../src/lib/desktop/electron.ts), [preload.cjs](../../../electron/preload.cjs)) → driven from [`useTransparentWindowRepaint`](../../../src/hooks/use-transparent-window-repaint.ts) on the background‑disappearing edge ([App.tsx](../../../src/App.tsx)). No‑op off Electron. Tests: [use-transparent-window-repaint.test.tsx](../../../src/hooks/use-transparent-window-repaint.test.tsx). **⚠️ Needs real‑Mac confirmation** that `invalidate()` clears the ghost; fallback if not = a 1‑device‑px window resize nudge.
- ✅ **As implemented:** per‑platform window options moved to a pure, unit‑tested [window-chrome.cjs `resolveWindowChrome(platform)`](../../../electron/window-chrome.cjs) consumed by [main.cjs `createWindow`](../../../electron/main.cjs) (darwin → `transparent:true` + `#00000000` + `hiddenInset` + framed; win32 → transparent + frameless; linux → opaque + framed). CSS chrome selectors widened to `:is([data-desktop-platform="win32"], [data-desktop-platform="darwin"])`. The cover‑drag border animation (`useWindowBorderDragColor`) stays win32‑only; macOS shows the settled cover‑colored border (no per‑frame drag follow). Tests: [scripts/electron-window-chrome.test.mjs](../../../scripts/electron-window-chrome.test.mjs). Full suite (2940 tests) green; bundle‑integrity test confirms `./window-chrome.cjs` bundles with no leaked deps. **⚠️ Real macOS run still needed** to confirm traffic lights + see‑through capture under `transparent:true`.

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
- [x] In [tray.cjs `buildTrayIcon()`](../../../electron/tray.cjs), load via `nativeImage.createFromPath`, `.resize({width:16,height:16})`, pass the resized `nativeImage` to `new Tray(...)` (injected `nativeImage` from [main.cjs](../../../electron/main.cjs)).
- [x] **Revised:** keep the colored logo (no `setTemplateImage`) so the brand mark shows, not a silhouette — per user feedback 2026-06-19.
- [x] Dock icon path ([app-icon.cjs](../../../electron/app-icon.cjs)) unaffected.

### Phase 1 Checklist
- [x] macOS tray icon downscaled to 16pt (fixes "huge"); user confirmed size is correct.
- [x] Colored logo shown in the menu bar, not a monochrome template silhouette (user feedback addressed).
- [x] Windows/Linux tray icon resized to 16px (verified by test).
- [x] Dock icon (`app.dock.setIcon`) path unchanged.
- [x] Graceful fallback to the raw icon path when `nativeImage` is absent or the asset decodes empty (verified by tests).
- [ ] _Light/dark menu‑bar contrast of the colored logo — confirm on a real Mac in both menu‑bar themes._

### Phase 2: macOS top‑right always‑on‑top button

**Goal:** macOS surfaces the pin button (and only the pin button) in the top‑right. ✅ **Completed**

**Tasks:**
- [x] Added `macControlsSupported` + `isMacRuntime` in [desktop-window-store.ts](../../../src/stores/desktop-window-store.ts).
- [x] New [MacWindowControls](../../../src/components/shell/mac-window-controls.tsx) mounts [HeaderPinButton](../../../src/components/shell/header-pin-button.tsx) top‑right (no‑drag), no min/max/close; rendered in [App.tsx](../../../src/App.tsx).
- [x] `setPinMode` round‑trips on macOS (already wired) and persists via `desktopWindowPinMode` (reuses existing `HeaderPinButton` logic).

### Phase 2 Checklist
- [x] macOS renders a working pin button top‑right; traffic lights remain native top‑left (verified by test: only one button, no min/max/close).
- [x] Toggling pin reuses the proven `setPinMode` → `setAlwaysOnTop` path ([window-pin.cjs](../../../electron/window-pin.cjs)); focus‑recovery unchanged.
- [x] Windows behavior unchanged — `WindowsWindowControls` stays Windows‑only (`MacWindowControls` renders nothing on win32, verified by test).
- [x] Pinned window follows across macOS Spaces + stays over fullscreen (`setVisibleOnAllWorkspaces`), reverts on unpin (added 2026-06-19; verified by test).
- [ ] _Live macOS validation (hover‑reveal placement vs traffic lights, real always‑on‑top, cross‑Space follow) — pending real‑device QA._

### Phase 3: macOS lyrics‑only transparent backing

**Goal:** lyrics‑only mode is genuinely transparent on macOS (decided approach: Option A — always‑transparent window). ✅ **Completed (pending real‑device QA)**

**Tasks:**
- [x] Per‑platform window options extracted to [window-chrome.cjs `resolveWindowChrome`](../../../electron/window-chrome.cjs); macOS → `transparent: true` + `backgroundColor: "#00000000"` + `titleBarStyle: "hiddenInset"`, wired into [main.cjs `createWindow`](../../../electron/main.cjs).
- [x] Extended the win32 DOM‑painted chrome (background‑transparent, `.app-shell` corners, `#root::after` border, maximized/fullscreen reset) in [styles.css](../../../src/styles.css) to also match `[data-desktop-platform="darwin"]`.
- [ ] _Verify native traffic lights render under transparency on a real Mac; fall back to `frame:false` + Issue‑#2 control if unstable. (pending)_
- [x] Normal states paint an opaque DOM background (`.app-shell bg-background`); the cross‑platform `data-muzero-lyrics-overlay` CSS (unchanged) yields the see‑through capture on macOS once the window is transparent.

### Phase 3 Checklist
- [x] Window created transparent on macOS (unit‑tested via `resolveWindowChrome`); lyrics‑overlay CSS already cross‑platform → see‑through path complete in code.
- [x] Non‑lyrics states: opaque DOM background + DOM‑painted rounded corners/border extended to macOS.
- [x] Maximized/fullscreen drops corners + border on macOS (reset selectors extended to darwin).
- [x] No regression to Windows transparency path (full suite green: 2940 tests; bundle‑integrity test passes).
- [ ] _Real macOS run: traffic lights render + capture is genuinely see‑through (pending real‑device QA)._

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
| 3 | Tray icon: monochrome **template** image vs full‑color logo? | ✅ Resolved (revised 2026-06-19) | First shipped as a template, but it rendered as a flat silhouette ("图案不对"). **Revised: keep the resized colored logo, no `setTemplateImage`** so the real brand mark shows. Tradeoff: no auto light/dark recolor — verify contrast on real menu bars. |
| 4 | Should the macOS pin button also expose `pin-click-through` (lyrics Lock), or only `off`/`pin` like the Windows header button? | ✅ Resolved | **Align with Windows** — `off`/`pin` only; `pin-click-through` stays the separate in‑overlay Lock action on both platforms. |
| 5 | When the macOS window is transparent, does the rounded‑corner / accent‑border treatment (currently win32‑only) need a macOS variant, or rely on the native frame? | ✅ Resolved | Needs a macOS variant — **extend the win32 DOM‑painted chrome** ([styles.css:219-289](../../../src/styles.css#L219-L289)) to `[data-desktop-platform="darwin"]`, because a transparent window has no native shadow/corners. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | MUZERO | Initial draft — root‑cause analysis for macOS tray icon size, missing always‑on‑top button, and lyrics‑only transparency |
| 2026-06-18 | MUZERO | Resolved all 5 Open Questions ("best practice + align with Windows"): Option A always‑transparent macOS window (`hiddenInset` + native traffic lights + DOM‑painted chrome), monochrome template tray icon, macOS pin button matches Windows `off`/`pin`. Folded decisions into §3.1/§3.2/§3.3 and Phase 3 |
| 2026-06-18 | MUZERO | **Phase 1 complete** (TDD): tray icon resized to 16pt + `setTemplateImage(true)` on macOS via injected `nativeImage` in [tray.cjs](../../../electron/tray.cjs); reuses the existing logo's alpha silhouette (no new asset). 4 new tests in [electron-tray.test.mjs](../../../scripts/electron-tray.test.mjs) |
| 2026-06-18 | MUZERO | **Phase 2 complete** (TDD): standalone macOS pin button — new [MacWindowControls](../../../src/components/shell/mac-window-controls.tsx) (top‑right, pin only) + `macControlsSupported`/`isMacRuntime` in [desktop-window-store.ts](../../../src/stores/desktop-window-store.ts), mounted in [App.tsx](../../../src/App.tsx). 4 new tests in [mac-window-controls.test.tsx](../../../src/components/shell/mac-window-controls.test.tsx) |
| 2026-06-19 | MUZERO | **Unfocused-window trail fix**: QA found the residue is focus-dependent (clean focused, trails unfocused) — macOS stops compositing/clearing an unfocused transparent window. Added `backgroundThrottling: false` ([main.cjs](../../../electron/main.cjs)) + `useContinuousTransparentRepaint` driving per-frame `invalidate()` while the capture is playing ([App.tsx](../../../src/App.tsx)). 4 new hook tests |
| 2026-06-19 | MUZERO | **Detached-effect ghost (strip ALL filters)**: residue persisted because the strip preserved the cascade engine's per-row `filter: blur()` — but a blur is also a filter → its own detached compositing layer that freezes on the transparent window (and the active line's karaoke `drop-shadow` is a filter too). Changed the document-wide strip to zero **all** `filter` (+ text/box-shadow, backdrop-filter) under `[data-muzero-lyrics-overlay="true"]` ([styles.css](../../../src/styles.css)); cascade inactive-line blur is sacrificed in the capture |
| 2026-06-19 | MUZERO | **Detached-shadow ghost (broadened strip)**: QA found the 残影 is the shadow's own compositing layer not tracking the text's transform on a transparent window — incl. a hidden opacity-0 in-page-lyrics layer whose detached shadow keeps painting. Broadened the shadow strip from `.lyrics-immersive-surface` to the whole `[data-muzero-lyrics-overlay="true"]` document subtree ([styles.css](../../../src/styles.css)); removed the now-unused overlay class |
| 2026-06-19 | MUZERO | **Motion‑trail ghost fix**: idle lyrics still trailed (two lines overlapping) because a fully transparent macOS backing (`#00000000`) makes the compositor skip clearing the surface during continuous motion. Gave the macOS window a 1/255‑alpha backing (`#01010101`) in [window-chrome.cjs](../../../electron/window-chrome.cjs) so Chromium clears each frame — visually invisible, Windows unchanged. Chrome test updated |
| 2026-06-19 | MUZERO | **Shadow‑residue ghost fix**: residue persisted after the repaint fix and "looked like a shadow" on lyrics + control bar. Stripped `text-shadow`/`box-shadow`/`backdrop-filter`/word `drop-shadow` in the transparent capture ([styles.css](../../../src/styles.css) under `.lyrics-immersive-surface`) + removed the control bar's `shadow-lg`/`backdrop-blur` ([floating-unpin-button.tsx](../../../src/components/player/floating-unpin-button.tsx)); generalized the repaint hook with `fadeMs` and applied it to the control-bar fade. Hook test extended |
| 2026-06-19 | MUZERO | **Locked‑overlay reveal precision** (TDD): when locked (click‑through capture), the control bar flashed on any pointer activity near the lyrics (`!idle`). New pure helper [`resolveLyricsOverlayRevealed`](../../../src/lib/lyrics-overlay-reveal.ts) → locked reveals ONLY on `clickThroughHover` (cursor over the centered bar region); pinned keeps `!idle` reveal. Wired in [App.tsx](../../../src/App.tsx) via live `pinMode`. 3 new tests |
| 2026-06-19 | MUZERO | **Transparent stale‑frame ghost fix** (TDD): a fixed ghost remained after the background faded out on the pinned transparent window. Confirmed single lyrics layer + background already unmounts → it's a macOS compositor clear bug. Added `webContents.invalidate()` repaint via new `muzero:window:repaint` IPC + bridge `repaint`, driven by [`useTransparentWindowRepaint`](../../../src/hooks/use-transparent-window-repaint.ts) on the background‑disappearing edge. 3 new hook tests. Needs real‑Mac confirmation |
| 2026-06-19 | MUZERO | **Cross‑Space follow** (TDD): a pinned/always‑on‑top window vanished when switching macOS Spaces. [window-pin.cjs `applyMode`](../../../electron/window-pin.cjs) now calls `setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: true })` so a pinned overlay follows across every Space + over fullscreen, reverting on unpin. 2 new tests in [electron-window-pin.test.mjs](../../../scripts/electron-window-pin.test.mjs) |
| 2026-06-19 | MUZERO | **Q3 revised after real‑Mac feedback**: the macOS tray template image rendered as a flat silhouette ("图案不对"). Dropped `setTemplateImage(true)` in [tray.cjs](../../../electron/tray.cjs) so the resized **colored logo** shows instead. Tests updated ([electron-tray.test.mjs](../../../scripts/electron-tray.test.mjs)) — macOS + Windows now both resize‑only, no template |
| 2026-06-18 | MUZERO | **Phase 3 complete** (TDD, pending real‑device QA): macOS window created transparent via [window-chrome.cjs `resolveWindowChrome`](../../../electron/window-chrome.cjs) in [main.cjs](../../../electron/main.cjs); win32 DOM‑painted chrome (corners/border/maximized reset) extended to `[data-desktop-platform="darwin"]` in [styles.css](../../../src/styles.css). 3 new tests in [electron-window-chrome.test.mjs](../../../scripts/electron-window-chrome.test.mjs); full suite (2940) green. **All 3 phases done — PRD ready to move Draft → Completed after real‑Mac verification.** |

---

> **Note:** This PRD emphasizes modifying existing shell code (window creation, tray controller, pin surfacing) over new structures. All three issues are macOS parity gaps against an already‑correct Windows path; the underlying capabilities (tray, always‑on‑top, lyrics transparency CSS) already exist.
