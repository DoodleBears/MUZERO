# PRD: MUZERO Structured Diagnostics Trace

**Status:** Draft
**Created:** 2026-06-11
**Author:** Codex
**Module:** Diagnostics / Logging / Settings Trace

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Audit, Taxonomy, Redaction Contract | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Shared Structured Logger API | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Playback / Stream Trace Migration | Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings Trace Workbench | Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Electron Main Process Bridge | Completed | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Local Trace Archive / File Export | Completed | [Phase 6 Checklist](#phase-6-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has local trace diagnostics:

- `src/lib/logger.ts` is the official renderer logger. It writes to `traceEvent()` and currently mirrors some entries to `console.*` according to level and build mode.
- `src/lib/trace.ts` stores an in-memory 300-entry ring buffer and formats it for copy.
- `src/pages/settings-page.tsx` exposes Settings > Advanced > Trace, with copy and clear controls.
- `src/components/shell/trace-recorder.tsx` captures app mount, window errors, unhandled rejections, document visibility changes, and coarse player state changes.

Recent external streaming debugging exposed the current gap. A user can paste console logs such as `youtube PoToken minted`, `youtube resolved`, `media 403`, and `MEDIA_ERR_SRC_NOT_SUPPORTED`, but the logs are still hard to correlate across:

- user action: playlist/search row click
- player queue resolution
- stream source resolution
- YouTube PoToken minting and `getInfo`
- download or media proxy fetch
- media element load/play failure
- cache prefetch
- Electron main-process proxy behavior

The current trace entries are mostly free-form `scope + message + data`. They are useful but not yet a product-grade diagnostic contract. The goal of this PRD is to turn Settings Trace into the first support/debugging surface: the user reproduces an issue, clicks "Copy trace", pastes it back, and the log has enough structured context to answer "where did this fail?" without requesting a second round of ad hoc instrumentation.

Console output must not be the support contract. DevTools console can remain a development mirror and emergency fallback, but product diagnostics should be visible, copyable, searchable, and optionally exportable from Settings.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| MUZERO user | Reproduces local playback, streaming, sync, or settings issues | Can copy and clear local trace from Settings |
| Developer / support | Reads pasted trace and maps it to code paths quickly | No access to user device unless user shares trace |
| Future tester | Uses trace output as regression evidence during manual QA | Can compare expected event sequence and error kind |

### 1.3 Core Value

1. **One pasted trace is actionable**: every important playback/stream failure carries a stable `traceId`, category, phase, and redacted technical details.
2. **Logs are comparable across bugs**: scopes, event names, error kinds, and metadata keys are standardized instead of being one-off strings.
3. **Privacy stays local-first**: trace is local, opt-in to copy, and redacted by default. No telemetry, no backend upload, no hidden remote flags.
4. **Renderer and shell logs meet**: Electron main-process media proxy failures can appear in the same diagnostic bundle as renderer playback events.

---

## 2. System Architecture

### 2.1 Architecture Overview

```text
User action
  |
  v
shared diagnostic context
  traceId / spanId / operation / source
  |
  +--> renderer structured logger
  |      src/lib/logger.ts
  |      src/lib/trace.ts
  |      player / streamsrc / sync / lyrics / chat
  |
  +--> platform fetch wrappers
  |      src/lib/platform.ts
  |      src/streamsrc/stream-http.ts
  |      src/lib/desktop/electron.ts
  |
  +--> Electron main diagnostics
         electron/fetch-proxy.cjs
         media proxy / generic proxy / status / range

All entries
  |
  v
local trace buffer / optional local persistence
  |
  +--> optional local archive files
  |      user-visible export / rotate / clear
  |
  v
Settings > Advanced > Trace
  filter, group, copy, clear, export, diagnostics bundle
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Renderer logger | Existing `src/lib/logger.ts` | Preserve hard rule: `src/**` does not call `console.*` directly |
| Trace store | Existing `src/lib/trace.ts`, then optional Dexie ring buffer | Keep current in-memory behavior first; add persistence only behind visible Settings control |
| Settings UI | Existing `src/pages/settings-page.tsx` TraceDiagnostics | The product already exposes trace copy/clear in Settings |
| Platform HTTP | Existing `getAppFetch()`, `stream-http`, Electron proxy | HTTP diagnostics must be emitted at the boundary where status, headers, range, and host are visible |
| Electron shell | `electron/fetch-proxy.cjs` plus IPC bridge | Main-process media fetch failures currently log to terminal only and need to join trace |
| Local archive | Electron app data / user-selected export file | Support longer sessions without relying on DevTools console; still local and user-controlled |
| Tests | Vitest + fake fetch / fake IndexedDB | Validate redaction, event schema, and streaming failure sequences |

### 2.3 Project Structure

```text
src/
├── lib/
│   ├── logger.ts                 # existing leveled logger; becomes structured logger facade
│   ├── trace.ts                  # existing ring buffer; gains event schema, formatters, filtering
│   ├── diagnostics.ts            # proposed shared types/helpers if logger.ts grows too large
│   └── desktop/electron.ts       # renderer bridge for Electron diagnostics
├── components/shell/
│   └── trace-recorder.tsx        # global browser/player trace hooks
├── pages/
│   └── settings-page.tsx         # TraceDiagnostics workbench
├── streamsrc/
│   ├── stream-http.ts            # header aliasing + request diagnostics
│   └── youtube/                  # YouTube token / resolve / download diagnostics
├── player/
│   └── media-engine.ts           # media element load/play/error diagnostics
└── stores/
    └── player-store.ts           # playback operation context and queue diagnostics

electron/
└── fetch-proxy.cjs               # main-process proxy diagnostics source
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```text
TraceEntry
  id
  at
  level
  scope
  event
  message
  context
    traceId
    spanId
    parentSpanId
    operation
    phase
    category
    errorKind
    source
    entities
    network
    media
    redactions
```

### 3.2 Trace Event Schema

This PRD extends the current `TraceEntry` shape in `src/lib/trace.ts`. The exact TypeScript may be adjusted during implementation, but these fields are the product contract.

```typescript
export type DiagnosticLevel = "debug" | "info" | "warn" | "error";

export type DiagnosticSource = "renderer" | "electron-main" | "tauri" | "web";

export type DiagnosticCategory =
  | "user-action"
  | "state"
  | "network"
  | "stream"
  | "media"
  | "cache"
  | "sync"
  | "db"
  | "provider"
  | "auth"
  | "performance"
  | "app";

export type DiagnosticPhase =
  | "start"
  | "success"
  | "retry"
  | "fail"
  | "abort"
  | "skip"
  | "state";

export type DiagnosticErrorKind =
  | "http_status"
  | "network_error"
  | "timeout"
  | "media_decode"
  | "unsupported_source"
  | "auth_required"
  | "permission_denied"
  | "po_token"
  | "schema"
  | "db"
  | "unknown";

export interface DiagnosticContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  operation?: string;
  phase?: DiagnosticPhase;
  category?: DiagnosticCategory;
  errorKind?: DiagnosticErrorKind;
  source?: DiagnosticSource;
  durationMs?: number;
  trackId?: string;
  sessionId?: string;
  sourceId?: string;
  videoId?: string;
  requestHost?: string;
  requestPathHash?: string;
  httpStatus?: number;
  contentType?: string;
  range?: string | null;
  acceptRanges?: string | null;
  bytes?: number;
  mime?: string;
  mediaReadyState?: number;
  mediaNetworkState?: number;
  retryCount?: number;
  route?: string;
  uiSurface?: string;
  controlId?: string;
  actionKind?: "click" | "submit" | "change" | "keyboard" | "drag" | "drop" | "paste" | "navigation";
  inputKind?: "text" | "file" | "media" | "toggle" | "select" | "slider";
  redactions?: string[];
}
```

### 3.3 Event Classes and Filtering

Trace must support fast filtering by event class, not only by free-text search.

Primary filters:

| Filter | Values | Purpose |
|--------|--------|---------|
| Level | `debug`, `info`, `warn`, `error` | Separate noisy detail from actionable failure |
| Category | `user-action`, `state`, `network`, `stream`, `media`, `cache`, `sync`, `db`, `provider`, `auth`, `performance`, `app` | Jump to the subsystem or event type |
| Phase | `start`, `success`, `retry`, `fail`, `abort`, `skip`, `state` | Follow an operation timeline |
| Error kind | `http_status`, `network_error`, `timeout`, `media_decode`, `unsupported_source`, `auth_required`, `permission_denied`, `po_token`, `schema`, `db`, `unknown` | Identify root failure class |
| Source | `renderer`, `electron-main`, `tauri`, `web` | Distinguish UI and shell-layer events |
| Trace id | `ply_*`, `sync_*`, etc. | Reconstruct a single user journey |
| Entity ids | `trackId`, `sessionId`, `sourceId`, `videoId` | Narrow logs to the affected object |

Settings Trace V1 must expose level/category/error-kind/search filters. V2 adds grouped timeline filters for `traceId`, `trackId`, and `sessionId`.

### 3.4 User Action Events

User operations are first-class trace events because they are the quickest way to reproduce a bug.

Required user-action shape:

```typescript
logger.info("play.click", {
  message: "track play clicked",
  category: "user-action",
  phase: "start",
  traceId,
  route: "search",
  uiSurface: "track-row",
  controlId: "track.play",
  actionKind: "click",
  trackId,
  sessionId,
});
```

Capture by default:

- playback actions: play, pause, seek, next, previous, repeat/shuffle, queue item click
- navigation actions: tab change, Settings section change, Now Playing open/close
- stream actions: search submit, source chip select, playlist import click, login/logout source action
- settings actions: save provider settings, change trace filters, copy/export/clear trace
- media ingest actions: upload, paste, drop, import result
- sync actions: connect drive, test connection, publish, pull, resolve conflict

Privacy rules:

- Record action type, route, control id, and safe local ids.
- Do not record raw search query, typed text, note content, lyrics, chat message text, prompt text, file names, clipboard text, or URL text.
- For text inputs, record only `inputKind`, length bucket, and whether the value changed if needed for reproduction.
- For file/media inputs, record count, MIME bucket, and total size bucket, not file names or bytes.

### 3.5 Scope and Event Naming

Scopes use dot-separated ownership. Events use dot-separated action names. The scope answers "which subsystem owns this event?" The event answers "what happened?"

| Scope | Examples | Owner |
|-------|----------|-------|
| `app` | `mounted`, `visibility.changed` | shell |
| `player.queue` | `track.selected`, `index.resolved` | player store |
| `player.media` | `load.start`, `play.requested`, `error` | media engine |
| `stream.resolve` | `source.selected`, `source.unavailable` | stream resolver |
| `stream.youtube` | `token.minted`, `info.resolved`, `download.failed` | YouTube source |
| `stream.proxy` | `request.start`, `request.failed`, `response.received` | stream HTTP / media proxy |
| `sync.r2` | `publish.start`, `pull.failed` | sync store |
| `lyrics.lrclib` | `search.failed`, `parse.failed` | lyrics auto-fetch |
| `chat.runtime` | `tool.failed`, `stream.aborted` | DJ chat |
| `ui.action` | `play.click`, `settings.section.changed` | user action recorder |
| `settings.trace` | `copy`, `clear`, `filter.changed` | Settings trace UI |

Required format:

```text
scope=<domain.subdomain>
event=<noun.verb or operation.phase>
message=<short human-readable fallback>
context=<structured DiagnosticContext>
```

### 3.6 Correlation Contract

Every user-initiated playback attempt must create or reuse one `traceId`.

Minimum playback chain:

1. `player.queue track.play_clicked` or equivalent user action event
2. `player.queue track.selected`
3. `stream.resolve start`
4. source-specific resolve events such as `stream.youtube token.minted`
5. `stream.youtube download.start` or `stream.proxy request.start`
6. `player.media load.start`
7. either `player.media play.success` or `player.media error`
8. optional `stream.cache start/success/fail`

If a later event has `trackId` but no `traceId`, implementation must attempt to recover the active track's current playback `traceId` from player store/module scope. A missing `traceId` in the playback chain is a test failure for migrated paths.

### 3.7 Privacy, Redaction, Retention

MUZERO remains local-first and no-telemetry.

Trace must never include:

- BYOK API keys
- `Authorization` headers
- cookies or session tokens
- provider raw responses containing prompt, lyrics, notes, chat contents, or user file names
- raw user input such as search query, note text, chat message, prompt text, pasted text, or file names
- audio/video/cover bytes
- full signed media URLs
- Googlevideo query params such as `pot`, `sig`, `lsig`, `spc`, `bui`, `id`, `n`, `cpn`
- R2 credentials, bucket secrets, S3 access keys, or signed upload URLs

Trace may include, when useful for diagnosis:

- scope, event, level, phase, category, and error kind
- local `trackId` / `sessionId`
- source id such as `youtube`, `bilibili`, `netease`
- external opaque ids needed for debugging such as YouTube `videoId`, as long as Settings copy labels trace as user-shared local diagnostics
- request host
- sanitized path hash
- HTTP status, content type, range, accept-ranges, byte count, duration
- media element ready/network state and error code
- token length, never token value
- user action route/control/action kind
- input length/count/size buckets when useful, never raw input content

Retention:

- V1 keeps current in-memory ring behavior but increases usefulness through structure.
- V2 adds a local archive strategy for longer repro sessions. This may be IndexedDB persistence, append-only JSONL files under the app data directory, or both, but it must be visible in Settings.
- Persistent trace is off by default unless product explicitly decides otherwise.
- Clear Trace must clear memory, IndexedDB trace rows, and app-managed trace archive files.
- Export Trace writes a redacted diagnostics bundle to a user-chosen file, or copies it to clipboard when file-system export is unavailable.
- Archive rotation must have bounded disk usage. Initial target: keep recent archives by size and age, for example max 20 MB or 7 days, whichever is reached first.
- Archive files must be UTF-8 JSONL or compact text plus JSON metadata, so a user can attach the file and a developer can diff/search it.

---

## 4. API Design

### 4.1 Shared Logger API

The implementation should preserve the existing `log.debug/info/warn/error(scope, ...args)` API for compatibility, while adding a structured path for new work.

Proposed API:

```typescript
const logger = createDiagnosticLogger("stream.youtube");

logger.info("token.minted", {
  message: "youtube PoToken minted",
  category: "auth",
  phase: "success",
  traceId,
  trackId,
  sourceId: "youtube",
  videoId,
  tokenBinding: "video",
  tokenLength: token.length,
});

logger.error("download.failed", {
  message: "youtube download failed",
  category: "network",
  phase: "fail",
  errorKind: "http_status",
  traceId,
  trackId,
  sourceId: "youtube",
  videoId,
  httpStatus: 403,
  requestHost,
  contentType: "text/plain",
  redactions: ["url.query.pot", "url.query.sig"],
});
```

Compatibility rule:

- Existing calls such as `log.info("youtube", "resolved", data)` still work.
- Migrated code should prefer `createDiagnosticLogger(scope).info(event, context)`.
- `logger.ts` remains the single import target for normal app code.
- `traceEvent()` remains available for low-level recorder code but should not become the default app API.

### 4.2 Console Policy

Trace is the source of truth. Console is not the support interface.

Required behavior:

- `src/**` must not call `console.*` directly.
- Structured logger calls always write to Settings Trace first.
- In development builds, console mirroring is allowed for developer convenience, but it must mirror the same sanitized payload that trace receives.
- In production builds, `debug` and `info` must not print to console.
- In production builds, `warn` and `error` may print only as an emergency mirror after sanitization. They must still be present in Settings Trace.
- Electron main-process logs must use the diagnostics bridge where possible. Raw terminal `console.*` is allowed only as boot-time fallback before renderer/preload diagnostics are ready.
- Tests should assert that migrated playback/network paths emit trace events without depending on console output.

Non-goal:

- Hiding all developer console output during local development. The goal is to make console secondary, sanitized, and never the only place a user-support diagnostic appears.

### 4.3 Diagnostics Context Helpers

Required helpers:

| Helper | Purpose |
|--------|---------|
| `createTraceId(prefix)` | Generate readable local ids such as `ply_...`, `sync_...` |
| `startSpan(traceId, operation)` | Create `spanId` and start time |
| `finishSpan(span, phase, context)` | Add duration and emit success/fail |
| `sanitizeDiagnosticData(value)` | Redact known sensitive fields recursively |
| `sanitizeUrlForTrace(url)` | Return host, path hash, selected safe query keys, redaction list |
| `normalizeError(error)` | Convert unknown thrown values to `{ name, message, stack?, errorKind? }` |
| `formatTraceEntries(entries, options)` | Existing formatter plus structured compact mode |
| `appendTraceArchive(entries)` | Optional local archive writer with redaction and rotation |
| `exportDiagnosticsBundle(entries, options)` | User-triggered file/clipboard export |

### 4.4 Example Trace Output

Human-readable copy format should stay paste-friendly:

```text
2026-06-11T11:53:02.686Z INFO  [player.queue] track.play_clicked trace=ply_8ph3 track=trk_fcf... session=ses_ee2...
2026-06-11T11:53:02.688Z INFO  [stream.resolve] resolve.start trace=ply_8ph3 source=youtube video=Ci_zad39Uhw
2026-06-11T11:53:02.926Z INFO  [stream.youtube] token.minted trace=ply_8ph3 binding=video video=Ci_zad39Uhw tokenLength=116
2026-06-11T11:53:04.138Z INFO  [stream.youtube] info.resolved trace=ply_8ph3 itag=140 mime="audio/mp4; codecs=\"mp4a.40.2\""
2026-06-11T11:53:04.423Z ERROR [stream.youtube] download.failed trace=ply_8ph3 kind=http_status status=403 host=rr2---sn-ouu2j-ioqs.googlevideo.com type=text/plain redacted=url.query.pot,url.query.sig
2026-06-11T11:53:04.436Z ERROR [player.media] error trace=ply_8ph3 kind=media_decode code=4 message="DEMUXER_ERROR_COULD_NOT_OPEN"
```

Optional JSON diagnostics bundle should be available for exact analysis:

```json
{
  "level": "error",
  "scope": "stream.youtube",
  "event": "download.failed",
  "message": "youtube download failed",
  "context": {
    "traceId": "ply_8ph3",
    "trackId": "trk_fcf90054-4980-40ef-a912-7e8ad58c7258",
    "sourceId": "youtube",
    "videoId": "Ci_zad39Uhw",
    "category": "network",
    "phase": "fail",
    "errorKind": "http_status",
    "httpStatus": 403,
    "requestHost": "rr2---sn-ouu2j-ioqs.googlevideo.com",
    "contentType": "text/plain",
    "redactions": ["url.query.pot", "url.query.sig"]
  }
}
```

### 4.5 Error Handling Requirements

- Every `error` event must include `errorKind` or be normalized to `unknown`.
- Every network error must include one of: `httpStatus`, normalized thrown error name/message, or timeout marker.
- Every media element error must include media error `code`, media `message`, `readyState`, and `networkState` when available.
- Every redacted field must be represented by a redaction marker so developers know data was intentionally omitted.
- Logger failure must never crash playback. If formatting or serialization fails, trace falls back to a minimal safe event.

### 4.6 Local Archive / File Export

Archive is for "I reproduced it before I opened Settings" and longer repro sessions.

Required behavior:

- Archive is local-only and never uploaded automatically.
- Archive controls live in Settings Trace.
- Archive storage location is discoverable from Settings when file-backed storage is enabled.
- Exported file name uses a safe support format such as `muzero-trace-YYYYMMDD-HHMMSS.jsonl`.
- File contents use redacted structured events, one JSON object per line, plus an optional header event with app version, release id, platform, shell, and locale.
- Export must support "current playback trace", "last 5 minutes", and "all retained entries" when the relevant data exists.
- Archive writer must batch writes and never block media playback.
- If file writing fails, trace records an `settings.trace archive.failed` event and keeps in-memory trace working.

---

## 5. Frontend Design

### 5.1 Settings Trace Workbench

Current UI:

- `settings.traceTitle`
- `settings.traceHint`
- `settings.traceCopy`
- `settings.traceClear`
- last 120 visible events, all entries copied

Required V1 upgrades:

- Filter by level: all, warn, error
- Filter by scope/category, including `user-action`, `network`, `stream`, `media`, and `sync`
- Filter by error kind, including `http_status`, `network_error`, `media_decode`, `auth_required`, `permission_denied`, and `po_token`
- Search by `traceId`, `trackId`, `sessionId`, `sourceId`, `videoId`, route, control id, or text
- Group by `traceId` for playback attempts
- Show a "Repro steps" view that extracts user-action events in time order
- Copy visible events
- Copy full diagnostics bundle
- Show event count and oldest/newest time
- Preserve simple one-click copy for the common support path

Required V2 upgrades:

- "Record persistent trace" visible setting if IndexedDB persistence is added
- Ring size control with safe bounds, for example 300 / 1000 / 3000
- Include/exclude potentially identifying local ids in copied bundle, default include local ids because they are useful and still local, but clearly label the behavior
- "Copy last 5 minutes" and "Copy current playback attempt"
- "Export trace file" for a redacted diagnostics bundle
- "Open trace archive location" when the platform supports file-backed archives
- "Clear archived traces" with confirmation when persistent/file archive is enabled
- Archive status row: enabled/disabled, retained size, oldest entry, newest entry

### 5.2 UX Copy Requirements

Trace UI must communicate:

- Trace is local.
- Nothing is uploaded automatically.
- Copying trace shares the visible technical log with whoever the user pastes it to.
- Secrets and signed URLs are redacted.
- Persistent archive, if enabled, writes local files only and can be cleared from Settings.

All user-facing strings must go through i18n catalogs in `src/i18n/locales/{en,zh,ja,ko}/common.json`.

### 5.3 State Management

- Trace buffer remains outside Zustand to avoid progress-frame rerenders.
- `useSyncExternalStore` remains appropriate for the trace subscription.
- If persisted trace is added, Dexie writes must be batched/debounced and never happen per animation frame.
- If file archive is added, writes must be batched outside the playback hot path and tolerate app shutdown.
- Filtering state is UI-local unless there is a visible Settings reason to persist it.

---

## 6. Implementation Plan

### Phase 1: Audit, Taxonomy, Redaction Contract

**Goal:** Freeze the diagnostic vocabulary before migrating logs.

**Tasks:**
- [x] Audit current `log.*` and `traceEvent()` calls in `src/**`.
- [x] Audit Electron main-process `console.*` usage, especially `electron/fetch-proxy.cjs`.
- [x] Define `DiagnosticContext`, taxonomy enums, and event naming rules.
- [x] Implement redaction policy tests before broad migration.
- [x] Document safe vs forbidden diagnostic fields in code comments near sanitizer.

### Phase 1 Checklist

- [x] No known secret field can pass through sanitizer unredacted.
- [x] Full signed media URLs are never copied into Settings trace.
- [x] Raw user input, search queries, note text, chat text, prompt text, pasted text, and file names are never copied into Settings trace.
- [x] Existing trace copy remains functional after schema additions.
- [x] PR review includes at least one real pasted YouTube failure log mapped to target events.

### Phase 2: Shared Structured Logger API

**Goal:** Add the shared function that future code should use.

**Tasks:**
- [x] Extend `src/lib/logger.ts` or add `src/lib/diagnostics.ts` if the type surface becomes too large.
- [x] Preserve `log.debug/info/warn/error(scope, ...args)` compatibility.
- [x] Add `createDiagnosticLogger(scope)`.
- [x] Add `recordUserAction(event, context)` helper for UI handlers that need safe reproduction breadcrumbs.
- [x] Add trace id/span helpers.
- [x] Add structured formatter and compact text formatter.
- [x] Add unit tests for compatibility calls and structured calls.

### Phase 2 Checklist

- [x] New structured logger writes to Settings Trace as the source of truth.
- [x] User action helper redacts raw input and emits `category=user-action`.
- [x] Development console mirror, if enabled, uses the same sanitized payload as trace.
- [x] `debug` / `info` console behavior still respects production silence.
- [x] `warn` / `error` production console mirror is sanitized and never the only diagnostic copy.
- [x] Serialization failure falls back to a safe minimal event.
- [x] TypeScript makes `event` and `scope` explicit for structured calls.

### Phase 3: Playback / Stream Trace Migration

**Goal:** Make the active debugging path, external streaming playback, fully traceable.

**Tasks:**
- [x] Add safe `ui.action play.click` breadcrumbs to `TrackRow` playback requests.
- [x] Add structured `stream.resolve` events to `resolveStreamedTrackMedia`.
- [x] Add structured `stream.cache` events to `runStreamCache`.
- [x] Create a playback `traceId` when a row/set/queue item starts playback.
- [x] Thread `traceId` through `player-store`, stream resolver, source adapter, cache, media proxy URL, and `media-engine`.
- [x] Migrate `src/streamsrc/youtube/youtube-ytjs.ts` logs to structured events.
- [x] Migrate `src/streamsrc/youtube/youtube-source.ts` and `src/streamsrc/stream-http.ts`.
- [x] Migrate `src/player/media-engine.ts` direct `traceEvent()` media events to the shared logger.
- [x] Add tests for successful YouTube path and 403/download failure path using fake fetch.

### Phase 3 Checklist

- [x] A pasted YouTube failure trace proves whether PoToken was minted.
- [x] The trace proves whether playback used a downloaded `blob:` URL or `muzfetch://media` proxy.
- [x] The trace includes HTTP status, content type, host, range support, and redaction markers for failed media requests.
- [x] The trace includes media element error code, ready state, and network state.
- [x] Cache-stream failures share the same playback `traceId`.
- [x] No test snapshots contain raw signed URLs, cookies, tokens, prompts, lyrics, notes, or file names.
- [x] A real successful YouTube trace proves the fixed path: video-bound PoToken applied to the active player, `hasCpn=true`, `download.success`, and `play.resolved`.

### Phase 4: Settings Trace Workbench

**Goal:** Make Settings Trace useful without opening DevTools.

**Tasks:**
- [x] Add level/scope/category filters.
- [x] Add error-kind filter.
- [x] Add traceId grouping and search.
- [x] Add user-action "Repro steps" timeline.
- [x] Add copy visible, copy current playback attempt, and copy full diagnostics bundle.
- [x] Add local explanatory copy and 4-locale i18n keys.
- [x] Add component tests for filter/copy/clear behavior.

### Phase 4 Checklist

- [x] User can reproduce a playback issue and copy only that playback attempt.
- [x] User can filter to errors only, user actions only, or network/media failures only.
- [x] User can copy a reproduction timeline that includes safe user-action breadcrumbs.
- [x] User can still copy all trace with one click.
- [x] Empty state remains clear.
- [x] Trace UI does not rerender on playback progress frames unless a trace entry is added.
- [x] UI text does not claim that trace is uploaded or remote.

### Phase 5: Electron Main Process Bridge

**Goal:** Bring media proxy diagnostics into the same copied trace.

**Tasks:**
- [x] Define a safe IPC or preload bridge from `electron/fetch-proxy.cjs` diagnostics to renderer trace.
- [x] Wrap main-process proxy logs with the same event taxonomy.
- [x] Include request host, status, content type, range, accept-ranges, and response metadata.
- [x] Ensure main-process logs are safe when renderer is unavailable.
- [x] Add tests or smoke harness for proxy event formatting.

### Phase 5 Checklist

- [x] `muzfetch://media` 403 appears in Settings Trace, not only terminal output.
- [x] Main-process diagnostics never expose full target URL or headers.
- [x] Renderer and main events use the same diagnostic schema; playback `traceId` propagation into media proxy URLs is tracked in Phase 3.
- [x] App behavior is unchanged if diagnostics bridge fails.

### Phase 6: Local Trace Archive / File Export

**Goal:** Support longer repro sessions and shareable local diagnostic files without making DevTools console the support path.

**Tasks:**
- [x] Decide V1 archive backend: IndexedDB ring, app-data JSONL files, or both.
- [x] Add visible Settings controls for archive enablement, retained size, export, and clear archive.
- [x] Implement bounded rotation by size and age.
- [x] Add redacted diagnostics bundle export.
- [x] Add app version / release id / shell / platform metadata to exported bundle.
- [x] Add tests for rotation, clear, export, redaction, and write failure fallback.

### Phase 6 Checklist

- [x] User can export a redacted trace file from Settings without opening DevTools.
- [x] A reproduced issue from before opening Settings can still be found if persistent archive was enabled.
- [x] Archive disk usage is bounded and visible.
- [x] Clear Trace removes active trace and archived trace.
- [x] Archive write failure is recorded as trace and does not affect playback.

---

## 7. Acceptance Criteria

### 7.1 YouTube Playback Failure

Given the user clicks a YouTube search/playlist row and playback fails with 403 or media decode error:

- Settings Trace contains one playback `traceId`.
- The trace starts with a safe user-action event for the click that initiated playback.
- The trace includes `player.queue`, `stream.youtube`, `stream.proxy` or `stream.youtube download`, and `player.media` events.
- The trace shows whether a video-bound PoToken was minted.
- The trace shows whether the app attempted direct proxy playback or downloaded Blob playback.
- The trace shows the failure as `errorKind=http_status`, `errorKind=media_decode`, or both.
- The trace has enough fields to identify the failing layer without asking the user for DevTools Network screenshots.

### 7.2 Netease / Bilibili / Other Stream Sources

Given a stream source requires headers/cookies/login or returns no playable URL:

- Trace distinguishes `auth_required`, `permission_denied`, `http_status`, and `unsupported_source`.
- Trace never prints cookies or login tokens.
- User-facing toast remains product-friendly while trace keeps technical detail.

### 7.3 App-Wide Logging Discipline

- `src/**` continues to avoid raw `console.*`.
- New logs use the shared structured logger unless they are low-level global capture in `trace-recorder.tsx`.
- New features must include trace events for their primary failure modes.
- New user-facing actions that can change playback, data, settings, sync, or navigation must emit safe `user-action` trace events.
- PR descriptions for risky playback/network changes include the trace events that should appear during manual verification.
- Settings Trace is the support source of truth. DevTools console output is optional, sanitized, and secondary.
- Production `debug` / `info` do not print to console.
- Any production `warn` / `error` console mirror is also present in Settings Trace.

### 7.4 Privacy

- Copying a full diagnostics bundle never includes secrets or full signed URLs.
- Automated tests cover redaction for headers, URL params, provider keys, R2 credentials, search queries, lyrics, prompts, notes, chat text, pasted text, and file names.
- No trace is uploaded to MUZERO or any third-party service.

### 7.5 Local Archive / File Export

- User can export a redacted diagnostics file from Settings.
- User can copy the same diagnostic information without using file export.
- Archive retention is bounded by size and age.
- Clear Trace clears active trace and app-managed archives.
- Archive file export includes enough app metadata for support: app version, release id, platform, shell, locale, and trace time range.
- Archive and export never include raw signed URLs, cookies, tokens, BYOK keys, prompts, lyrics, chat text, notes, file names, or bytes.

---

## 8. Out of Scope

- Cloud telemetry or analytics.
- Automatic crash upload.
- A remote support backend.
- Hidden debug flags in `localStorage`, URL params, or `window.*`.
- Replacing DevTools for deep browser performance profiling.
- Full OpenTelemetry integration.
- Persisting trace forever or writing unbounded log files.
- Automatic file attachment, email sending, or remote upload.

---

## 9. Security Considerations

- **Authentication:** No account system. Trace access is local to the app UI.
- **Authorization:** Any local user who can open Settings can copy trace. This matches current local-first desktop behavior.
- **Data Protection:** Secrets, cookies, signed URLs, prompt/lyrics/chat/note/file-name contents, and bytes are redacted or omitted.
- **Audit Logging:** This is not audit logging and not telemetry. It is local support diagnostics.
- **BYOK Discipline:** User keys remain in IndexedDB settings rows and must never enter logs, trace, URLs, bundle, or committed env files.
- **No Hidden Backend Flags:** Trace persistence or verbosity controls must be visible Settings controls. Rollback is git revert plus release.
- **Local Archive:** File-backed archives, if enabled, live in the app data directory or a user-selected export path. They must be clearable from Settings and bounded by retention policy.

---

## 10. Related Documents

| Document | Description |
|----------|-------------|
| [`src/lib/logger.ts`](../../../src/lib/logger.ts) | Current leveled logger and console discipline entry point |
| [`src/lib/trace.ts`](../../../src/lib/trace.ts) | Current in-memory trace buffer and formatter |
| [`src/pages/settings-page.tsx`](../../../src/pages/settings-page.tsx) | Current Settings Trace UI |
| [`src/components/shell/trace-recorder.tsx`](../../../src/components/shell/trace-recorder.tsx) | Current global trace recorder |
| [`electron/fetch-proxy.cjs`](../../../electron/fetch-proxy.cjs) | Current Electron proxy and media request diagnostics source |
| [`src/streamsrc/stream-http.ts`](../../../src/streamsrc/stream-http.ts) | Header aliasing and stream HTTP boundary |
| [`src/streamsrc/youtube/youtube-ytjs.ts`](../../../src/streamsrc/youtube/youtube-ytjs.ts) | YouTube resolve/token/download path |
| [`src/player/media-engine.ts`](../../../src/player/media-engine.ts) | Media element diagnostics and playback errors |
| [`src/stores/player-store.ts`](../../../src/stores/player-store.ts) | Playback orchestration and queue context |
| [`docs/prd/20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md`](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | External streaming source PRD and prior proxy/login diagnostics |

---

## 11. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should YouTube `videoId` be copied by default? | Resolved | Yes. Include opaque external ids needed for diagnosis when the user explicitly copies local diagnostics; redact full URLs, signed params, cookies, and tokens. |
| 2 | Should persisted trace be on by default? | Resolved | No for V1. Keep memory trace always available; add persistent/file archive only behind a visible Settings control. |
| 3 | Should trace ring size remain 300? | Resolved | Use 300 in-memory entries by default for low overhead. Offer larger bounded retention only through visible persistent/archive controls. |
| 4 | Should Electron main events be buffered if renderer is not ready? | Resolved | Yes. Keep a small sanitized main-process ring buffer and flush it to renderer trace when diagnostics bridge attaches. |
| 5 | Should structured event names be compile-time unions? | Resolved | Use typed unions for level/category/phase/errorKind/source. Keep event names string-based initially, documented by scope tables, to avoid slowing migration. |
| 6 | Should file archive be enabled by default on desktop? | Open | Proposed: off by default for V1, with visible Settings toggle |
| 7 | Should archive backend be IndexedDB or JSONL files? | Open | Proposed: in-memory plus Settings export first; JSONL app-data archive only when longer repro sessions need it |
| 8 | What is the default archive retention? | Open | Proposed: max 20 MB or 7 days, configurable later only if needed |

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-11 | Codex | Initial draft based on current logger/trace audit and external streaming debug needs |
| 2026-06-11 | Codex | Added console-as-secondary policy and local trace archive/file export requirements |
| 2026-06-11 | Codex | Resolved Open Questions 1-5 by best practice and added user-action/repro-step trace requirements |
| 2026-06-11 | Codex | Completed Phase 1 with structured diagnostics schema, filter helpers, URL summarization, and redaction tests |
| 2026-06-11 | Codex | Completed Phase 2 with structured logger facade, sanitized legacy logging, user-action helper, and trace formatter tests |
| 2026-06-11 | Codex | Advanced Phase 3a with safe TrackRow play breadcrumbs plus structured stream resolve/cache trace events and tests |
| 2026-06-11 | Codex | Completed Phase 3 with playback traceId propagation through player, stream resolver/cache, YouTube provider/runtime, media engine, stream HTTP, and media proxy events |
| 2026-06-11 | Codex | Completed Phase 4 with Settings Trace filters, copy-visible/all, repro-step timeline, i18n, and component tests |
| 2026-06-11 | Codex | Completed Phase 5 with Electron main diagnostics buffering, preload bridge, renderer trace ingestion, and redacted media proxy events |
| 2026-06-11 | Codex | Completed Phase 6 with IndexedDB trace archive, visible enable/export controls, bounded rotation, JSONL export metadata, and archive tests |
| 2026-06-11 | Codex | Recorded successful YouTube playback trace after active-player video PoToken binding and `cpn` fix |
