/**
 * Resolve the Now Playing Pixi background's GPU backend + power preference from
 * user settings. Both default to "auto", and **auto = pick the performant path**
 * (WebGPU when the device supports it; high-performance GPU) per the PRD; users
 * can override either in Settings (e.g. a laptop on battery → low-power, or a
 * flaky WebGPU WebView → force WebGL). Resolvers are pure so they're unit-tested;
 * the WebGPU capability probe is the only runtime bit.
 */
export type GpuBackendPreference = "auto" | "webgpu" | "webgl";
export type GpuBackend = "webgpu" | "webgl";
export type GpuPowerPreference = "auto" | "high-performance" | "low-power";
export type GpuPower = "high-performance" | "low-power";

export function resolveGpuBackend(
  pref: GpuBackendPreference | undefined,
  hasWebGpu: boolean,
): GpuBackend {
  // Explicit WebGL never upgrades. Everything else wants WebGPU but degrades
  // gracefully to WebGL when the device/WebView can't provide it (e.g. WKWebView).
  if (pref === "webgl") return "webgl";
  return hasWebGpu ? "webgpu" : "webgl";
}

export function resolveGpuPower(pref: GpuPowerPreference | undefined): GpuPower {
  // auto + high-performance both prefer the performant GPU; only an explicit
  // low-power choice opts out (e.g. to save battery).
  return pref === "low-power" ? "low-power" : "high-performance";
}

/** Runtime probe: does this environment expose the WebGPU API at all? */
export function hasWebGpuSupport(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator && Boolean(navigator.gpu);
}
