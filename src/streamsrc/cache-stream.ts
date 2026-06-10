/**
 * Offline-cache orchestration (Phase 5): resolve a streamed track to a playable URL,
 * download the bytes, persist them. Pure + injectable (no store/bridge/db import) so
 * it's unit-testable; the player wires `resolve` from the registry, `fetchBytes` from
 * the media proxy, and `store` from {@link cacheStreamedTrackBlob}.
 *
 * Maps provider verdicts the same way playback does — a VIP/login gate is reported,
 * not cached, so the UI can prompt instead of writing a broken blob.
 */

import type { StreamPlaybackResult } from "./resolve-playback";

export interface RunStreamCacheDeps {
  /** Resolve the track to a playable URL (already account/quality-bound). */
  resolve: () => Promise<StreamPlaybackResult>;
  /** Download the resolved media (the caller injects proxy headers / CORS). */
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;
  /** Persist the bytes + set the track's blobId (cacheStreamedTrackBlob bound to the id). */
  store: (blob: Blob, mime: string) => Promise<string>;
}

export type RunStreamCacheResult =
  | { kind: "cached"; blobId: string; bytes: number }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Resolve → download → store. Never throws; returns a verdict. */
export async function runStreamCache(deps: RunStreamCacheDeps): Promise<RunStreamCacheResult> {
  let resolved: StreamPlaybackResult;
  try {
    resolved = await deps.resolve();
  } catch (err) {
    return { kind: "error", message: message(err) };
  }
  if (resolved.kind === "requires-login") return { kind: "requires-login" };
  if (resolved.kind === "no-permission") {
    return { kind: "no-permission", reason: resolved.reason };
  }
  if (resolved.kind !== "ok") return { kind: "error", message: resolved.message };
  try {
    const blob = await deps.fetchBytes(resolved.url, resolved.headers);
    const mime = resolved.mime || blob.type || "audio/mpeg";
    const blobId = await deps.store(blob, mime);
    return { kind: "cached", blobId, bytes: blob.size };
  } catch (err) {
    return { kind: "error", message: message(err) };
  }
}
