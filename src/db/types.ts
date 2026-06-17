import type { UIMessage } from "ai";
import type { LlmProviderPresetId } from "@/ai/llm-providers";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { AppIconId } from "@/lib/app-icon";
import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
} from "@/live-requests/audience-request-schema";
import type { LyricsProviderId, LyricsRecord } from "@/lyrics/provider";
import type { CloudPresetId } from "@/musicgen/presets";
import type { MusicGenProviderId } from "@/musicgen/registry";
import type { ScopedShortcutBinding } from "@/shortcuts/registry";
import type {
  SystemGlobalShortcutActionId,
  SystemShortcutBinding,
} from "@/shortcuts/system-global";
import type { VisualizerStyleId } from "@/visualizer/types";

/** Lifecycle of a single track. Uploaded tracks are born "ready". */
export type TrackStatus = "pending" | "generating" | "ready" | "failed";

/** Playback type. A set can mix both freely. */
export type TrackKind = "audio" | "video";

/** Where the track came from. `streamed` = resolved on demand from an external source. */
export type TrackOrigin = "generated" | "uploaded" | "streamed";

/**
 * External streaming sources (NetEase / Bilibili / YouTube / QQ Music). Codename-
 * stable ids (CLAUDE.md rule 4) — persisted on streamed tracks and keyed in
 * settings, so they must not change across brand/shell pivots. See `src/streamsrc/`.
 */
export type StreamSourceId = "netease" | "bili" | "youtube" | "qq";

export interface CoverPaletteRgb {
  r: number;
  g: number;
  b: number;
}

/** Per-source on-device config (BYOK): login state + quality preference. Never bundled. */
export interface StreamSourceConfig {
  enabled?: boolean;
  /** Session cookie (netease MUSIC_U / bili SESSDATA…), captured at login. */
  cookie?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Token/cookie expiry (ms epoch), when known. */
  expiresAt?: number;
  /** Source-specific quality key (e.g. netease "lossless", bili "high"). */
  quality?: string;
  lastAuthAt?: number;
}

/** Snapshot of an external track's display metadata, so the library renders offline. */
export interface StreamSourceMeta {
  artist?: string;
  album?: string;
  coverUrl?: string;
  durationSec?: number;
}

export interface TrackMediaMetadata {
  title?: string;
  artists?: string[];
  album?: string;
  albumArtists?: string[];
  genres?: string[];
  year?: number;
  date?: string;
  trackNo?: number;
  trackOf?: number;
  diskNo?: number;
  diskOf?: number;
  composer?: string[];
  bpm?: number;
  key?: string;
  isrc?: string[];
  musicBrainzRecordingId?: string;
  musicBrainzTrackId?: string;
  musicBrainzAlbumId?: string;
  musicBrainzArtistIds?: string[];
  originalFileName?: string;
  originalMime?: string;
  originalExtension?: string;
  container?: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  parser: "music-metadata" | "track-brief" | "manual";
  parsedAt: number;
}

/**
 * A track in a set — either an AI-generated song or a user-uploaded audio/video
 * (YouTube-Music-style MV). The audio/video bytes and any cover image live in
 * the separate `mediaBlobs` table so list queries stay light.
 */
export interface Track {
  id: string;
  sessionId: string;
  title: string;
  kind: TrackKind;
  origin: TrackOrigin;
  /** Generated tracks only — the DJ brief that produced it. */
  brief?: TrackBrief;
  /** Provider id for generated tracks; "upload" for uploaded ones. */
  provider: string;
  status: TrackStatus;
  /** Duration in seconds. */
  durationSec: number;
  /** FK into `mediaBlobs` for the audio/video bytes. */
  blobId?: string;
  /** Streamable remote audio/video URL for read-only cloud shares. */
  remoteMediaUrl?: string;
  /** Optional cover image (memory photo / artwork) — FK into `mediaBlobs`. */
  coverBlobId?: string;
  /** Streamable remote cover URL for read-only cloud shares. */
  remoteCoverUrl?: string;
  /** Non-destructive square crop for the cover, in the original image's pixels. */
  coverCrop?: CropRect;
  /**
   * Base64 thumbhash of the cover (its displayed framing) — a ~25-byte blurred
   * preview shown instantly before the cover blob resolves (instant-cover-thumbnails
   * PRD). Derived from OUR cover bytes, not the file's tags. Non-indexed → additive,
   * no schema bump; absent on legacy/remote covers until generated/backfilled.
   */
  coverThumbhash?: string;
  /**
   * Small extracted cover palette used by spectrum/flow effects. Stored with the
   * track so browser-only R2 playback does not need CORS-clean cover bytes just to
   * tint visual effects. First color is the dominant swatch. Additive/non-indexed.
   */
  coverPalette?: CoverPaletteRgb[];
  /** Source identity for `coverPalette`: local cover blob id or remote cover URL. */
  coverPaletteSource?: string;
  error?: string;
  createdAt: number;
  /**
   * Last user-edit clock (annotation edits: tags / note / cover / liked / memories).
   * Additive + non-indexed (same path as {@link Track.coverThumbhash}) — legacy rows
   * lack it, so readers fall back to `createdAt`; no Dexie bump / backfill needed.
   * Distinct from `generatedAt` (pipeline) and playback `lastPlayedAt` (stats).
   */
  updatedAt?: number;
  generatedAt?: number;
  playCount: number;
  liked: boolean;
  // Annotations — "music carries memories": user labels + memories (see `Memory`).
  tags: string[];
  /** Normalized embedded/generated media metadata. Raw native tag frames stay out of DB. */
  mediaMetadata?: TrackMediaMetadata;
  /** Absolute on-disk path this track was imported from — dedup key for local-folder sync. */
  sourcePath?: string;
  /**
   * @deprecated Superseded by the one-to-many {@link Memory} table (v4 migrates
   * any existing note into a first Memory). Kept nullable for defense; new code
   * reads/writes memories, never this. Still indexed by search if present.
   */
  note?: string;
  /**
   * Which cloud vendor/model preset generated this track (provenance, musicgen
   * Q5). Undefined for uploaded/mock tracks. Display-only; safe when missing.
   */
  providerPreset?: string;
  // --- External streaming source (origin === "streamed") --------------------
  // Additive, non-indexed → no Dexie version bump (mirrors coverThumbhash). The
  // playable URL is NOT stored (it expires); it's re-resolved before each play.
  // An optional offline cache populates `blobId` (Phase 5), preferred when present.
  /** Which external source this track streams from. */
  streamSourceId?: StreamSourceId;
  /** The source's stable id (netease songId / bili "bvid#cid" / youtube videoId). */
  streamExternalId?: string;
  /** Display snapshot so the library renders without an online round-trip. */
  streamMeta?: StreamSourceMeta;
  /** Safe display-only source snapshot for tracks imported from a cloud drive. */
  cloudSource?: CloudSourceAttribution;
}

