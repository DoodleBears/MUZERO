# PRD: MUZERO 下载中心 — Gallery 第 6 个「下载」Tab（虚拟列表 + 全状态 + 筛选）

**Status:** Draft
**Created:** 2026-07-02
**Author:** DoodleBear
**Module:** `src/pages/search-page.tsx`（Gallery 第 6 个 mode）· `src/components/downloads/`（虚拟化下载中心 + 抽共享行）· `src/lib/download-center.ts`（纯筛选/排序/汇总）· i18n · 快捷键 registry

> 承接 [`20260621-muzero-download-queue-resume-autosync-prd`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md)（持久下载队列 `downloadJobs` 已就位）与 [`20260622-muzero-unified-background-progress-notification-prd`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md)（下载进度收敛到左上角通知栈）。那两个 PRD 把「下载怎么跑」「进行中进度怎么弹通知」做通了，但**下载队列本身只有一个藏在 Settings→在线源里的紧凑面板**（[`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx)），既不虚拟化（529 条收藏夹批量下 → 上百个 job 全量挂载），也没有一个**一等公民的浏览入口**。本 PRD 把下载列表提升成 tab 2（Gallery）的**第 6 个 mode「下载」**——虚拟化、全状态、可筛选，和「歌单 / 全部歌曲 / 专辑 / 歌手 / 发现」并列。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 纯核心 + 抽共享行（`download-center.ts` 筛选/排序/汇总 + 从 `downloads-panel` 抽 `DownloadJobRow`/action 钩子） | ✅ 完成（14 单测；progress口径倒置进 lib、`download-indicator` 委托；panel 改用共享行、Settings 不变） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Gallery 第 6 个「下载」tab（常驻 ModeTab + 快捷键 6 + 虚拟列表 + 筛选 chip + 聚合头 + 空态 + i18n×4） | ✅ 完成（代码就位 + 44 单测 + tsc/biome 绿 + E2E harness；真机行渲染/大批量待 Electron 手测） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 跨链接收尾（done job → 跳转 track/set · 通知「查看」改指本 tab · 环境感知空态） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（prd-create.md §3「基础设施先于覆盖广度」）**：Phase 1 先把纯 `download-center.ts`（筛选/排序/汇总，穷举单测）与「共享行」抽好——它同时是 Phase 2 虚拟列表的行渲染、和 Settings 旧面板的行渲染，抽好才不会造两套。Phase 2 才拼 tab。Phase 3 是纯增强，可独立后合。

---

## 1. Overview

### 1.1 Background

下载链路的**数据层已经完全就绪**（前两个 PRD 落地）：

- **持久队列表 `downloadJobs`**（[`db/types.ts` `DownloadJob`](../../../../src/db/types.ts)：`id/source/externalId/title/quality/audioOnly/status/bytesDone/totalBytes/partStorageKey/sessionId/coverUrl/trackId/attempts/lastError/createdAt/updatedAt`），状态机 `pending → active → done/paused/failed`（[`download-queue.ts`](../../../../src/streamsrc/download-queue.ts)），运行器并发/重试/重启恢复（[`download-queue-runner.ts`](../../../../src/streamsrc/download-queue-runner.ts)），入队/重试/移除/清理动作（[`download-action.ts`](../../../../src/streamsrc/download-action.ts)），仓库 CRUD（[`download-job-repo.ts`](../../../../src/db/download-job-repo.ts)：`listDownloadJobs`/`updateDownloadJob`/`deleteDownloadJob`/`clearFinishedDownloadJobs`）。
- **进行中进度**已通过 [`download-indicator.ts`](../../../../src/stores/download-indicator.ts)（`summarizeDownloadJobs` → 一条左上角聚合 loading toast）反馈。

但**下载的浏览/管理界面只有一处，而且是二等公民**：

1. **藏在 Settings→在线源**：[`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx) 挂在设置深处，用户要「看我下了什么 / 下到哪了 / 哪条失败了」得先进设置、翻到在线源。下载不是「设置」，是一等的内容活动，理应和歌单/专辑/歌手/发现并排在 tab 2。
2. **不虚拟化**：面板 `useLiveQuery(() => db.downloadJobs.orderBy("createdAt").reverse().toArray())` 后**全量 map 成行**。默认收藏夹 **529 条**批量下载 → 上百个 job DOM 节点同时挂载，与本仓一贯的虚拟化纪律（[`VirtualTrackList`](../../../../src/components/library/virtual-track-list.tsx) / [`VirtualCardGrid`](../../../../src/components/library/virtual-card-grid.tsx)）背道而驰，大批量时卡顿。
3. **无筛选**：`done`/`failed`/`active` 全混在一条时间线里。用户想「只看失败的重试」「只看进行中的」没有入口。

