/**
 * StreamSourceProvider — the pluggable boundary for external streaming sources
 * (NetEase / Bilibili / YouTube). Parallel to (NOT reused from) `MusicGenProvider`:
 * musicgen *generates* audio bytes (`generate(brief) → {blob,…}`); a stream source
 * *resolves an already-existing track* to a short-lived playable URL. Same
 * discipline though — implement this interface, register it, and never branch on a
 * concrete source outside resolution (CLAUDE.md rule 5).
 *
 * Resolved URLs are NOT persisted (they expire); the player re-resolves before each
 * play. The persisted shapes (ids, per-source config, metadata snapshot) live in
 * `@/db/types`; this module owns only the behavioral contract.
 */

import type { StreamSourceId } from "@/db/types";
import type { DiagnosticContext } from "@/lib/diagnostics";

export interface StreamSearchHit {
  /** The source's stable id for this track (netease songId / bili "bvid#cid" / yt videoId). */
  externalId: string;
  title: string;
  artist?: string;
  album?: string;
  durationSec?: number;
  coverUrl?: string;
  source: StreamSourceId;
}

export interface PlayableStream {
  /** Bare CDN URL (un-proxied). The desktop media proxy wraps it + injects `headers`. */
  mediaUrl: string;
  /** Already-downloaded bytes for sources that must fetch before playback (YouTube). */
  blob?: Blob;
  /** Headers the media GET must carry (e.g. bili `Referer`), since `<audio>` can't set them. */
  headers?: Record<string, string>;
  mime: string;
  durationSec?: number;
  /** When the URL stops working (ms epoch); the player re-resolves past this. */
  expiresAt?: number;
  /** The quality tier actually selected. */
  quality?: string;
}

export type StreamResolveResult =
  | { kind: "ok"; stream: PlayableStream }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

export interface StreamSearchOptions {
  limit?: number;
  signal?: AbortSignal;
}

export interface StreamResolveOptions {
  /** Preferred source-specific quality key; the provider downgrades as needed. */
  quality?: string;
  signal?: AbortSignal;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}

/** A playlist on a source (the logged-in user's, or a public one). */
export interface StreamPlaylist {
  id: string;
  name: string;
  coverUrl?: string;
  trackCount: number;
  source: StreamSourceId;
}

export interface StreamSourceProvider {
  readonly id: StreamSourceId;
  readonly label: string;
  /** Whether playback needs a logged-in session (vs. anonymous/guest). */
  readonly requiresLogin: boolean;
  /** Whether the current on-device config has a usable session. */
  isAuthed(): boolean;
  search(query: string, opts?: StreamSearchOptions): Promise<StreamSearchHit[]>;
  resolve(externalId: string, opts?: StreamResolveOptions): Promise<StreamResolveResult>;
  /** The logged-in user's playlists (optional; requires login). */
  getUserPlaylists?(opts?: { signal?: AbortSignal }): Promise<StreamPlaylist[]>;
  /** Resolve specific track ids (from a pasted song link) to hits (optional). */
  getTracksByIds?(ids: string[], opts?: { signal?: AbortSignal }): Promise<StreamSearchHit[]>;
  /** Fetch a playlist's meta by ref — for importing a pasted/foreign playlist link (optional). */
  getPlaylistMeta?(
    playlistRef: string,
    opts?: { signal?: AbortSignal },
  ): Promise<StreamPlaylist | null>;
  /** Import a source playlist/favlist/collection into hits (optional per source). */
  importPlaylist?(playlistRef: string, opts?: { signal?: AbortSignal }): Promise<StreamSearchHit[]>;
  /** Best-effort reachability check for Settings. */
  health?(): Promise<boolean>;
}

export class StreamSourceError extends Error {
  constructor(
    message: string,
    readonly source: StreamSourceId,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StreamSourceError";
  }
}