/**
 * 歌曲记忆 — one memory attached to a track ("music carries memories"). A track
 * has MANY: each a freeform note + an optional photo + a timestamp, shown as a
 * timeline. The photo bytes live in `mediaBlobs` (role "memory"), never inline.
 */
export interface Memory {
  id: string; // newId("mem")
  /** Which track this memory belongs to (one-to-many). */
  trackId: string;
  /** The memory text (searchable, fed to the DJ as listener context). */
  note: string;
  /** Optional photo — FK into `mediaBlobs` (role "memory"). */
  photoBlobId?: string;
  /** Streamable remote memory photo URL for read-only cloud shares. */
  remotePhotoUrl?: string;
  /** Snapshot of the device/person who wrote this memory. */
  author?: MemoryAuthorRef;
  createdAt: number;
  /**
   * Optional playback anchor: the second in the song this memory is pinned to
   * (user taps "pin to current time" while playing, e.g. 98 → 1:38). Absent =
   * floating (shown to fill idle seconds, not tied to a moment). Callers clamp
   * to `[0, track.durationSec]`; the repo only sanitizes negative/non-finite to
   * undefined. Non-indexed additive field → no Dexie schema bump (same path as
   * {@link Track.coverThumbhash}). Threaded through the R2 manifest (optional).
   */
  atSec?: number;
}

/**
 * Audio, video, or image bytes, kept out of the hot `tracks` table.
 *  - `media`   — the audio/video itself
 *  - `cover`   — a single cover image per track
 *  - `background` — per-track slideshow background images (many per track)
 *  - `gallery` — global slideshow images, stored under the sentinel
 *    `trackId === GLOBAL_GALLERY_ID` (not bound to any track)
 *  - `memory`  — a photo attached to a {@link Memory} (`trackId` = the song)
 *  - `avatar`  — a local device profile avatar (`trackId` = device record id)
 *  - `cover-derivative` — generated local cover derivatives (thumbnail/backlight/stage)
 * New roles are additive: existing rows keep their role, so no schema bump.
 */
export interface MediaBlob {
  id: string;
  trackId: string;
  role: "media" | "cover" | "background" | "gallery" | "memory" | "avatar" | "cover-derivative";
  mime: string;
  bytes: number;
  storageBackend?: "indexeddb" | "opfs" | "electron-file";
  storageKey?: string;
  blob?: Blob;
}

export type CoverDerivativeKind = "thumbnail" | "backlight" | "stage" | "palette";

export interface CoverDerivative {
  id: string;
  kind: CoverDerivativeKind;
  sourceKey: string;
  sourceKind: "local-cover" | "remote-cover";
  sourceRef: string;
  contentHash?: string;
  cropSig: string;
  version: number;
  blobId?: string;
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  palette?: CoverPaletteRgb[];
  generatedAt: number;
  updatedAt: number;
  error?: string;
}

/**
 * Automatically managed remote playback cache. Media bytes prefer OPFS and only
 * fall back to IndexedDB Blob storage when OPFS is unavailable; either way this
 * cache is LRU-evictable and must not be treated as a permanent download.
 */
export interface PlaybackCacheEntry {
  id: string;
  sourceUrl: string;
  trackId: string;
  kind: TrackKind;
  storage: "opfs" | "indexeddb";
  fileName?: string;
  mime: string;
  bytes: number;
  blob?: Blob;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
}

/**
 * A user-chosen cover for a DERIVED library entity (one artist or one album).
 * Artist/album are not stored tables — identity is the projection key from
 * `library-index.ts` (`normalizeArtistName` for an artist, `AlbumEntry.key` for
 * an album), so `id` IS that key. Bytes live in `mediaBlobs` (role "cover",
 * `trackId` = this key), mirroring the owner-keyed set cover. The key format is a
 * frozen codename-layer value — changing it orphans existing covers.
 */
export interface EntityCover {
  id: string; // = entity projection key
  kind: "artist" | "album";
  /** Local cover bytes set on THIS device. Mutually exclusive with `remoteCover`. */
  coverBlobId?: string; // FK → mediaBlobs (role "cover", trackId = id)
  /**
   * Cover imported from another device via R2 — displayed from the URL (lazy, no
   * local bytes) and re-exported by reference so a re-export can't drop it.
   */
  remoteCover?: {
    url: string; // absolute, for display
    key: string; // relative object key (objects/covers/sha256-…), for re-export
    mime: string;
    bytes: number;
    sha256?: string;
  };
  crop?: CropRect;
  /** Base64 thumbhash of the entity cover — instant blurred preview (mirrors `Track.coverThumbhash`). */
  thumbhash?: string;
  updatedAt: number; // last-write-wins clock for R2 sync
}

/**
 * 播放列表 Play Queue — the actual playback order the player consumes, DECOUPLED
 * from any 歌单(Set/`DjSession`). You load a set's tracks into it, push tracks
 * ("play next" / "add to queue"), remove, reorder; it loops. One global singleton.
 * Entries carry their own id so the same track can appear more than once and
 * reorder has stable keys.
 */
export interface PlayQueueEntry {
  id: string; // newId("pqe")
  trackId: string;
}

export interface PlayQueue {
  id: "main"; // singleton
  entries: PlayQueueEntry[];
  currentIndex: number;
  repeat: "off" | "one" | "all";
  /** Which 歌单 we're "playing from" — drives autoExtend continuation + UI. */
  contextSetId?: string;
  updatedAt: number;
}

/** Where the Now-Playing ambient background pulls its image(s) from. `"none"` hides it entirely. */
export type BackgroundMode = "cover" | "slideshow" | "none";

/** Flow background color source: follow the cover palette or a fixed custom set. */
export type FlowColorSource = "cover" | "custom";
export type NowPlayingCoverEffectMode = "shadow" | "backlight" | "off";
/** Flow effect variants — the full color4bg style family, each its own
 *  self-authored shader in `flow-shaders.ts` (no color4bg dependency). */
export type FlowEffectId =
  | "ambient-light"
  | "aesthetic-fluid"
  | "big-blob"
  | "blur-dot"
  | "blur-gradient"
  | "wavy-waves"
  | "chaos-waves"
  | "swirling-curves"
  | "curve-gradient"
  | "step-gradient"
  | "grid-array"
  | "triangles-mosaic"
  | "random-cubes"
  | "abstract-shape";
/** How the flow layer composites with the background below it (CSS mix-blend-mode).
 *  `screen`/`plus-lighter` ≈ additive glow; `multiply` tints/darkens. */
export type FlowBlendMode =
  | "normal"
  | "screen"
  | "plus-lighter"
  | "multiply"
  | "overlay"
  | "soft-light";
export type BackgroundRenderer =
  | "image"
  | "blur"
  | "pixel"
  | "ascii"
  | "cross-hatch"
  | "crt"
  | "dot"
  | "noise";

