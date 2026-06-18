import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveWindowChrome } = require("../electron/window-chrome.cjs");

describe("resolveWindowChrome", () => {
  it("runs the macOS window transparent so lyrics-only mode can be see-through", () => {
    const chrome = resolveWindowChrome("darwin");
    // `transparent` can't be toggled at runtime, so the window must be created
    // transparent up front; the DOM paints the opaque app background in normal states.
    expect(chrome.transparent).toBe(true);
    expect(chrome.backgroundColor).toBe("#00000000");
    // Keep native traffic lights (top-left) via the inset title bar; never frameless.
    expect(chrome.titleBarStyle).toBe("hiddenInset");
    expect(chrome.frame).toBe(true);
  });

  it("keeps the Windows window transparent + frameless (app draws its own controls)", () => {
    const chrome = resolveWindowChrome("win32");
    expect(chrome.transparent).toBe(true);
    expect(chrome.backgroundColor).toBe("#00000000");
    expect(chrome.frame).toBe(false);
    expect(chrome.titleBarStyle).toBeUndefined();
  });

  it("keeps Linux opaque and framed (transparency not assumed)", () => {
    const chrome = resolveWindowChrome("linux");
    expect(chrome.transparent).toBe(false);
    expect(chrome.backgroundColor).toBe("#09090b");
    expect(chrome.frame).toBe(true);
    expect(chrome.titleBarStyle).toBeUndefined();
  });
});
