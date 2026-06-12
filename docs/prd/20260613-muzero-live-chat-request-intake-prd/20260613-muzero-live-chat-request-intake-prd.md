# PRD: MUZERO — Live Chat Request Intake（直播弹幕点歌接入）

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** AI DJ / Search / Player Queue / Tauri Desktop Local Intake

> 产品请求：直播间弹幕可通过 Social Stream Ninja 等工具转发到 MUZERO。MUZERO 需要对外暴露一个本地接口接收消息，并可配置把消息交给 AI DJ 处理，或直接走搜索匹配，把最高分曲目加入下一首 / 立即切歌 / 追加队列。

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | PRD + Architecture Decision | ✅ Completed | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | Contracts + Pure Router | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Desktop Loopback Intake Server | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Settings + Request Inbox UI | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Direct Search Route + Playback Actions | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | AI DJ Route + Prompt Safety | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Social Stream Ninja Preset + Docs | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Verification + Hardening | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 已有三套关键能力：

- AI DJ 对话工具链：`library_search` / `set_add_by_search` / `play_track` / `play_set` 等工具已经能搜索、策展、切歌，见 [`src/chat/dj-chat-tools.ts`](../../../src/chat/dj-chat-tools.ts)。
- 统一搜索引擎：本地曲库搜索已经覆盖标题、artist、album、tag、memory、歌词和音译评分，见 [`src/lib/track-search.ts`](../../../src/lib/track-search.ts)。
- 播放队列控制：`player-store` 已有 `playTrack` / `playIndex` / `setActiveSession`，DB repo 已有 `playQueuePlayNext` / `playQueueAppend` 等播放列表操作。

直播场景缺的是一个**外部消息入口**和一个**可配置路由器**。Social Stream Ninja 这类工具可以把直播平台弹幕转成外部消息；MUZERO 需要能在本机接收这些消息，然后按主播设置执行：

1. 交给 AI DJ 自然语言理解和工具调用；
2. 直接走 MUZERO 搜索，取最高匹配曲目；
3. 在低置信度时进入人工确认或升级给 AI DJ。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Streamer / Host** | 直播时让观众点歌、插歌、引导 AI DJ 改变 vibe。 | 开关本地接收接口、配置路由模式、播放动作、限流、手动审批。 |
| **Moderator** | 协助主播过滤误触发、重复点歌和低置信度匹配。 | 在 Request Inbox 中批准、拒绝、改成下一首或立即播放。 |
| **Audience** | 在直播间发出点歌弹幕。 | 无 MUZERO 账号；只通过直播平台消息间接请求。 |
| **Local Power User** | 用 Stream Deck、OBS、脚本、局域网工具触发 MUZERO。 | 使用本地 token 调接口；默认仅本机 loopback。 |

### 1.3 Core Value

1. **直播互动变成播放控制**：观众发弹幕即可影响 AI DJ 或点播曲库，不需要主播手动搜索。
2. **AI 与确定性搜索两条路**：复杂自然语言交给 AI DJ；明确歌名走本地搜索，低延迟、低成本、可解释。
3. **本地优先不变**：MUZERO 不新增服务器；接口只在本机桌面端启用，token 和设置只存在 IndexedDB，请求消息默认不持久化。
4. **主播可控**：默认关闭、默认 play-next、可限流、可设置信心阈值和人工审批，避免直播间把播放器打乱。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Social Stream Ninja / OBS / local script
        │
        │  POST http://127.0.0.1:<port>/v1/audience/request
        │  Authorization: Bearer <local intake token>
        ▼
Tauri Desktop LocalIntakeServer
        │  validate token / rate limit / normalize payload
        │  emit event to WebView
        ▼
src/live-requests/audience-request-runtime.ts
        │  keep transient request queue/inbox in memory
        │  dedupe / command prefix / cooldown / optional approval
        ▼