/**
 * A square crop region in the original image's pixels. Stored non-destructively
 * (Poweramp-style): the full image stays in `mediaBlobs`; this only records what
 * to show, and a setting decides whether covers render cropped or full.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a set renders the "stage" while playing. */
export type SetDisplayMode = "video" | "cover";

/**
 * A set: an ordered, mixed list of tracks. The DJ can keep it growing
 * (`config.autoExtend` + a `seedPrompt`), or it can be a hand-curated/upload set.
 */
export interface DjSession {
  id: string;
  name: string;
  /** Free-text description shown on the set detail page. */
  description?: string;
  /** The DJ vibe/seed. Empty for a pure upload set. */
  seedPrompt: string;
  /**
   * Set-level cover — FK into `mediaBlobs` (role "cover", `trackId` = this set id).
   * When unset, the UI falls back to the topmost (newest) track's cover.
   */
  coverBlobId?: string;
  /** Non-destructive square crop for the set cover (mirrors `Track.coverCrop`). */
  coverCrop?: CropRect;
  /** Base64 thumbhash of the set cover — instant blurred preview (mirrors `Track.coverThumbhash`). */
  coverThumbhash?: string;
  /** Remote set cover URL from an imported cloud drive; local `coverBlobId` wins when present. */
  remoteCoverUrl?: string;
  /** Ordered, curated members. Newest is PREPENDED to the front (= the cover). */
  trackIds: string[];
  /**
   * 歌单内每首歌的分数序 rank（Notion-block 式 drag-reorder）。一次拖拽只更新被移动
   * 歌曲的一个值（相邻中点）；间隙耗尽时批量 renormalize。Additive、非索引（镜像
   * {@link streamPlaylistRef} / {@link coverThumbhash}）→ 无 Dexie 版本 bump。
   * 不变量：undefined（legacy / 从未拖过，顺序 = `trackIds` 数组）或覆盖 `trackIds`
   * 全集（已物化，顺序 = rank 升序）。唯一裁决见 `player/set-order.ts` 的
   * `orderedSetTrackIds`。
   */
  trackRanks?: Record<string, number>;
  /**
   * Removal tombstones for multi-device co-editing (R2 PRD §12.5): trackId →
   * removedAt (ms). Recorded when a member is removed/deleted, cleared on
   * re-add, capped to the newest 200. Published into the set index's
   * `removedTracks` so another device's stale copy can't resurrect the track.
   * Additive + non-indexed (same path as {@link trackRanks}) — no Dexie bump.
   */
  removedTracks?: Record<string, number>;
  /**
   * When a sync pull-merge last applied this set's remote index (PRD §12.5).
   * Disambiguates a genuine local re-add (membership re-added AFTER a pull
   * already applied the removal) from a stale copy. Additive + non-indexed.
   */
  lastPulledAt?: number;
  status: "idle" | "running";
  config: DjConfig;
  /** Default stage rendering: video-first → cover → title. */
  displayMode: SetDisplayMode;
  /**
   * When this set was created by syncing an external playlist, the source + its
   * playlist id — so a later sync can recognize "this is that playlist" and offer
   * an incremental re-sync into the same set. Additive, non-indexed (no version bump).
   */
  streamPlaylistRef?: { source: StreamSourceId; id: string };
  /** Safe display-only source snapshot for sets imported from a cloud drive. */
  cloudSource?: CloudSourceAttribution;
  createdAt: number;
  updatedAt: number;
}

export interface CloudSourceAttribution {
  driveId: string;
  driveLabel?: string;
  devicePublicId?: string;
  displayName?: string;
  avatarSeed?: string;
  avatarUrl?: string;
}

export interface DjChatMessageMetadata {
  /** Original composer text, before future chips/@mentions expand for the model. */
  composerRaw?: string;
  /** Marker used by future interrupt flows to show a turn was superseded. */
  interruptionMarker?: boolean;
  /** Local-only usage/cost hints; never telemetry. */
  turnTelemetry?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    wallMs?: number;
  };
}

export type DjChatUIMessage = UIMessage<DjChatMessageMetadata, never, Record<string, never>>;

/** One queued prompt waiting for explicit dispatch in a chat session. */
export interface DjChatQueuedPrompt {
  id: string; // newId("cqp")
  composerRaw: string;
  createdAt: number;
}

/** One local AI DJ chat session; messages are stored as a JSON snapshot. */
export interface ChatSession {
  id: string; // newId("cht")
  title: string;
  createdAt: number;
  updatedAt: number;
  messagesJson: string; // JSON.stringify(DjChatUIMessage[])
  composerDraftRaw?: string;
  llmProviderPresetId?: string;
  llmModel?: string;
  parentSessionId?: string;
  forkedFromIndex?: number;
  queuedPromptsJson?: string;
  contextStartIndex?: number;
  /** Per-chat-session local-id registry snapshot for LLM-facing short refs. */
  localIdRegistryJson?: string;
}

/** Per-set DJ behavior. */
export interface DjConfig {
  /** Whether the DJ keeps generating audio to fill this set. */
  autoExtend: boolean;
  /** Auto-extend when fewer than this many upcoming tracks remain. */
  refillThreshold: number;
  /** How many tracks the DJ drafts per refill. */
  batchSize: number;
  /** Default target track length the DJ aims for (seconds). */
  targetDurationSec: number;
  /** Allow vocals, or instrumental-only. */
  allowVocals: boolean;
}

export const DEFAULT_DJ_CONFIG: DjConfig = {
  autoExtend: true,
  refillThreshold: 2,
  batchSize: 1,
  targetDurationSec: 60,
  allowVocals: true,
};

export type LlmProviderId = "openai" | "anthropic";
export type AudienceRequestSearchScope = "active-set" | "all-library";

export interface AudienceRequestIntakeSettings {
  enabled: boolean;
  bindHost: "127.0.0.1";
  port: number;
  authToken?: string;
  routeMode: AudienceRequestRouteMode;
  playbackAction: AudienceRequestPlaybackAction;
  searchScope: AudienceRequestSearchScope;
  includeLyrics?: boolean;
  onlineFallbackOnLowConfidence?: boolean;
  confidenceThreshold: number;
  scoreMarginThreshold: number;
  commandPrefixes: string[];
  dedupeWindowSec: number;
  requesterCooldownSec: number;
  maxRequestsPerMinute: number;
  requireApprovalForPlayNow: boolean;
}

export const DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS: AudienceRequestIntakeSettings = {
  enabled: false,
  bindHost: "127.0.0.1",
  port: 41731,
  routeMode: "library-search",
  playbackAction: "play-next",
  searchScope: "all-library",
  includeLyrics: false,
  onlineFallbackOnLowConfidence: true,
  confidenceThreshold: 1.5,
  scoreMarginThreshold: 0.25,
  commandPrefixes: ["点歌", "!sr", "song:"],
  dedupeWindowSec: 30,
  requesterCooldownSec: 10,
  maxRequestsPerMinute: 30,
  requireApprovalForPlayNow: true,
};