**本 PRD**：把下载列表提升成 **Gallery（tab 2 / search 页）第 6 个 mode「下载」**——**常驻**、**虚拟化**、**全状态 + 筛选 chip**、**聚合进度头**。它复用既有 `downloadJobs` 数据与动作，不新增任何持久化，只补「一个像样的下载中心 UI」。

> **需求方决策（2026-07-02 确认）**：
> 1. **范围 = 完整下载中心**：全状态（`pending`/`active`/`paused`/`done`/`failed`）+ 筛选 chip（全部 / 进行中 / 已完成 / 失败），非仅活动队列。
> 2. **呈现 = 进度优先的虚拟列表**：按虚拟列表实现（参考歌单/歌曲列表），聚焦「下载进度呈现」；**不必和 Settings 面板长得完全一样**——tab 是更丰富的浏览面，Settings 保留紧凑配置。
> 3. **显示时机 = 常驻**：作为固定的第 6 个 tab 常驻显示（不像「发现」那样 `hasStreamingSources()` 门控）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 一键把收藏夹/歌单下成本地视频/音频；要一个明确的地方看「下了多少、下到哪、哪条失败、重试/清理」，且大批量（数百条）也不卡。 | 桌面端全功能；纯前端浏览，无新增权限。web/无下载能力壳层照常显示 tab，空态说明。 |

### 1.3 Core Value