AudienceRequestRouter
        ├── route: "ai-dj"
        │       └── serial AI queue (max 1 active)
        │             └── create a fresh chat session per request
        │                   └── DjChatRuntimeActor.sendMessage()
        │                         └── existing tools: library_search / play_track / set_add_by_search / generate...
        │
        ├── route: "library-search"
        │       └── trackSearchScore + memory notes + lyrics option
        │             └── action: play-next / append / play-now / manual-review
        │
        └── route: "hybrid"
                ├── confident local match -> playback action
                ├── low local score -> try configured online sources
                └── no confident match -> AI DJ or inbox
```

**Key decision:** v1 exposes a **desktop-only HTTP loopback server inside the Tauri shell** for Social Stream Ninja **Call Webhook**. A normal browser tab cannot listen for inbound HTTP requests, and adding a MUZERO cloud relay would violate the local-first product boundary. The local server is not a MUZERO backend; it is a device-local bridge owned by the user.

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Local intake server | Tauri Rust command + async loopback HTTP server | Browser cannot accept inbound requests; desktop shell can bind `127.0.0.1`. |
| Frontend runtime | React/TypeScript module-scope singleton | Mirrors existing `DjEngine` / `MediaEngine` pattern; runtime state does not belong in Zustand. |
| Persistence | Dexie `muzero-db` `AppSettings` fields only | Endpoint settings and token remain local. Request messages/status are transient memory state by default and are not saved. |
| Validation | Zod schemas in `src/live-requests/` | Accept generic JSON while normalizing to one internal contract. |
| AI route | Existing `DjChatRuntimeActor` + `createDjChatTools` | Reuse existing tool loop and BYOK LLM gating. |
| Search route | `trackSearchScore`, `searchTracks`, `memoryNotesByTrack`, optional lyrics helpers | Same scoring semantics as UI search and chat `library_search`. |
| Playback actions | `playQueuePlayNext`, `playQueueAppend`, `usePlayerStore.getState().playTrack` | Avoid new queue model; use existing play queue surface. |
| UI | Settings pane + request inbox popover/table | Visible runtime toggle; no hidden backend flags. |
| Logging | `src/lib/logger.ts` | No `console.*`; token/message redaction. |

### 2.3 Project Structure

```
src/
├── live-requests/
│   ├── audience-request-schema.ts       # Zod input + normalized AudienceRequestInput
│   ├── audience-request-router.ts       # pure route decision + match selection
│   ├── audience-request-search.ts       # direct search scoring and tie handling
│   ├── audience-request-runtime.ts      # event subscriber, transient queue/inbox, side effects
│   ├── audience-request-security.ts     # token compare, redaction, cooldown/rate-limit helpers
│   └── social-stream-ninja.ts           # payload adapter preset + examples
├── components/
│   ├── settings/live-request-settings.tsx
│   └── live-requests/request-inbox.tsx
├── db/
│   ├── types.ts                         # AppSettings fields + shared request types
│   └── repositories.ts                  # settings helper only if needed
├── stores/
│   └── player-store.ts                  # optional narrow actions if repo-only queue ops are not enough
└── i18n/locales/{en,zh,ja,ko}/common.json

src-tauri/
└── src/lib.rs                           # start/stop local intake server + event emit
```

> Net-new `src/live-requests/` is justified because this is a boundary module: inbound untrusted messages, security/rate-limit rules, pure routing, and playback side effects should not be scattered through chat/store/UI.

### 2.4 Runtime Boundary

| Runtime | v1 Behavior |
|---------|-------------|
| Tauri desktop | Full feature: start/stop local loopback server and receive HTTP requests. |
| Browser dev server | No inbound server; Settings shows desktop-only unavailable state. Unit tests can call router/runtime directly. |
| Mobile Tauri | Out of scope for v1; no listening port. Future: deep link / push-free local network receiver if product requires it. |

---

## 3. Data Model Design

### 3.1 Core Concepts

```
AppSettings.audienceRequestIntake
  -> enabled / port / auth token / route mode / playback action / thresholds

Transient AudienceRequestRuntimeItem
  -> normalized inbound message
  -> route decision
  -> matched track or chat session
  -> action status + error
  -> lives in module memory/Zustand only; cleared on app reload