/** Singleton app settings (id = "app"). BYOK keys stay on-device, never bundled. */
export interface AppSettings {
  id: "app";
  // LLM DJ (Vercel AI SDK)
  llmProvider: LlmProviderId;
  llmModel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  // Music generation (BYOK cloud API; "mock" needs no config)
  musicGenProvider: MusicGenProviderId;
  /**
   * Whether AI DJ music generation is enabled. OFF by default — generation hits
   * a paid cloud API, so the user opts in explicitly in Settings. When off, the
   * chat agent is not given the generate tools (search/ingest still work). There
   * is no offline/local generation option.
   */
  aiDjGenerationEnabled?: boolean;
  /** Which cloud vendor preset drives the "cloud" provider. Defaults to mureka. */
  musicCloudPreset?: CloudPresetId;
  musicCloudUrl?: string;
  musicCloudApiKey?: string;
  musicCloudModel?: string;
  /**
   * External streaming sources (NetEase / Bilibili / YouTube), per-source BYOK
   * config keyed by {@link StreamSourceId}. Off by default — the user opts in and
   * logs in per source in Settings. Cookies/tokens stay on-device (rule 2).
   */
  streamSources?: Partial<Record<StreamSourceId, StreamSourceConfig>>;
  /** The set that collects songs played from an online source via global search. */
  streamOnlineSetId?: string;
  /**
   * Auto-download streamed songs to a local blob after they play (offline cache,
   * Phase 5). On by default so online songs become available offline after play.
   * A visible Settings toggle (rule 3); cleared via "clear cache".
   */
  autoCacheStreamed?: boolean;
  /**
   * Maximum size for the automatic remote playback cache, in bytes. This is a
   * visible 1–10 GiB setting and does not affect permanent manual downloads.
   */
  playbackCacheMaxBytes?: number;
  // UI
  locale: "en" | "zh" | "ja" | "ko";
  /** Now-Playing background *priority*: prefer the track's own cover or its bound slideshow. Defaults to "cover". */
  backgroundMode?: BackgroundMode;
  /** How the resolved Now-Playing background image is rendered. Defaults to the noise renderer. */
  backgroundRenderer?: BackgroundRenderer;
  /** Pixel block size for the pixel background renderer. Default 12. */
  backgroundPixelSize?: number;
  /** Pixi background GPU backend. "auto" = WebGPU when supported, else WebGL. Default "auto". */
  backgroundGpuBackend?: "auto" | "webgpu" | "webgl";
  /** Pixi background GPU power preference. "auto" prefers high-performance. Default "auto". */
  backgroundGpuPowerPreference?: "auto" | "high-performance" | "low-power";
  /** ASCII renderer character color, used when replaceColor is on. Default #ffffff. */
  backgroundAsciiColor?: string;
  /** ASCII renderer replaces source colors with backgroundAsciiColor. Default false. */
  backgroundAsciiReplaceColor?: boolean;
  /** CRT renderer curvature. Default 0.54. */
  backgroundCrtCurvature?: number;
  /** CRT renderer scanline width. Default 4. */
  backgroundCrtLineWidth?: number;
  /** CRT renderer scanline contrast. Default 1. */
  backgroundCrtLineContrast?: number;
  /** CRT renderer line orientation. Default false (horizontal). */
  backgroundCrtVerticalLine?: boolean;
  /** CRT renderer scanline animation phase. Default 0. */
  backgroundCrtTime?: number;
  /** CRT renderer noise intensity, 0–1. Default 0.44. */
  backgroundCrtNoise?: number;
  /** CRT renderer noise particle size. Default 1. */
  backgroundCrtNoiseSize?: number;
  /** CRT renderer noise seed. Default 0.42. */
  backgroundCrtSeed?: number;
  /** CRT renderer vignette radius. Default 0.27. */
  backgroundCrtVignetting?: number;
  /** CRT renderer vignette opacity. Default 0.91. */
  backgroundCrtVignettingAlpha?: number;
  /** CRT renderer vignette blur. Default 0.62. */
  backgroundCrtVignettingBlur?: number;
  /** Dot renderer scale. Defaults to a value derived from backgroundPixelSize. */
  backgroundDotScale?: number;
  /** Dot renderer angle. Default 5. */
  backgroundDotAngle?: number;
  /** Dot renderer grayscale mode. Default false. */
  backgroundDotGrayscale?: boolean;
  /** Noise renderer amount, 0–1. Default 0.4. */
  backgroundNoiseAmount?: number;
  /** Noise renderer seed. Default 0.37. */
  backgroundNoiseSeed?: number;
  /** When a track has neither its own slideshow nor a cover, fall back to the global gallery slideshow. Default true. */
  backgroundGalleryFallback?: boolean;
  /** Auto-hide the header + dock on Now Playing after idle (immersive). Default true. */
  immersiveIdle?: boolean;
  /** Render covers using their stored crop (vs the full image). Default true. */
  coverCropped?: boolean;
  /** Now-Playing background blur radius in px. Default 64. */
  backgroundBlur?: number;
  /** Now-Playing background dim/mask opacity, 0–100. Default 25. */
  backgroundMaskOpacity?: number;
  /** backdrop-filter blur radius (px) on the dim/mask layer. Default 0 (off). */
  backgroundMaskBlur?: number;
  /** Slideshow auto-advance interval in seconds. Default 300 (5 min). */
  backgroundSlideshowIntervalSec?: number;
  /** Slideshow advances in random order vs sequential. Default true (random). */
  backgroundSlideshowShuffle?: boolean;
  /** Collapse the desktop Now-Playing right rail. Mobile queue overlay ignores this. Default false. */
  nowPlayingRightRailCollapsed?: boolean;
  /** Persisted scroll anchor for the collapsed Now-Playing memory timeline rail. Default 0. */
  nowPlayingMemoryRailScrollTop?: number;
  /** Now-Playing visualizer style. Defaults to "bars". */
  visualizerStyle?: VisualizerStyleId;
  /** Per-style visualizer tuning. Missing style entries fall back to legacy top-level visualizer tuning fields. */
  visualizerTuningByStyle?: Partial<Record<VisualizerStyleId, VisualizerStyleTuning>>;
  /** Overlay the visualizer on the full Now-Playing background image/slideshow. Default true. */
  visualizerAsBackground?: boolean;
  /** Dim/darken over the background visualizer, 0–100 (foreground legibility). Default 0. */
  visualizerBackgroundDim?: number;
  /** Opacity of the background visualizer layer, 0–100. Default 100. */
  visualizerBackgroundOpacity?: number;
  /** How the background visualizer (spectrum) blends with the layers below it
   *  (flow + background). CSS mix-blend-mode. Default "screen" (glow). */
  visualizerBlendMode?: FlowBlendMode;
  /** Dim over the background visualizer WHEN lyrics are shown over it. Default 40. */
  visualizerBgDimLyrics?: number;
  /** Opacity of the background visualizer WHEN lyrics are shown over it. Default 60. */
  visualizerBgOpacityLyrics?: number;
  /** Hide all Now-Playing foreground UI after idle, leaving only background + visualizer. Default false. */
  visualizerIdleOnly?: boolean;
  /** In idle-only mode, hide background/visual effects and keep only lyrics for OBS overlays. Default false. */
  visualizerLyricsOnlyIdle?: boolean;
  /** Surface memories as a top popover during full-immersive (idle-only) playback. Default true. */
  immersiveMemoryOverlay?: boolean;
  /** Mount the floating performance HUD in prod builds (dev always mounts it).
   *  Visible Settings switch for perf baselining — memory-perf-audit PRD Phase 1. Default false. */
  perfHudEnabled?: boolean;
  /** Prefer the current cover's extracted dominant color for visualizers. Default true. */
  visualizerUseCoverColor?: boolean;
  /** Flow background ("流光") color source: follow the cover palette, or a fixed custom set.
   *  When "cover" but the cover yields no palette, falls back to `flowCustomColors`. Default "cover". */
  flowColorSource?: FlowColorSource;
  /** Custom flow colors (hex, 2–5). Always kept — the fallback when no cover palette. */
  flowCustomColors?: string[];
  /** Flow effect variant (shader branch). Default "aurora-drift". */
  flowEffect?: FlowEffectId;
  /** Flow drift speed, 0–100. Default 40 (calm). */
  flowMotion?: number;
  /** Flow blob scale, 0–100. Default 50. */
  flowScale?: number;
  /** How much audio modulates the flow, 0–100 (0 = pure ambient). Default 20. */
  flowAudioReactivity?: number;
  /** Render the flow background as an INDEPENDENT layer — composited above the
   *  Now-Playing background image/video and below the visualizer spectrum (not
   *  mutually exclusive with the visualizer). Default true. */
  flowEnabled?: boolean;
  /** Opacity of the flow background layer, 0–100. Default 100. */
  flowOpacity?: number;
  /** Dim over the flow background layer, 0–100. Default 0. */
  flowDim?: number;
  /** How the flow layer blends with the background below it. Default "screen". */
  flowBlendMode?: FlowBlendMode;
  /** Override analyser FFT size for the active visualizer. Defaults to style metadata. */
  visualizerFftSize?: 256 | 512 | 1024 | 2048;
  /** Override analyser smoothing, 0–0.99. Defaults to style metadata. */
  visualizerSmoothing?: number;
  /** Override analyser min decibels. Defaults to style metadata. */
  visualizerMinDecibels?: number;
  /** Override analyser max decibels. Defaults to style metadata. */
  visualizerMaxDecibels?: number;
  /** Visualizer amplitude/audio response multiplier. Default 1. */
  visualizerIntensity?: number;
  /** Visualizer motion/speed multiplier. Default 1. */
  visualizerMotion?: number;
  /** Visualizer detail/count/segment multiplier. Default 8 (24 octave bands for bars). */
  visualizerDetail?: number;
  /** Visualizer radius/gap/spread multiplier. Default 0.35. */
  visualizerSpread?: number;
  /** Visualizer mirror/reflection multiplier. Default 1. */
  visualizerMirror?: number;
  // --- Synced-lyrics appearance (synced-lyrics PRD) --------------------------
  /** Active (current) lyric line font size in px. Default 24. */
  lyricsActiveFontSize?: number;
  /** Inactive lyric line font size in px. Default 20. */
  lyricsInactiveFontSize?: number;
  /** Active lyric line opacity, 0–100. Default 100. */
  lyricsActiveOpacity?: number;
  /** Inactive lyric line opacity, 0–100. Default 40. */
  lyricsInactiveOpacity?: number;
  /** Lyric text color source. "default" = theme foreground. Default "default". */
  lyricsColorMode?: "default" | "cover" | "custom";
  /** Custom lyric color (hex) when `lyricsColorMode === "custom"`. */
  lyricsCustomColor?: string;
  /** Cover-derived lyric color saturation, 0–200. Default 100. */
  lyricsCoverColorSaturation?: number;
  /** Cover-derived lyric color brightness, 0–200. Default auto: 150 dark / 50 light. */
  lyricsCoverColorBrightness?: number;
  /** Cover-derived lyric color contrast, 0–200. Default 100. */
  lyricsCoverColorContrast?: number;
  /** Lyric line alignment (the widescreen "pure lyrics" mode especially). Default "left". */
  lyricsAlign?: "left" | "center" | "right";
  /**
   * Per-syllable karaoke fill: when the active line has word-level timing
   * (Enhanced LRC / yrc / qrc), wipe each word as it's sung instead of just
   * highlighting the whole line. No effect on line-level lyrics. Default true.
   */
  lyricsWordByWord?: boolean;
  /** Show a translation sub-line under each lyric line, when the source has one. Default true. */
  lyricsShowTranslation?: boolean;
  /** Show a romanization sub-line under each lyric line, when the source has one. Default false. */
  lyricsShowRomanization?: boolean;
  /**
   * Synced-lyrics motion mode. `undefined` = "classic" (current stable follow).
   * "inertial" adds spring-follow scrolling; "cascade" adds Apple-Music-like
   * neighbor delay. Reduced motion resolves to the low-motion classic behavior.
   */
  lyricsMotionMode?: "classic" | "inertial" | "cascade";
  /** Cascade active-line anchor in viewport percent, 25–60. Default 42. */
  lyricsCascadeAnchorPct?: number;
  /** Cascade per-row follow delay in ms, 0–140. Default 52. */
  lyricsCascadeDelayMs?: number;
  /** Cascade maximum inactive-line blur in px, 0–8. Default 4.2. */
  lyricsCascadeBlurPx?: number;
  /** Legacy mirror for the lyrics/memory rail toggle; layout is driven by nowPlayingRightRailCollapsed. */
  lyricsStageOpen?: boolean;
  /** Lyric text-shadow strength, 0–100 (0 = no shadow). Default 35. */
  lyricsShadowOpacity?: number;
  /** Lyric text-shadow blur radius in px. Default 8. */
  lyricsShadowBlur?: number;
  /** Lyric text-shadow X offset in px. Default 0. */
  lyricsShadowOffsetX?: number;
  /** Lyric text-shadow Y offset in px. Default 2. */
  lyricsShadowOffsetY?: number;
  /** Vertical gap between lyric lines, in px. Default 8. */
  lyricsLineGap?: number;
  /** Lyric text outline (stroke) width in px, 0–12 (0 = no outline). Default 0. */
  lyricsStrokeWidth?: number;
  /** Outline color source. "custom" = the hex below; "cover" = the visualizer's cover color. Default "custom". */
  lyricsStrokeColorMode?: "custom" | "cover";
  /** Lyric text outline color (hex) when `lyricsStrokeColorMode === "custom"`. Default "#000000". */
  lyricsStrokeColor?: string;
  /** Lyric text outline opacity, 0–100. Default 100. */
  lyricsStrokeOpacity?: number;
  /**
   * Smooth scrolling (Lenis) master toggle. `undefined` = off. The OS
   * reduced-motion setting does not override this explicit MUZERO preference.
   */
  smoothScroll?: boolean;
  /**
   * Smooth-scroll strength (Lenis `lerp`). `undefined` = 0.10. Clamped to
   * [0.04, 0.20] at read time: lower = floatier/slower, higher = snappier.
   */
  smoothScrollLerp?: number;
  /** Global color scheme. Mirrors localStorage `muzero-theme`; defaults to dark. */
  theme?: "light" | "dark" | "system";
  /**
   * Which alternate desktop app icon to show (Electron only) — swaps the running
   * dock/taskbar icon and browser favicon. Defaults to "light". See
   * {@link AppIconId} + use-app-icon.ts.
   */
  appIcon?: AppIconId;
  /** Electron frameless-window corner radius in px. */
  electronWindowRadius?: number;
  /** Electron frameless-window border width in px. */
  electronWindowBorderWidth?: number;
  /** Electron frameless-window border color source. */
  electronWindowBorderColorMode?: "cover" | "custom";
  /** Electron frameless-window border color as hex. */
  electronWindowBorderColor?: string;
  /** Electron frameless-window border opacity, 0–100. */
  electronWindowBorderOpacity?: number;
  /** Album/square cover corner radius in px. Artist/avatar circles stay round. */
  albumCoverRadius?: number;
  /** Album/square cover shadow opacity, 0–100. Default 55. */
  albumCoverShadowOpacity?: number;
  /** Album/square cover shadow blur radius in px. Default 16. */
  albumCoverShadowBlur?: number;
  /** Album/square cover shadow X offset in px. Default 0. */
  albumCoverShadowOffsetX?: number;
  /** Album/square cover shadow Y offset in px. Default 4. */
  albumCoverShadowOffsetY?: number;
  /** Now Playing large-cover light effect. Other square covers keep albumCoverShadow. Default "shadow". */
  nowPlayingCoverEffectMode?: NowPlayingCoverEffectMode;
  /** Now Playing cover backlight opacity, 0–100. Default 50. */
  nowPlayingCoverBacklightOpacity?: number;
  /** Now Playing cover backlight outward range in percent. Default 13. */
  nowPlayingCoverBacklightRange?: number;
  /** Now Playing cover backlight blur radius in px. Default 12. */
  nowPlayingCoverBacklightBlur?: number;
  /** Now Playing cover backlight saturation, 100–600 percent. Default 330. */
  nowPlayingCoverBacklightSaturation?: number;
  /** Desktop always-on-top preference. Click-through is session-only and not persisted. */
  desktopWindowPinMode?: "off" | "pin";
  /** Primary/accent color (hex) for light mode. Mirrors localStorage `muzero-primary-light`. */
  primaryLight?: string;
  /** Primary/accent color (hex) for dark mode. Mirrors localStorage `muzero-primary-dark`. */
  primaryDark?: string;
  /** UI font-family stack. Mirrors localStorage `muzero-font`; unset = system default. */
  fontFamily?: string;
  /** Persisted resume point: last active session + index. */
  lastSessionId?: string;
  lastTrackIndex?: number;
  /** Persisted global transport toggles. */
  playerRepeatMode?: "off" | "one" | "all";
  playerShuffle?: boolean;
  /** Persisted playback volume (0–1). */
  playerVolume?: number;
  /** Persisted resume pointer for the AI DJ chat runtime. */
  lastChatSessionId?: string;
  /** Local Electron loopback intake for Social Stream Ninja / OBS audience requests. */
  audienceRequestIntake?: AudienceRequestIntakeSettings;
  /** Global default chat/DJ model preset. Keys stay in apiKeysByPresetId. */
  defaultLlmProviderPresetId?: LlmProviderPresetId;
  defaultLlmModel?: string;
  /** BYOK keys by visible provider preset id. Device-local only. */
  apiKeysByPresetId?: Partial<Record<LlmProviderPresetId, string>>;
  /** Last selected model per provider preset, restored when switching back (ClipCombo parity). */
  modelsByPresetId?: Partial<Record<LlmProviderPresetId, string>>;
  /** Max output tokens per DJ-chat generation step. Higher = longer replies / less
   * truncation on multi-step tool runs; costs more. Defaults to 32000 when unset. */
  chatMaxOutputTokens?: number;
  /** Context-window ceiling (tokens) the DJ chat warns/blocks at. Raise it for
   * big-context models so long chats aren't blocked early. Defaults to 128000. */
  chatMaxContextTokens?: number;
  /** Default selected cloud drive. R2 credentials remain device-local settings, never synced. */
  defaultCloudDriveId?: string;
  /** R2 write credentials by local drive id. Device-local only; never exported to manifests. */
  r2CredentialsByDriveId?: Record<string, R2LocalCredentials>;
  /** Optional low-frequency trusted-device presence. Off by default. */
  presenceEnabled?: boolean;
  /** Remembered local folders to incrementally re-sync on launch (desktop only). */
  importFolders?: ImportFolder[];
  /**
   * User keyboard-shortcut overrides, keyed by stable action id (codename layer,
   * hard rule #4). Sparse: only changed actions appear; `[]` = explicitly unbound
   * (vs absent → built-in default). Device-local, never synced. See the
   * configurable-keyboard-shortcuts PRD.
   */
  shortcutOverrides?: Record<string, ScopedShortcutBinding[]>;
  /** OS-level Electron global shortcuts. Disabled by default; separate from in-app `global` scope. */
  systemShortcutsEnabled?: boolean;
  systemShortcutBindings?: Partial<Record<SystemGlobalShortcutActionId, SystemShortcutBinding>>;
  /**
   * Auto-fetch lyrics for uploaded/streamed tracks (synced-lyrics PRD). Sends
   * title/artist to the visible lyrics source(s) selected below; default on.
   * Generated tracks use their own brief.lyrics and never fetch.
   */
  autoFetchLyrics?: boolean;
  /**
   * Which lyrics source strategy to use (visible Settings dropdown, rule 3).
   * Default `auto` tries suitable sources in order. Streamed NetEase tracks with
   * a concrete source choice still use an exact NetEase/AMLL path because their
   * songId identifies the official lyrics — see `resolveLyricsProviderForTrack`.
   */
  lyricsProviderId?: LyricsProviderId;
}

