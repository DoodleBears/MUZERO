// Per-platform BrowserWindow chrome (pure, so it's unit-testable without electron).
//
// macOS AND Windows run a TRANSPARENT window. Electron's `transparent` flag can't be
// toggled at runtime — it must be set at window creation — so the only way the
// lyrics-only / "subtitle only" capture can become see-through is to create the
// window transparent up front. In normal (non-lyrics) states the opaque app
// background is painted by the DOM (`.app-shell` `bg-background`); the lyrics-only
// CSS path then drops that to transparent and the desktop shows through. Without
// this, macOS painted its opaque `#09090b` backing color (a near-black rectangle)
// behind the transparent DOM — the "fine on Windows, black on macOS" bug.
//
// Windows is frameless (the app draws its own min/max/close cluster). macOS keeps
// the native frame + inset traffic lights (top-left); the app only adds a top-right
// pin button. A transparent window loses the OS shadow + rounded-corner mask on both
// platforms, so the rounded corners + accent border are repainted in the DOM
// (styles.css, keyed off data-desktop-platform). Linux stays opaque + framed.
const OPAQUE_BACKGROUND = "#09090b";
const TRANSPARENT_BACKGROUND = "#00000000";

// macOS + Windows run a transparent window so the lyrics-only DOM can be see-through
// (`transparent` can't be toggled at runtime). Windows is frameless (app-drawn min/
// max/close); macOS keeps its native frame + inset traffic lights (top-left) and only
// adds a top-right pin button. Linux stays opaque + framed.
//
// NOTE: making macOS frameless was tried as a fix for the transparent-window scroll
// "残影" trails (Windows, which is frameless, never trailed) — it did NOT help, so the
// frame is not the cause and macOS keeps its native traffic lights. The trails are a
// deeper macOS limitation (animated DOM content on a transparent window isn't cleared);
// see PRD §3.3 — the durable fix is a self-clearing canvas lyrics layer.
function resolveWindowChrome(platform) {
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";
  const transparent = isMac || isWindows;
  return {
    backgroundColor: transparent ? TRANSPARENT_BACKGROUND : OPAQUE_BACKGROUND,
    frame: !isWindows,
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    transparent,
  };
}

module.exports = { OPAQUE_BACKGROUND, resolveWindowChrome, TRANSPARENT_BACKGROUND };
