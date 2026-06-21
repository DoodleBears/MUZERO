# PRD: MUZERO 统一后台进度通知（下载队列 + 切歌加载 收敛到左上角通知栈）

**Status:** Draft
**Created:** 2026-06-22
**Author:** DoodleBear
**Module:** `src/stores/notification-store.ts`（progress 字段复活）· `src/components/shell/notification-stack.tsx`（左上角栈）· 新增 `src/stores/download-indicator.ts` + `src/stores/playback-indicator.ts`（liveQuery/store → 通知）· `src/streamsrc/download-action.ts`（分P 入队修正）· `src/components/downloads/download-progress-badge.tsx`（下线）· `src/components/player/track-identity-row.tsx`（Dock 封面 spinner 保留）

> 承接 [`20260621-muzero-download-queue-resume-autosync-prd`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md)（持久下载队列已就位）。那个 PRD 把「下载怎么跑」做通了，本 PRD 处理「下载/加载进度**怎么反馈给用户**」——目前后台活动的可视化反馈散落在 3 个位置、affordance 不一致，本 PRD 把它们**收敛到左上角通知栈**这一个 surface。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 下载队列指示器收敛到左上角通知栈（复活 `progress` 条 + indicator 订阅 `downloadJobs` + 下线右上角徽标） | ✅ 完成（`download-indicator.ts` 纯聚合 + reconcile 生命周期 + 13 单测；App 启动 wiring；删徽标；i18n×4 `download.view`） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 切歌加载指示器进左上角通知栈（阈值门控 + 真字节进度 + 远程下载/本地加载文案 + 保留 Dock 封面 spinner） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 一致性收尾（分P 批量下载改走队列 → 进统一指示器 + 重试；i18n×4 校对/清理） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（prd-create.md §4 观测先行 / 基础设施先于覆盖广度）**：Phase 1 先把「indicator → 通知栈」这套 wiring + 复活的 `progress` 条建好（下载是现成的 liveQuery 数据源，最稳），Phase 2 复用同一套 wiring 接 `playbackLoading`，Phase 3 修历史遗留 + 增强。

---

## 1. Overview

### 1.1 Background

「后台活动进度怎么反馈」目前**散在 3 个地方，affordance 各不相同**：

1. **下载队列 → 右上角浮动徽标**：[`DownloadProgressBadge`](../../../../src/components/downloads/download-progress-badge.tsx) 固定在 `top-14 right-4`，由 `db.downloadJobs`（status `active`/`pending`）的 `useLiveQuery` 驱动，显示「N 个下载中 · X%」，点击跳 Settings → Downloads。挂在 [`App.tsx:450`](../../../../src/App.tsx)。
2. **切歌加载 → Dock 封面上一个极小的 spinner**：[`track-identity-row.tsx:300`](../../../../src/components/player/track-identity-row.tsx)（`data-testid="dock-cover-loading"`）。由 player store 的 `playbackLoading`（[`PlaybackLoadingState`](../../../../src/stores/player-store.ts) = `{trackId, title, sourceKind, startedAt}`）驱动，主要覆盖**流媒体「下载整曲再播」**那几秒（[`player-store.ts:4452`](../../../../src/stores/player-store.ts) 的 `beginPlaybackLoading` + `setStreamDownloading`）。这个 spinner 很容易被忽略、**没有任何文字**说明「在下载 / 在加载 / 卡了」。
3. **同步 / 本地导入 → 左上角通知栈**：[`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) 已经把云盘 R2 同步 + 本地文件夹导入桥接成左上角的**持久可取消 loading toast**（`notify.loading` + 原地 `notify.update`）。

矛盾点：
- **同一类「后台活动进度」却分了 3 个 surface**——用户要在 3 个地方找反馈，下载在右、同步在左、加载在封面上。
- 通知 store 早就**有一根进度条能力但没人用**：[`notification-store.ts`](../../../../src/stores/notification-store.ts) 的 `NotificationItem.progress` + [`notification-stack.tsx:172`](../../../../src/components/shell/notification-stack.tsx) 会渲染一根细进度条——**全代码库没有任何一处给通知传 `progress`**，是休眠的死能力。（历史：单视频下载曾用过 `notify.loading(..., {progress})`，commit `4f85427d` 把单下载改走持久队列时删掉了这套，从此进度只剩右上角徽标。）
- 切歌加载缺乏文字反馈，用户分不清「在下载这首歌 / 在加载本地文件 / App 卡住了」。

**本 PRD：把下载队列进度 + 切歌加载进度都收敛进左上角通知栈**，复活那根休眠的 `progress` 条，与同步/导入用同一套 indicator 模式（[`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts)）。下线右上角徽标。