```

### 3.2 Settings Shape

Additive field on [`AppSettings`](../../../src/db/types.ts):

```ts
export type AudienceRequestRouteMode = "ai-dj" | "library-search" | "hybrid";
export type AudienceRequestPlaybackAction =
  | "manual-review"
  | "play-next"
  | "append-queue"
  | "play-now";

export interface AudienceRequestIntakeSettings {
  enabled: boolean;                    // default false
  bindHost: "127.0.0.1";                // v1 fixed loopback
  port: number;                         // generated free port, user-editable
  authToken?: string;                   // local secret; masked in UI/logs
  routeMode: AudienceRequestRouteMode;  // default "library-search"
  playbackAction: AudienceRequestPlaybackAction; // default "play-next"
  searchScope: "active-set" | "all-library";
  includeLyrics?: boolean;
  onlineFallbackOnLowConfidence?: boolean; // default true when sources are configured
  confidenceThreshold: number;          // default derived from search-core tiers
  scoreMarginThreshold: number;         // require best to beat second result
  commandPrefixes: string[];            // e.g. ["点歌", "!sr", "song:"]
  dedupeWindowSec: number;
  requesterCooldownSec: number;
  maxRequestsPerMinute: number;
  requireApprovalForPlayNow: boolean;   // default true
}
```

Defaults:

- `enabled: false`
- `bindHost: "127.0.0.1"`
- `routeMode: "library-search"`
- `playbackAction: "play-next"`
- `searchScope: "all-library"`
- `onlineFallbackOnLowConfidence: true`
- `requireApprovalForPlayNow: true`

No Dexie version bump is required for optional `AppSettings` fields because `getSettings()` already merges over `DEFAULT_SETTINGS`.

### 3.3 Transient Request State

No `audienceRequests` Dexie table in v1. The product decision is **do not save a separate intake request history**. The runtime keeps only a bounded in-memory queue/inbox for currently visible moderation and in-flight processing. AI-routed requests may create their own fresh chat sessions, but the intake layer should not persist viewer identity or a parallel request log.

```ts
export type AudienceRequestStatus =
  | "received"
  | "ignored"
  | "queued"
  | "needs-approval"
  | "completed"
  | "failed";

export interface AudienceRequestRuntimeItem {
  id: string;                 // newId("arq")
  externalId?: string;        // upstream message id for dedupe
  receivedAt: number;
  sourceKind: "social-stream-ninja" | "http" | "manual-test";
  platform?: string;          // youtube / twitch / bilibili / douyin / unknown
  roomId?: string;
  requesterDisplayName?: string; // display only; not persisted
  requesterKey?: string;      // in-memory cooldown/dedupe key; not persisted
  requesterRole?: "viewer" | "moderator" | "broadcaster" | "unknown";
  rawMessage: string;
  normalizedQuery: string;
  routeMode: AudienceRequestRouteMode;
  playbackAction: AudienceRequestPlaybackAction;
  status: AudienceRequestStatus;
  matchedTrackId?: string;
  matchedScore?: number;
  secondScore?: number;
  confidence?: "high" | "medium" | "low" | "none";
  chatSessionId?: string;
  error?: string;
  completedAt?: number;
}
```

Runtime memory rules:

- The in-memory queue is bounded, e.g. last 50 visible rows, to protect the UI during floods.
- A request row exists only while the app is running. App reload clears request text, display names, and statuses.
- Dedup/cooldown maps are also in memory. They prevent bursts during one live session but are not durable records.
- Logs must redact `authToken`, raw request body, local endpoint token query params, and requester ids.

### 3.4 Search Match Invariants

Direct search route must use one pure selector:

```ts
pickAudienceRequestMatch({
  tracks,
  query,
  memoryNotesByTrackId,
  lyricsByTrackId,
  threshold,
  margin,
  avoidCurrentTrack,
})
```

Rules:

- Lower score is better, following `scoreRow` / `trackSearchScore`.
- `NO_MATCH_SCORE` is always a hard reject.
- If best and second-best are too close, mark `needs-approval` instead of guessing.
- If current track is the best match and `playbackAction !== "play-now"`, prefer next confident match or mark duplicate.
- Default search uses local library only. If local best score is too low and `onlineFallbackOnLowConfidence` is enabled, try configured online sources as a fallback path, then add the selected online hit to the current/online set before queueing.
- Empty query, command-only message, or cooldown violation is `ignored`, not `failed`.

---

## 4. API Design

### 4.1 Local HTTP Endpoints

All endpoints bind to `127.0.0.1` by default and exist only while Settings toggle is enabled.

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | none | Returns app name, enabled state, and API version. No settings or secrets. |
| `/v1/audience/request` | POST | Bearer token | Accept one chat/request message. |

Social Stream Ninja setup target:

- Type: **Call Webhook**
- Method: **POST**
- Body: **Include full message object as JSON body**
- URL: copy from MUZERO Settings, usually `http://127.0.0.1:<port>/v1/audience/request?token=...`
- Synchronous mode: optional; MUZERO returns quickly after accepting/queueing the message, not after a song finishes or an LLM completes.

