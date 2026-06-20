import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { resolveWindowChrome } = require("../electron/window-chrome.cjs");

describe("resolveWindowChrome", () => {
  it("runs the macOS window transparent AND frameless, identical to Windows", () => {
    const chrome = resolveWindowChrome("darwin");
    // `transparent` can't be toggled at runtime, so the window must be created
    // transparent up front; the DOM paints the opaque app background in normal states.
    expect(chrome.transparent).toBe(true);
    expect(chrome.backgroundColor).toBe("#00000000");
    // FRAMELESS, no native titlebar. A FRAMED transparent macOS window (titleBarStyle:
    // hiddenInset) is composited differently by the window server and doesn't clear
    // moving content — the "残影" trails. Windows is frameless and clears fine, so macOS
    // matches it. The app draws its own window controls; native traffic lights are gone.
    expect(chrome.frame).toBe(false);
    expect(chrome.titleBarStyle).toBeUndefined();
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