> **决策已定**（创建/评审时与需求方确认）：
> 1. **统一位置 = 左上角通知栈**（复活 `progress` 字段，indicator 驱动，下线右上角徽标）。
> 2. **切歌加载 = 阈值门控**：加载超过约定阈值（~800ms）才弹通知；若在阈值前就加载完，则**完全不弹**（瞬时本地/缓存切歌保持安静）。Dock 封面 spinner 仍立即转（即时反馈不变）。
> 3. **切歌加载显示真实进度**：`PlaybackLoadingState` 增加 `progress`，给 `fetchStreamMediaBytes` 加流式 `onProgress`（一次性 `resp.blob()` → `resp.body.getReader()` 流式读），下载整曲的真字节比例喂进通知的进度条（不再是 indeterminate）。此项从「可选增强」升为 Phase 2 核心。
> 4. **多条持久 toast 同屏** 按现状（`createdAt` 堆叠、持久项上限 20）即可，本期不做合并/折叠。
> 5. **阈值 800ms** 采纳为源码常量（上线后按手感微调）。
> 6. **右上角徽标直接删除**（[`download-progress-badge.tsx`](../../../../src/components/downloads/download-progress-badge.tsx) 文件 + 挂载一并删；回退走 `git revert`）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户（owner）** | 切流媒体歌曲时要知道「正在下载这首歌」而不是以为卡了；批量/收藏夹下载时要在一个明确的地方看进度；不想被瞬时本地切歌的通知刷屏。 | 全功能；纯前端可视化反馈，无新增权限 |

### 1.3 Core Value