/**
 * A local folder the user asked MUZERO to watch. On desktop launch each remembered
 * folder is re-scanned and any media file not already in the library (by absolute
 * {@link Track.sourcePath}) is imported into the bound set. Device-local; never synced.
 */
export interface ImportFolder {
  /** `imf_…` */
  id: string;
  /** Absolute folder path on disk. */
  path: string;
  /** The {@link DjSession} new files are imported into. */
  setId: string;
  /** Folder basename, shown in Settings. */
  displayName?: string;
  /** Whether sync scans nested folders. Defaults to true for existing entries. */
  recursive?: boolean;
  /** Epoch ms of the most recent successful scan. */
  lastScanAt?: number;
  /** Files imported on the most recent scan (UI hint). */
  lastImportedCount?: number;
}

/**
 * Fetched or manual lyrics for a track (1:1 via trackId). Kept in its own table
 * — NOT on the Track row — because LRC text is KB-scale and would otherwise ride
 * every virtualized list query (rule 6). `status` doubles as a negative cache
 * ("notFound" → don't re-hit the API). See the synced-lyrics PRD.
 */
export interface TrackLyrics extends LyricsRecord {
  /** `lyr_…` */
  id: string;
  trackId: string;
  /** Which record the provider matched (debug / correction). */
  matched?: { trackName: string; artistName: string; durationSec: number };
  fetchedAt: number;
}