1. **下载是一等公民**：和歌单/专辑/歌手/发现并列在 tab 2，一眼可达，不再埋在设置里。
2. **大批量不卡**：虚拟列表——529 条收藏夹批量下也只挂可见行，符合本仓虚拟化纪律。
3. **全状态可筛选**：进行中 / 已完成 / 失败一键切换；失败集中重试，进行中集中看进度。
4. **零新增持久化**：完全复用 `downloadJobs` 表与既有动作，不 bump DB、不新表、不新播放/下载通路——纯 UI 表面（本地优先，规则 1/4）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                     数据源（已有，只读订阅）                纯核心（新，穷举单测）           UI（tab 2 第 6 mode）
                     ─────────────────────────               ────────────────────           ─────────────────────
  db.downloadJobs ──usePausedLiveQuery──▶  download-center.ts                        ┌── DownloadCenter（新，虚拟化）
    {status,bytesDone,totalBytes,          · filterDownloadJobs(jobs, filter)        │     ├─ 聚合头: N 进行中 · M 完成 · K 失败 + 进度
     coverUrl,title,trackId,sessionId}     · orderDownloadJobs(jobs)  (active→…→done)│     ├─ 筛选 chip: 全部 | 进行中 | 已完成 | 失败
                                           · summarizeDownloadCenter(jobs) → counts  │     ├─ VirtualList（TanStack Virtual，仿 VirtualTrackList）
                                             （复用/扩展既有 summarizeDownloadJobs）  │     │    └─ DownloadJobRow（共享行，从 downloads-panel 抽出）
                                                                                     │     │         cover · title · source · status · 进度条 · 动作
  既有动作（不改）                                                                    │     └─ 空态（无 job / web 无下载能力）
   enqueueDownload / retryDownload(id) / removeDownload(id) / clearFinishedDownloads()┘
        │                                                                                  ▲
        └───────────────── DownloadJobRow 的按钮直接调既有动作 ──────────────────────────────┘

  Gallery 集成（search-page.tsx）
    GALLERY_MODES:  ["sets","tracks","albums","artists","online","downloads"(NEW)]
    ModeTab value="downloads" shortcut="6"  → {t("gallery.modeDownloads")}    // 常驻，不 streaming 门控
    内容区 {mode === "downloads" && <DownloadCenter />}

  复用: Settings→在线源 的 downloads-panel.tsx 改为消费同一个 DownloadJobRow（不再各写一套行）
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **列表数据** | Dexie [`usePausedLiveQuery`](../../../../src/pages/search-page.tsx)(`listDownloadJobs`) | 真相在 `downloadJobs` 表；响应式自动正确（规则 6）；`paused` 变体在离开 tab 时暂停订阅（与 sets/tracks 同纪律，省无谓重算） |
| **虚拟化** | TanStack Virtual（镜像 [`VirtualTrackList`](../../../../src/components/library/virtual-track-list.tsx)） | 上百个 job 只挂可见行；固定行高（下载行结构规整），比 grid 更简单 |
| **筛选/排序/汇总** | 新纯模块 `src/lib/download-center.ts` + Vitest | 规则 7：纯函数穷举单测（筛选映射、状态排序、计数/聚合进度）。复用既有 [`summarizeDownloadJobs`](../../../../src/stores/download-indicator.ts) |
| **共享行 + 动作** | 从 [`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx) 抽 `DownloadJobRow` | DRY：tab（虚拟长列）与 Settings 面板（紧凑）共用行渲染 + 动作钩子，不造两套（prd-create「利用已有代码」）|
| **tab 集成** | 复用 Gallery `Tabs`/`ModeTab` + `GALLERY_MODES` + 快捷键 registry | 与既有 1–5 mode 同构（netease「发现」tab 即此模式）；新增 mode `downloads` + Digit6 |
| **i18n** | i18next 4-locale | 复用既有 `download.*`（状态/动作已全）；新增 `gallery.modeDownloads` + 筛选/聚合/空态少量键（en 源 → zh/ja/ko）|

### 2.3 Project Structure（改动点；只 append/抽取，不新建大结构）

```
src/
├── lib/
│   ├── download-center.ts            # [新] filterDownloadJobs / orderDownloadJobs / summarizeDownloadCenter（纯）
│   └── download-center.test.ts       # [新] 穷举单测（筛选/排序/计数/聚合进度/空）
├── components/
│   └── downloads/
│       ├── download-job-row.tsx      # [新] 从 downloads-panel 抽出的共享行（cover/title/source/status/进度/动作）
│       ├── download-center.tsx       # [新] tab 2 内容：聚合头 + 筛选 chip + VirtualList<DownloadJobRow> + 空态
│       └── downloads-panel.tsx       # [改] 改用 <DownloadJobRow>（删内联行）；Settings 保留紧凑面板
├── pages/
│   └── search-page.tsx               # [改] GALLERY_MODES + "downloads"；ModeTab(shortcut 6, 常驻)；内容区分支
├── stores/
│   └── download-indicator.ts         # [改·Phase3] 通知「查看」动作改指 downloads tab（不再 Settings）
└── i18n/locales/{en,zh,ja,ko}/common.json  # [改] gallery.modeDownloads + downloadCenter.* + nav/shortcuts 键
```

无 `src-tauri` / `electron` / Dexie schema 改动。无新依赖。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
本 PRD 不新增任何持久化数据模型。唯一数据源是已存在的 downloadJobs 表（前 PRD 建）：

  db.downloadJobs (已有, muzero-db.ts 索引 "id, status, createdAt")
      │  只读订阅（usePausedLiveQuery）
      ▼
  DownloadCenterView (纯派生, 内存)
      · filter: "all" | "active" | "done" | "failed"        （active = pending+active+paused，即「未完成/进行中」）
      · rows:   orderDownloadJobs(filterDownloadJobs(jobs))  （active→pending→paused→failed→done，次序内按 updatedAt desc）
      · summary: { inFlight, done, failed, total, progress } （progress = Σ(bytesDone/totalBytes)/有 total 的 active 数）
```

### 3.2 Database Schema

⚠️ **无 schema 变更。不 bump DB version。** `downloadJobs` 沿用 [`20260621` PRD](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) 的定义（[`db/types.ts` `DownloadJob`](../../../../src/db/types.ts) + [`muzero-db.ts`](../../../../src/db/muzero-db.ts) `downloadJobs: "id, status, createdAt"`），本 PRD **只读**（列表）+ 经既有动作**写**（重试/移除/清理，均已存在）。

- **Current Schema:** `downloadJobs`（`id` PK、`status` + `createdAt` 索引，队列/时间线查询已够）。
- **Required Changes:** 无。
- **Constraints & Indexing:** 现有 `status`/`createdAt` 索引足够；筛选/排序在内存对 liveQuery 快照做（数百量级，微秒级），**不新增索引**（与本仓「浏览态派生在内存」一致）。
- **Rollback Plan:** 回退 = `git revert` 注册项（`GALLERY_MODES` 去掉 `"downloads"` + 删组件）+ 重发版；无 down-migration（无 schema 改动）。无 hidden flag（规则 3）。
- **Privacy & Retention:** 队列只存源引用 + 进度 + 封面 URL 快照，不存直链/cookie；tab 只显示 title/封面/计数/百分比，不显示 URL/headers/token。

### 3.3 Data Relationship Diagram

```
DjSession(集) ──sessionId──┐
                           ▼
DownloadJob ──trackId──▶ Track(下载完成建的本地 track)   ← done 行「跳转到歌曲/所在集」用 trackId + sessionId
   │  coverUrl (封面快照, 队列期用) ──▶ DownloadJobRow 缩略图
   └  status/bytesDone/totalBytes ──▶ 行进度条 + 聚合头
```

---

## 4. API / Module Design

> 本 PRD 无网络 API。这里描述**内部模块接口**。

### 4.1 纯核心（`src/lib/download-center.ts`，规则 7 穷举单测）

```typescript
import type { DownloadJob, DownloadJobStatus } from "@/db/types";

export type DownloadFilter = "all" | "active" | "done" | "failed";

// active 语义 = 未完成的（用户视角「进行中」）：pending + active + paused
const ACTIVE_STATUSES: DownloadJobStatus[] = ["active", "pending", "paused"];

/** 按筛选切片（纯）。 */
export function filterDownloadJobs(jobs: readonly DownloadJob[], filter: DownloadFilter): DownloadJob[];

/** 展示排序（纯）：active → pending → paused → failed → done；同段内 updatedAt desc（新→旧）。 */
export function orderDownloadJobs(jobs: readonly DownloadJob[]): DownloadJob[];

/** 聚合计数 + 进度（纯）。progress 复用 summarizeDownloadJobs 的口径：仅有 totalBytes 的 active 才计入平均。 */
export interface DownloadCenterSummary {
  total: number;
  inFlight: number;   // ACTIVE_STATUSES 计数
  done: number;
  failed: number;
  progress: number | null;  // 0..1；无可测字节时 null（YouTube blob 传输无 total → 不显示进度条）
}
export function summarizeDownloadCenter(jobs: readonly DownloadJob[]): DownloadCenterSummary;
```

- `progress` 与既有 [`summarizeDownloadJobs`](../../../../src/stores/download-indicator.ts)（左上角通知）**同口径**，避免 tab 聚合头与通知条百分比打架——直接复用/委托该函数，不重算。
- 三个函数全纯、注入无副作用，穷举单测：各 filter 的切片、五状态混排后的稳定排序、空数组、无 total 不给 progress、多任务平均、全 done → inFlight 0。

### 4.2 共享行（`DownloadJobRow`，从 `downloads-panel.tsx` 抽出）

```typescript
// src/components/downloads/download-job-row.tsx
export interface DownloadJobRowProps {
  job: DownloadJob;
  onRetry?: (id: string) => void;     // 既有 retryDownload
  onRemove?: (id: string) => void;    // 既有 removeDownload
  onOpenTrack?: (job: DownloadJob) => void;  // Phase 3：done 行跳转 track/set
  compact?: boolean;                  // Settings 面板紧凑；tab 用完整（进度条更明显）
}
```

- 行内容：封面缩略图（`job.coverUrl`）· 标题（`job.title`）· 源徽标（`job.source`）· 状态标签（`t("download.status*")`，已有）· 进度条（`bytesDone/totalBytes`，`active` 且有 total 时）· 动作按钮（`failed`→重试；非 `active`→移除；`failed`→复制错误）。
- 这些**行为/文案 downloads-panel 已实现**——抽成组件后 tab 与 panel 共用；`compact` 控制密度差异（满足「tab 不必和 Settings 完全一样」）。

### 4.3 动作（全部复用，不新增）

| 动作 | 既有符号 | 来源 |
|---|---|---|
| 重试失败 | `retryDownload(id)` | [`download-action.ts`](../../../../src/streamsrc/download-action.ts) |
| 移除/取消（非 active）| `removeDownload(id)` | 同上 |
| 清空已完成 | `clearFinishedDownloadJobs()` | [`download-job-repo.ts`](../../../../src/db/download-job-repo.ts) |
| 复制错误详情 | 面板既有 clipboard 逻辑 | [`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx) |
| （Phase 3）跳转到歌曲/所在集 | `useNavStore().openSet(sessionId)` / 定位 `trackId` | [`nav-store.ts`](../../../../src/stores/nav-store.ts) |

### 4.4 Error Handling / Edge Cases

- **空队列**：`total === 0` → 友好空态（区分「无下载能力壳层」vs「有能力但暂无任务」，见 §5.2）。
- **某 filter 空、总非空**：如只有 done、切到「失败」→ 该 filter 空态（「没有失败的下载」），聚合头仍显示总计。
- **无 total 的进行中**（YouTube blob）：行显示 indeterminate（转圈/脉冲），不显示百分比；聚合头 `progress` 为 null 时头部只显示计数。
- **done 行跳转**：`trackId` 缺失（历史 job / 已被删）→ 跳转禁用或落到所在集；`sessionId` 缺失 → 落到「下载」默认集。
- **Telemetry：无**。本地优先无遥测；仅 [`logger.ts`](../../../../src/lib/logger.ts) warn/error，绝不记 URL/title 之外内容（规则 8）。

---

## 5. Frontend Design

### 5.1 Page Structure

「下载」是 Gallery（[`search-page.tsx`](../../../../src/pages/search-page.tsx)）的**第 6 个 mode**，不新增路由：

```
// search-page.tsx
GalleryMode = "sets" | "tracks" | "albums" | "artists" | "online" | "downloads"   // [改] 追加
GALLERY_MODES = [..., "downloads"]                                                 // [改]

<TabsList>
  <ModeTab value="sets"      shortcut="1">{t("gallery.modeSets")}</ModeTab>
  <ModeTab value="tracks"    shortcut="2">{t("gallery.modeTracks")}</ModeTab>
  <ModeTab value="albums"    shortcut="3">{t("gallery.modeAlbums")}</ModeTab>
  <ModeTab value="artists"   shortcut="4">{t("gallery.modeArtists")}</ModeTab>
  {streamingSupported && <ModeTab value="online" shortcut="5">{t("gallery.modeOnline")}</ModeTab>}
  <ModeTab value="downloads" shortcut="6">{t("gallery.modeDownloads")}</ModeTab>   {/* [新] 常驻，不门控 */}
</TabsList>

{mode === "downloads" && <DownloadCenter />}                                       // [新] 内容区分支
```

> **门控差异（有意）**：「发现」`online` 依 `streamingSupported` 条件渲染，故其快捷键实际是「第 5 个可见 tab」；「下载」**常驻**（需求方决策 3），快捷键固定 Digit6。当 `online` 因 web/未启用而隐藏时，可见 tab 是 1/2/3/4/6——快捷键绑数字键位（Digit6）而非「第 N 个」，位置不因 online 显隐而漂移。

### 5.2 UI Components

- **`DownloadCenter`（新，tab 内容）**：自上而下
  1. **聚合头**：`summarizeDownloadCenter` → 「N 进行中 · M 已完成 · K 失败」+（有 progress 时）总进度条；右侧「清空已完成」按钮（`clearFinishedDownloadJobs`）。
  2. **筛选 chip 行**：`全部 | 进行中 | 已完成 | 失败`（`DownloadFilter`），本地 `useState` + `localStorage`（视图偏好，非行为 flag，允许；cf. 规则 3 与既有 `MODE_KEY` 同纪律）。带计数角标。
  3. **虚拟列表**：`orderDownloadJobs(filterDownloadJobs(jobs, filter))` → TanStack Virtual（镜像 [`VirtualTrackList`](../../../../src/components/library/virtual-track-list.tsx)），行 = `<DownloadJobRow>`（完整密度）。
  4. **空态**：无能力壳层（web，`hasDownloadCapability()`/无 bridge writeMediaStorageBlob）→「下载需要桌面版」；有能力但空 →「暂无下载 · 去在线源/收藏夹下载」引导。
- **`DownloadJobRow`（新共享行）**：见 §4.2；tab 用完整密度（进度条醒目），Settings 面板用 `compact`。
- **[`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx)（改）**：Settings→在线源保留此紧凑面板（快速一瞥 + 配置旁），但**行改用 `<DownloadJobRow compact>`**，删内联行 markup；避免两套行。（自动同步配置 [`playlist-sync-panel.tsx`](../../../../src/components/downloads/playlist-sync-panel.tsx) 不动，仍在 Settings。）
- **响应式**：与其它 Gallery mode 一致（`md` 分界）；移动端行紧凑、动作进 overflow；桌面完整。虚拟列表容器与 tracks mode 同布局约束。

### 5.3 State Management

- **列表**：`usePausedLiveQuery(() => listDownloadJobs(), [])`（响应式 + 离开 tab 暂停，规则 6）。筛选/排序/汇总用 `useMemo` 键于 `[jobs, filter]`（纯函数，微秒级）。
- **filter 选择态**：`DownloadCenter` 本地 `useState` + `localStorage`（如 `muzero-download-filter`），与 `MODE_KEY` 同纪律。
- **动作**：直接调既有模块函数（`retryDownload`/`removeDownload`/`clearFinishedDownloadJobs`），不进 Zustand；下载运行器单例仍在模块作用域（不进 store state，规则 6）。
- **不新增 store**：本 PRD 零新 Zustand state；`download-indicator` 单例（通知）不动（Phase 3 仅改其「查看」动作目标）。

---

## 6. Implementation Plan

### Phase 1: 纯核心 + 抽共享行

**Goal:** `download-center.ts` 三个纯函数有穷举单测；`DownloadJobRow` 从 `downloads-panel` 抽出，两处（未来的 tab + 现有 Settings 面板）共用同一行。

**Tasks:**
- [x] 新增 [`src/lib/download-center.ts`](../../../../src/lib/download-center.ts)：`filterDownloadJobs` / `orderDownloadJobs` / `summarizeDownloadCenter` + `isInFlight` + `DownloadFilter` 类型。**实现决策（倒置依赖）**：progress口径的单一真相搬到本纯 lib 的 `downloadAggregateProgress`，[`download-indicator.ts`](../../../../src/stores/download-indicator.ts) 的 `summarizeDownloadJobs` **委托**它（store→lib 正确方向；避免 lib 反向 import 重量级 store，且两处进度永不打架）。
- [x] `download-center.test.ts`（14 例）：各 filter 切片（all/active=pending+active+paused/done/failed）、五状态稳定排序、同段 updatedAt desc、不变性（不 mutate 入参）、空数组、无 total 不给 progress、多任务平均、全 done → inFlight 0。
- [x] 抽 [`download-job-row.tsx`](../../../../src/components/downloads/download-job-row.tsx)（cover/title/status/进度条/重试/移除/复制错误 + `compact` prop + `onOpenTrack?` 预留给 Phase 3）；[`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx) 改用 `<DownloadJobRow compact>`（删内联 `DownloadRow`/`statusLabel`），Settings 行为/外观不变。

#### Phase 1 Checklist
- [x] `download-center` 四函数单测全绿（14 例，含边界：空、无 total、五态混排、各 filter、不变性）。
- [x] `downloads-panel` 改用 `DownloadJobRow` 后，Settings→在线源下载面板行为/外观不变（重试/移除/复制/清空/进度）；`download-indicator` 委托后 13 单测零回归。
- [x] `make check` 等价（`tsc --noEmit` + biome + 27 单测）通过；无 `console.*` 直连（规则 8）。

### Phase 2: Gallery 第 6 个「下载」tab

**Goal:** tab 2 出现常驻「下载」mode（快捷键 6），虚拟列表 + 筛选 chip + 聚合头 + 空态，动作可用。

**Tasks:**
- [x] [`search-page.tsx`](../../../../src/pages/search-page.tsx)：`GalleryMode` + `GALLERY_MODES` 加 `"downloads"`；`ModeTab value="downloads" shortcut="6"`（**常驻**，不 `streamingSupported` 门控）；内容区 `{mode === "downloads" && <DownloadCenter/>}`；`GalleryWallMode`/`SEARCH_PLACEHOLDER_KEY`/`isGalleryWallMode` 排除 downloads；wall 容器对 downloads 走 `overflow-hidden`（内层虚拟列表自滚，同 tracks）；toolbar 行对 downloads 隐藏（同 online）。`~` 循环 + Digit6 直跳自动纳入（`GALLERY_MODES`/`GALLERY_TAB_ACTIONS`）。
- [x] 快捷键 registry 加 `nav.galleryTabDownloads`(Digit6) + `GALLERY_TAB_ACTIONS` 追加；registry 单测扩到 Digit1–6。
- [x] 新增 [`download-center.tsx`](../../../../src/components/downloads/download-center.tsx)：聚合头（in-flight 计数 + 进度条 + 「清空已完成」）+ 筛选 chip（计数角标 + `localStorage` `muzero-download-filter`）+ TanStack Virtual 列表（`useVirtualizer` + `measureElement` 动态行高，`<DownloadJobRow>`）+ `useMemo` 筛选/排序。**实现决策**：用 `useLiveQuery`（非 `usePausedLiveQuery`）——组件仅在 `mode==="downloads"` 条件挂载，切走即卸载自动退订，无需额外 pause。
- [x] 空态：能力感知（`hasStreamingSources()` 为真且空→复用 `download.queueEmpty`；web 不可下载→`downloadCenter.emptyWeb`；筛选无命中→`downloadCenter.emptyFiltered`）。
- [x] i18n×4：`gallery.modeDownloads`、`shortcuts.action.navGalleryTabDownloads`、`downloadCenter.filterAll/Active/Done/Failed`、`downloadCenter.emptyWeb/emptyFiltered`（聚合头复用既有 `download.inProgress`/`queueClear`/`queueEmpty`）。en 源 → zh/ja/ko，脚本插入 + `JSON.parse` 校验。
- [x] E2E harness [`scripts/download-center.mjs`](../../../../scripts/download-center.mjs)（CDP：seed 状态混合 job → Cmd/Ctrl+2 + 6 导航 → 快照 chip 计数/行数 → 翻 filter → 断言 → 清理）。

#### Phase 2 Checklist
- [x] tab 2 出现第 6 个「下载」tab（常驻，快捷键 6 直跳；`~` 循环纳入）；绑 **Digit6 键位** → `online` 隐藏时不漂移。（组件测 + tsc；DOM 层由 harness 验）
- [x] 筛选 chip：全部/进行中(=active+pending+paused)/已完成/失败 正确切片 + 计数角标准确；空 filter 出 `emptyFiltered`；空队列出 `queueEmpty`(桌面)/`emptyWeb`(web)。（5 组件单测 render 断言）
- [x] 5 组件单测（chips 计数 / 能力感知空态 ×2 / 筛选切换+持久化 / 清空已完成）+ registry Digit1–6 单测；`download-center` 纯核心 14 单测复用。
- [x] `make check` 等价（`tsc --noEmit` + biome + 44 单测全绿）；4 locale 无缺键（脚本校验）；无硬编码用户可见字符串（走 `t()`）。
- [ ] **入队单/批量下载 → tab 实时出现行、进度条随字节推进** + **529 条大批量虚拟化**（仅可见行挂载、滚动无 longtask 尖峰，对齐 prd-create §4）+ 重试/移除/清空 tab 内可用 — **待 Electron 手测**（harness `download-center.mjs` 已就绪；需 `electron:dev` + `MUZERO_REMOTE_DEBUG_PORT`）。

### Phase 3: 跨链接收尾

**Goal:** done 行可跳到建好的歌曲/所在集；左上角下载通知的「查看」改指本 tab；空态环境感知打磨。

**Tasks:**
- [ ] `DownloadJobRow` done 态：点击/「查看歌曲」→ `onOpenTrack` → [`nav-store`](../../../../src/stores/nav-store.ts) `openSet(job.sessionId)`（并尽量定位 `job.trackId`）；缺字段降级（§4.4）。
- [ ] [`download-indicator.ts`](../../../../src/stores/download-indicator.ts) 通知「查看」动作：从 `setTab("settings")` 改为 `setTab("search") + setModePref("downloads")`（下载现在有一等 tab；更新其单测断言）。
- [ ] 空态文案/图标按环境（桌面 vs web）最终打磨 + i18n 校对清理（删本 PRD 引入但未用的键）。

#### Phase 3 Checklist
- [ ] 完成的下载点「查看」→ 跳到该歌曲所在集（`trackId`/`sessionId` 缺失走降级，不崩）。
- [ ] 左上角下载通知「查看」→ 落到 tab 2「下载」mode（非 Settings）。
- [ ] web/无下载能力壳层：tab 常驻但显示「桌面版」引导空态，不报错。
- [ ] `make check` 通过；无死 i18n key / 死代码。

---

## 7. Out of Scope

- **不改下载队列本身**：并发、重试策略、**断点续传（前 PRD 的 Phase 2，runJob 分片集成仍待做）**、调度、`.part` 落盘——本 PRD 只做「列表 UI 表面」，不碰运行器。
- **不新增暂停/恢复按钮**：状态机有 `paused`，但运行器对「进行中 job 主动暂停 + 从 `bytesDone` 续」的 wiring 属前 PRD Phase 2（未完）。本 tab **如实展示** `paused` 状态（若已被置），但不新增「暂停正在下的任务」按钮——待队列续传落地后另开增强。
- **不把自动同步配置搬进 tab**：per-set 自动同步频率/自动下载（[`playlist-sync-panel.tsx`](../../../../src/components/downloads/playlist-sync-panel.tsx)）仍留 Settings（需求方：tab 聚焦「下载进度呈现」，非配置）。可选加一个「同步设置 →」链接跳 Settings（非本期硬性）。
- **不删 Settings 下载面板**：Settings→在线源保留紧凑 `downloads-panel`（改用共享行）；tab 是增补的一等浏览面，两者共存（DRY 靠共享 `DownloadJobRow`）。
- **不新增持久化 / 不 bump DB**：无 `downloadHistory` 归档表；done 项就是 `downloadJobs` 里 `status:"done"`，「清空已完成」即删行。
- **不做批量多选/批量重试选中**：v1 逐行动作 + 整体「清空已完成」；多选批量是后续增强。
- **移动端全屏细节**：布局响应式已含，触摸态打磨随移动端 native PRD。

## 8. Security & Compliance

- **无密钥/无 PII 入 UI**：tab 只显示 title/封面/计数/百分比/状态；不显示直链/headers/cookie/token（沿用 `sanitizeUrlForTrace` 纪律）。
- **本地优先 / 无后端 / 无遥测**：纯前端读 IndexedDB + 既有动作（规则 1）；无出站请求由本 PRD 新增。
- **无 hidden flag**：tab 常驻由源码决定，filter 选择是可见 UI 视图偏好（`localStorage`，非行为门控）；回退 = `git revert`（规则 3）。
- **Console 纪律**：一律走 [`logger.ts`](../../../../src/lib/logger.ts)（规则 8）。
- **codename 稳定**：不动 `muzero-db` / 表名 / id 前缀 / `DownloadJob` 字段名（规则 4）。

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260621-muzero-download-queue-resume-autosync-prd`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) | 持久下载队列 `downloadJobs`（本 PRD 的数据源 + 动作） |
| [`20260622-muzero-unified-background-progress-notification-prd`](../20260622-muzero-unified-background-progress-notification-prd/20260622-muzero-unified-background-progress-notification-prd.md) | 下载进度左上角通知（Phase 3 改其「查看」动作指向本 tab）；`summarizeDownloadJobs` 进度口径复用来源 |
| [`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md) | 视频下载基础（下载链路起点） |
| [`20260614-muzero-netease-online-recommendations-prd`](../../20260614-muzero-netease-online-recommendations-prd/20260614-muzero-netease-online-recommendations-prd.md) | 第 5 个「发现」tab——本 PRD 新增第 6 个 tab 的同构先例（`GALLERY_MODES` + `ModeTab` + 快捷键 registry 模式） |
| [`20260610-muzero-artist-album-library-entities-prd`](../../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | 第 3/4 个「专辑/歌手」tab——虚拟列表/派生视图/`useMemo` 模式先例 |
| [`downloads-panel.tsx`](../../../../src/components/downloads/downloads-panel.tsx) · [`download-indicator.ts`](../../../../src/stores/download-indicator.ts) · [`search-page.tsx`](../../../../src/pages/search-page.tsx) | 主要代码触点 |

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | tab 显示范围：完整下载中心（含历史+筛选）vs 仅活动队列 vs 活动+最近完成 | ✅ Resolved | **完整下载中心**：全状态 + 筛选 chip（全部/进行中/已完成/失败）（需求方 2026-07-02 确认） |
| 2 | 与 Settings 面板取舍：抽共享组件 vs 整体搬走 vs 独立实现 | ✅ Resolved | **抽共享行 `DownloadJobRow`**：tab（虚拟长列，进度优先）与 Settings（紧凑）共用行，Settings 保留配置面板（需求方：呈现进度、虚拟列表、不必和 Settings 完全一样）|
| 3 | tab 显示时机：常驻 vs streaming 门控 vs 有任务才显示 | ✅ Resolved | **常驻显示**（第 6 个固定 tab）（需求方 2026-07-02 确认）|
| 4 | 常驻但 web/无下载能力时 tab 空——如何处理？ | ✅ Resolved（细节）| **常驻 + 能力感知空态**：web 显示「下载需要桌面版」引导，不隐藏 tab（符合决策 3；实现细节，非阻断）|
| 5 | 快捷键随 online 显隐漂移？ | ✅ Resolved | 绑 **Digit6 键位**（非「第 N 个可见 tab」），online 显隐不影响 downloads 键位 |
| 6 | 暂停/恢复正在下的任务，本期做吗？ | ✅ Resolved | **不做**（依赖队列续传 Phase 2 runJob 集成，未完）；tab 如实展示 `paused` 态，暂停按钮待续传落地另开（§7）|

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-02 | DoodleBear | Initial draft：把下载列表提升为 Gallery（tab 2）第 6 个常驻「下载」mode——虚拟化 + 全状态 + 筛选 chip + 聚合进度头；复用既有 `downloadJobs` 表/动作（零新持久化），抽共享 `DownloadJobRow`（tab + Settings 面板共用），纯 `download-center.ts`（筛选/排序/汇总，穷举单测）。3 phase：纯核心+抽行 → tab 集成（快捷键 6 常驻）→ 跨链接收尾（done 跳转 + 通知「查看」改指本 tab）。需求方三决策（完整下载中心 / 进度优先虚拟列表 / 常驻）已并入 §1.1 与 §10 |
| 2026-07-02 | Claude (TDD) | **Phase 1 完成**（TDD）：纯 `download-center.ts`（`filterDownloadJobs`/`orderDownloadJobs`/`summarizeDownloadCenter`/`downloadAggregateProgress`/`isInFlight`）+ 14 单测；实现决策——progress口径单一真相倒置进 lib、`download-indicator.summarizeDownloadJobs` 委托（store→lib，13 单测零回归）。抽 `download-job-row.tsx`（`compact` + `onOpenTrack?` 预留）、`downloads-panel` 改用之（Settings 不变）。tsc + biome + 27 单测全绿 |
| 2026-07-02 | Claude (TDD) | **Phase 2 完成**（TDD）：`search-page` 加第 6 个常驻「下载」mode（`GalleryMode`/`GALLERY_MODES`/`GALLERY_TAB_ACTIONS`/`isGalleryWallMode`/toolbar+wall 容器 downloads 分支）；registry `nav.galleryTabDownloads`(Digit6) + 单测扩 Digit1–6；`download-center.tsx`（聚合头 + 4 筛选 chip + `useVirtualizer`+`measureElement` 虚拟列表 + 能力感知空态）+ 5 组件单测；i18n×4（脚本插入 + JSON 校验）；E2E harness `scripts/download-center.mjs`（CDP seed→导航→快照→断言→清理）。tsc + biome + 44 单测全绿。真机行渲染/大批量/入队实时 待 Electron 手测。附：期间一并发 session 切到 `feat/online-source-playlist-filter` 提交 filter-playlists WIP（`d25a5833`），本工作已恢复回 `feat/downloads-gallery-tab`，无丢失 |

---

> **Note:** 本 PRD 遵循模板「优先改既有代码、少建新结构」：数据层（`downloadJobs` 表 + 队列 + 动作 + 进度汇总）**全部已存在**，本期只补「一个一等公民的、虚拟化的、可筛选的下载中心 UI」。唯一新文件是 `download-center.ts`（纯核心）+ `download-center.tsx`（tab 内容）+ `download-job-row.tsx`（从 panel 抽出的共享行）；其余全是 append 到 `search-page.tsx` / i18n / 快捷键 registry。无 schema 变更、无新持久化模型、无新下载/播放通路。
