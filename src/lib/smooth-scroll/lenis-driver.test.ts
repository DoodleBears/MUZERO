import type Lenis from "lenis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __activeCount,
  __resetDriver,
  lenisForElement,
  registerLenis,
  requestLenisTick,
  unregisterLenis,
} from "./lenis-driver";

// Minimal fake — the driver only ever calls `.raf(time)`.
function fakeLenis() {
  const listeners = new Map<string, Array<() => void>>();
  return {
    isScrolling: false,
    on: vi.fn((event: string, cb: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return () => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((listener) => listener !== cb),
        );
      };
    }),
    raf: vi.fn(),
    trigger(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  } as unknown as Lenis & { trigger: (event: string) => void };
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

  it("sleeps after registered instances settle, then wakes on virtual scroll", () => {
    const a = fakeLenis();
    registerLenis(a);
    for (let i = 0; i < 8; i += 1) step(i * 16);
    expect(pending).toBeNull();

    a.trigger("virtual-scroll");
    expect(rafCalls).toBe(9);
    step(200);
    expect(a.raf).toHaveBeenLastCalledWith(200);
  });

  it("can be woken by programmatic scroll helpers", () => {
    const a = fakeLenis();
    registerLenis(a);
    for (let i = 0; i < 8; i += 1) step(i * 16);
    expect(pending).toBeNull();

    requestLenisTick(a);
    expect(rafCalls).toBe(9);
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
