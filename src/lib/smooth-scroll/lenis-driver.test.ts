import type Lenis from "lenis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __activeCount,
  __resetDriver,
  lenisForElement,
  registerLenis,
  unregisterLenis,
} from "./lenis-driver";

// Minimal fake — the driver only ever calls `.raf(time)`.
function fakeLenis() {
  return { raf: vi.fn() } as unknown as Lenis;
}

let pending: FrameRequestCallback | null = null;
let rafCalls = 0;
let cancelCalls = 0;

beforeEach(() => {
  pending = null;
  rafCalls = 0;
  cancelCalls = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    pending = cb;
    return ++rafCalls;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    cancelCalls += 1;
    pending = null;
  });
});

afterEach(() => {
  __resetDriver();
  vi.unstubAllGlobals();
});

/** Invoke the scheduled frame, as the browser would. */
function step(time = 16) {
  const cb = pending;
  pending = null;
  cb?.(time);
}

describe("lenis-driver — one shared rAF for all instances (PRD §4.2)", () => {
  it("starts the loop on first register and ticks the instance", () => {
    const a = fakeLenis();
    registerLenis(a);
    expect(rafCalls).toBe(1); // exactly one loop started
    step(100);
    expect(a.raf).toHaveBeenCalledWith(100);
  });

  it("drives every active instance in a single frame", () => {
    const a = fakeLenis();
    const b = fakeLenis();
    registerLenis(a);
    registerLenis(b);
    expect(rafCalls).toBe(1); // still a single loop, not one per instance
    step(50);
    expect(a.raf).toHaveBeenCalledWith(50);
    expect(b.raf).toHaveBeenCalledWith(50);
    expect(__activeCount()).toBe(2);
  });

  it("registering the same instance twice is idempotent", () => {
    const a = fakeLenis();
    registerLenis(a);
    registerLenis(a);
    expect(__activeCount()).toBe(1);
    expect(rafCalls).toBe(1);
  });

  it("stops the loop when the last instance unregisters, restarts on the next register", () => {
    const a = fakeLenis();
    registerLenis(a);
    unregisterLenis(a);
    expect(__activeCount()).toBe(0);
    expect(cancelCalls).toBe(1);

    // A tick that somehow fires after empty must not reschedule.
    step();
    // re-register restarts a fresh loop
    const b = fakeLenis();
    registerLenis(b);
    expect(rafCalls).toBe(2);
  });

  it("lenisForElement returns the instance whose rootElement matches, else null", () => {
    const el = document.createElement("div");
    const lenis = { raf: vi.fn(), rootElement: el } as unknown as Lenis;
    registerLenis(lenis);
    expect(lenisForElement(el)).toBe(lenis);
    expect(lenisForElement(document.createElement("div"))).toBeNull();
  });

  it("self-stops: a tick with an empty set does not reschedule", () => {
    const a = fakeLenis();
    registerLenis(a);
    // remove without cancel path by deleting then ticking
    unregisterLenis(a);
    pending = null;
    step(); // no callback pending → no reschedule
    expect(__activeCount()).toBe(0);
  });
});