Recommended auth:

```http
Authorization: Bearer muz_live_...
```

Social Stream Ninja Call Webhook commonly exposes URL/method/body controls before headers. For that path, MUZERO should generate a copyable URL with query-token auth:

```http
POST /v1/audience/request?token=muz_live_...
```

Query-token support must be documented as less private because URLs can appear in tool logs.

### 4.2 Request Example

```json
{
  "id": "ssn-youtube-1730000000-abc",
  "source": "social-stream-ninja",
  "platform": "youtube",
  "roomId": "live-room-id",
  "user": {
    "id": "viewer-123",
    "name": "Alice",
    "role": "viewer"
  },
  "message": "点歌 晴天 周杰伦",
  "command": "song-request",
  "timestamp": "2026-06-13T12:00:00.000Z",
  "raw": {}
}
```

Normalized internal input:

```ts
{
  externalId: "ssn-youtube-1730000000-abc",
  sourceKind: "social-stream-ninja",
  platform: "youtube",
  requesterDisplayName: "Alice",
  rawMessage: "点歌 晴天 周杰伦",
  normalizedQuery: "晴天 周杰伦",
}
```

### 4.3 Response Examples

Accepted and queued:

```json
{
  "accepted": true,
  "requestId": "arq_123",
  "status": "queued",
  "routeMode": "library-search",
  "message": "queued"
}
```

Low confidence:

```json
{
  "accepted": true,
  "requestId": "arq_124",
  "status": "needs-approval",
  "routeMode": "library-search",
  "message": "low-confidence match"
}
```

Rejected:

```json
{
  "accepted": false,
  "status": "rate-limited",
  "message": "requester cooldown active"
}
```

### 4.4 Error Handling

| Error | Behavior |
|-------|----------|
| Disabled intake | Return `503`; do not store body. |
| Missing/invalid token | Return `401`; log redacted metadata only. |
| Invalid JSON/schema | Return `400`; no playback side effect. |
| Duplicate upstream id | Return `200` with existing request id; no duplicate playback. |
| Rate-limited requester | Return accepted=false or in-memory `ignored`; do not persist. |
| Low local search score | If configured online sources are available, try online fallback before inbox/AI. |
| No search match | `needs-approval` or route to AI DJ in hybrid mode. |
| LLM unavailable | Search route remains usable; AI route marks request `failed` with visible reason. |
| Playback action fails | Mark request `failed`; do not retry infinitely. |

---

## 5. Frontend Design

### 5.1 Settings Surface

Add a visible Settings pane: **AI -> Live requests** or **Controls -> Live requests**. Recommendation: place it under AI because its primary product job is "audience drives AI DJ/search".

Required controls:

- Enable live request intake toggle.
- Endpoint display: `http://127.0.0.1:<port>/v1/audience/request`.
- Copy Social Stream Ninja URL button (`?token=...`) and copy token/header examples for scripts.
- Regenerate token button with confirmation.
- Route segmented control:
  - AI DJ
  - Search
  - Hybrid
- Playback action segmented control:
  - Manual review
  - Play next
  - Append queue
  - Play now
- Search scope select:
  - Active set
  - All library
