/**
 * Bridge-backed YouTube runtime — the one place that wires the desktop bridge's
 * sandboxed `n`-eval into the (otherwise injectable) {@link createYoutubeRuntime}.
 * Memoized so player.js is fetched + parsed once per app run, not per resolve.
 * Returns null on web/tauri (no `evalYoutubeN`) → YouTube playback is desktop-only.
 *
 * Kept out of `registry.ts` so the registry's source-construction stays free of any
 * direct bridge import (the same discipline the other sources follow).
 */

import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import type { StreamHttp } from "../http";
import { createYoutubeRuntime, type YoutubeRuntimeHandle } from "./youtube-runtime";

let cached: YoutubeRuntimeHandle | null | undefined;

export function createBridgeYoutubeRuntime(http: StreamHttp): YoutubeRuntimeHandle | null {
  if (cached !== undefined) return cached;
  const evalN = resolveDesktopBridge().evalYoutubeN;
  cached = evalN ? createYoutubeRuntime({ http, evalN }) : null;
  return cached;
}
