# PRD: MUZERO 下载队列 + 断点续传 + 歌单/收藏夹自动同步

**Status:** Draft
**Created:** 2026-06-21
**Author:** DoodleBear
**Module:** `src/streamsrc/`（download queue + resume）· `src/sync/`（playlist auto-sync scheduler）· `src/db/`（downloadJobs 表）· `src/lib/desktop/`（chunked range fetch）· Settings

> 承接 [`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md)（视频下载已合并进 main，PR #1）末尾列出的两个确认后续增强。该 PRD 把「下载一个视频」做通了，但**整单/大批量**（如默认收藏夹 529 条）下载是**内存级 fire-and-forget**——无持久队列、无断点续传、关闭即丢；且歌单同步只有手动增量，无自动定时。本 PRD 补这两块。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 持久下载队列（落 DB + 并发上限 + 重试 + 重启恢复 + UI 面板） | 🔄 P1a 数据层完成（表/repo/类型/迁移） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 断点续传（Range 分片拉取 + 分片落盘 + 直链过期重解析） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 歌单/收藏夹自动定时同步（调度器 + 可选「同步即下载」） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（prd-create.md §3 基础设施先于覆盖广度）**：Phase 1 的持久队列是 Phase 2（续传是队列任务的能力）与 Phase 3（自动同步把新视频**入队**）共同的地基，必须先合并。

---

## 1. Overview

### 1.1 Background

视频下载 PRD（已合并）落地后，下载链路是：`downloadStreamedHit` → `downloadStreamedVideoToLibrary`（resolve → fetch 整块进内存 → mediabunny worker mux → 落持久媒体存储 → 建 track）。单条/几条很好用，但批量场景（[`downloadHitsAsVideo`](../../../../src/streamsrc/download-action.ts) 顺序逐条 + 逐条进度通知）有三个硬伤：

1. **无持久化**：队列只活在内存（一串 `await`）。app 关闭 / 刷新 / 崩溃 → 未完成的全丢，重开不续。默认收藏夹 **529 条** 顺序裸跑体验差、且中断成本高。
2. **无断点续传**：每条**整块**拉进内存（`fetchBytes` 一次性 `resp.blob()`）再 mux——大视频内存峰值高（PRD 曾用 200MB 守卫），且一条下到 90% 断网就得从 0 重来。
3. **同步只能手动**：歌单/收藏夹**绑定 + 手动增量 re-sync 已存在**（[`streamPlaylistRef`](../../../../src/db/types.ts) + [`addStreamedPlaylistToSet`](../../../../src/stores/player-store.ts)，按 `source+externalId` 去重，源无关，Bili 收藏夹经上个 PRD 的 P5a 自动继承）。缺的是**自动/定时**——目前只有云盘 R2 有 [`auto-sync-scheduler`](../../../../src/sync/auto-sync-scheduler.ts)，streamed 歌单没有。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 把整个收藏夹/歌单一键下成本地视频离线看；订阅一个收藏夹，新视频自动同步进库（可选自动下载）。BYO 登录态。 | 全功能；功能默认 disabled / manual，需显式开启（沿用在线源红线） |

### 1.3 Core Value

1. **大批量可靠下载**：529 条收藏夹也能稳稳下完——失败重试、关闭重开自动续、并发可控、可暂停/取消。
2. **断点续传 + 低内存**：断网/重启后从断点继续，不重下；分片落盘而非整块内存，大视频不爆内存。
3. **订阅式自动同步**：绑定的收藏夹/歌单按间隔或启动时增量同步新视频，可选自动下载——「关注一个 UP 的收藏夹，新片自动进库」。
4. **本地优先**：队列与调度全在设备本地（IndexedDB + 本地定时器），无后端、无遥测。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
 入队来源                          持久队列（IndexedDB: downloadJobs）           队列运行器（单例）
  · ⌘F 下载按钮                     ┌─────────────────────────────────────┐      · 并发上限 N（默认 2-3）
  · 收藏夹「下载为视频」  ──enqueue──▶│ job: {id, source, externalId,        │◀──── · FIFO + 优先级
  · 自动同步发现的新视频             │   quality, audioOnly, status,        │      · 失败指数退避重试
                                    │   bytesDone, totalBytes, partKey,    │      · app 启动恢复 active/pending
                                    │   attempts, error}                   │           │
                                    └─────────────────────────────────────┘           ▼
                                                                          runJob(job): resolve(可能重解析过期直链)
                                                                              → resumableFetch(url, headers, fromByte=bytesDone)
                                                                                  · HTTP Range: bytes=<bytesDone>-
                                                                                  · 分片写 .part 文件（chunked，不进内存）
                                                                                  · 每片更新 job.bytesDone（断点）
                                                                              → 两轨齐 → mux(worker) → 落库 + 建 track
                                                                              → job.status=done（清 .part）

 歌单自动同步调度器（镜像 cloud auto-sync-scheduler）
  shouldSyncPlaylist(input) ──▶ 对每个 streamPlaylistRef 绑定集：到期 → addStreamedPlaylistToSet（增量去重）
                                  → 新 hits → （可选）enqueue 视频下载任务
  · per-set / per-source 频率（manual / app-start / 15 / 30 / 60min）+ 抖动 + 可见性/在线 gate + 失败退避
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **下载队列持久化** | Dexie 新表 `downloadJobs`（bump version + upgrade） | 本地优先；重启恢复需要持久状态（规则 1/4） |
| **队列运行器** | 模块作用域单例（注入 `now`/`sleep`/并发数，可确定性单测；不进 Zustand state，规则 6） | 与 `cloud-job`/`DjEngine` 同纪律：非响应式编排放模块作用域 |
| **断点续传** | HTTP `Range: bytes=<from>-` + 206 续传；分片写 `writeMediaStorageBlob`（已支持 `chunkSizeBytes`/`onProgress`）到 `.part` | B站/YT CDN 支持 Range/206（播放 seek 已依赖）；分片落盘修复整块内存 |
| **直链过期处理** | 续传前**重解析** stream URL（`resolve`/`resolveVideo`）再 Range——B站 `deadline=` / YT `expire` 直链秒级~小时级过期 | 直链不可长存；续传 = 重解析 + 从 `bytesDone` Range（同一视频字节内容一致） |
| **自动同步调度** | 镜像 [`auto-sync-scheduler.ts`](../../../../src/sync/auto-sync-scheduler.ts)：纯 `shouldSyncPlaylist` + 注入式 `createPlaylistAutoSyncScheduler` | 复用成熟模式（jitter / 可见性 / 在线 / 失败退避 / app-start 延迟），穷举单测 |
| **增量同步** | 既有 `addStreamedPlaylistToSet`（去重，源无关） | 不重造；自动同步只是「定时调它」 |

### 2.3 Project Structure

```
src/
├── streamsrc/
│   ├── download-queue.ts              # 新：队列状态机（纯 reducer：enqueue/start/progress/done/fail/retry）+ 单测
│   ├── download-queue-runner.ts       # 新：运行器（注入 now/sleep/concurrency；driveJob；启动恢复）
│   ├── resumable-fetch.ts             # 新：Range 分片拉取 + 偏移续传（纯逻辑 + 注入 fetch/writeChunk）
│   └── download-action.ts             # 改：startBackgroundDownload/downloadHitsAsVideo → enqueue（不再裸 await）
├── sync/
│   ├── playlist-auto-sync.ts          # 新：shouldSyncPlaylist（纯，仿 shouldRunAutoSync）+ createPlaylistAutoSyncScheduler
│   └── playlist-auto-sync.test.ts
├── db/
│   ├── types.ts                       # 改：DownloadJob 表行 + DjSession.autoSyncFrequency/autoDownloadNew + AppSettings.downloadConcurrency
│   ├── muzero-db.ts                   # 改：bump version + downloadJobs store + upgrade
│   └── download-job-repo.ts           # 新：队列 CRUD（list/put/updateProgress/cleanup）
├── components/
│   ├── downloads/downloads-panel.tsx  # 新：下载队列面板（进度/暂停/取消/重试/清理）
│   └── settings/                      # 改：下载并发 + per-set/source 自动同步频率 + 自动下载开关
└── stores/player-store.ts             # 改：入队动作（替代 fire-and-forget 循环）
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
DownloadJob (新表 downloadJobs)
  id, source, externalId, quality, audioOnly
  status: "pending" | "active" | "paused" | "done" | "failed"
  bytesDone / totalBytes        （断点 + 进度）
  partStorageKey?               （.part 文件，续传中）
  trackId?                      （done 后指向建好的本地 track）
  attempts, lastError?, createdAt, updatedAt

DjSession（既有，扩字段）
  streamPlaylistRef: {source,id}      （已有：绑定）
  autoSyncFrequency?: "manual"|"app-start"|"15min"|"30min"|"60min"   （新）
  autoDownloadNew?: boolean           （新：同步到新条目后自动入队下载视频）
  lastAutoSyncAt?: number             （新）
```

### 3.2 Database Schema

⚠️ 优先扩展、不重构。`downloadJobs` 是**新表**（需 bump version + `.upgrade()` 空回填）；`DjSession`/`AppSettings` 新字段**附加非索引、零迁移**（与上个 PRD 同纪律）。

- **Current Schema:** [`src/db/muzero-db.ts`](../../../../src/db/muzero-db.ts)（DB 已到 v19+），[`src/db/types.ts`](../../../../src/db/types.ts)。
- **Required Changes:**
  1. 新表 `downloadJobs`，索引 `id` + `status`（队列按 status 拉取 pending/active；这是热路径，值得建索引——与「按源筛选不建索引」不同，队列查询频繁）。
  2. `DjSession` 加 `autoSyncFrequency`/`autoDownloadNew`/`lastAutoSyncAt`（非索引附加）。
  3. `AppSettings` 加 `downloadConcurrency?`（默认 2）。
- **Rollback Plan:** 回退 = `git revert` + 重发版；遗留 `downloadJobs` 表无害（新版不读即可），不做 down-migration（本地优先单机）。
- **Privacy:** 队列只存源引用 + 进度，不存直链/cookie；`.part` 文件在持久媒体存储，完成或取消即清。

### 3.3 队列状态机（纯）

```
pending ──start──▶ active ──progress(bytesDone)──▶ active
   ▲                  │                              │
   │ retry(backoff)   ├──done────▶ done（清 .part）  │
   └──── failed ◀─────┤                              │
        (attempts++)  └──pause──▶ paused ──resume──▶ pending(bytesDone 保留)
```

`download-queue.ts` 是纯 reducer（`(jobs, event) → jobs`），穷举单测：入队去重（同 source+externalId+quality 不重复排队）、并发选取（pending 中取 ≤N 个非 active）、失败退避、暂停/恢复保留 `bytesDone`。

---

## 4. API / Module Design

### 4.1 队列运行器（注入式，仿 `cloud-job`）

```ts
// src/streamsrc/download-queue-runner.ts
export interface DownloadQueueDeps {
  now: () => number;
  concurrency: number;                              // AppSettings.downloadConcurrency
  listJobs: () => Promise<DownloadJob[]>;            // download-job-repo
  updateJob: (id: string, patch: Partial<DownloadJob>) => Promise<void>;
  runJob: (job: DownloadJob, onBytes: (done: number, total?: number) => void) => Promise<RunVideoDownloadResult>;
  onChange?: (jobs: DownloadJob[]) => void;          // UI 面板订阅
}
// start()：启动时把 active→pending（恢复），按 concurrency 驱动 pending；done/fail 更新；失败指数退避重试。
```

`runJob` 内部 = `resumableFetch`（见 §4.2）→ mux（既有 worker）→ 落库（既有 `cacheStreamedTrackBlob`）。失败/取消保留 `.part` + `bytesDone` 供续传。

### 4.2 断点续传（`resumable-fetch.ts`，纯逻辑 + 注入 IO）

```ts
export interface ResumableFetchDeps {
  resolveUrl: () => Promise<{ url: string; headers?: Record<string, string> }>; // 每次（重）解析直链
  fetchRange: (url: string, headers: Record<string, string>, fromByte: number) => Promise<ReadableStream>;
  appendChunk: (partKey: string, chunk: Uint8Array) => Promise<void>;            // writeMediaStorageBlob chunked
  onBytes: (done: number, total?: number) => void;
  getResumeOffset: () => number;     // job.bytesDone
}
```
- 续传：`fromByte = bytesDone` → `Range: bytes=<fromByte>-`；CDN 回 206 + `Content-Range` 则从偏移续；回 200（不支持 Range / 直链已变）则从 0 重下（清 .part）。
- **直链过期**：每次进入 `runJob` 先 `resolveUrl()` 重解析（B站 `deadline`/YT `expire` 已过期就重拿）；Range 作用于新直链（同视频同字节）。
- 偏移/Range 计算是纯函数，穷举单测（206/200/Content-Range 解析、重置条件）。

### 4.3 歌单自动同步调度器（镜像 `auto-sync-scheduler`）

```ts
// src/sync/playlist-auto-sync.ts
export function shouldSyncPlaylist(input: {
  set: DjSession; isVisible: boolean; isOnline: boolean;
  now: number; appStartedAt: number; jitterMs: number;
  lastAutoSyncAt?: number; consecutiveFailures?: number;
}): boolean;   // 纯，仿 shouldRunAutoSync（manual/app-start/15/30/60min + 退避 + gate）

export function createPlaylistAutoSyncScheduler(deps): { tick; start; stop };
// tick：对每个有 streamPlaylistRef + autoSyncFrequency≠manual 的集，到期 → addStreamedPlaylistToSet（增量）
//       → 新增 hits → 若 set.autoDownloadNew → enqueue 视频下载任务。
```

### 4.4 Error Handling
- 队列任务失败 → 指数退避重试（上限 N 次），超限标 `failed` + `lastError`，UI 可手动重试。直链过期/403 → 重解析重试。VIP/登录墙 → 标 `failed`（reason）不重试，提示登录。
- 自动同步失败 → 退避（同 cloud scheduler），不阻塞其它集。
- Telemetry：本地 logger only（规则 8），不上报 URL/cookie/externalId。

---

## 5. Frontend Design

### 5.1 下载面板
- 新 `downloads-panel.tsx`：列出队列（缩略图 + 标题 + 进度条/% + 状态），整体「N 下载中 / M 等待」；逐条暂停/取消/重试，整体暂停/清理已完成。入口：通知中心点开 / Settings / dock 角标。
- 既有逐条进度通知保留（单条下载仍弹通知）；批量时通知折叠为「队列摘要」并引导到面板。

### 5.2 Settings
- **下载**：并发数（1–4，默认 2）。
- **自动同步**（每个绑定了外部歌单的集，或 per-source 默认）：频率下拉（手动/启动时/15/30/60 分）+「同步后自动下载新视频」开关。
- i18n 4 locale（en 源 + zh/ja/ko），新键走 `t()`，不内联。

### 5.3 State
- 队列状态用 Dexie `useLiveQuery` 读 `downloadJobs`（响应式、规则 6）；运行器单例在模块作用域（不进 store）。调度器单例随 app 生命周期 start/stop（visibility 感知）。

---

## 6. Implementation Plan

### Phase 1: 持久下载队列
**Goal:** 入队即落 DB；运行器按并发驱动；失败重试；app 重启恢复未完成任务；下载面板。**先不做续传**（每任务仍整块下，但已持久 + 并发 + 恢复 = 替换 fire-and-forget）。
**Tasks:**
- [x] `downloadJobs` 表（v31）+ repo（[`download-job-repo.ts`](../../../../src/db/download-job-repo.ts)）+ 类型（`DownloadJob`/`DownloadJobStatus`/`PlaylistAutoSyncFrequency` + `DjSession.autoSync*` + `AppSettings.downloadConcurrency`）。tsc 绿。
- [x] `download-queue.ts` 纯状态机 + 单测（createDownloadJob/sameTarget 去重/selectNextJobs 并发/jobsToRecover 恢复/canRetry+retryBackoffMs 退避；7 测绿）。
- [ ] `download-queue-runner.ts` 运行器（注入式）+ 单测（并发/重试/恢复）。
- [ ] `download-action`/player-store 入队改造（`downloadHitsAsVideo`/收藏夹「下载为视频」→ enqueue）。
- [ ] `downloads-panel.tsx` + i18n。

#### Phase 1 Checklist
- [ ] 收藏夹「下载为视频」入队后，关闭重开 app → 未完成任务自动继续。
- [ ] 并发上限生效（默认 2 同时下）；失败任务退避重试、可手动重试。
- [ ] 529 条入队不卡 UI；面板进度准确。

### Phase 2: 断点续传
**Goal:** 任务分片 Range 下载、分片落盘、记录 `bytesDone`；中断后从断点续（含直链过期重解析）；低内存。
**Tasks:**
- [ ] `resumable-fetch.ts`（Range/206/200 + 偏移）+ 纯单测。
- [ ] `runJob` 接续传：resolve→range→appendChunk(.part)→两轨齐→mux→落库。
- [ ] 暂停/恢复保留 `bytesDone`；取消清 `.part`。

#### Phase 2 Checklist
- [ ] 下到 ~50% 断网/暂停 → 恢复从断点续（206 验证，不从 0）。
- [ ] 直链过期后恢复：重解析 + Range 续成功。
- [ ] 大文件（>200MB）内存平稳（分片落盘，非整块）。

### Phase 3: 歌单/收藏夹自动同步
**Goal:** 绑定集按频率自动增量同步；可选自动下载新视频（入队）。
**Tasks:**
- [ ] `playlist-auto-sync.ts` `shouldSyncPlaylist`（纯）+ scheduler（注入式）+ 单测。
- [ ] `DjSession.autoSyncFrequency/autoDownloadNew/lastAutoSyncAt` + Settings UI。
- [ ] app 生命周期 start/stop 调度器；到期 → `addStreamedPlaylistToSet` → 新 hits →（可选）enqueue。

#### Phase 3 Checklist
- [ ] 绑定收藏夹设 15min → 新增视频自动进集；开「自动下载」→ 自动入队下载。
- [ ] 不可见/离线/退避时不跑；jitter 生效；手动频率不自动跑。
- [ ] `shouldSyncPlaylist` 穷举单测（各频率/gate/退避）。

---

## 7. Out of Scope
- **转码 / 强制格式**：沿用上个 PRD 决策（不打包 FFmpeg，copy-remux 已够）。
- **跨设备同步队列**：队列是单机本地（本地优先）；不跨设备。
- **P2P / 多线程分段并发下载单文件**：v1 单连接 Range 续传；多分段并发是后续优化。
- **移动端**：走 native PRD。

## 8. Security & Compliance
- 个人本地 / BYO 登录态 / 默认关闭；队列 + .part 仅本地；不解密 DRM（红线）。
- **风控友好**：并发上限 + 自动同步 jitter/退避 + 顺序续传，降低对 B站/YT 的请求压力（社区脚本经验：大收藏夹批量需限速）。
- 凭据只在 settings（规则 2）；回退 = `git revert`，无 hidden flag（规则 3）。
- Bili 提取/收藏夹 API 以 yt-dlp 活源校准（bilibili-API-collect 已关停，见上个 PRD §8）。

## 9. Related Documents
| Document | Description |
|----------|-------------|
| [`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md) | 前序：视频下载 + 收藏夹同步（已合并 PR #1）；本 PRD 补队列/续传/自动同步 |
| [`auto-sync-scheduler.ts`](../../../../src/sync/auto-sync-scheduler.ts) | 云盘 R2 自动同步调度器——Phase 3 `playlist-auto-sync` 直接镜像其纯函数 + 调度模式 |
| [`download-action.ts`](../../../../src/streamsrc/download-action.ts) | 现有下载入口（fire-and-forget）；Phase 1 改为入队 |