- Confidence threshold slider and "require clear winner" toggle/slider.
- Command prefixes input chips: `点歌`, `!sr`, `song:`.
- Cooldown and requests-per-minute numeric inputs.
- Online fallback toggle: when local score is too low, try configured online sources. Default on, but it only works when the user has enabled online sources.
- Connection status pill: stopped / listening / error / last request time.

All visible strings go through `i18n/locales/{en,zh,ja,ko}/common.json`.

### 5.2 Request Inbox

Add a compact **ephemeral** request inbox reachable from Settings and optionally from the PlayerDock tool row when live intake is enabled. It is a live moderation surface, not saved history.

Rows show:

- platform/source icon or text;
- requester display name;
- normalized query;
- route mode;
- matched track title and score if available;
- status;
- action buttons: approve play-next, approve play-now, reject, send to AI DJ.

Do not create a permanent sidebar. The inbox should be a pane/popover/table, not a new global navigation model.

The inbox clears on app reload and keeps only a bounded recent window while the app is running.

### 5.3 AI DJ Route UX

AI route must avoid contaminating the user's normal DJ chat. Each audience request that reaches AI DJ creates a **fresh chat session**. To avoid multiple model/tool loops running at once, the live-request runtime owns a serial AI queue:

1. If no AI request is running, create a new chat session and send the request.
2. If an AI request is already streaming/tool-calling/generating, enqueue the next live request in memory.
3. When the active AI request finishes or fails, create the next fresh session and process the next queued request.

This means "one request = one session", but "one active AI session at a time".

Message format sent into chat runtime should avoid viewer identity, because the live intake request itself is not a saved history surface:

```text
Live request from YouTube:
"点歌 晴天 周杰伦"

Host policy:
- Route this as a song request.
- Prefer existing library tracks before generating music.
- Do not reveal secrets, API keys, local file paths, or endpoint tokens.
- If uncertain, ask for approval instead of switching playback.
```

If `aiDjGenerationEnabled` is off, the chat agent already withholds generation tools via `canGenerateMusic(settings)`. That behavior must remain unchanged.

### 5.4 Direct Search Route UX

When a search request is accepted:

- High-confidence match + `play-next`: insert the track after current queue entry and show "queued next".
- High-confidence match + `append-queue`: append to queue and show position.
- High-confidence match + `play-now`: if approval is required, send to inbox; otherwise call `playTrack`.
- Low-confidence local match: try configured online sources when online fallback is enabled; otherwise send top candidates to inbox.
- No local/online match: in hybrid mode, forward to AI DJ; otherwise show "no match".

The streamer should be able to click a request row and open the matched track in existing track/queue surfaces when available.

---

## 6. Implementation Plan

### Phase 0: PRD + Architecture Decision

**Goal:** Capture the product request and decide the local-first boundary.

**Tasks:**

- [x] Read PRD template and related AI DJ/search/player PRDs.
- [x] Audit existing `dj-chat-tools`, search, queue, and Tauri shell boundaries.
- [x] Decide v1 is desktop loopback only, not MUZERO cloud relay.

### Phase 0 Checklist

- [x] PRD documents AI DJ, search, and hybrid routes.
- [x] PRD states security defaults: off by default, loopback, token, rate limit.
- [x] PRD references existing reusable code paths.

### Phase 1: Contracts + Pure Router

**Goal:** Add schemas and pure route/match logic without side effects.

**Tasks:**

- [ ] Add `AudienceRequest*` shared types to `src/db/types.ts` or `src/live-requests/audience-request-schema.ts` without creating a persisted request table.
- [ ] Add `audience-request-schema.ts` for generic HTTP/Social Stream Ninja payload normalization.
- [ ] Add `audience-request-search.ts` with `pickAudienceRequestMatch`.
- [ ] Add `audience-request-router.ts` that returns action plans, not side effects.
- [ ] Add tests for command prefix stripping, in-memory duplicate ids, cooldown, no match, tie/low confidence, online fallback decision, and high-confidence match.

### Phase 1 Checklist

- [ ] Router is pure and unit-testable.
- [ ] Search route reuses `trackSearchScore` / memory notes instead of a new matcher.
- [ ] Online source lookup is only planned after low local confidence and only when sources are configured.
- [ ] Low-confidence and tie behavior is deterministic.
- [ ] No playback, DB, or LLM side effects happen in pure modules.