1. **一个地方看所有后台进度**：下载、切歌加载、同步、导入——全部在左上角通知栈，affordance 一致（持久 loading toast + 进度条 + 可取消/可跳转）。
2. **切歌不再「像卡住」**：超过阈值的加载/下载会明确告诉用户「正在下载《歌名》」，并显示进度；瞬时切歌保持安静无噪音。
3. **复用而非新造**：复活已有的 `progress` 条字段 + 沿用 `sync-indicator.ts` 成熟的 indicator 模式（liveQuery/store 订阅 → notify create/update/dismiss），不引入新 UI 体系。
4. **顺手修一致性历史债**：分P 批量下载（[`startBackgroundBatchDownload`](../../../../src/streamsrc/download-action.ts)）改走持久队列，从此也进统一指示器并获得重试。
5. **本地优先**：全是前端可视化，无后端、无遥测、无 hidden flag（规则 1/3/8）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                          数据源（已有，不新增状态）                         indicator（新增，模块作用域单例）                左上角通知栈
                          ──────────────────────────                       ──────────────────────────────────              ─────────────
 [下载]  db.downloadJobs（active/pending） ──liveQuery──▶  download-indicator.ts                          ┐
            {bytesDone,totalBytes,status}                    · 聚合 N 个任务 → 一条 loading toast         │
                                                             · progress = Σ(bytesDone/total)/N            │
                                                             · 动作:「查看」→ Settings → Downloads        │
                                                                                                          ├──▶  notification-store（已有）
 [切歌]  player-store.playbackLoading      ──subscribe──▶  playback-indicator.ts                          │       notify.loading / update / dismiss
            {trackId,title,sourceKind,                       · 阈值门控（~800ms 计时器；早完成→不弹）     │           │
             startedAt}                                      · 文案: remote=下载 / 其它=加载              │           ▼
                                                             · progress = 真字节比例(流式 onProgress)     │     NotificationStack（已有）
                                                                                                          │       · 持久项(duration:0)常驻、不被 maxVisible 截断
 [同步/导入]  sync-store / folder-import-store ──▶  sync-indicator.ts（已有，作为参照模板，不改）         ┘       · item.progress → 复活那根细进度条(172 行)

 下线: <DownloadProgressBadge/>（App.tsx:450）—— 删除挂载；右上角不再有独立浮动徽标
 保留: Dock 封面 spinner（track-identity-row.tsx:300）—— 即时反馈，不动；通知是「补充的、带文字+进度的」第二层
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **统一通知 surface** | 既有 [`notification-store`](../../../../src/stores/notification-store.ts) + [`NotificationStack`](../../../../src/components/shell/notification-stack.tsx)（左上角，持久项常驻） | 不新造 UI；持久 loading（`duration:0`）天然适合长任务；`progress` 字段 + 渲染**已存在**，只是没人用 |
| **下载指示器** | 新增 `src/stores/download-indicator.ts`：`useLiveQuery`/`db.downloadJobs.hook` 订阅 → `notify.loading`/`update`/`dismiss`（镜像 [`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) 的 `reconcileR2`） | 真相在 DB；indicator 只把队列聚合态映射成一条 toast，响应式自动正确（规则 6） |
| **切歌指示器** | 新增 `src/stores/playback-indicator.ts`：`usePlayerStore.subscribe(s => s.playbackLoading)` + 阈值计时器 → notify（含真字节进度） | 复用同一 indicator 模式；阈值门控消除瞬时切歌噪音 |
| **切歌真字节进度** | `PlaybackLoadingState` 加 `progress?`；[`fetchStreamMediaBytes`](../../../../src/stores/player-store.ts) 从一次性 `resp.blob()` 改流式 `resp.body.getReader()` + `onProgress(loaded,total)` → 回填 `playbackLoading.progress` | 镜像 [`download-action.ts` fetchBytes](../../../../src/streamsrc/download-action.ts) 的流式读法；下载整曲（多秒）显示真进度 |
| **进度条** | 复活 `NotificationItem.progress`（store 已支持 `update({progress})`，stack 已渲染） | 死能力复用，零新增渲染代码 |
| **分P 批量下载修正** | 改 [`startBackgroundBatchDownload`](../../../../src/streamsrc/download-action.ts) 逐条 `enqueueDownload` 而非直连 `downloadStreamedHit` | 入队后自动进统一指示器 + 获得重试/重启恢复，消除「唯一不走队列」的历史不一致 |
| **wiring 启动** | 在 [`App.tsx`](../../../../src/App.tsx) / 与 `startSyncIndicator()` 同处启动 `startDownloadIndicator()` + `startPlaybackIndicator()`（幂等，StrictMode 安全） | 与现有 indicator 启动一致 |

### 2.3 Project Structure

```
src/
├── stores/
│   ├── notification-store.ts        # 改：无需改字段（progress 已存在）；仅确认 update 支持 progress（已支持）
│   ├── sync-indicator.ts            # 参照模板（不改）
│   ├── download-indicator.ts        # 新增：downloadJobs liveQuery → 一条聚合 loading toast（+progress +「查看」动作）
│   └── playback-indicator.ts        # 新增：playbackLoading 订阅 + 阈值计时器 → loading toast（文案分流）
├── components/
│   ├── shell/
│   │   └── notification-stack.tsx   # 不改（progress 条已渲染；可微调 progress 条样式）
│   ├── downloads/
│   │   └── download-progress-badge.tsx  # 下线：删除组件 + App.tsx 挂载（或保留文件标注 deprecated）
│   └── player/
│       └── track-identity-row.tsx   # 不改 spinner（保留即时反馈）
├── streamsrc/
│   └── download-action.ts           # 改：startBackgroundBatchDownload 改走 enqueueDownload
├── App.tsx                          # 改：移除 <DownloadProgressBadge/>；启动两个新 indicator
└── i18n/locales/{en,zh,ja,ko}/common.json  # 新增 download/playback 通知文案
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
本 PRD 不新增持久化数据模型。所有数据源已存在：
  · 下载: db.downloadJobs（上个 PRD 建的表）—— 只读订阅
  · 切歌: player-store.playbackLoading（内存态）—— 只读订阅
  · 通知: notification-store.queue（内存态）—— 新增 producer（两个 indicator）

唯一「形状」变化: 让 NotificationItem.progress 真正被使用（字段已定义，无需改 schema）。
```

### 3.2 Database Schema

⚠️ **无 schema 变更。** `downloadJobs` 表沿用上个 PRD 的定义（[`download-job-repo.ts`](../../../../src/db/download-job-repo.ts) / [`db/types.ts`](../../../../src/db/types.ts) 的 `DownloadJob`），本 PRD 只读不写。不 bump DB version。

### 3.3 Data Relationship Diagram

```
NotificationItem（已有）
  ├─ type: "loading"            ← 下载/切歌持续中
  ├─ message / detail           ← 文案（i18n）
  ├─ duration: 0                ← 持久（不自动消失）
  ├─ progress?: 0..1            ← 【复活】下载=真字节比例；切歌=可选/indeterminate
  └─ actions?: [{「查看」→ Settings→Downloads}]  ← 取代徽标的「点击跳转」
```

---

## 4. API Design

> 本 PRD 无网络 API。这里描述**模块接口**（indicator 的对外形状），对齐 `sync-indicator.ts`。

### 4.1 模块接口

| Symbol | 签名 | 说明 |
|---|---|---|
| `startDownloadIndicator()` | `(): void` | 幂等。订阅 `db.downloadJobs`（active/pending），把聚合态 reconcile 成**一条** loading toast。无任务 → dismiss。 |
| `startPlaybackIndicator()` | `(): void` | 幂等。订阅 `playbackLoading`，阈值计时后弹/更新/消除 toast。 |
| `notify.update(id, {progress})` | 已存在 | 复用：indicator 用它原地更新进度条，不新建 toast（避免闪烁/刷屏）。 |

### 4.2 行为示例（伪代码，镜像 sync-indicator.reconcileR2）

```typescript
// download-indicator.ts — 一条聚合 toast，原地更新
function reconcileDownloads(jobs: DownloadJob[]): void {
  const key = "downloads";
  const id = toastIds.get(key);
  const active = jobs.filter(j => j.status === "active" || j.status === "pending");
  if (active.length === 0) { if (id) { notify.dismiss(id); toastIds.delete(key); } return; }

  const withBytes = active.filter(j => j.status === "active" && (j.totalBytes ?? 0) > 0);
  const progress = withBytes.length
    ? withBytes.reduce((s, j) => s + j.bytesDone / (j.totalBytes ?? 1), 0) / withBytes.length
    : undefined; // YouTube blob 传输无 totalBytes → 不显示进度条（与徽标同口径）

  const message = i18n.t("download.inProgress", { count: active.length });
  const detail = progress != null ? `${Math.round(progress * 100)}%` : undefined;
  const viewAction = { label: i18n.t("download.view"), onClick: () => setTab("settings"), keepOpen: true };

  if (id) notify.update(id, { message, detail, progress });
  else toastIds.set(key, notify.loading(message, { detail, progress, actions: [viewAction] }));
}
```

```typescript
// playback-indicator.ts — 阈值门控
const THRESHOLD_MS = 800;
let timer: number | null = null;
let toastId: string | null = null;

usePlayerStore.subscribe(s => s.playbackLoading, (loading) => {
  // 任何变化先清掉上一首的 pending 计时器
  if (timer != null) { clearTimeout(timer); timer = null; }
  if (!loading) { if (toastId) { notify.dismiss(toastId); toastId = null; } return; }

  // 阈值前就完成 → 上面的 null 分支已 dismiss/清计时器 → 完全不弹
  timer = window.setTimeout(() => {
    timer = null;
    const label = loading.sourceKind === "remote"
      ? i18n.t("player.loadingRemote", { title: loading.title })  // 已有 key
      : i18n.t("player.loadingTrack", { title: loading.title });  // 已有 key
    toastId = notify.loading(label, { progress: loading.progress });
  }, THRESHOLD_MS);
});

// 弹出后 playbackLoading.progress 继续推进 → 原地更新进度条（不新建 toast）
usePlayerStore.subscribe(s => s.playbackLoading?.progress, (progress) => {
  if (toastId != null && progress != null) notify.update(toastId, { progress });
});
```

### 4.3 Error Handling

- **下载终态/失败**：仍由 [`download-action.ts`](../../../../src/streamsrc/download-action.ts) 的 `onPermanentFailure`（`notify.error`，带 copy）负责——indicator 只管「进行中」聚合 toast，失败是独立 error toast，互不干扰。
- **切歌失败**：`playbackLoading` 被 `clearPlaybackLoading`/`cancelPlaybackLoading` 置空 → indicator 自动 dismiss；播放错误另由既有 `notify.error(player.playbackError)` 处理（[`player-store.ts:4494`](../../../../src/stores/player-store.ts)）。
- **快速连切**：每次 `playbackLoading` 变化都先清计时器/旧 toast（§4.2）——连续 3 次瞬时切歌 = 0 通知。
- **Telemetry**：本 PRD 不新增遥测；indicator trace 走既有 `createDiagnosticLogger`（如需，对齐 `sync-indicator` 的 `traceImportToast`，只记 id/计数/耗时，不记歌名 URL）。

---

## 5. Frontend Design

### 5.1 Page Structure

无新增页面。变化都在**全局浮层**：左上角 [`NotificationStack`](../../../../src/components/shell/notification-stack.tsx)（已挂在 `main.tsx`）成为唯一后台进度 surface；右上角徽标移除。

### 5.2 UI Components

- **`NotificationStack`（不改或微调）**：`progress` 条已在 [`172 行`](../../../../src/components/shell/notification-stack.tsx) 渲染（`absolute inset-x-0 bottom-0 h-0.5 bg-primary`）。可选微调：loading 类型 + 有 progress 时进度条更明显。多条持久 toast（同步 + 下载 + 切歌）会按 `createdAt` 排序堆叠，符合现有行为（持久项不被 `maxVisible` 截断）。
- **`DownloadProgressBadge`（下线）**：删除 [`App.tsx:450`](../../../../src/App.tsx) 的 `<DownloadProgressBadge/>` 挂载。组件文件可删除或标 deprecated（保留以防回退；但按规则「回退=git revert」，倾向直接删）。「点击跳 Settings→Downloads」的能力移到下载 toast 的「查看」动作按钮。
- **Dock 封面 spinner（保留）**：[`track-identity-row.tsx:300`](../../../../src/components/player/track-identity-row.tsx) 不动——它是**即时**反馈（0ms 就转），通知是**阈值后**的带文字+进度的补充层。两者并存：封面转圈 = "正在弄这首歌"，通知 = "弄的是下载/加载，进度 X%"。

### 5.3 State Management

- **不新增 store state**。两个 indicator 是**模块作用域单例**（订阅 + 计时器 + `toastIds` Map），不进 Zustand state——与 `sync-indicator.ts` / `AudioEngine` / liveQuery 订阅同纪律（规则 6：非响应式编排放模块作用域）。
- **producer 单一化**：下载/切歌进度的唯一 producer 是对应 indicator；UI 组件只消费 `notification-store`，不再各自读 `downloadJobs` / `playbackLoading` 渲染浮层。

---

## 6. Implementation Plan

### Phase 1: 下载队列指示器收敛到左上角通知栈

**Goal:** 下载进度从右上角徽标搬到左上角通知栈（带复活的进度条 + 「查看」动作），下线徽标。

**Tasks:**
- [ ] 新增 `src/stores/download-indicator.ts`：`startDownloadIndicator()` + `reconcileDownloads()`，订阅 `db.downloadJobs`（active/pending），聚合成一条 loading toast，原地 `notify.update({progress})`。
- [ ] 进度口径与徽标一致：仅对有 `totalBytes` 的 active 任务算平均字节比例；YouTube blob 传输无 total → 不显示进度条（只显示计数）。
- [ ] toast 加「查看」动作（`keepOpen:true`）→ `useNavStore.setTab("settings")`。
- [ ] [`App.tsx`](../../../../src/App.tsx)：移除 `<DownloadProgressBadge/>`；在 `startSyncIndicator()` 旁启动 `startDownloadIndicator()`。
- [ ] 删除 [`download-progress-badge.tsx`](../../../../src/components/downloads/download-progress-badge.tsx)（或标 deprecated）。
- [ ] i18n×4：复用 `download.inProgress`（已有）；新增 `download.view`。

### Phase 1 Checklist

- [x] 入队单/批量下载 → 左上角出现一条持久 loading toast，进度条随字节推进。（indicator 订阅 `downloadJobs` liveQuery，create→update→dismiss）
- [x] 右上角不再有徽标。（删 [`download-progress-badge.tsx`](../../../../src/components/downloads/download-progress-badge.tsx) + App.tsx 挂载）
- [x] 「查看」跳 Settings → Downloads。（toast action `keepOpen` → `useNavStore.setTab("settings")`）
- [x] 所有任务完成/清空 → toast 自动消失。
- [x] 单测：`summarizeDownloadJobs` + `createDownloadReconciler` → 正确的 message/detail/progress（含 0 任务 dismiss、无 totalBytes 不给 progress、多任务平均、re-create）。13 例。
- [x] `make check` 通过。（typecheck + biome 干净；全量 vitest 445 文件 / 3293 例 通过）

### Phase 2: 切歌加载指示器进左上角通知栈（阈值门控 + 真字节进度）

**Goal:** 切歌加载/下载超过阈值时弹通知（带文案 + 真进度条），瞬时切歌保持安静；Dock 封面 spinner 不变。

**Tasks:**
- [ ] `PlaybackLoadingState`（[`player-store.ts`](../../../../src/stores/player-store.ts)）增加 `progress?: number`；`beginPlaybackLoading` 初始 `progress` 留空（indeterminate 起手）。
- [ ] [`fetchStreamMediaBytes`](../../../../src/stores/player-store.ts) 从一次性 `resp.blob()` 改流式 `resp.body.getReader()` + `onProgress(loaded,total)`（content-length / `x-muzero-content-length` 读 total），无 total 时退化为无进度（仍可下载）。
- [ ] download-before-play 分支（[`player-store.ts:4452`](../../../../src/stores/player-store.ts)）把 `onProgress` 接到一个节流（~按整数 % 去重）的 `set({ playbackLoading: { ...prev, progress } })`，仅当请求仍是 current 时更新。
- [ ] 新增 `src/stores/playback-indicator.ts`：`startPlaybackIndicator()`，订阅 `playbackLoading`，阈值（常量 `~800ms`）计时器门控；弹出后订阅 `playbackLoading.progress` 原地 `notify.update({progress})`。
- [ ] 文案分流：`sourceKind === "remote"` → `player.loadingRemote`；其它 → `player.loadingTrack`（两 key 已存在于 [`track-identity-row.tsx`](../../../../src/components/player/track-identity-row.tsx) 的用法）。
- [ ] 切歌/完成/取消时清计时器 + dismiss（消除连切残留）。
- [ ] [`App.tsx`](../../../../src/App.tsx) 启动 `startPlaybackIndicator()`。
- [ ] 阈值常量集中定义 + 注释（不引入 hidden flag；要可调就走 Settings——本期硬编码 800ms）。

### Phase 2 Checklist

- [ ] 切到需多秒下载的流媒体歌 → ~800ms 后左上角出现「正在下载《歌名》」loading toast，**进度条随字节推进**；歌开始播 → 消失。
- [ ] 切本地/缓存歌（瞬时）→ **不弹**任何通知（封面 spinner 可能一闪）。
- [ ] 连续快速切 3 首本地歌 → 0 通知。
- [ ] Dock 封面 spinner 行为不变。
- [ ] 单测（store）：`fetchStreamMediaBytes` 流式上报 `onProgress`；download-before-play 更新 `playbackLoading.progress`；stale 请求不更新。
- [ ] 单测（indicator）：阈值前完成不弹、阈值后弹、progress 原地更新、切歌清理、remote/非 remote 文案分流（注入 fake timer + 模拟 `playbackLoading` 序列）。
- [ ] `make check` 通过。

### Phase 3: 一致性收尾（分P 批量下载改走队列）

**Goal:** 修历史不一致（分P 批量下载不走队列）；i18n 校对清理。

**Tasks:**
- [ ] [`startBackgroundBatchDownload`](../../../../src/streamsrc/download-action.ts) 改为对每个 part `enqueueDownload`（而非循环 `downloadStreamedHit` + 自建 `notify.loading`）——入队后自动进统一指示器 + 获得重试/重启恢复。删除其内联的 `notify.loading`/`update` 分支。
- [ ] 删除 `download-action.ts` 中因上一步变成死代码的分P 进度文案分支（`download.downloadingPart` 等若不再用则连同 i18n 清理）。
- [ ] i18n×4 全量校对（en 源 + zh/ja/ko），删除不再使用的 key。

### Phase 3 Checklist

- [ ] 分P「下载全部」→ 进度显示在统一指示器（与单/批量一致），且失败会重试。
- [ ] 无残留的「唯一不走队列」下载路径。
- [ ] 无死 i18n key / 死代码。
- [ ] `make check` 通过。

---

## 7. Out of Scope

- **不改下载队列本身**：并发、重试、断点续传（上个 PRD 的 P2）、调度——本 PRD 只改「反馈呈现」。
- **不动同步/导入指示器**：[`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) 是参照模板，行为不变。
- **不引入通知中心/历史面板**：不做「已完成通知的归档列表」；终态仍是瞬时 success/error toast。
- **不引入 Settings 开关控制阈值/位置**：阈值硬编码 800ms；不加 hidden flag（规则 3）。若日后要可调再开 PRD 建可见 Settings 控件。
- **移动端全屏 sheet 的加载态**：本 PRD 聚焦桌面 + 通用通知栈；移动 now-playing-sheet 的加载呈现按需后续打磨（通知栈本身已 responsive）。
- **多条持久 toast 的合并/折叠**：本期按现状堆叠（同步 + 下载 + 切歌各一条）；同类合并是后续优化（Q4 已确认现状可接受）。