/** One model exposed by a user-defined LLM endpoint. */
export interface CustomLlmModel {
  id: string;
  label?: string;
}

/**
 * A user-defined OpenAI-compatible LLM provider (ClipCombo parity): arbitrary
 * baseURL + its own model list, addressed as `custom:<uuid>` alongside the
 * built-in presets. Keys still live in `AppSettings.apiKeysByPresetId` (and may
 * be absent — local endpoints run keyless). Stored in `llmCustomProviders`.
 */
export interface CustomLlmProvider {
  /** `custom:<uuid>` — the dynamic-custom id namespace (codename-stable). */
  id: `custom:${string}`;
  label: string;
  baseUrl: string;
  models: CustomLlmModel[];
  createdAt: number;
  updatedAt: number;
}

/** Per-visualizer-style tuning memory. Additive settings shape; legacy top-level
 *  `visualizer*` tuning fields remain fallback values for existing users. */
export interface VisualizerStyleTuning {
  fftSize?: 256 | 512 | 1024 | 2048;
  smoothing?: number;
  minDecibels?: number;
  maxDecibels?: number;
  intensity?: number;
  motion?: number;
  detail?: number;
  spread?: number;
  mirror?: number;
  backgroundOpacity?: number;
  backgroundDim?: number;
  bgOpacityLyrics?: number;
  bgDimLyrics?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  musicGenProvider: "mock",
  musicCloudPreset: "mureka",
  locale: "en",
  autoFetchLyrics: true,
  autoCacheStreamed: true,
  lyricsProviderId: "auto",
  theme: "dark",
  appIcon: "dark",
  electronWindowRadius: 12,
  electronWindowBorderWidth: 6,
  electronWindowBorderColorMode: "cover",
  electronWindowBorderColor: "#ffffff",
  electronWindowBorderOpacity: 10,
  albumCoverRadius: 12,
  albumCoverShadowOpacity: 55,
  albumCoverShadowBlur: 16,
  albumCoverShadowOffsetX: 0,
  albumCoverShadowOffsetY: 4,
  nowPlayingCoverEffectMode: "shadow",
  nowPlayingCoverBacklightOpacity: 50,
  nowPlayingCoverBacklightRange: 13,
  nowPlayingCoverBacklightBlur: 12,
  nowPlayingCoverBacklightSaturation: 330,
  desktopWindowPinMode: "off",
  backgroundMode: "cover",
  backgroundRenderer: "noise",
  backgroundPixelSize: 12,
  backgroundGpuBackend: "auto",
  backgroundGpuPowerPreference: "auto",
  backgroundAsciiColor: "#ffffff",
  backgroundAsciiReplaceColor: false,
  backgroundCrtCurvature: 0.54,
  backgroundCrtLineWidth: 4,
  backgroundCrtLineContrast: 1,
  backgroundCrtVerticalLine: false,
  backgroundCrtTime: 0,
  backgroundCrtNoise: 0.44,
  backgroundCrtNoiseSize: 1,
  backgroundCrtSeed: 0.42,
  backgroundCrtVignetting: 0.27,
  backgroundCrtVignettingAlpha: 0.91,
  backgroundCrtVignettingBlur: 0.62,
  backgroundDotAngle: 5,
  backgroundDotGrayscale: false,
  backgroundNoiseAmount: 0.4,
  backgroundNoiseSeed: 0.37,
  backgroundGalleryFallback: true,
  immersiveIdle: true,
  coverCropped: true,
  backgroundBlur: 64,
  backgroundMaskOpacity: 25,
  backgroundMaskBlur: 0,
  backgroundSlideshowIntervalSec: 300,
  backgroundSlideshowShuffle: true,
  nowPlayingRightRailCollapsed: false,
  nowPlayingMemoryRailScrollTop: 0,
  visualizerStyle: "bars",
  visualizerAsBackground: true,
  visualizerBackgroundDim: 30,
  visualizerBackgroundOpacity: 70,
  visualizerBgDimLyrics: 30,
  visualizerBgOpacityLyrics: 70,
  visualizerIdleOnly: false,
  visualizerLyricsOnlyIdle: false,
  immersiveMemoryOverlay: true,
  visualizerUseCoverColor: true,
  visualizerIntensity: 1,
  visualizerMotion: 1,
  visualizerDetail: 8,
  visualizerSpread: 0.35,
  visualizerMirror: 1,
  flowEnabled: true,
  lyricsActiveFontSize: 30,
  lyricsInactiveFontSize: 24,
  lyricsActiveOpacity: 100,
  lyricsInactiveOpacity: 40,
  lyricsColorMode: "default",
  lyricsAlign: "center",
  lyricsWordByWord: true,
  lyricsShowTranslation: true,
  lyricsShowRomanization: false,
  lyricsMotionMode: "classic",
  lyricsCascadeAnchorPct: 42,
  lyricsCascadeDelayMs: 52,
  lyricsCascadeBlurPx: 4.2,
  lyricsStageOpen: false,
  lyricsShadowOpacity: 50,
  lyricsShadowBlur: 8,
  lyricsLineGap: 8,
  lyricsShadowOffsetX: 0,
  lyricsShadowOffsetY: 2,
  lyricsStrokeWidth: 0,
  lyricsStrokeColorMode: "custom",
  lyricsStrokeColor: "#000000",
  lyricsStrokeOpacity: 100,
  playerRepeatMode: "all",
  playerShuffle: false,
  playerVolume: 0.9,
  systemShortcutsEnabled: false,
  systemShortcutBindings: {},
  audienceRequestIntake: DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  presenceEnabled: false,
};