### Phase 2: Desktop Loopback Intake Server

**Goal:** Let desktop MUZERO receive local HTTP requests while preserving local-first security.

**Tasks:**

- [ ] Add Tauri commands to start/stop/status the local intake server.
- [ ] Bind only `127.0.0.1` in v1.
- [ ] Validate bearer token before emitting payload to WebView.
- [ ] Add bounded request body size, timeout, and rate-limit guard.
- [ ] Emit a typed Tauri event to frontend runtime.
- [ ] Add Rust-side tests where practical; otherwise add integration harness with injected request handler.

### Phase 2 Checklist

- [ ] Server is off by default and stops when Settings toggle turns off.
- [ ] Invalid token cannot reach frontend runtime.
- [ ] Token is never logged.
- [ ] Browser/mobile builds show unavailable state, not a broken toggle.
- [ ] Port conflict surfaces a visible error and allows choosing another port.

### Phase 3: Settings + Request Inbox UI

**Goal:** Give streamers a visible control room for endpoint setup and moderation.

**Tasks:**

- [ ] Add `DEFAULT_SETTINGS.audienceRequestIntake`.
- [ ] Add Settings pane and i18n keys for en/zh/ja/ko.
- [ ] Add endpoint/token copy actions.
- [ ] Add route/action/scope/threshold/cooldown controls.
- [ ] Add live request inbox with approve/reject/send-to-AI actions.
- [ ] Keep inbox/request rows in memory only; clear them on reload/disable.

### Phase 3 Checklist

- [ ] No hidden flags or localStorage-only backend behavior.
- [ ] Token regeneration is explicit and updates the running server.
- [ ] Play-now default requires approval.
- [ ] Inbox is explicitly described as live/current only, not saved history.
- [ ] UI remains desktop-first and responsive.

### Phase 4: Direct Search Route + Playback Actions

**Goal:** Turn clear song requests into queue actions without LLM cost.

**Tasks:**

- [ ] Implement runtime side effects for `play-next`, `append-queue`, and approved `play-now`.
- [ ] Use active set/all library scope correctly.
- [ ] Join memory notes for scoring.
- [ ] Optional: include lyrics search when enabled.
- [ ] If local confidence is too low, try configured online sources before AI/inbox when online fallback is enabled.
- [ ] Add request status updates: received -> queued/completed/needs-approval/failed.
- [ ] Add tests with `fake-indexeddb` for queue insertion order and duplicate handling.

### Phase 4 Checklist

- [ ] Highest-confidence local result can be queued next.
- [ ] Low-confidence local result can fall back to configured online sources.
- [ ] Queue order is stable and does not duplicate current track unexpectedly.
- [ ] Low-confidence requests do not auto-switch playback.
- [ ] Direct search works with no LLM key configured.

### Phase 5: AI DJ Route + Prompt Safety

**Goal:** Route natural-language audience requests into the existing AI DJ chat agent safely.

**Tasks:**

- [ ] Create a fresh chat session per AI-routed live request.
- [ ] Add a serial in-memory AI request queue so only one live-request chat session runs at a time.
- [ ] Add `sendAudienceRequestToDjChat` adapter around `DjChatRuntimeActor`.
- [ ] Add system/policy wrapper for untrusted live messages.
- [ ] Ensure chat tools are still gated by `canGenerateMusic` and `hasEnabledStreamSources`.
- [ ] Add tests with a fake chat runtime to verify message formatting and status updates.

### Phase 5 Checklist

- [ ] AI DJ route does not expose API keys, local paths, endpoint tokens, or raw settings.
- [ ] Each AI-routed request creates a new chat session.
- [ ] Concurrent AI-routed requests queue in memory until the current request finishes.
- [ ] AI DJ route works when generation is disabled, using search/curation tools only.
- [ ] AI DJ failures do not crash playback.
- [ ] The transient request row links to the chat session/action result while the app is running.

### Phase 6: Social Stream Ninja Preset + Docs

**Goal:** Make common livestream forwarding setup copy-pasteable.

