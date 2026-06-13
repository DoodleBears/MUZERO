import { describe, expect, it } from "vitest";
import { resolveGpuBackend, resolveGpuPower } from "./gpu-backend";

describe("resolveGpuBackend", () => {
  it("auto picks WebGPU when the device supports it", () => {
    expect(resolveGpuBackend("auto", true)).toBe("webgpu");
  });

  it("auto falls back to WebGL when WebGPU is unsupported", () => {
    expect(resolveGpuBackend("auto", false)).toBe("webgl");
  });

  it("undefined (no setting) behaves like auto", () => {
    expect(resolveGpuBackend(undefined, true)).toBe("webgpu");
    expect(resolveGpuBackend(undefined, false)).toBe("webgl");
  });

  it("explicit WebGPU still falls back when unsupported (no crash on WKWebView)", () => {
    expect(resolveGpuBackend("webgpu", false)).toBe("webgl");
    expect(resolveGpuBackend("webgpu", true)).toBe("webgpu");
  });

  it("explicit WebGL never upgrades even when WebGPU is available", () => {
    expect(resolveGpuBackend("webgl", true)).toBe("webgl");
  });
});

describe("resolveGpuPower", () => {
  it("auto prefers high-performance (pick the performant path)", () => {
    expect(resolveGpuPower("auto")).toBe("high-performance");
  });

  it("undefined (no setting) behaves like auto", () => {
    expect(resolveGpuPower(undefined)).toBe("high-performance");
  });

  it("explicit low-power is honored (laptop battery)", () => {
    expect(resolveGpuPower("low-power")).toBe("low-power");
  });

  it("explicit high-performance is honored", () => {
    expect(resolveGpuPower("high-performance")).toBe("high-performance");
  });
});