export interface RemoteSearchCatalog {
  id: string;
  driveId: string;
  shareId?: string;
  scope: "library" | "share";
  sourceUrl: string;
  updatedAt: number;
  syncedAt: number;
  setCount: number;
  trackCount: number;
  pageVersions?: Record<string, string>;
}

export interface RemoteSearchTrack {
  id: string;
  catalogId: string;
  driveId: string;
  shareId?: string;
  trackId: string;
  title: string;
  normalizedText: string;
  setIds: string[];
  shareIds: string[];
  tags: string[];
  mediaMetadata?: TrackMediaMetadata;
  kind: TrackKind;
  origin: TrackOrigin;
  durationSec: number;
  coverUrl?: string;
  mediaAvailable: boolean;
  updatedAt: number;
}

export interface RemoteSearchSet {
  id: string;
  catalogId: string;
  driveId: string;
  shareId?: string;
  setId: string;
  name: string;
  description?: string;
  normalizedText: string;
  trackCount: number;
  coverUrl?: string;
  updatedAt: number;
}

export interface CloudDriveCapabilities {
  read: boolean;
  write: boolean;
  manageInvites: boolean;
  writeStats: boolean;
  writePresence: boolean;
}

export type CloudDriveAutoSyncFrequency =
  | "manual"
  | "app-start"
  | "change-debounce"
  | "15min"
  | "30min"
  | "60min";