## 10. Open Questions
| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `bytesDone` 续传：B站/YT CDN 对**重解析后的新直链**是否稳定支持从任意 offset 的 Range 206？ | Open | Phase 2 实测；若某源不稳定则该源回退「整块重下」（仍享队列/并发/恢复） |
| 2 | 自动同步频率粒度：per-set 还是 per-source 默认 + per-set 覆盖？ | Open（倾向 per-set + 可选 source 默认） | Phase 3 先 per-set（最直观），source 默认后加 |
| 3 | 下载面板入口形态（dock 角标 / 通知中心 / Settings 页）？ | Open | Phase 1 先做通知中心可展开 + Settings 入口，dock 角标后加 |
| 4 | 自动下载新视频的清晰度：用 `defaultVideoQuality` 还是 per-set 记忆？ | Open（默认 defaultVideoQuality） | 复用既有默认（1080p，prefer-match-else-degrade），per-set 覆盖后加 |

## 11. Document Change Log
| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | DoodleBear | Initial draft：下载队列（持久/并发/重试/恢复）+ 断点续传（Range 分片 + 直链重解析）+ 歌单/收藏夹自动同步（镜像 cloud auto-sync-scheduler）。承接视频下载 PRD（PR #1）的两个确认后续增强 |

---

> **Note:** 复用既有地基——`addStreamedPlaylistToSet`（增量去重）、`auto-sync-scheduler`（调度模式）、`writeMediaStorageBlob`（chunked 落盘）、video-mux worker、`downloadStreamedVideoToLibrary`（落库）。本 PRD 主要新增「持久队列 + Range 续传 + 调度器」三块编排，不重造下载/同步本身。