**Tasks:**

- [ ] Add Social Stream Ninja adapter preset for expected payload fields.
- [ ] Add a generic webhook example for OBS/scripts.
- [ ] Add localized setup copy with endpoint, auth header, and example JSON.
- [ ] Validate with the actual Social Stream Ninja forwarding shape before marking Final.

### Phase 6 Checklist

- [ ] A streamer can copy endpoint + token and configure a forwarding tool.
- [ ] The primary Social Stream Ninja example uses Call Webhook POST with full JSON body and URL query token.
- [ ] Header auth remains documented for tools/scripts that can set headers.
- [ ] Unknown payload shapes fail gracefully with visible schema errors.

### Phase 7: Verification + Hardening

**Goal:** Prove the feature is safe enough for live use.

**Tasks:**

- [ ] Run targeted Vitest suites for router/search/runtime/settings.
- [ ] Run `tsc --noEmit`.
- [ ] Run Tauri desktop manual test with curl/Postman/local script.
- [ ] Verify no `console.*` in `src/**`.
- [ ] Verify token/raw body redaction in logs.
- [ ] Verify request flood does not freeze playback UI.
- [ ] Verify no user-visible string is hardcoded outside i18n catalogs.

### Phase 7 Checklist

- [ ] `make check` or equivalent targeted gate passes.
- [ ] Manual curl request can queue a song next.
- [ ] Manual low-confidence request lands in inbox, not playback.
- [ ] AI DJ request creates a fresh chat session, and a second AI request waits until the first finishes.
- [ ] Disabling Settings toggle closes the local server.
- [ ] No MUZERO backend, telemetry, account system, or hidden runtime flag is introduced.

---

## 7. Out of Scope

- MUZERO-hosted cloud relay or public webhook endpoint.
- Scraping livestream chat directly from YouTube/Twitch/Bilibili/Douyin. v1 only receives messages from user-configured forwarding tools.
- Mobile inbound listener.
- LAN/public network binding. v1 binds loopback only; LAN requires a separate security review.
- Full moderation AI or toxicity classifier.
- OBS plugin development.
- Replacing the existing AI DJ chat system.
- Replacing the existing search engine or queue model.
- Allowing live chat to access API keys, local paths, cloud credentials, cookies, or raw IndexedDB exports.

---

## 8. Security Considerations

