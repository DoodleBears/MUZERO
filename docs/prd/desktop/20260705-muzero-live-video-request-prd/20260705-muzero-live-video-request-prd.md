# PRD: MUZERO 点视频（弹幕点 MV / 视频请求）—— 关键词区分 + 来源 id 本地优先 + 时长上限 + 预设清晰度下载

**Status:** In Progress
**Created:** 2026-07-05
**Author:** DoodleBear
**Module:** `src/live-requests/`（intake-command / runtime / controller）· `src/streamsrc/`（stream-link / download-action / streamed-track-repo）· `src/db/types.ts`（intake 命令 + 时长上限设置）· Settings（点歌/点视频命令表 + 清晰度）

> 本 PRD 是两条已完成脉络的**交汇点**，几乎不新造轮子——它把两套已存在的能力**接线**成一个新的弹幕意图：
> 1. **弹幕点歌（点歌）** 关键词→意图路由体系（[`intake-command.ts`](../../../../src/live-requests/intake-command.ts) 的 `IntakeCommand` / `matchIntakeCommand` / `resolveCommands`，见 [`20260625-muzero-live-request-queue-routing-prd`](../20260625-muzero-live-request-queue-routing-prd/20260625-muzero-live-request-queue-routing-prd.md)）——已支持「可配置关键词 + 每命令自带路由/播放动作」。
> 2. **视频清晰度选择 + 下载到本地入库**（[`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md)，Phase 1–5 ✅）——已支持「BV号/YouTube id 定向解析 → 按预设清晰度 prefer-match-else-degrade 下载 → mux → 入库为可离线播放的 `kind:"video"` track」。
>
> **新增的产品缺口**：点歌的在线兜底目前**只走关键词搜索、且只拿音频**（[`defaultOnlineFallback`](../../../../src/live-requests/audience-request-runtime.ts) 用 `source.search(query)`）。观众想「点一个具体的 MV」（贴 `BV号` / `YouTube id`）没有独立入口，也不会**下载视频画面**、不会**按 id 命中本地已有**、不会**挡掉超长视频**。本 PRD 补齐这四件事，且**全部复用已验证链路**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 数据模型 + 命令模型：`点视频` intake 命令（`mediaKind:"video"`）+ 时长上限设置 + 库级 by-id 查找（纯函数） | ✅ Completed | [Phase 1](#phase-1数据--命令模型纯函数) |
| 2 | 请求 fulfillment：id 定向解析 → 本地优先 → 时长闸门 → 预设清晰度下载 → 入队播放（注入式 orchestrator） | ✅ Completed | [Phase 2](#phase-2请求-fulfillment-orchestrator) |
| 3 | 控制器接线 + 通知 + 播放时序（download-then-enqueue / 队列化，抗 OOM） | ✅ Completed（Electron 手测待跑） | [Phase 3](#phase-3控制器接线--通知--播放时序) |
| 4 | Settings UI（点视频命令表 + 时长上限 + 清晰度）+ i18n（en/zh/ja/ko） | ✅ Completed（Electron 手测待跑） | [Phase 4](#phase-4settings-ui--i18n) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序遵循 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) §3「基础设施先于覆盖广度」**：命令/数据模型与库级查找（Phase 1，纯函数）先合并，再做带运行时的 fulfillment（Phase 2/3），最后 UI（Phase 4）。

---

## 1. Overview

### 1.1 Background

MUZERO 已能作为「直播点歌台」：观众在弹幕/聊天里发 `点歌 周杰伦 七里香`，[`live-request-controller`](../../../../src/live-requests/live-request-controller.ts) 经 `matchIntakeCommand` 识别 `点歌` 前缀 → 库内搜索 → 命中即按 `playbackAction` 入队；未命中且开了在线兜底 → `source.search()` 联网找一首（**音频**）落「点歌歌单」再播。

同时，MUZERO 也已能「把 B站/YouTube 视频按清晰度下载进曲库」：⌘F 贴 `BV号`/`YouTube id` → [`parseBareStreamId`](../../../../src/streamsrc/stream-link.ts) 定向解析 → [`downloadStreamedHit`](../../../../src/streamsrc/download-action.ts) 按 `AppSettings.defaultVideoQuality`（默认 `"1080"`，prefer-match-else-degrade）→ mux → 建 `kind:"video"` 本地 track。

**但这两条能力没有在「弹幕请求」这一侧打通。** 观众无法「点一个 MV」，具体缺口：

1. **无法区分「点歌」与「点视频」**：只有一个 `request` 语义，走库搜索/音频兜底。没有一个「这是一个视频请求」的独立关键词与意图。
2. **点视频不会拿画面**：即便有人贴 `BV号`，在线兜底走的是关键词 `search()` + 音频 resolve，**不下载视频轨**，观众看不到 MV。
3. **不「本地优先」**：同一个 `BV号` 若曲库里已下过（有 `blobId` 的本地视频），当前请求路径不会先命中本地——会重新联网/重复下载。
4. **无时长上限**：有人点一个 2 小时的直播回放/合集，会触发超长下载（内存/磁盘炸，见 [[bulk-video-download-oom-risk]]）与队列占用，主播无从设限。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **主播 / 房主（owner）** | 开直播点歌台，希望观众除了点歌，还能「点 MV」——贴 `BV号`/`YouTube id` 即把该视频按主播预设清晰度下载进本地并播放；能设「点视频」关键词、时长上限、清晰度。BYOK：自带 B站/YT 登录态解锁高清。 | 全功能；点视频**默认关闭**（沿用在线源 + 弹幕请求红线，见 §8），需开启在线源 +（如需高清）登录 |
| **观众（audience）** | 在弹幕/聊天发 `点视频 BV1xx…` 或 `点视频 dQw4w9WgXcQ`，无需任何本地权限——请求经主播机器 fulfil。 | 仅发消息；受限流/时长/审批约束 |

> 单机产品（本地优先、无账号）。点视频是「点歌台」的视频向增量。

### 1.3 Core Value

1. **一句话点 MV**：`点视频 <BV号 / YouTube id / 链接>` → 主播机器解析该视频、按预设清晰度下载、播放画面。关键词可配。
2. **本地优先、不重复联网/下载**：曲库里已有这个来源 id（尤其已下载过视频）→ 直接播本地，不再联网、不重复下载（省流、秒开、离线可用）。
3. **可控**：时长上限（默认 8 分钟）挡掉超长视频，保护内存/磁盘/直播节奏；复用已有限流/去重/审批。
4. **零新栈**：不新增解码/网络/下载栈——`点视频` = 新 intake 命令 + 复用 `parseBareStreamId`/`getTracksByIds`/`findStreamedTrack`/`downloadStreamedHit`。所有源差异仍收在各 provider 纯映射里（规则 5/10）。

### 1.4 已验证基线（本 PRD 的起点，不从零做）

| 能力 | 现状 | 代码 |
|---|---|---|
| 关键词→意图路由（可配前缀、每命令自带 route/action、longest-prefix-first） | ✅ 已验证 | [`intake-command.ts`](../../../../src/live-requests/intake-command.ts) `matchIntakeCommand`/`resolveCommands`；`IntakeCommand`（[`types.ts:750`](../../../../src/db/types.ts)） |
| 控制器按 intent 分派（request / comment / rating） | ✅ 已验证 | [`live-request-controller.ts:233`](../../../../src/live-requests/live-request-controller.ts) |
| BV号/av号/YouTube id / 链接 定向解析（跳过关键词搜索） | ✅ 已验证（⌘F） | [`stream-link.ts`](../../../../src/streamsrc/stream-link.ts) `parseStreamLink`/`parseBareStreamId` |
| 按 id 取视频元信息（标题/作者/时长/封面） | ✅ 已验证 | `source.getTracksByIds`（bili/youtube）·`StreamSearchHit.durationSec` |
| 按 id / hit 下载视频（预设清晰度 prefer-match-else-degrade → mux → 入库 `kind:"video"`） | ✅ 已验证 E2E | [`download-action.ts`](../../../../src/streamsrc/download-action.ts) `downloadStreamedHit` + `DEFAULT_VIDEO_QUALITY="1080"` + `AppSettings.defaultVideoQuality` |
| Track 存来源归属（`streamSourceId` + `streamExternalId`="bvid#cid"/videoId）+ 下载档快照 | ✅ 已验证 | [`types.ts:201`](../../../../src/db/types.ts) `streamSourceId`/`streamExternalId`/`downloadedVideoHeight` |
| 按 (source, externalId) 找已存在的 streamed track（去重） | ✅ 存在（**但 session 域**） | [`streamed-track-repo.ts:55`](../../../../src/streamsrc/streamed-track-repo.ts) `findStreamedTrack(sessionId, source, id)` |
| 持久下载队列（并发上限、重试、关闭恢复；顺序逐条抗风控/OOM） | ✅ 存在 | `download-action.ts` `enqueueDownload`/`startBackgroundDownload` |
| 在线兜底落「点歌歌单」（`streamOnlineSetId`，不随活动集漂移） | ✅ 已验证 | [`resolveLiveRequestOnlineSetId`](../../../../src/live-requests/audience-request-runtime.ts) |

**关键事实（决定工程量）**：`点视频` 的解析、下载、入库、播放**全部已实现且经 E2E**。真正要新写的只有薄薄一层：**①命令模型加「视频请求」这一意图/媒介、②fulfillment 把「id 解析 → 本地优先 → 时长闸门 → 下载 → 入队」串起来、③一个库级（跨 session）by-id 查找、④时长上限设置 + Settings UI**。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
观众弹幕："点视频 BV1xY411k7eR"  （或 "点视频 BV1x…#12345"、"点视频 BV1x… 12345"、"点视频 https://youtu.be/dQw4…"、裸 id）
        │
        ▼
 live-request-controller.handlePayload
   matchIntakeCommand(msg, resolveCommands(intake))    ← 已存在；命中 video-request 命令（mediaKind:"video"）
        │  body = "BV1xY411k7eR"（前缀剥离后）
        ▼
 分派：command.intent==="request" && command.mediaKind==="video"  → runtime.handleVideoRequest   ← 新分支
        │
        ▼
 planVideoRequest(body, deps)                          ← 新纯函数（Phase 1/2）
   1) ref = parseStreamLink(normalize(body)) ?? parseBareStreamId(normalize(body))  ← 扩：认 bvid#cid / bvid 空格 cid
        └─ 非视频源(netease/qq)/无法解析 → rejected("unsupported-source"/"not-a-video-ref")
   2) resolvePartRef：bili 无 cid → fetchFirstCid → 默认 P1（bvid#cid）    ← 复用 bili-source（§4.1a）
   3) 本地优先：findLocalDownloadedVideo(ref.source, ref.id)     ← 新库级查找（v33 索引，精确 bvid#cid）
        └─ 命中【有 blobId 的已下载视频】→ play-local(trackId)   （仅在线引用无 blob → 不命中，继续下载 Q6）
   4) 在线：hit = source.getTracksByIds([ref.id])[0]             ← 已存在
        └─ null → rejected("unresolved")
        └─ 时长闸门：hit.durationSec > maxVideoRequestDurationSec（默认480）→ rejected("too-long")（未知时长放行 Q7）
        └─ download-online(ref)
        ▼
 executeVideoRequest(verdict, deps)                    ← 新 orchestrator（Phase 2/3）
   ├─ play-local     → executePlayback(action, localTrack)                 ← 复用，零联网
   ├─ download-online→ 入持久下载队列 → downloadStreamedHit(ref, {quality:defaultVideoQuality,
   │                       sessionId: streamDownloadsSetId})               ← 复用（预设清晰度 + prefer-else-degrade）
   │                    → 建 kind:"video" 本地 track（标题=视频标题+分P名 §4.3a）→ executePlayback(action, track)
   └─ rejected       → 通知观众（"仅支持 B站/YouTube 视频" / "视频过长（>8 分钟）" / "无法解析"）  ← 复用通知

 ┌── 所有出站 HTTP（解析/取字节）── getAppFetch() / mediaProxyUrl → muzfetch（Electron）──┐
 │  v1 仅 Electron（hasStreamingSources() gate，同 20260620 PRD）                          │
 └──────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **关键词→视频意图** | 扩 `IntakeCommand`（加 `mediaKind?:"audio"\|"video"`）+ `DEFAULT_INTAKE_COMMANDS` 追加 `video-request` 条目；`matchIntakeCommand` **零改动**（已按前缀命中任意命令） | 复用已验证的命令路由；`点视频` 只是又一个可配前缀的命令，不新造 parser |
| **id 定向解析（含分P）** | `normalizeVideoRequestBody` → `parseStreamLink` ?? `parseBareStreamId`（扩：认 `bvid#cid` 与 `bvid 空格 cid`）+ `resolvePartRef`（无 cid→默认 P1） | BV/av/YouTube-id/各源链接 + 分P 一处裁决（规则 5，无散落 `if(source===)`）；§4.1a |
| **本地优先查找（索引 + blob-gated）** | 新纯函数 `findLocalDownloadedVideo(source, externalId)`（库级，走 v33 复合索引 `[streamSourceId+streamExternalId]`；仅 `blobId` 齐全者算命中） | 现有 `findStreamedTrack` 限 sessionId + filter；点视频要「全库有没有**下载过**这个精确 id」且每请求走索引（Q4/Q6，§3.2/§4.2） |
| **时长闸门** | 纯判定 `withinRequestDurationLimit(durationSec, maxSec)`；数据来自 `hit.durationSec`（search/getTracksByIds 已带） | 纯函数、穷举单测（规则 7）；无需额外网络探测 |
| **预设清晰度下载** | `downloadStreamedHit(hit, {quality, sessionId})`（已存在）+ `AppSettings.defaultVideoQuality`（已存在，prefer-match-else-degrade） | 用户诉求「按设置里的清晰度、fallback 更低」= 现成语义，零新代码 |
| **播放入队** | `executePlayback`（play-now/play-next/append，已存在，store 光标相对插入，见 [[live-request-play-now-skip-bug]]） | 复用点歌的入队纪律，含 shuffle/repeat 正确性 |
| **抗 OOM 下载** | 走已有**持久下载队列**（顺序/并发上限），而非整块 fire-and-forget | 直播弹幕会突发多条点视频；队列化 + 时长上限双保险（[[bulk-video-download-oom-risk]]） |

### 2.3 Project Structure

```
src/
├── live-requests/
│   ├── intake-command.ts            # 扩：IntakeCommandMatch 透传 command（含 mediaKind）；matchIntakeCommand 逻辑不变
│   ├── video-request.ts             # 新：normalizeVideoRequestBody + planVideoRequest + withinRequestDurationLimit（纯）
│   ├── audience-request-runtime.ts  # 扩：handleVideoRequest / executeVideoRequest（注入式 orchestrator）
│   └── live-request-controller.ts   # 扩：intent==="request" && mediaKind==="video" → runtime.handleVideoRequest 分支
├── streamsrc/
│   ├── streamed-track-repo.ts       # 扩：findLocalDownloadedVideo(source, externalId)（库级、v33 复合索引、blob-gated）
│   └── download-action.ts           # 扩：composePartTitle（分P 命名 = 视频标题 + 分P名，修 title:part.title）§4.3a
├── db/
│   ├── types.ts                     # 扩：IntakeCommand.mediaKind?；DEFAULT_INTAKE_COMMANDS 加 video-request；
│   │                                #     AudienceRequestIntakeSettings.maxVideoRequestDurationSec?（默认 480）。落集复用 streamDownloadsSetId
│   └── muzero-db.ts                 # 扩：version(33) 加 tracks 复合索引 [streamSourceId+streamExternalId]（Q4，无 upgrade 回调）
└── components/settings/
    └── live-request-settings.tsx    # 扩：命令表编辑器已支持增改命令；补「点视频」默认行 + 时长上限输入 + 清晰度指向
```

> **遵循「不新增源代码文件，除非引入新 parser / lib bridge」（prd-create §3）**：唯一新文件 `video-request.ts` 是新的**请求-规划纯函数**（intake 的一个新意图规划器），其余全是 append。不新建 registry/adapter。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
IntakeCommand（关键词→意图）
   ├── 点歌   : { intent:"request", routeMode:"library-search", mediaKind:"audio"(默认) }   ← 已有
   ├── AI点歌 : { intent:"request", routeMode:"ai-dj" }                                     ← 已有
   ├── 点视频 : { intent:"request", mediaKind:"video", prefixes:["点视频","!mv","video:"] }  ← 新增
   ├── 评论   : { intent:"comment" }                                                        ← 已有
   └── 评分   : { intent:"rating" }                                                         ← 已有

点视频请求 body → parseStreamLink/parseBareStreamId → { source, id }
   ├─ 本地已有(source,id 且 kind:video/有 blobId) → 播本地
   └─ 否则 → getTracksByIds → 时长闸门 → downloadStreamedHit(预设清晰度) → 建本地视频 track → 播
```

### 3.2 Database Schema

⚠️ **设置/命令字段全是「附加的非索引字段」→ 无需迁移体**（参照 `Track.coverThumbhash`/`downloadedVideoHeight` 的 additive 做法）。**唯一的 Dexie bump 是 Q4 的复合索引**（v32→v33，纯 additive 索引、无 upgrade 回调、Dexie 自动重建，无数据迁移），见下 Indexing。

- **Current Schema:** [`src/db/types.ts`](../../../../src/db/types.ts) — `IntakeCommand`（750）、`AudienceRequestIntakeSettings`（692）、`AppSettings`（798+，含 `defaultVideoQuality`/`streamDownloadsSetId`/`streamOnlineSetId`）、`Track`（`streamSourceId`/`streamExternalId`/`downloadedVideoHeight`）。
- **Required Changes（TS 类型层 / 附加属性，零迁移）：**
  1. **`IntakeCommand` 加媒介维度**（[`types.ts:750`](../../../../src/db/types.ts)）：
     ```ts
     /** `request` only: fulfill as a downloaded video (点视频) instead of audio search.
      *  Undefined = "audio" (点歌 legacy behavior). A "video" command resolves its body
      *  as a BV/av/YouTube id-or-link, prefers a local copy, else downloads at the preset
      *  quality. Codename-stable additive field → no Dexie bump. */
     mediaKind?: "audio" | "video";
     ```
  2. **`DEFAULT_INTAKE_COMMANDS` 追加**（[`types.ts:764`](../../../../src/db/types.ts)）：
     ```ts
     { id: "video-request", intent: "request", mediaKind: "video", prefixes: ["点视频", "!mv", "video:"] },
     ```
     > `resolveCommands` 的 legacy 合成分支需在末尾并入该条（与 ai-dj/comment/rating 同款回填），保证旧 install 也自动获得点视频。
  3. **`AudienceRequestIntakeSettings` 加时长上限**（[`types.ts:692`](../../../../src/db/types.ts)）：
     ```ts
     /** 点视频请求的最大视频时长（秒）。超过则拒绝并通知观众。Undefined = 480（8 分钟）。 */
     maxVideoRequestDurationSec?: number;
     ```
     `DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS` 显式给 `maxVideoRequestDurationSec: 480`。
  4. **点视频落集（Q2 决策：复用已有架构，零新字段）**：直接复用 `AppSettings.streamDownloadsSetId`（下载视频已落此集），无则 `ensureDownloadsSet()`。**不新增** `liveRequestVideoSetId`——点视频=下载视频的一种触发，与 ⌘F 手动下载、收藏夹导入落同一「下载」集，语义一致。
- **Track 侧无字段改动**：下载后的视频沿用 `origin:"streamed"` + `kind:"video"` + `blobId`/`streamSourceId`/`streamExternalId`/`downloadedVideoHeight`（20260620 已定型，保留来源引用 + 记忆 + 可离线，见其 §3.1 Q2）。
- **Indexing（Q4 决策：按长期性能 Best Practice 加复合索引，Dexie bump v32→v33）：** 库级 by-id 查找是**每次点视频请求都跑一次的热路径**，必须索引化——`filter` 全表扫 streamed 子集是「低频路径可接受」的短期妥协，不符合长期性能纪律。故新增复合索引 `[streamSourceId+streamExternalId]`：
  ```ts
  // src/db/muzero-db.ts — 追加(当前最高版本 v32)
  this.version(33).stores({
    // 既有 tracks 索引原样保留 + 追加复合索引;纯 additive 索引 → 无 upgrade 回调、Dexie 自动重建。
    tracks: "id, sessionId, status, createdAt, kind, sourcePath, [streamSourceId+streamExternalId]",
  });
  ```
  `findLocalDownloadedVideo` 用 `db.tracks.where("[streamSourceId+streamExternalId]").equals([source, externalId])` 直取（O(log n)），对齐库内既有高性能复合索引方案（`memories` 的 `[trackId+createdAt]`(v4)、`trackLikes`(v26)）。**注意**：追加索引必须**保留 tracks 当前全部已有索引串**（v32 的定义），只在末尾加复合索引,漏写会丢索引。

### 3.3 Data Relationship Diagram

```
AudienceRequestIntakeSettings
   ├── commands[]                        （含 video-request，mediaKind:"video"，可配前缀）
   ├── maxVideoRequestDurationSec        （新增，默认 480）
   ├── requireApprovalForPlayNow / 限流 / 去重   （复用，点视频同样受约束）
   └── playbackAction                    （点视频命中后的入队动作，可被命令级覆盖）

AppSettings
   ├── defaultVideoQuality               （复用：点视频下载清晰度，prefer-match-else-degrade）
   ├── streamSources[source].videoQuality（复用：每源清晰度覆盖）
   └── streamDownloadsSetId               （复用：点视频落集，Q2；无独立 set）

Track(origin:"streamed", kind:"video")   ← v33 复合索引 [streamSourceId+streamExternalId]
   ├── streamSourceId + streamExternalId  （bili 精确 "bvid#cid" / youtube videoId）← 本地优先命中键（索引）
   ├── blobId/storageKey → MediaBlob(role:"media")   （下载后填 → 有 blob 才算「本地命中」，Q6）
   └── downloadedVideoHeight / tags / memories / cover
```

---

## 4. Provider / API Design

> **不新增 provider 接口**。点视频复用 `StreamSourceProvider` 既有的 `getTracksByIds`（by-id 元信息 + 时长）、`listVideoQualities`/`resolveVideo`（清晰度 + 视频轨，见 20260620 §4.1）。纯音频源（netease/qq）不实现 `resolveVideo` → `canDownloadVideo(source)` 为 false → 点视频对其自然拒绝（"该源不支持视频"）。

### 4.1 请求规划纯函数（Phase 1，`video-request.ts`）

```ts
// src/live-requests/video-request.ts
import { parseStreamLink, parseBareStreamId, type StreamLinkRef } from "@/streamsrc/stream-link";

export type VideoRequestPlan =
  | { kind: "play-local"; trackId: string }
  | { kind: "download-online"; ref: StreamLinkRef; durationSec?: number }
  | { kind: "rejected"; reason: "not-a-video-ref" | "unsupported-source" | "too-long" | "unresolved" };

export function withinRequestDurationLimit(durationSec: number | undefined, maxSec: number): boolean {
  if (!Number.isFinite(durationSec) || (durationSec ?? 0) <= 0) return true; // 未知时长 → 不因缺失而拒（宽松，见 §4.4）
  return (durationSec as number) <= maxSec;
}

export interface PlanVideoRequestDeps {
  parseRef: (body: string) => StreamLinkRef | null;                 // = normalizeVideoRequestBody → parseStreamLink ?? parseBareStreamId（§4.1a）
  canDownloadVideo: (source: StreamLinkRef["source"]) => boolean;   // 复用 download-action.canDownloadVideo
  resolvePartRef: (ref: StreamLinkRef) => Promise<StreamLinkRef>;   // bili 无 cid → 默认 P1（fetchFirstCid），补成 bvid#cid（§4.1a）
  findLocalDownloadedVideo: (source: string, externalId: string) => Promise<{ trackId: string } | null>;  // 库级、blob-gated（§4.2）
  fetchHitMeta: (ref: StreamLinkRef) => Promise<{ durationSec?: number } | null>;  // = getTracksByIds([externalId])[0]
  maxVideoRequestDurationSec: number;
}

export async function planVideoRequest(body: string, deps: PlanVideoRequestDeps): Promise<VideoRequestPlan>;
// 1) ref = deps.parseRef(body); null → rejected("not-a-video-ref")
// 2) !deps.canDownloadVideo(ref.source) → rejected("unsupported-source")   // netease/qq
// 3) ref = await deps.resolvePartRef(ref);   // bili: 无 cid → 默认 P1 → bvid#cid（§4.1a）
// 4) local = await deps.findLocalDownloadedVideo(ref.source, ref.id);  // 仅「有 blobId 的已下载副本」算命中（Q6）
//    命中 → play-local；未命中（含仅在线引用无 blob）→ 继续下载
// 5) meta = await deps.fetchHitMeta(ref); null → rejected("unresolved")
// 6) !withinRequestDurationLimit(meta.durationSec, max) → rejected("too-long")
// 7) → download-online(ref, meta.durationSec)
```

**纪律**：`planVideoRequest` 纯 + 注入、**never throws**、返回结构化 verdict（对齐 [`runStreamCache`](../../../../src/streamsrc/cache-stream.ts) / `runVideoDownload`）。所有 IO（DB 查、getTracksByIds、fetchFirstCid）由 caller 注入，穷举单测覆盖 7 条分支 + 时长边界（含未知时长放行、恰好等于上限）+ 分P 补全 + blob-gate（有引用无 blob → 不短路）。

### 4.1a 分P（多P）解析 + 默认 P1（Q3）

**body 归一（`normalizeVideoRequestBody`，纯）**：点视频 body 除了裸 `BV号`/链接，还要认两种带分P写法——
- `bvid#cid`（如 `BV1xY411k7eR#12345`，与 `streamExternalId` 同形，`parseBareStreamId` 已忽略 `#` 后缀 → 需扩：保留 cid）；
- `bvid<空格>cid`（如 `BV1xY411k7eR 12345`）→ 归一成 `bvid#cid` 再交 `parseBareStreamId`。

```ts
// 归一：把 "bvid 空格 cid" → "bvid#cid"；YouTube/链接原样透传。纯函数，穷举单测。
export function normalizeVideoRequestBody(body: string): string;
// "BV1x… 12345" → "BV1x…#12345"；"BV1x…#12345" → 原样；"BV1x…" → 原样（无 cid）；"https://…"/YT id → 原样
```

**`resolvePartRef`（注入，bili-only 一跳）**：解析出的 `StreamLinkRef` 若是 bili 且 `id` 不含 `#cid` → 调 `fetchFirstCid(bvid)`（bili-source 已有）补成 `bvid#cid`（**默认 P1**）；已含 cid / 非 bili → 原样。这样下游 `findLocalDownloadedVideo` / `fetchHitMeta` / `downloadStreamedHit` 拿到的都是**精确到分P**的 `bvid#cid`。

> **为什么默认 P1 而非「整篇」**：`streamExternalId` 恒为 `bvid#cid`（20260620 定型，分P 各自独立 track），没有「整 BV」这一实体。用户未指定分P 时取 P1 与 ⌘F 单视频下载、收藏夹导入的既有语义一致。

### 4.2 库级 by-id 查找（Phase 1，扩 `streamed-track-repo.ts`，索引化 + blob-gated）

现有 [`findStreamedTrack`](../../../../src/streamsrc/streamed-track-repo.ts) 限定 `sessionId` 且走 filter。点视频要「**整个曲库**有没有**下载过**这个精确 id」，且是每请求热路径 → **走复合索引**（§3.2 的 v33 `[streamSourceId+streamExternalId]`）：

```ts
// src/streamsrc/streamed-track-repo.ts — 附加
/**
 * 库级（跨 session）查找一个已【下载到本地】的 streamed 视频 track。
 * 点视频「本地优先」用：命中(有 blobId=可离线)即直接播本地，不再联网/重复下载。
 * Q6：只有在线引用(无 blobId)的 track **不算命中** → 调用方走 download-online 持久化。
 * 走 v33 复合索引直取，O(log n)，不全表 filter。
 */
export async function findLocalDownloadedVideo(
  sourceId: StreamSourceId,
  externalId: string,                                  // 精确 "bvid#cid"（已由 resolvePartRef 补全）/ youtube videoId
  db: MuzeroDB = defaultDb,
): Promise<Track | undefined>;
// db.tracks.where("[streamSourceId+streamExternalId]").equals([sourceId, externalId])
//   .filter(t => t.kind === "video" && !!t.blobId)   // Q6：必须已下载(有 blob)才算本地命中
//   .first();
```

> **匹配键纪律（Q3）**：`streamExternalId` 是精确 `"bvid#cid"`（分P 各自独立）。点视频 body 经 §4.1a 补成 `bvid#cid` 后**精确匹配**——请求 P3 只命中 P3 的本地副本，不会错播 P1。YouTube 直接用 videoId 精确匹配。

### 4.3 Fulfillment orchestrator（Phase 2/3，扩 `audience-request-runtime.ts`）

在 runtime 上新增（镜像既有 `executePlan`/`defaultOnlineFallback` 的注入纪律）：

```ts
// 依赖注入（可 fake 单测；真实实现由 controller/store 注入）
interface VideoRequestDeps {
  plan: (body: string) => Promise<VideoRequestPlan>;                  // = planVideoRequest 绑定 deps
  downloadHit: (ref: StreamLinkRef, opts: { quality?: string; sessionId: string })
      => Promise<{ trackId: string } | null>;                        // = downloadStreamedHit 包装（预设清晰度）
  resolveVideoSetId: () => Promise<string>;                          // 点视频落集（复用 streamDownloadsSetId/online）
  getTrack: (id: string) => Promise<Track | undefined>;
  executePlayback: (action: AudienceRequestPlaybackAction, track: Track) => Promise<void>;  // 复用
  notifyRejected: (reason: string, ctx: {...}) => void;              // 复用通知（[[live-request-notification]]）
}
async function handleVideoRequest(input): Promise<AudienceRequestRuntimeItem>;
```

- **download-online**：`downloadHit(ref, { quality: settings.defaultVideoQuality, sessionId })` → 内部 `downloadStreamedHit` 走**预设清晰度 prefer-match-else-degrade**（用户诉求「按设置清晰度、fallback 更低」= 现成）。落集 = `streamDownloadsSetId`（Q2 复用下载集）。下载完成 → `executePlayback(action, newTrack)`。**含 Q6**：`play-local` 未命中时（无 blob 的在线引用也算未命中）走这条持久化。
- **play-local**：本地已有**已下载**副本（`blobId` 齐全）→ 直接 `executePlayback(action, localTrack)`，零联网、零重复下载。
- **rejected**：`notifyRejected`（"仅支持 B站/YouTube 视频链接或 id" / "视频过长（超过 {n} 分钟）" / "无法解析该视频"）——复用 [`live-request-notification`](../../../../src/live-requests/live-request-notification.ts) 的 toast，never 静默吞（[[live-request-queue-routing-gaps]] §3.7 教训）。

### 4.3a 分P 下载命名 = 视频标题 + 分P名（Q3，修既有 bug）

**现状 bug**：[`enqueuePartsForDownload`](../../../../src/streamsrc/download-action.ts)（download-action.ts:409）建队列项时 `title: part.title`——`part.title` 只是**分P名**（bili `pages[].part`，缺省 `P{n}`），丢了视频标题。故一个多P视频下载后，库里显示成 `P1` / `第1P` 之类，看不出是哪部作品。

**修复（Q3）**：分P下载的 track 标题 = **`视频标题 - 分P名`**（`${hit.title} - ${part.title}`）；单P（无 pages 或 `part` 与标题重复）退化为纯视频标题，避免 `标题 - 标题` 冗余。

```ts
// download-action.ts enqueuePartsForDownload — title 拼接（纯，穷举单测）
const label = composePartTitle(hit.title, part.title, parts.length);
// 多P & part.title 非空且≠hit.title → `${hit.title} - ${part.title}`
// 单P / part.title 为空 / part.title===hit.title → hit.title
```

> 点视频命中 online 单P时，`downloadStreamedHit`/`downloadHit` 拿到的是 `bvid#cid` 精确 ref，标题取该分P的 `part.title` 拼视频标题同规则。此命名修复对**所有**分P下载路径（⌘F 手动、收藏夹导入、点视频）统一生效，不只点视频。

### 4.4 播放时序 + 抗 OOM（Phase 3，关键设计）

「点视频要下载视频」与「弹幕请求要尽快响应」存在张力，且直播弹幕**会突发多条**。设计（Q5 决策：先下载再播放，含 play-now）：

- **download-then-enqueue（默认，含 play-now）**：点视频命中 online → 入**持久下载队列**（`enqueueDownload`/`startBackgroundDownload`，已存在，并发上限 `downloadConcurrency`、失败重试、关闭恢复），下载完成回调再按 `playbackAction` 入播放队列。**不**整块 fire-and-forget（[[bulk-video-download-oom-risk]]：多条整视频进内存 → 渲染进程 OOM）。**不做**「边下边播 / 先 stream 直链后台补下」（Q5 明确否决 stream-first）——离线可靠、语义一致。
- **play-now 也是先下后播**（Q5）：`play-now` 命中 online 时下载完成才切入当前播放（复用 store 光标相对插入，见 [[live-request-play-now-skip-bug]]）；命中本地（有 blob）则 play-now 立即切入。下载期间给观众「下载中…」通知，避免观感卡顿被误认为无响应。
- **时长上限双保险**：`maxVideoRequestDurationSec`（默认 480s）先挡超长视频，从源头压下单条下载字节量。
- **未知时长（Q7）**：`getTracksByIds` 偶尔无 `durationSec` → `withinRequestDurationLimit` 返回 true（放行），交给下载队列 + 用户可见进度兜底；不因元信息缺失而误拒合法请求。

### 4.5 Error Handling & 边界

- **纯音频源被点视频**（`点视频 <netease songId>`）→ `rejected("unsupported-source")`，通知「网易云/QQ 不支持视频，请用 B站/YouTube」。
- **非视频 ref / 纯文字**（`点视频 周杰伦`）→ `rejected("not-a-video-ref")`：**不**对点视频做关键词搜索兜底（Q1 决策：点视频语义 = 指定具体视频 id/链接），通知引导「请贴 BV号 / YouTube 链接或 id」。想搜歌 → 用「点歌」。
- **VIP/登录墙 / 直链过期 / 磁盘不足**：全部沿用 `downloadStreamedHit` → `runVideoDownload` 的结构化 verdict（requires-login / no-permission / error），转成观众通知，不写坏 blob（20260620 §4.5）。
- **限流/去重/审批**：点视频复用 `AudienceRequestIntakeSettings` 的 `dedupeWindowSec`/`requesterCooldownSec`/`maxRequestsPerMinute`/`requireApprovalForPlayNow`——**下载是重操作**，去重尤其重要（同一 BV 被多人刷 → 命中本地或去重窗口，不重复下）。
- **Telemetry**：本地优先、无遥测（规则 1/8）。仅本地 logger，白名单 `source` / `videoHeight` / `durationSec` / `strategy` / `bytes`；**永不**记 externalId / URL / cookie / 观众标识 / 弹幕原文（与 prd-create §3 telemetry 白名单一致）。

---

## 5. Frontend Design

### 5.1 Page Structure

```
components/settings/
├── live-request-settings.tsx        # 命令表编辑器（已存在）：补「点视频」默认命令行 + 媒介标识
└── （同面板）                        # 「点视频」区块：时长上限输入 + 清晰度指向（复用在线源 defaultVideoQuality）
```

### 5.2 UI Components / Interaction

- **命令表编辑器（已存在，见 [`live-request-settings.tsx`](../../../../src/components/settings/live-request-settings.tsx)）**：现已支持增/改命令的前缀与路由。新增：
  - 展示内建 `video-request` 行（前缀默认 `点视频 / !mv / video:`，可增删改），标一个「视频」徽标（`mediaKind:"video"`）区别于点歌。
  - `enabled` 开关（关掉即禁用点视频，保留配置，复用 `IntakeCommand.enabled`）。
- **点视频设置区块（新）**：
  - **最大时长**：数字输入（分钟，内部存秒），默认 8 分钟；旁注「超过则拒绝并提示观众」。
  - **清晰度**：**不重复造控件**——一行说明「点视频按【在线源 → 默认视频清晰度】下载」+ 跳转链接到已有 `defaultVideoQuality` 设置（prefer-match-else-degrade）。
  - **落集**：说明点视频下载落「下载」集（`streamDownloadsSetId`，复用，Q2），无需新控件。
- **观众侧无 UI**：观众只发弹幕；反馈经既有请求通知（命中/下载中/被拒原因）呈现在主播的 live-request 面板 + 可选 toast。
- **入口 gate**：点视频区块仅当 `hasStreamingSources()` 且至少一个视频源（bili/youtube）启用时可编辑；否则灰显 + 「点视频需要在线源（桌面端）」提示（沿用 20260620 gate）。

### 5.3 State Management

- 命令表 + 时长上限 + 清晰度都是 `AppSettings`/`AudienceRequestIntakeSettings` 持久字段，经既有 Settings `update()` 落库（Dexie），**不进** Zustand 瞬态（规则 6）。
- 下载进度为 ephemeral，走既有下载队列的进度通知（20260620 已建），点视频不新增进度 UI。

### 5.4 i18n（4 locale，per prd-create §3）

所有新文案走 `t("ns.key")`，先加 **en**（类型源）再补 zh/ja/ko：点视频命令名/徽标、时长上限 label + 单位 + 说明、清晰度指向说明、四类拒绝原因（unsupported-source / not-a-video-ref / too-long / unresolved）、下载中/已本地命中通知。拒绝原因 `too-long` 用插值 `{{minutes}}`。默认前缀 `点视频` 等是命令配置值（用户可改），非 i18n 文案；解释性 UI 才进 i18n。少 locale 在 PR 标 "pending translation" + 开 followup。

---

## 6. Implementation Plan

> 顺序遵循「基础设施先于覆盖广度」。纯函数走 TDD（test → impl → green）；带运行时（下载/播放/IPC/UI）的部分实现后标「待 Electron 手测」，不冒充已验证（沿用 streamsrc/20260620 PRD 的 Progress Log 纪律）。真实验证走 dev 控制端点 harness（[[perf-control-endpoint-harness]] / `scripts/live-request-drive.mjs`），关 throttling、unset `ELECTRON_RUN_AS_NODE`。

### Phase 1: 数据 + 命令模型（纯函数）

**Goal:** 命令模型认识「点视频」、请求规划能产出 verdict、库级 by-id 查找就位——全纯函数，不下载、不播放。

**Tasks:**
- [x] `IntakeCommand.mediaKind?` + `DEFAULT_INTAKE_COMMANDS` 追加 `video-request` + `resolveCommands` legacy 合成并入该条（附加字段）。
- [x] `IntakeCommandMatch` 透传整个 `command`（controller 需读 `mediaKind`）；`matchIntakeCommand` 逻辑**不变**（回归既有测试）。
- [x] `AudienceRequestIntakeSettings.maxVideoRequestDurationSec?` + `DEFAULT_...` 给 480。
- [x] **Q4 索引**：`muzero-db.ts` `version(33)` tracks 加复合索引 `[streamSourceId+streamExternalId]`（保留 v32 全部既有索引串；无 upgrade 回调）。
- [x] **Q3 解析**：`normalizeVideoRequestBody`（`bvid 空格 cid` → `bvid#cid`，纯）+ `parseBareStreamId` 扩为保留 `#cid` 后缀（不再丢弃）；`resolvePartRef`（注入 `fetchFirstCid`，无 cid→P1）。穷举单测。
- [x] `video-request.ts`：`withinRequestDurationLimit` + `planVideoRequest`（纯 + 注入，7 分支 + 时长边界 + 分P补全 + blob-gate 穷举单测）。
- [x] `streamed-track-repo.ts`：`findLocalDownloadedVideo(source, externalId)`（走 v33 复合索引；**仅 `kind:"video" && blobId` 齐全算命中**，Q6）。`fake-indexeddb` 单测：命中有 blob / 有引用无 blob（不命中）/ 未命中 / 精确 cid 区分 P1≠P3。

#### Phase 1 Checklist
- [x] `matchIntakeCommand("点视频 BV1xx", resolveCommands(...))` 命中 `video-request`、body="BV1xx"；既有点歌/评分/评论命中无回归。
- [x] `normalizeVideoRequestBody` + `parseBareStreamId`：`BV..#cid` / `BV.. cid` / 裸 `BV..` / YT id / 链接 各解析正确。
- [x] `planVideoRequest` 对 {裸 BV(补P1) / BV#cid / YouTube 链接 / netease id(拒) / 纯文字(拒) / 超长(拒) / 未知时长(放行) / 本地有blob(play-local) / 本地仅引用无blob(继续下载)} 各返回正确 verdict。
- [x] `findLocalDownloadedVideo` 跨 session 命中且走复合索引；无 blob 不算命中；P1 与 P3 精确区分。
- [x] 全项目 `tsc` 绿；v33 索引迁移在 `fake-indexeddb` 下不报错、既有 tracks 索引查询无回归。验证：`pnpm vitest run src/live-requests/intake-command.test.ts src/live-requests/video-request.test.ts src/streamsrc/stream-link.test.ts src/streamsrc/streamed-track-repo.test.ts`、`pnpm biome check ...`、`pnpm typecheck` 均通过。

### Phase 2: 请求 fulfillment orchestrator + 分P 命名修复

**Goal:** 把 verdict 变成动作——本地播 / 联网下载（预设清晰度）后播 / 拒绝通知；顺带修分P命名，注入式、fake 单测。

**Tasks:**
- [x] runtime `handleVideoRequest`/`executeVideoRequest`（注入 `plan`/`downloadHit`/`resolveVideoSetId`/`executePlayback`/`notifyRejected`）。
- [x] `downloadHit` 包装：绑定 `downloadStreamedHit(ref, { quality: settings.defaultVideoQuality, sessionId })`；`fetchHitMeta` 绑定 `getTracksByIds`。
- [x] `resolveVideoSetId`：复用 `streamDownloadsSetId`（无则 `ensureDownloadsSet()`）（Q2）。
- [x] **Q3 命名**：`download-action.ts` `composePartTitle(videoTitle, partTitle, partCount)`（纯，穷举单测）+ 替换 `enqueuePartsForDownload` 的 `title: part.title` → `composePartTitle(...)`。**对所有分P下载路径统一生效**（⌘F/收藏夹/点视频）。
- [x] fake-deps 单测：play-local / download-online→play / rejected(每种) / 下载失败 verdict 转通知，never throws。

#### Phase 2 Checklist
- [x] 注入 canned deps：本地有 blob 命中直接播、不调 downloadHit；仅引用无 blob → 调 downloadHit。
- [x] online 路径：调 downloadHit(预设清晰度) → 建 track（标题=视频标题+分P名）→ executePlayback(action)。
- [x] 超长/不支持源/无法解析 → 各自 notifyRejected，无下载、无抛错。
- [x] `composePartTitle`：多P→`标题 - P名`、单P→纯标题、`part===标题`→不冗余。验证：`pnpm vitest run src/streamsrc/download-action.test.ts src/live-requests/audience-request-runtime.test.ts src/live-requests/live-request-controller.test.ts` 与 `pnpm typecheck` 通过。

### Phase 3: 控制器接线 + 通知 + 播放时序

**Goal:** 真正接进 live-request 管线，直播弹幕 → 点视频 → 下载 → 播放，抗 OOM。

**Tasks:**
- [x] `live-request-controller`：`command.intent==="request" && command.command.mediaKind==="video"` → `runtime.handleVideoRequest(body, {playbackAction override})`；点歌（audio）路径不变。
- [x] 下载走**持久队列**（`enqueueDownloadAndWait` → `enqueueDownload`/runner）而非整块 fire-and-forget；下载完成后按 action 入播放队列（[[bulk-video-download-oom-risk]]）。
- [x] 通知文案接 `notifyRejected`（不支持源 / 非视频引用 / 无法解析 / 超长 / 下载失败）；下载中进度复用既有 Downloads 队列 UI。
- [x] 复用限流/去重/审批门（下载重操作，去重优先命中本地/去重窗口）。
- [x] dev 控制端点 + `scripts/live-request-drive.mjs --video-id ...` 扩点视频注入（沿用 [[live-request-play-now-skip-bug]] harness）。

#### Phase 3 Checklist（**待 Electron 手测**）
- [ ] 真实 Electron：`点视频 BV1xx`（真 B站视频，登录后）→ 按 `defaultVideoQuality` 下载 → `kind:video` 入库（标题=视频标题+分P名）→ 按 action 播放，`/state` 回 `isPlaying=true, displayMode=video`。
- [x] **本地优先**：同一 `bvid#cid` 第二次点 → 秒命中本地（有 blob）、无联网、无重复下载；仅有在线引用（无 blob）时仍触发下载（Q6）。（unit/fake-indexeddb 已覆盖）
- [x] **分P**：`点视频 BV1xx 3`（或 `BV1xx#<cid>`）→ 下载并播放 P3、命名含视频标题；未给分P → 落 P1。（planner + `composePartTitle` 已覆盖）
- [x] **时长闸门**：点一个 >8 分钟视频 → 被拒 + 观众收到「过长」通知，无下载。（planner + notify wiring 已覆盖）
- [x] 突发多条点视频 → 走队列（并发≤`downloadConcurrency`）、内存不爆（prod build 第二次循环复测，见 [[playback-disk-io-cover-derivative-storm]] 的复测纪律）。（持久队列路径已接入；压力手测待跑）
- [ ] YouTube id/链接同样通路（PoToken 渲染器铸，20260620 §4.6）。

Automated validation: `pnpm vitest run src/live-requests/live-request-controller.test.ts src/streamsrc/download-action.test.ts src/live-requests/audience-request-runtime.test.ts`、Phase 3 Biome target、`pnpm typecheck` 均通过。Electron 网络手测需在有在线源登录态的桌面壳内执行：`node scripts/live-request-drive.mjs --video-id <BV-or-YouTube-id> --playback-action play-next`。

### Phase 4: Settings UI + i18n

**Goal:** 让主播能配「点视频」关键词、时长上限、清晰度。

**Tasks:**
- [x] `live-request-settings.tsx`：点视频命令行（前缀可编 + 视频徽标 + enable 开关）+ 时长上限输入（分钟）+ 清晰度指向说明。
- [x] i18n en→zh/ja/ko 全量（命令名/时长/清晰度说明/4 类拒绝原因/下载中·本地命中通知）。
- [x] web/tauri 壳下点视频区块灰显 + 「需在线源（桌面端）」提示。

#### Phase 4 Checklist
- [x] 四语言文案齐全、无内联硬编码用户可见串。验证：`settings.liveRequestsVideo*` 与 `settings.liveRequestsCommand.video-request` 已补齐 en/zh/ja/ko。
- [x] Settings UI harness：启用在线源后显示 `video-request` 命令，修改「最长视频时长（分钟）」会保存为秒。验证：`pnpm vitest run src/components/settings/live-request-settings.test.tsx` 通过。
- [ ] 端到端手测：配前缀「点MV」→ 发「点MV BV1xx」→ 下载→入库→播放→再点命中本地→点超长被拒，全通。（需 Electron 壳 + 在线源登录态）

Automated validation: `pnpm vitest run src/components/settings/live-request-settings.test.tsx` 通过；Phase 4 Biome target 与 `pnpm typecheck` 通过。Electron 网络手测需在有在线源登录态的桌面壳内执行：`node scripts/live-request-drive.mjs --video-id <BV-or-YouTube-id> --playback-action play-next`，并在 Settings 中先改前缀/时长上限确认持久化。

---

## 7. Out of Scope

- **点视频「+歌名」搜视频再下**（Q1 决策：不做）：点视频只认 BV/av/YouTube-id/链接。想按歌名找 → 用「点歌」。「点视频 周杰伦 MV」搜视频候选 + 消歧留后续独立增强。
- **边下边播 / stream-first**（Q5 决策：不做）：点视频 download-then-play（含 play-now）。先 resolveVideo 直链即时播、后台补下持久副本是体验增强，留后续。
- **点视频独立「点视频歌单」集**（Q2 决策：不做）：复用 `streamDownloadsSetId`；不新增 `liveRequestVideoSetId`。
- **网易云/QQ 视频**：纯音频源不实现 `resolveVideo` → 点视频对其明确拒绝，不涉及其 MV。
- **Tauri / web 壳 parity**：v1 仅 Electron（同 20260620，`hasStreamingSources()` gate）。
- **下载队列/断点续传的进一步硬化**：点视频复用现有持久队列；分片落盘断点续传是 20260620 §7 已列的后续增强，不在本 PRD 重复。
- **「整篇 BV」批量下全部分P**：点视频未指定分P = 默认 P1（Q3）；「一条点视频下全部分P」非本期语义（收藏夹/⌘F 已有「下载全部 N P」）。
- **DRM / 加密流**：红线——不解密任何受 DRM 保护内容（见 §8，沿用 [[qq-music-stream-source-state]]）。
- **移动端**：走 [native PRD](../../mobile/) 独立栈，不复用本桌面方案。

---

## 8. Security & Compliance Considerations

- **红线：只处理可自由流式播放的内容，不碰 DRM**。点视频拿的是与「在线播放/手动下载」同一份直链字节，只是由弹幕触发——不新增任何解密/破解。沿用 [[qq-music-stream-source-state]] / 20260620 §8：质量封顶明文可得档，不解密 DRM 容器。
- **Bilibili 工具链合规（2026）**：`bilibili-API-collect`（2026-01-28 律师函关停）/ `BBDown`（2026-05-14 archive）已死；WBI/playurl/DASH 参考以仍维护的 [yt-dlp `bilibili.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) / yutto 校准（见 [[bilibili-tooling-takedown-2026]]）。维持「个人本地使用、BYO 登录态、不解密 DRM、不商用分发破解逻辑」红线。
- **弹幕请求安全（沿用点歌）**：点视频复用 [`audience-request-security`](../../../../src/live-requests/audience-request-security.ts) 的限流/去重/冷却/审批；`bindHost:"127.0.0.1"` 本地回环、authToken 门禁；观众标识只用于限流、不落库、不进日志。
- **下载即重操作 → 双重限流 + 时长上限**：防止弹幕刷点视频造成下载风暴（风控 + OOM + 磁盘）。时长上限（默认 480s）+ 去重（同 id/窗口）+ 并发上限（`downloadConcurrency`）+ 顺序队列。
- **凭据纪律**：B站/YT cookie 只在 `AppSettings.streamSources`（规则 2），永不进日志/遥测/bundle/URL。
- **不打包 FFmpeg**：点视频下载复用 20260620 的 mediabunny copy-remux（MIT，无重编码，无 FFmpeg），不新增任何原生二进制（包体增量近 0）。
- **回退 = `git revert`，不藏 flag**：点视频命令/时长上限/清晰度都是**可见 Settings 控件**（`IntakeCommand.enabled` + 命令表 + 时长输入）；不塞 `localStorage`/URL/`window.*` 开关（规则 3，与 `feedback_no_hidden_backend_flags` 一致）。
- **codename 稳定**：新 `IntakeCommand.id="video-request"`、`mediaKind` 值 `"audio"`/`"video"`、set id 复用——跨品牌/跨壳不改（规则 4）。
- **Telemetry 白名单**：仅 `source`/`videoHeight`/`durationSec`/`strategy`/`bytes`；**永不**记 externalId/URL/cookie/弹幕原文/观众标识。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md) | **直接依赖**：视频清晰度选择 + 下载入库 + mediabunny mux + `downloadStreamedHit` + `defaultVideoQuality` + BV/YT 定向解析。点视频=把它接进弹幕请求 |
| [`20260625-muzero-live-request-queue-routing-prd`](../20260625-muzero-live-request-queue-routing-prd/20260625-muzero-live-request-queue-routing-prd.md) | **直接依赖**：弹幕点歌路由/入队/在线兜底/落集纪律。点视频复用其 `executePlayback`/通知/落集 |
| [`20260610-muzero-external-streaming-sources-prd`](../../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | 在线源接入（搜索/resolve/播放/缓存/`getTracksByIds`），点视频的解析栈来源 |
| [`20260621-muzero-download-queue-resume-autosync-prd`](../20260621-muzero-download-queue-resume-autosync-prd/) | 持久下载队列 + 断点续传（点视频抗 OOM 走此队列） |
| [yt-dlp `bilibili.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) | 仍维护的 Bilibili 提取参考（WBI/fnval/qn/DASH），替代已关停的 bilibili-API-collect（§8） |

---

## 10. Open Questions

> **全部 7 项已由用户拍板（2026-07-05），决策已回写正文对应章节。**

| # | Question | Status | Decision (2026-07-05) |
|---|----------|--------|----------------|
| 1 | 点视频是否支持「+ 歌名」搜视频，还是只认 id/链接？ | ✅ Resolved | **只认 id/链接**。非 id → `rejected("not-a-video-ref")` 引导贴 id。不做关键词搜视频（§4.5） |
| 2 | 点视频下载落哪个集？ | ✅ Resolved | **复用已有架构** = `streamDownloadsSetId`（下载集），无则 `ensureDownloadsSet()`。不新增 `liveRequestVideoSetId`（§3.2/§4.3） |
| 3 | 分P 处理 + 本地命中键 + 命名？ | ✅ Resolved（§4.1a/§4.3a） | **支持分P**：body 认 `bvid#cid` 与 `bvid<空格>cid`；**未给分P → 默认 P1**（`fetchFirstCid`）。本地命中键 = 精确 `bvid#cid`。**下载命名 = 视频标题 + 分P名**（修 `enqueuePartsForDownload` 的 `title:part.title` → `${hit.title} - ${part.title}`），不再只有分P名 |
| 4 | 库级 by-id 查找：filter 扫 vs 复合索引？ | ✅ Resolved（§3.2） | **按长期性能 Best Practice = 加复合索引** `[streamSourceId+streamExternalId]`，Dexie **bump 到 v33**（纯 additive 索引、无 upgrade 回调、自动重建）。by-id 走索引而非全表 filter，对齐已有高性能索引方案（`memories` 的 `[trackId+createdAt]`、`trackLikes`） |
| 5 | play-now：download-then-play vs stream-first？ | ✅ Resolved | **先下载再播放**（含 play-now）。离线可靠、语义一致；不做 stream-first（§4.4） |
| 6 | 命中本地但只有在线引用（无 blob）：即时播 vs 下载？ | ✅ Resolved | **仍需下载**。`play-local` 仅当本地副本**有 `blobId`**（已下载可离线）才短路；只有在线引用（无 blob）→ 走 download-online 持久化后再播（§4.2/§4.3） |
| 7 | 未知时长：放行 vs 保守拒绝？ | ✅ Resolved | **放行**。`withinRequestDurationLimit` 对无 `durationSec` 返回 true，交下载队列 + 进度兜底（§4.4） |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-05 | DoodleBear | Initial draft：点视频（弹幕视频请求）——`IntakeCommand.mediaKind:"video"` 新命令（可配前缀）+ id 定向解析（`parseBareStreamId`）+ 库级 by-id 本地优先（`findLocalDownloadedVideo`）+ 时长上限（默认 480s）+ 预设清晰度下载（复用 `downloadStreamedHit`/`defaultVideoQuality` prefer-match-else-degrade）。定位为 20260620（视频下载）× 20260625（弹幕点歌路由）的接线层，几乎零新栈 |
| 2026-07-05 | DoodleBear | Open Questions 全 7 项拍板并回写正文：**Q1** 只认 id/链接（不搜歌名）；**Q2** 复用 `streamDownloadsSetId`（不新增 set）；**Q3** 支持分P（`bvid#cid` / `bvid 空格 cid`，未给→默认 P1；本地精确 cid 匹配；**下载命名改为「视频标题 - 分P名」**，修 `enqueuePartsForDownload` 的 `title:part.title` bug，对所有分P下载路径统一生效）；**Q4** 按长期性能 Best Practice 加复合索引 `[streamSourceId+streamExternalId]`（Dexie v32→v33，纯 additive 无 upgrade）；**Q5** 先下载再播放（含 play-now，不做 stream-first）；**Q6** 本地命中须有 `blobId`（仅在线引用无 blob→仍下载持久化）；**Q7** 未知时长放行。新增 §4.1a（分P解析）/§4.3a（分P命名修复），Phase 1/2 任务与 checklist 相应扩充 |
| 2026-07-05 | Codex | Phase 1 ✅：TDD 完成 `mediaKind:"video"` 默认命令与 legacy 回填、`maxVideoRequestDurationSec` 默认 480、Dexie v33 `[streamSourceId+streamExternalId]` 复合索引、`normalizeVideoRequestBody` / `resolvePartRef` / `planVideoRequest` 纯规划器、`findLocalDownloadedVideo` 库级 blob-gated 查询。验证：目标 Vitest 90 tests、Biome、TypeScript typecheck 通过 |
| 2026-07-05 | Codex | Phase 2 ✅：TDD 完成 `executeVideoRequest`/`handleVideoRequest` 注入式 fulfillment、下载集解析复用 `streamDownloadsSetId`、`downloadStreamedHit` 默认清晰度绑定、拒绝/下载失败 never-throw 转状态、`composePartTitle` 分P命名修复。验证：Phase 2 目标 Vitest 49 tests、TypeScript typecheck 通过 |
| 2026-07-05 | Codex | Phase 3 ✅（自动化）：controller 按 `mediaKind:"video"` 分派到 `handleVideoRequest`；默认下载路径改为 `enqueueDownloadAndWait` 持久队列等待完成后播放；dev control endpoint 与 `scripts/live-request-drive.mjs --video-id` 支持点视频注入；拒绝/下载失败通知接入四语言 key。真实 Electron B站/YouTube 手测仍需在桌面壳执行 |
| 2026-07-05 | Codex | Phase 4 ✅（自动化）：Settings 命令表显示点视频命令、视频徽标与 enable 开关；视频请求区按 web/在线源状态灰显并提示；最长视频时长以分钟编辑、保存为 `maxVideoRequestDurationSec` 秒；补齐 en/zh/ja/ko Settings 文案。验证：Settings UI Vitest harness、Phase 4 Biome target、TypeScript typecheck 通过；真实 Electron B站/YouTube 手测仍需在线源登录态 |

---

> **Note:** 本 PRD 的核心是**接线而非新造**——点视频复用已 E2E 验证的视频下载栈（20260620）与弹幕点歌路由栈（20260625）。真正新写的仅：`mediaKind` 命令维度、`normalizeVideoRequestBody`/`resolvePartRef`（分P解析）、`planVideoRequest` 请求规划纯函数、`findLocalDownloadedVideo` 索引化 blob-gated 库级查找、`composePartTitle` 分P命名修复、`maxVideoRequestDurationSec` 时长闸门 + v33 复合索引 + Settings UI。源差异仍收在 provider 纯映射（规则 5/10），下载走持久队列 + 时长上限抗 OOM（[[bulk-video-download-oom-risk]]）。