---

## 8. Security Considerations

- **无密钥/无 PII 入通知**：通知只显示歌名 + 计数 + 百分比；不显示 URL、headers、token（沿用 `sanitizeUrlForTrace` 纪律，indicator 不碰这些）。
- **无后端/无遥测**：纯前端可视化（规则 1）。indicator 的 diagnostic log 只记 id/计数/耗时，不记歌名内容（对齐 `sync-indicator` 的 trace 字段）。
- **无 hidden flag**：阈值是源码常量，回退=`git revert`（规则 3/8）。
- **Console 纪律**：indicator 一律走 [`logger.ts`](../../../../src/lib/logger.ts)，不直连 `console.*`（规则 8）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260621-muzero-download-queue-resume-autosync-prd`](../20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) | 持久下载队列（本 PRD 的数据源 `downloadJobs`） |
| [`20260620-muzero-video-quality-download-import-prd`](../20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md) | 视频下载基础（下载链路起点） |
| [`sync-indicator.ts`](../../../../src/stores/sync-indicator.ts) | indicator → 通知栈的**实现模板**（本 PRD 镜像它） |
| [`notification-store.ts`](../../../../src/stores/notification-store.ts) | 统一通知 store（`progress` 字段在此） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 统一到左上角通知栈 还是 右上角徽标演进? | ✅ Resolved | **左上角通知栈**，下线徽标（需求方 2026-06-22 确认） |
| 2 | 切歌加载何时弹通知? | ✅ Resolved | **超过阈值（~800ms）才弹**；阈值前完成则不弹（需求方确认） |
| 3 | 切歌 toast 显示真字节进度条 还是 indeterminate? | ✅ Resolved | **显示真字节进度**（给 `fetchStreamMediaBytes` 加流式 `onProgress` → `playbackLoading.progress`）；升为 Phase 2 核心（需求方 2026-06-22 确认） |
| 4 | 多条持久 toast 同时在（同步+下载+切歌）会不会太挤? | ✅ Resolved | **按现状堆叠即可**（`createdAt` 排序、持久项上限 20）；合并/折叠不在本期（需求方确认） |
| 5 | 阈值 800ms 是否合适? | ✅ Resolved | **采纳 800ms** 源码常量，上线后按手感微调（需求方确认） |
| 6 | `download-progress-badge.tsx` 删除 还是 保留 deprecated? | ✅ Resolved | **直接删除**文件 + 挂载（回退=git revert，需求方确认） |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-22 | DoodleBear | Initial draft（合并两需求：下载进度统一 + 切歌加载通知；左上角通知栈 + 阈值门控 已定） |
| 2026-06-22 | DoodleBear | Resolve Open Q3-Q6：切歌显示真字节进度（升 Phase 2 核心）、多 toast 堆叠按现状、阈值 800ms 采纳、徽标直接删除 |