- **Authentication:** Local bearer token required for all mutating endpoints. Generate a strong random token in Settings; store only in local IndexedDB; mask by default.
- **Authorization:** v1 accepts requests only on `127.0.0.1`. Moderator/broadcaster trust is advisory metadata unless the forwarding tool supplies verified roles.
- **Data Protection:** Intake request rows and viewer identities are transient runtime data only. They must not be persisted to Dexie, cloud manifests, public shares, telemetry, or logs. If a request is routed to AI DJ, the new chat session may contain the sanitized request text, but should not include viewer display names or platform user ids.
- **Prompt Injection:** Live chat is untrusted model input. AI route wraps messages with a policy prompt and exposes only existing approved tools. Never include secrets in model context.
- **Playback Safety:** `play-now` requires approval by default. Low-confidence search results require approval.
- **Rate Limiting:** Enforce per-requester cooldown and global request/minute caps before playback or LLM calls.
- **No Hidden Backend Flags:** Every runtime behavior is controlled by visible Settings. Rollback is `git revert` and release, not a hidden URL/localStorage flag.
- **Local-First Boundary:** The intake server is device-local HTTP for Social Stream Ninja Call Webhook. There is no MUZERO server, account, telemetry, or cloud queue.
- **Logging:** Use `src/lib/logger.ts`; redact auth tokens, raw payloads, requester ids, local endpoint query strings, API keys, cookies, signed URLs, and file paths.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [PRD Template](../prd-template.md) | Base PRD structure. |
| [AI DJ Foundation](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | Core DJ loop and TrackBrief contract. |
| [AI DJ Chat Agent Panel](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | Existing chat runtime and tool-call architecture. |
| [External Streaming Sources](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | Online source search/ingest that may be optionally exposed to AI route. |
| [Settings Information Architecture](../20260613-muzero-settings-information-architecture-prd/20260613-muzero-settings-information-architecture-prd.md) | Settings grouping and AI section context. |
| [`src/chat/dj-chat-tools.ts`](../../../src/chat/dj-chat-tools.ts) | Existing AI DJ tools: library search, set curation, play controls, online search. |
| [`src/lib/track-search.ts`](../../../src/lib/track-search.ts) | Existing local search scoring and memory/tag/lyrics surfaces. |
| [`src/stores/player-store.ts`](../../../src/stores/player-store.ts) | Existing playback actions and queue orchestration. |
| [`src/player/queue.ts`](../../../src/player/queue.ts) | Existing pure queue math. |
| [`src-tauri/src/lib.rs`](../../../src-tauri/src/lib.rs) | Current minimal Tauri shell; local intake server belongs here or a small module called from here. |

---

## 10. Open Questions

| # | Question | Status | Recommendation |
|---|----------|--------|----------------|
| 1 | Social Stream Ninja 的接入方式是什么？ | Resolved | 使用 Call Webhook HTTP POST，并勾选 full message object as JSON body。 |
| 2 | 默认路由应该是 AI DJ 还是 Search？ | Resolved | 默认 Search。点歌是高频低延迟场景，搜索便宜且可解释；复杂请求可手动/Hybrid 升级给 AI DJ。 |
| 3 | `play-now` 是否允许完全自动？ | Resolved | 默认动作是加到下一首；`play-now` 属高级动作，默认需要审批。 |
| 4 | 是否默认搜索在线源？ | Resolved | 默认先搜本地源；本地匹配分数太低时，若用户已配置在线源，再尝试在线源 fallback。 |
| 5 | 是否允许局域网设备发送点歌？ | Resolved | 暂不需要。Social Stream Ninja 与 MUZERO 都在本机运行，用户只配置本地 port。 |
| 6 | 请求历史是否保存观众昵称？ | Resolved | 不保存请求历史；观众昵称/消息只存在当前运行时内存和屏幕上的 transient inbox。 |
| 7 | AI DJ 路由要不要进入现有用户聊天历史？ | Resolved | 不进入现有聊天。每个 AI-routed 请求创建一个新 session；如果当前 AI session 正在处理，则后续请求先排队，等它结束后再开下一个新 session。 |

---

## 11. Acceptance Criteria

1. Settings 中存在可见的 Live requests 开关；默认关闭。
2. 桌面端开启后只监听 `127.0.0.1`，并显示 endpoint 与 token。
3. 未授权请求无法进入前端 runtime，也不会触发 DB/播放/LLM 副作用。
4. Social Stream Ninja Call Webhook `POST /v1/audience/request?token=...` 可以接收一条点歌消息并返回 request id。
5. Search route 能用现有搜索评分匹配本地曲库，并按设置执行 play-next / append / approved play-now。
6. 低置信度或并列候选不会自动切歌，会进入 Request Inbox。
7. 低本地匹配分数时，若用户配置了在线源，可以 fallback 到在线源搜索。
8. Hybrid route 在本地/在线搜索无明确命中时可把请求交给 AI DJ。
9. AI DJ route 复用现有 chat runtime/tool gating，不泄漏密钥、token、local path。
10. AI DJ route 每条请求创建新 chat session，并保证同一时间最多一个 live-request AI session 在处理；后续 AI 请求排队。
11. 请求历史不持久化；inbox/队列状态仅在当前运行时内存存在。
12. Flood/cooldown/duplicate 行为有单测覆盖。
13. 所有 UI 文案进入 en/zh/ja/ko i18n。
14. `src/**` 不新增 `console.*`。
15. 不引入 MUZERO 自有后端、账号、遥测、隐藏 runtime flag。

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial draft from PM request: live chat/Social Stream Ninja message intake, AI DJ route, search route, local desktop loopback architecture, security defaults, implementation phases. |
| 2026-06-13 | Codex | Resolved product open questions: Social Stream Ninja Call Webhook POST, default Search/play-next, online fallback only after low local confidence, no LAN, no persisted request history, and serial one-request-one-session AI DJ handling. |