export type CloudDriveUploadConcurrency = 1 | 2 | 3;
export type CloudDriveAutoSyncPauseReason =
  | "needs-review"
  | "failed"
  | "cancelled"
  | "auth"
  | "network";

export interface R2LocalCredentials {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix?: string;
  endpointUrl?: string;
}

export interface CloudDrive {
  id: string;
  label: string;
  kind: "owned" | "trusted" | "shared" | "local-only";
  provider: "r2" | "mu0";
  publicBaseUrl?: string;
  manifestUrl?: string;
  apiBaseUrl?: string;
  capabilities: CloudDriveCapabilities;
  /** Visible per-drive scheduler choice. Defaults to manual; never hidden behind flags. */
  autoSyncFrequency?: CloudDriveAutoSyncFrequency;
  /** Max parallel immutable-object uploads. Mutable JSON still writes ordered. Defaults to 2. */
  uploadConcurrency?: CloudDriveUploadConcurrency;
  /** When set, automatic sync is paused until the user manually retries or changes settings. */
  autoSyncPausedAt?: number;
  autoSyncPauseReason?: CloudDriveAutoSyncPauseReason;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
}

export interface CloudShare {
  id: string;
  driveId: string;
  remoteShareId: string;
  label: string;
  sourceOwnerName?: string;
  manifestUrl: string;
  access: "read-only" | "stats" | "presence" | "collaborator" | "owner";
  addedAt: number;
  lastSyncedAt?: number;
}

export type SyncDirection = "push" | "pull";
export type SyncRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface SyncRun {
  id: string;
  driveId: string;
  direction: SyncDirection;
  status: SyncRunStatus;
  startedAt: number;
  finishedAt?: number;
  totalBytes: number;
  bytesDone: number;
  objectCount: number;
  uploaded: number;
  skipped: number;
  failed: number;
  error?: string;
}

export interface SyncObject {
  id: string;
  driveId: string;
  key: string;
  kind: string;
  contentType: string;
  bytes: number;
  sha256?: string;
  sourceSetId?: string;
  sourceTrackId?: string;
  sourceMemoryId?: string;
  lastUploadedAt?: number;
  lastUploadedRunId?: string;
  lastSeenAt?: number;
  updatedAt: number;
}

export interface SyncMutation {
  id: string;
  driveId: string;
  devicePublicId: string;
  // "entity-cover" is reserved for derived artist/album cover edits (entityId =
  // projection key). Recording is deferred along with the rest of the not-yet-wired
  // edit→mutation path; today entity covers sync via full re-export + LWW on import.
  scope: "set" | "track" | "memory" | "profile" | "stats" | "entity-cover";
  entityId: string;
  action:
    | "set-metadata-updated"
    | "track-added-to-set"
    | "track-removed-from-set"
    | "track-metadata-updated"
    | "memory-added"
    | "memory-updated"
    | "memory-removed"
    | "profile-updated"
    | "stats-segment-published";
  base?: {
    remoteKey: string;
    etag?: string;
    revision?: number;
    updatedAt?: number;
  };
  payload: unknown;
  createdAt: number;
  syncedAt?: number;
}

export interface DeviceRecord {
  id: string;
  publicId: string;
  name: string;
  avatarSeed?: string;
  avatarBlobId?: string;
  platform: "browser" | "tauri" | "electron";
  userAgent?: string;
  os?: string;
  appVersion: string;
  localSigningSecret?: string;
  publishProfile: boolean;
  profileRevision: number;
  createdAt: number;
  lastSeenAt: number;
}

export interface DevicePublicProfile {
  schema: "muzero-r2-device-profile-v1";
  devicePublicId: string;
  displayName: string;
  avatarSeed?: string;
  avatar?: {
    url: string;
    mime: string;
    bytes: number;
    sha256?: string;
  };
  appVersion?: string;
  revision: number;
  updatedAt: number;
}

export interface MemoryAuthorRef {
  devicePublicId: string;
  displayName?: string;
  avatarSeed?: string;
  avatarUrl?: string;
}

export interface TrackPlaybackStats {
  id: string;
  devicePublicId: string;
  trackId: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
  updatedAt: number;
}

/**
 * The "liked" bit moved OFF the cold `tracks` catalog row into this high-churn side
 * table (mirrors `trackPlaybackStats` for playCount): toggling a like writes here, so
 * it no longer re-fires every `tracks` liveQuery (the play-queue's getTracksByIds(N) +
 * the search全表 listAllTracks) — the fan-out that tanked FPS on big queues. Row
 * presence = liked; un-liking deletes the row (PRD 20260617-scalable-track-list).
 */
export interface TrackLike {
  /** PK = trackId (1:1 with a track; presence means liked). */
  trackId: string;
  likedAt: number;
}

export interface PlaybackEvent {
  id: string;
  devicePublicId: string;
  trackId?: string;
  remoteTrackRef?: {
    driveId: string;
    shareId?: string;
    setId?: string;
    trackId: string;
    mediaSha256?: string;
  };
  context: {
    source: "local" | "owned-drive" | "shared-drive" | "share";
    driveId?: string;
    shareId?: string;
    setId?: string;
    queueEntryId?: string;
  };
  startedAt: number;
  endedAt?: number;
  listenedSec: number;
  countedAsPlay: boolean;
}

export interface PlaybackAggregate {
  id: string;
  devicePublicId: string;
  scope: "track" | "track-in-set" | "track-in-share" | "set" | "share" | "drive";
  driveId?: string;
  shareId?: string;
  setId?: string;
  trackId?: string;
  remoteTrackId?: string;
  mediaSha256?: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
  updatedAt: number;
}
