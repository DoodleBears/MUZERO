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
// macOS only: a 1/255-alpha backing instead of pure #00000000. A FULLY transparent
// macOS window backing makes the compositor skip clearing the surface, so moving
// content (the scrolling / cascading lyrics in the transparent capture) leaves
// stale-frame trails — the "残影" where two lyric lines smear over each other.
// A minimal non-zero alpha gives Chromium a surface to clear every frame, killing the
// trails while staying visually invisible (~0.4% black, only ever shown in the
// lyrics-only transparent state; the opaque DOM background covers it otherwise).
// #01010101 is format-agnostic: alpha = 1/255 whether parsed as #AARRGGBB or
// #RRGGBBAA. Windows clears fine with pure transparent, so it keeps #00000000.
const MAC_TRANSPARENT_BACKGROUND = "#01010101";

function resolveWindowChrome(platform) {
  const isMac = platform === "darwin";
  const isWindows = platform === "win32";
  const transparent = isMac || isWindows;
  const backgroundColor = isMac
    ? MAC_TRANSPARENT_BACKGROUND
    : transparent
      ? TRANSPARENT_BACKGROUND
      : OPAQUE_BACKGROUND;
  return {
    backgroundColor,
    frame: !isWindows,
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    transparent,
  };
}

module.exports = {
  MAC_TRANSPARENT_BACKGROUND,
  OPAQUE_BACKGROUND,
  resolveWindowChrome,
  TRANSPARENT_BACKGROUND,
};
