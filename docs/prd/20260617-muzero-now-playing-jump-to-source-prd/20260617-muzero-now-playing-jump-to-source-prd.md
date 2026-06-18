# PRD: Now Playing →「跳转到歌曲所在歌单」(Jump-to-Source)

**Status:** Draft
**Created:** 2026-06-17
**Revised:** 2026-06-18 — 对齐 coverflow 重构 + 新 `gallery-cover` 共享封面 morph 体系（见 §0 变更摘要）
**Author:** UX / Frontend (MUZERO)
**Module:** Navigation · Now Playing · Library Deep-link

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 来源解析 + 锚点深链基础设施 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 入口：Dock 信息 tab 感知点击 + 右键菜单项 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 封面纵向手势（coverflow 上/下滑）→ 跳转 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | View Transition：复用 `gallery-cover` 封面 morph + a11y 兜底 | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 0. 变更摘要（2026-06-18 复审 vs 初稿）

初稿（2026-06-17）写于旧封面结构上。复审发现封面层已**大幅重构为 coverflow**，且新增了一套**共享封面 morph** 的 View Transition 体系。本次按现状重写了 §2/§3/§5/§6/§9/§10，要点：

| 项 | 初稿假设（已过时） | 当前现状（已核对） |
|----|--------------------|--------------------|
| Now Playing 封面组件 | `swipeable-media-stage.tsx`（单卡横滑） | **已被取代** → [`SwipeableCoverStage`](../../../src/components/player/swipeable-cover-stage.tsx)（windowed coverflow）+ [`cover-pager-strip.tsx`](../../../src/components/player/cover-pager-strip.tsx) + [`cover-pager.ts`](../../../src/components/player/cover-pager.ts) + [`cover-window-store.ts`](../../../src/components/player/cover-window-store.ts) + 基座 [`media-stage.tsx`](../../../src/components/player/media-stage.tsx) |
| 封面手势 | 横滑切歌 + tap 切歌词 | 同左，但实现是 coverflow：`drag="x"`（X 轴锁定）+ 横向 wheel/trackpad + tap；**纵向被显式过滤**（仍空闲）。tap/纵向判定在 `onPointerDown/Up`（[swipeable-cover-stage.tsx:840-861](../../../src/components/player/swipeable-cover-stage.tsx#L840)） |
| 共享封面过渡 | motion `layoutId="now-cover"` | **Dock 封面已刻意去掉 `layoutId`**（[track-identity-row.tsx:37-41](../../../src/components/player/track-identity-row.tsx#L37) 注释，PRD `20260617-dock-swipe-switch-jank`）。新机制：原生 View Transition + **`SHARED_COVER_VT = "gallery-cover"`** 命名配对（[search-page.tsx:207](../../../src/pages/search-page.tsx#L207) `beginCoverMorph`/`coverMorphName`/`morphKey`） |
| Dock 信息点击 | `setTab("now")`，未包过渡 | `handleOpen()` 已用 `transitionState(onOpen)` 包裹（[track-identity-row.tsx:176](../../../src/components/player/track-identity-row.tsx#L176)），`onOpen = () => setTab("now")`（[App.tsx](../../../src/App.tsx) `onOpenNowPlaying`）。仍 **tab 无关**（已在 now 也只是 no-op） |
| Dock 队列抽屉 | （未提） | 已重构为「pure up-next surface」（[queue-panel.tsx](../../../src/components/player/queue-panel.tsx)，commit `eeca8645`）：显示「Playing from <set>」+ `VirtualTrackList`，**无当前曲目高亮/定位** → 新增「替代落点」候选，见 OQ#5 |

**未变（初稿仍准确）**：`nav-store`（仍 `set/artist/album/online-playlist`，无锚点、无 `openSystemPlaylist`）、`QueueSource`（仍 `set/system-playlist`，无 online）、`VirtualTrackList` 的 `initialScrollIndex`+`selectedTrackId`、`TrackListSection` 转发、播放真相 `activeSessionId/currentIndex/queue`。

---

## 1. Overview

### 1.1 Background

当前从底部 `PlayerDock` 点击歌曲信息（封面 + 标题），走
[`track-identity-row.tsx:176`](../../../src/components/player/track-identity-row.tsx#L176) `handleOpen()`
→ `transitionState(onOpen)`，`onOpen` 在 [`App.tsx`](../../../src/App.tsx) 是 `() => setTab("now")`。

问题：**这个动作没有终点感**。

1. 当用户**已经在 Now Playing tab** 时再点 Dock 信息 —— `setTab("now")` 是 no-op，点击像「坏掉了」。
   用户此刻真正想做的是：**回到这首歌所在的歌单（集 / 系统歌单 / 在线歌单），并定位到这首歌在列表里的位置**
   （「我现在听的这首，在歌单里它前后是什么？」）。
2. Now Playing 的 coverflow 封面目前只有**横滑切上/下首**（[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)
   `drag="x"` + 横向 wheel）+ 移动端 tap 切歌词，**纵向手势被显式过滤、完全空闲**。竖直方向是一块「免费的」、
   符合直觉的手势空间，可以承载「上滑/下滑看这首歌的来源歌单」。

这是一个典型的「Now Playing ↔ 歌单上下文」双向导航缺口。Apple Music / Spotify 都提供从正在播放跳回「来源队列 / 专辑 / 歌单并高亮当前曲目」。
MUZERO 现已具备**所有零件**（来源真相 + scroll-to-index + 共享封面 morph，见 §2），只缺把它们接起来。

产品经理明确要求：**过渡要走 View Transition 的平滑效果**。好消息：复审发现项目已自研出一套 **`gallery-cover` 共享封面 morph**
（wall 卡片 ↔ 详情头部封面互变，§2.4），本特性应**直接复用**它，而不是重造。

### 1.2 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **听歌用户（桌面主力）** | 在 Now Playing 沉浸看封面/可视化，想快速回到歌单上下文 | 一个手势 / 一次点击就能跳到「这首歌在哪个歌单的第几首」 |
| **混合集策展用户** | 维护 DJ 集 / 上传集 / 系统歌单（最近、红心） | 从正在播放直达该集详情，顺手编辑、加歌、调序 |
| **移动端用户（后续打磨）** | 全屏 coverflow 封面，触摸优先 | 上/下滑封面这种触摸友好手势直达来源 |

### 1.3 Core Value

1. **闭环导航**：Now Playing 与「来源歌单」之间建立双向跳转，消除「点了没反应」的死角。
2. **定位即上下文**：跳过去不是只打开歌单，而是 **scroll 到当前曲目 + 高亮**，立刻回答「它在歌单里的位置」。
3. **平滑过渡**：复用既有 `gallery-cover` 封面 morph，让跳转有空间连续性，不是生硬切屏。
4. **零新依赖、零隐藏 flag**：全部基于现有 `nav-store` / `player-store` / coverflow / `view-transition` 基建扩展（符合硬规则 3 & 10）。

---

## 2. System Architecture

### 2.1 Architecture Overview（现状零件 → 目标接线）

```
                       ┌─────────────────────────────────────────────┐
                       │            player-store（播放真相）          │
                       │  queueSource: {set|system-playlist}          │
                       │  activeSessionId / currentIndex / queue[]    │
                       └───────────────┬─────────────────────────────┘
                                       │  当前曲目 = queue[currentIndex]
                    ┌──────────────────▼───────────────────┐
   【新增·纯函数】  │   resolvePlayingSource(playerState)   │  → JumpTarget | null
                    │   把「在放什么 / 来自哪 / 第几首」     │     {kind, id/anchorTrackId}
                    └──────────────────┬───────────────────┘
                                       │
       触发入口（3 处）                ▼
  ┌─────────────────────────┐   ┌───────────────────────────────┐
  │ A. Dock 信息点击 (tab感知)│   │  nav-store（跨 tab 导航意图）  │
  │ B. 当前曲目右键/长按菜单  │──▶│  openSet/openSystemPlaylist/   │
  │ C. coverflow 封面上/下滑  │   │  openOnlinePlaylist            │
  └─────────────────────────┘   │  pendingLibraryEntity          │
                                 │  + anchorTrackId（新增可选）   │
                                 └───────────────┬───────────────┘
                                                 │ tab="search" + 待开实体(+锚点)
                                                 ▼
                          ┌──────────────────────────────────────┐
                          │ search-page 消费 pendingLibraryEntity │
                          │  → SetDetailView / SystemPlaylist     │
                          │    Detail / EntityDetail              │
                          │  → 透传 anchorTrackId 到               │
                          │    TrackListSection → VirtualTrackList │
                          │    (selectedTrackId 高亮 +             │
                          │     initialScrollIndex 滚动到位)        │
                          │  → 触发 gallery-cover morph(见 §2.4)  │
                          └──────────────────────────────────────┘
```

### 2.2 Technology Stack（沿用，不新增）

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **导航状态** | Zustand `nav-store`（`tab` + `pendingLibraryEntity`） | 已是 library deep-link 的唯一裁决点 |
| **播放真相** | Zustand `player-store`（`queueSource`/`activeSessionId`/`currentIndex`/`queue`） | 当前曲目与来源的唯一来源 |
| **封面/手势** | coverflow（`SwipeableCoverStage` + `cover-pager*` + `cover-window-store`） | 纵轴当前空闲，扩展成本低 |
| **列表滚动/高亮** | TanStack Virtual（`VirtualTrackList` 的 `initialScrollIndex` + `selectedTrackId`） | 已支持 scroll-to-index & 高亮 |
| **过渡** | 原生 View Transition（`transitionState`）+ `gallery-cover` 共享封面 morph | 已有基建（reduced-motion + 重背景时自动降级） |

**不引入**：新路由库、新 state manager、新手势库、新动画库（符合硬规则与 PRD「不新增 runtime owner」）。

### 2.3 Project Structure（涉及文件，均为**修改**为主）

```
src/
├── stores/
│   ├── player-store.ts          # [改] QueueSource 增加 online-playlist 来源（见 §3.2 / OQ#1）
│   └── nav-store.ts             # [改] LibraryEntityTarget 增 anchorTrackId；新增 openSystemPlaylist
├── lib/
│   └── playing-source.ts        # [新·纯函数] resolvePlayingSource(state) → JumpTarget | null（唯一裁决 + 穷举单测）
├── components/player/
│   ├── track-identity-row.tsx   # [改] Dock 信息点击改 tab 感知（handleOpen，line 176）
│   ├── track-context-menu.tsx   # [改] CurrentTrackContextMenu 增「跳转到所在歌单」菜单项
│   ├── swipeable-cover-stage.tsx# [改] onPointerUp 增纵向(上/下)滑判定 → 跳转来源（line 840-861）
│   ├── cover-pager-strip.tsx    # [只读参考] coverflow 槽渲染，不改
│   └── cover-window-store.ts    # [只读参考] 共享 coverWindowOffset，不改
├── pages/
│   ├── now-playing-page.tsx     # [可能改] 给 coverflow 基座封面接 jump-to-source 的 morph 命名（见 §2.4）
│   └── search-page.tsx          # [改] 消费 pendingLibraryEntity 时透传 anchorTrackId + 触发 gallery-cover morph
├── components/library/
│   ├── track-list-section.tsx   # [改] 透传 anchorTrackId → 计算显示索引 → 滚动 + 高亮
│   └── virtual-track-list.tsx   # [复用] initialScrollIndex / selectedTrackId（可微调 align:"center"）
└── App.tsx                      # [复用] onOpenNowPlaying（tab 感知逻辑放 handleOpen 里即可，App 无需大改）
```

### 2.4 现有 View Transition + `gallery-cover` 封面 morph（**核心复用**）

1. **基建**：[`view-transition.ts`](../../../src/lib/view-transition.ts) `startViewTransition()` / `canViewTransition()`：
   Chromium（Electron / WebView2 / Chrome）走原生 `document.startViewTransition`，WebKit / reduced-motion /
   **重背景激活时**（`setViewTransitionSuppressed(ambientBackdropActive)`）回退为直接 `update()`。
   [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) `transitionState(update)` = `flushSync` + `startViewTransition`。
2. **共享封面 morph（新）**：search-page 用一个**单一**共享名 `SHARED_COVER_VT = "gallery-cover"`
   （[`search-page.tsx:207`](../../../src/pages/search-page.tsx#L207)）：
   - `morphKey` 记录「当前在 morph 哪个命名空间实体」（如 `set:<id>` / `artist:<key>` / `album:<key>`）。
   - `coverMorphName(ns)`（[`:961`](../../../src/pages/search-page.tsx#L961)）= `morphKey === ns ? SHARED_COVER_VT : undefined` —— 只有 morph 两端佩戴该 `view-transition-name`。
   - `beginCoverMorph(ns)`（[`:968`](../../../src/pages/search-page.tsx#L968)）在 transition 前 `flushSync(setMorphKey(ns))`，让旧 DOM 快照前先打上名字。
   - wall 卡片（`EntityGrid` / set 卡）与详情头部封面（`SetDetailView` 的 `coverViewTransitionName`，[`:1758`](../../../src/pages/search-page.tsx#L1758)）成对佩戴 → 浏览器把一个 morph 成另一个。
3. **关键发现（接线点）**：跨 tab 的 `nav-store.openSet(id)` 走的是**消费 `pendingLibraryEntity`** 路径
   （search-page 直接 `setSelectedSetId`），**绕过了**页面内本地 `openSet` 的 `beginCoverMorph`。因此**从 Now Playing 跳过去默认不会触发封面 morph**。
   要拿到平滑过渡（Now Playing 封面 → 详情头部封面），需在**消费路径**里也调用 `beginCoverMorph(`set:<id>`)`，
   并让 **Now Playing coverflow 基座封面**（[`media-stage.tsx`](../../../src/components/player/media-stage.tsx)）在跳转那一刻佩戴同名 `view-transition-name`。这是 Phase 4 的主要工作（见 §5.4 + OQ#2）。

> 注意：**不要**给 Dock 封面重新加 `layoutId` —— 它是被刻意移除的（[track-identity-row.tsx:37-41](../../../src/components/player/track-identity-row.tsx#L37)，PRD `20260617-dock-swipe-switch-jank`：`layoutId` 的 `getBoundingClientRect` reflow 加剧了拖拽切歌卡顿）。封面连续性走 `gallery-cover` 命名，不走 motion layout。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
播放来源（queueSource）                    导航目标（JumpTarget = 新增纯类型）
─────────────────────────                  ──────────────────────────────────
{kind:"set", setId}              ──映射──▶  {kind:"set", id, anchorTrackId}
{kind:"system-playlist", id}     ──映射──▶  {kind:"system-playlist", id, anchorTrackId}
{kind:"online-playlist", …}*     ──映射──▶  {kind:"online-playlist", playlist, anchorTrackId}
（无来源 / 当前无曲目）           ──映射──▶  null（入口降级，见 §5.2）

* online-playlist 作为播放来源当前未建模 —— 见 §3.2 + Open Question #1
anchorTrackId = queue[currentIndex].id（当前正在播放的曲目 id）
```

### 3.2 Schema / 类型修改

⚠️ 本特性**不触碰 IndexedDB schema**（无 Dexie version bump），只改**内存类型**与**导航意图**。

1. **`LibraryEntityTarget` 增加可选锚点**（[`nav-store.ts:19`](../../../src/stores/nav-store.ts#L19)）：
   ```typescript
   export type LibraryEntityTarget =
     | { kind: "set"; id: string; anchorTrackId?: string }
     | { kind: "system-playlist"; id: SystemPlaylistId; anchorTrackId?: string } // 新增 kind
     | { kind: "artist"; name: string }
     | { kind: "album"; trackId: string }
     | { kind: "online-playlist"; playlist: StreamPlaylist; anchorTrackId?: string };
   ```
   - `anchorTrackId` 缺省 = 老行为（不滚动、不高亮），向后兼容现有 `openSet`/`openArtist` 调用点。

2. **`nav-store` 新增动作**（[`nav-store.ts:33-42`](../../../src/stores/nav-store.ts#L33)）：
   - `openSystemPlaylist(id, anchorTrackId?)` —— **nav-store 当前没有这个跨-tab 入口**（注意：search-page 内部有个**同名的本地** `openSystemPlaylist`，[`search-page.tsx:991`](../../../src/pages/search-page.tsx#L991)，那是页面内 wall→detail，二者不同层）。需在 nav-store 补齐，与 `openSet` 对称。
   - `openSet(id, anchorTrackId?)` / `openOnlinePlaylist(playlist, anchorTrackId?)` 增加可选锚点参数（签名向后兼容）。

3. **`QueueSource` 扩展（Open Question #1 决定）**（[`player-store.ts:151`](../../../src/stores/player-store.ts#L151)）：
   ```typescript
   export type QueueSource =
     | { kind: "set"; setId: string }
     | { kind: "system-playlist"; id: SystemPlaylistId }
     | { kind: "online-playlist"; playlist: StreamPlaylist }; // 新增：在线歌单作为播放来源
   ```
   - 「全部来源覆盖」（产品决策）要求在线歌单被播放时也能跳回。需在「播放在线歌单」的入口处写入该 `queueSource`。
   - 若现状在线歌单播放是先导入成 set / 临时 queue 而**不留来源标识**，则该路径要么补 `queueSource`，要么在 §5.2 走降级（见 OQ#1）。

### 3.3 纯函数：`resolvePlayingSource`

新建 [`src/lib/playing-source.ts`](../../../src/lib/playing-source.ts)（**唯一裁决**，禁止在 UI / store 散落 `if (queueSource.kind === …)`，对齐硬规则「不散落分支」纪律）：

```typescript
export type JumpTarget =
  | { kind: "set"; id: string; anchorTrackId: string }
  | { kind: "system-playlist"; id: SystemPlaylistId; anchorTrackId: string }
  | { kind: "online-playlist"; playlist: StreamPlaylist; anchorTrackId: string };

/** 把播放真相映射成「跳哪去 + 定位到哪首」。无来源 / 无当前曲目 → null。 */
export function resolvePlayingSource(input: {
  queueSource: QueueSource | undefined;
  activeSessionId: string | null;
  currentIndex: number;
  queue: Track[];
}): JumpTarget | null;
```

- 输入是 plain data → **可确定性穷举单测**（对齐硬规则 7：纯逻辑单独穷举）。
- 锚点用 **`anchorTrackId`（稳定 id）而非 index**：详情页可能按列名排序 / 红心过滤 / 站内搜索，列表 index 与 queue index **不一致**，必须按 id 在详情的 `shownTracks` 里定位（见 §5.3）。

---

## 4. API Design

> 纯前端、本地优先，无后端 API。本节描述**内部模块契约**（store actions + 组件 props）。

### 4.1 模块契约

| 契约 | 位置 | 描述 |
|------|------|------|
| `resolvePlayingSource(state)` | `lib/playing-source.ts` | 纯函数，返回 `JumpTarget \| null` |
| `nav.openSet(id, anchorTrackId?)` | `nav-store.ts` | 切到 library + 待开集 + 锚点 |
| `nav.openSystemPlaylist(id, anchorTrackId?)` | `nav-store.ts` | **新增**，对称于 `openSet` |
| `nav.openOnlinePlaylist(playlist, anchorTrackId?)` | `nav-store.ts` | 增加锚点参数 |
| `SetDetailView` props 增 `anchorTrackId?` | `search-page.tsx:1743` | 初次 mount 滚动 + 高亮该曲目 |
| `TrackListSection` props 增 `anchorTrackId?` | `track-list-section.tsx` | 透传 → `VirtualTrackList.initialScrollIndex/selectedTrackId` |
| 消费路径触发 morph | `search-page.tsx`（consume effect） | 设 `anchorTrackId` 后 `beginCoverMorph('set:'+id)` |

### 4.2 触发流程示例（已在 now，点击 Dock 信息）

```typescript
// track-identity-row.tsx —— handleOpen() 改 tab 感知（line 176）
function handleOpen() {
  if (!track) return;
  const tab = useNavStore.getState().tab;
  if (tab !== "now") {
    transitionState(() => onOpen?.()); // 老行为：先回 now（onOpen = setTab("now")）
    return;
  }
  // 已在 now → 跳转到来源并定位当前曲目
  const target = resolvePlayingSource(readPlayerSnapshot());
  if (!target) return;                       // 降级：无来源则不动（见 §5.2）
  transitionState(() => dispatchJump(target)); // 调对应 nav.open*(id, anchorTrackId)
}
```

`dispatchJump(target)` 内部按 `target.kind` 调 `openSet` / `openSystemPlaylist` / `openOnlinePlaylist`
（唯一一处 switch，封装在 nav-store helper 或 lib，UI 不散落）。

### 4.3 Error Handling / Edge Cases

- **无当前曲目 / 无来源**：`resolvePlayingSource` 返回 `null` → 入口 no-op（点击 / 手势不报错、不闪屏）。
- **来源实体已被删除**：search-page 消费 `pendingLibraryEntity` 时若实体不存在（如集已删），保持 pending 直到出现或被新意图覆盖（沿用现有「等实体就绪」逻辑）。需补：长时间无法解析时不要卡死（超时清 pending 或 fallback 到列表顶）。
- **锚点曲目不在详情可见列表**（如详情开了「红心过滤」且当前曲目未红心）：高亮 / 滚动**静默跳过**，仍打开详情（不报错）。
- **Telemetry / 日志**：仅走 [`logger.ts`](../../../src/lib/logger.ts)（硬规则 8）；不上报曲目内容 / id 到任何外部（本地优先，无遥测）。

---

## 5. Frontend Design

### 5.1 三个入口（交互规格）

#### 入口 A：Dock 信息点击（tab 感知）
- **不在 now tab**：维持现状 → `transitionState(setTab("now"))`。
- **已在 now tab**：→ `resolvePlayingSource` → 跳转来源详情 + 定位当前曲目。
- 拖拽尾随的 click 仍被 `didDrag` 吞掉（[track-identity-row.tsx:243-246](../../../src/components/player/track-identity-row.tsx#L243)），不影响 Dock 既有「拖拽切歌」。

#### 入口 B：当前曲目右键 / 长按菜单项（产品决策选定的「可见入口」）
- 在 [`CurrentTrackContextMenu`](../../../src/components/player/track-context-menu.tsx#L194) 增一条菜单项
  「**跳转到所在歌单**」（i18n key，见 §5.5），点击 → 同 §4.2 的 `dispatchJump`。
- 现有菜单项：加入歌单 / 选封面 / 显示模式（cover·video）。新项加在「加入歌单」附近。
- `disabled` 当 `resolvePlayingSource() === null`（无来源时灰显，给出可发现但不误导的可见性）。
- 该菜单同时包裹 Dock 信息行与 Now Playing 封面区（[now-playing-page.tsx:173](../../../src/pages/now-playing-page.tsx#L173) `<CurrentTrackContextMenu>`），一处实现两处可用。

#### 入口 C：coverflow 封面纵向手势（上 / 下滑）
- **上滑 OR 下滑**封面 → 跳转来源（产品明确：两个方向都跳）。
- 现状：coverflow 的 `motion.div` 是 **`drag="x"`（X 轴锁定）**（[swipeable-cover-stage.tsx:836](../../../src/components/player/swipeable-cover-stage.tsx#L836)），
  纵向指针位移**不会**被 motion 当成 drag → 当前在 `onPointerUp` 里因位移 >10px 既非 tap、又无横向 `onDrag`，**直接落空**。
  这正是干净的插入点：
  - 在 [`onPointerUp`（:845-861）](../../../src/components/player/swipeable-cover-stage.tsx#L845) 增判定：`Δy 主导`（`|Δy| > |Δx|`）且 `|Δy| ≥ 阈值`（距离或时间内速度，复用 Dock 的 `DOCK_SWITCH_DISTANCE/VELOCITY` 量级常量）→ `dispatchJump`。
  - tap（`|Δ| < 10px`，移动端切歌词）与横向 coverflow drag（`onDrag` 设 `tapMoved`）逻辑保持不变；纵向是三者之外的新分支。
- 视觉（可选打磨）：纵向拖拽时给基座封面一个轻微 `y` 跟手 + 顶/底浮现「歌单」hint chip，松手达阈值即触发。

> 注：发现性由**入口 B（可见菜单项）**承担；手势是 power-user 加速器，发现性不足可接受。

### 5.2 降级与边界（无来源 / 不支持过渡）

| 场景 | 行为 |
|------|------|
| 无当前曲目 / `resolvePlayingSource()===null` | 入口 A no-op；入口 B 菜单项 disabled；入口 C 手势无动作 |
| WebKit / reduced-motion / 重背景激活 | `startViewTransition` 自动回退为直接切换（无 morph，但功能照常）—— 已由现有基建处理 |
| 在线歌单来源未建模（见 OQ#1） | 临时降级为 no-op 或 fallback 到 now tab，待 §3.2 `QueueSource` 扩展落地后启用 |

### 5.3 列表定位（滚动 + 高亮）

- 详情页（`SetDetailView` / `SystemPlaylistDetail` / `EntityDetailView`）接 `anchorTrackId`：
  - 在该页 `shownTracks` 里 `findIndex(t => t.id === anchorTrackId)` 求**显示索引**（**不复用 queue index**，§3.3）。
  - 命中 → 设 `selectedTrackId={anchorTrackId}` 高亮 + `initialScrollIndex=显示索引` 传给 `VirtualTrackList`
    （[virtual-track-list.tsx:185-192](../../../src/components/library/virtual-track-list.tsx#L185) 已支持 mount 时 `scrollToIndex`，经 Lenis 平滑滚动）。
  - 建议把对齐从 `align:"start"` 调成 `align:"center"`（当前曲目居中更符合「定位」语义）—— 仅锚点路径用 center，常规滚动还原仍 start（OQ#3）。
  - 未命中（被过滤/排序排除）→ 仅打开详情，不滚动不高亮。

### 5.4 平滑过渡接线（Phase 4 重点）

要让「Now Playing 封面 → 来源详情头部封面」有 `gallery-cover` morph：
1. **消费路径触发 morph**：在 search-page 消费 `pendingLibraryEntity`（set / system-playlist / online）时，
   除 `setSelectedSetId` 外，也 `beginCoverMorph('set:'+id)`（系统/在线同理给各自命名空间），让详情头部封面佩戴 `SHARED_COVER_VT`。
2. **源端封面命名**：跳转那一刻给 **Now Playing coverflow 基座封面**（`media-stage.tsx` 的封面元素）`flushSync` 打上同名 `view-transition-name = "gallery-cover"`，作为 morph 的另一端；transition 结束即摘除。
   - 因为是**跨 tab**（now → search）切换，整页也在过渡；封面命名让封面这一块做连续 morph，其余走根 cross-fade。
3. **降级**：`canViewTransition()` 为假时全部跳过命名（沿用 `beginCoverMorph` 既有 guard），不报错、功能照常。

### 5.5 State Management & i18n

- **状态**：不新增持久化状态。`anchorTrackId` 走 `nav-store.pendingLibraryEntity`（ephemeral，**不 persist**，沿用 `partialize` 只存 `tab`/`settingsItem`，[nav-store.ts:68](../../../src/stores/nav-store.ts#L68)）。
- **i18n**（4 语言全量 en/zh/ja/ko，硬规则 i18n）：新增 `t("nav.jumpToSource")`（如 en「Go to playlist」/ zh「跳转到所在歌单」），先加 en 再补 zh/ja/ko；封面 hint chip 文案同理。**禁止**内联文案。

---

## 6. Implementation Plan

> 顺序遵循「基础设施先于覆盖广度」：先把来源解析 + 锚点深链管道打通（Phase 1），再接各入口（2/3），最后做过渡打磨（4）。

### Phase 1: 来源解析 + 锚点深链基础设施

**Goal:** 把「播放真相 → 跳转目标」纯函数化，并让三类详情页支持「滚动到 + 高亮」指定曲目。

**Tasks:**
- [x] 新建 `lib/playing-source.ts` `resolvePlayingSource()` 纯函数 + `JumpTarget` 类型。
- [x] 扩展 `QueueSource` 增 `online-playlist`（播放在线歌单现状为导入/追加进在线 set 再播放，因此当前运行路径仍自然走 set 来源；保留 online source 类型供独立在线队列接入）。
- [x] `nav-store`：`LibraryEntityTarget` 增 `anchorTrackId` + 新增跨-tab `openSystemPlaylist`；`openSet`/`openOnlinePlaylist` 增锚点参数。
- [x] search-page 消费逻辑透传 `anchorTrackId` → `SetDetailView` / `SystemPlaylistDetail`。
- [x] `track-list-section.tsx` 透传 `anchorTrackId` → 计算显示索引 → `VirtualTrackList` 的 `initialScrollIndex` + `selectedTrackId`（`align:"center"`）。

### Phase 1 Checklist
- [x] `resolvePlayingSource` 穷举单测：set / system-playlist / online / 无来源 / 无当前曲目（`currentIndex < 0`）/ 空队列。
- [x] 锚点缺省时所有现有调用点行为不变（向后兼容回归测试）。
- [x] 详情页按 `anchorTrackId` 在排序/过滤后仍能定位（id 而非 index）；未命中静默跳过的单测。
- [x] Phase 1 targeted check 通过：`pnpm tsc --noEmit`、Biome touched files、focused Vitest suite。

### Phase 2: 入口 —— Dock 信息 tab 感知点击 + 右键菜单项

**Goal:** 接通最稳的两个入口（点击 + 可见菜单项）。

**Tasks:**
- [x] `track-identity-row.tsx` `handleOpen()`（line 176）改 tab 感知（非 now → 回 now；已在 now → `dispatchJump`）。
- [x] `CurrentTrackContextMenu` 增「跳转到所在歌单」菜单项（`disabled` 当无来源）。
- [x] `dispatchJump(target)` helper（唯一 switch，封装在 `lib/jump-to-source.ts`）。
- [x] i18n 4 语言加 `nav.jumpToSource`。

### Phase 2 Checklist
- [x] 不在 now → 点 Dock 信息仍切 now（回归）。
- [x] 已在 now → 点 Dock 信息跳到正确来源 + 定位当前曲目。
- [x] 右键菜单项复用统一 `dispatchJumpTarget`；无来源时灰显。
- [x] Dock 既有「拖拽切歌」不被破坏（`didDrag` 吞 click）。
- [x] `track-identity-row.test.tsx` / `track-context-menu.test.tsx` / `jump-to-source.test.ts` 更新并通过；`pnpm tsc --noEmit` + touched-file Biome 通过。

### Phase 3: coverflow 封面上/下滑手势 → 跳转

**Goal:** 给 coverflow 封面纵向手势接上跳转，不破坏横滑切歌与 tap 切歌词。

**Tasks:**
- [x] `swipeable-cover-stage.tsx` 的 `onPointerUp`（:845-861）增纵向判定（Δy 主导 + 距离/速度阈值）→ 上/下滑均 `dispatchJump`。
- [x] 纵向拖拽跟手视觉 + 可选 hint chip（i18n）本期不做额外可视化；发现性由 Phase 2 菜单项承担。
- [x] 确认 tap（`<10px`，移动端切歌词）与横向 coverflow drag 不受影响。

### Phase 3 Checklist
- [x] 横滑 = 上一首/下一首（coverflow 回归不变）。
- [x] 上滑 / 下滑都跳转到来源（两方向对称）。
- [x] 轻 tap 仍切歌词（移动端），不误触发跳转。
- [x] 对角手势按主导轴干净解析（横主导切歌、纵主导跳转）。
- [x] `swipeable-cover-stage.test.ts` 覆盖纵向/横向/轻 tap/快速 flick；focused Vitest、touched-file Biome、`pnpm tsc --noEmit` 通过。

### Phase 4: View Transition —— 复用 `gallery-cover` 封面 morph + a11y 兜底

**Goal:** 让跳转有空间连续性（封面 morph），并在不支持/低动效时优雅降级。

**Tasks:**
- [x] search-page 消费路径触发 `beginCoverMorph`（set / system-playlist / online 各命名空间），让详情头部封面佩戴 `gallery-cover`（§5.4 步骤 1）。
- [x] Now Playing coverflow 基座封面在跳转瞬间佩戴同名 `view-transition-name`，短暂 active 后自动摘除（§5.4 步骤 2）。
- [x] 验证重背景激活（`viewTransitionSuppressed`）/ unsupported View Transition 下回退为直接切换、功能照常（单测覆盖；reduced-motion 由既有 `view-transition.test.ts` 覆盖）。
- [x] 跳转后焦点落到高亮曲目行（键盘可达 / a11y）。

### Phase 4 Checklist
- [x] Chromium（Electron）封面 morph 接线完成：统一 `SOURCE_COVER_MORPH_NAME = "gallery-cover"`，Now Playing 源端与 search detail 目标端共用命名；仍需实际 Electron 视觉 smoke pass 确认可见效果。
- [x] WebKit / reduced-motion / 重背景下直接切换不报错、定位仍正确（`source-cover-transition.test.ts` + 既有 `view-transition.test.ts` 覆盖 fallback）。
- [x] 键盘从 Now Playing 触发跳转后，焦点/aria 落在当前曲目行（`initialFocusIndex` 单测覆盖）。
- [x] Verification：focused Vitest（7 files / 30 tests）、`pnpm tsc --noEmit`、touched-file Biome 均通过；`make check` 已尝试，typecheck 通过，但全库 lint 被本 PRD 未触碰文件的既有 Biome 格式/import 问题阻塞（如 `src/chat/dj-chat-tool-metadata.test.ts`、`src/components/player/changelog-modal.tsx`、`src/visualizer/*`）。

---

## 7. Out of Scope

- **集详情页 / coverflow 本身的重构**：仅透传锚点 + 增纵向手势 + 接 morph，不改详情页布局或 coverflow 核心引擎。
- **给 Dock 封面重加 `layoutId`**：刻意不做（PRD `20260617-dock-swipe-switch-jank`），连续性走 `gallery-cover` 命名。
- **反向高亮联动**：详情页「当前播放行」的常驻动态高亮 / 跟随（本期只做「跳转那一刻」的定位）。
- **Dock 队列抽屉的当前曲目定位**：queue-panel 当前是「pure up-next surface」，是否让它也高亮/定位当前曲目见 OQ#5，本期不强制。
- **新建独立「队列上下文」页面**：复用现有 library 详情，不引入新页面/新路由。
- **手势配置化 / 自定义方向**：不提供 Settings 改手势方向（避免硬规则 3 的 hidden toggle 与过度设计）。
- **遥测 / A-B**：本地优先无后端，无埋点。

---

## 8. Security Considerations

- **本地优先无后端**（硬规则 1）：本特性纯前端状态导航，无网络出站、无新数据存储。
- **无密钥 / 无 PII 外泄**（硬规则 2）：不涉及任何 key；曲目 id / 内容不离开设备、不进日志外部。
- **日志纪律**（硬规则 8）：调试只走 `logger.ts`，prod 静默 debug/info。
- **无 hidden flag**（硬规则 3）：无 localStorage / URL / `window.*` 开关；回退 = `git revert`。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260618 coverflow backlight/shadow drag PRD](../) | coverflow 拖拽期 backlight/shadow hand-off（`swipeable-cover-stage` 注释多处引用 `20260618-backlight-shadow-drag`）；Phase 3/4 不能破坏其 hand-off |
| `20260617-dock-swipe-switch-jank`（commit 注释引用） | 为何 Dock 封面**移除** `layoutId`；本 PRD 据此不重加，改用 `gallery-cover` 命名 |
| [20260614 list-scroll-affordances PRD](../20260614-muzero-list-scroll-affordances-prd/20260614-muzero-list-scroll-affordances-prd.md) | `TrackListSection` 滚动锚点（`scroll.anchorIndexRef`），本特性复用其 scroll-to-index 管道 |
| [20260610 artist-album-library-entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | `nav-store` library deep-link（`openArtist`/`openAlbumForTrack`）+ `gallery-cover` morph 的来源，本特性对称扩展 |
| [`view-transition.ts`](../../../src/lib/view-transition.ts) / [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) | View Transition 基建 |

## Related Issues
- （待建）Closes: Now Playing「点了没反应」/ coverflow 封面纵向手势缺口
- Related: 移动端全屏纵向手势细节（后续 mobile phase）

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 在线歌单作为播放来源当前**未建模**（`QueueSource` 只有 set / system-playlist）。播放在线歌单是否会留下可跳转的来源标识？ | Resolved | Phase 1 已扩展 `QueueSource` 增 `online-playlist` 与 resolver 覆盖；现有在线歌曲播放路径会导入/追加进在线 set 再播放，因此当前真实入口直接走 set 分支，不额外改播放编排。 |
| 2 | 跨-tab 跳转（now→search）时，`gallery-cover` 封面 morph 从 **coverflow 基座封面** 出发是否稳定？（coverflow 基座在拖拽/hand-off 期有 opacity 切换，[swipeable-cover-stage.tsx:875](../../../src/components/player/swipeable-cover-stage.tsx#L875)） | Resolved | Phase 4 接线：`jumpToSource()` 先 arm 源端 cover morph；coverflow 纵向手势路径会先 `closeOverlay()` 再跳转，避免与 hand-off 抢帧。目标端由 search-page pending 消费路径按来源命名空间触发 `beginCoverMorph`。 |
| 3 | 详情页定位的滚动对齐用 `center` 还是 `start`？ | Open | 倾向 `center`（定位语义更强），但列表很短时 center 可能无效，需实测回退 `start`。 |
| 4 | 当前曲目被详情页过滤（如红心过滤开启且未红心）时，是否要**自动清过滤**以保证可定位？ | Open | 倾向不自动清（尊重用户当前视图），仅静默跳过高亮。 |
| 5 | Dock 队列抽屉（「pure up-next surface」）是否也应高亮/定位当前曲目，作为「轻量级 jump-to-source」？ | Open | 倾向本期不做（抽屉定位为 up-next，不含已播）；若后续要，复用同一 `selectedTrackId`/`initialScrollIndex` 管道即可。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | UX / Frontend | Initial draft（来源覆盖：全部来源；可见入口：复用右键/长按菜单项） |
| 2026-06-18 | UX / Frontend | 复审重写：对齐 coverflow 重构（`SwipeableCoverStage`/`cover-pager*`/`cover-window-store` 取代 `swipeable-media-stage`）、改用新 `gallery-cover` 共享封面 morph（弃 `layoutId`）、补「消费路径绕过 morph」接线点、新增 OQ#2/#5、更新全部文件引用与行号 |
| 2026-06-18 | Codex | Phase 1 completed：新增播放来源 resolver、nav-store 锚点 deep-link、set/system 详情锚点消费、TrackListSection/VirtualTrackList 居中定位测试与实现。 |
| 2026-06-18 | Codex | Phase 2 completed：Dock 信息点击 tab-aware 跳转、当前曲目菜单新增可见跳转项、统一 `dispatchJumpTarget` helper、四语言 `nav.jumpToSource`。 |
| 2026-06-18 | Codex | Phase 3 completed：coverflow 封面纵向上/下滑识别为 jump-to-source，横向主导仍交给 coverflow 切歌，轻 tap 不误触发。 |
| 2026-06-18 | Codex | Phase 4 completed：新增共享 source-cover morph 状态、`jumpToSource()` 统一 arm + transition + dispatch、search-page pending 消费复用 `gallery-cover` 命名空间、锚点跳转后聚焦当前曲目行。 |
| 2026-06-18 | Codex | Follow-up fix：拆分列表滚动语义，`initialScrollIndex` 回到 mount-only（普通点击/聚焦不抢 scrollbar），新增显式 `jumpScrollIndex` / `jumpFocusIndex` 只响应 Dock/Now Playing 来源跳转；列表内增加悬浮「跳到当前歌曲」按钮供手动定位。 |
| 2026-06-18 | Codex | Follow-up fix：悬浮「跳到当前歌曲」按钮改为锚定在整个列表区域层，而非滚动容器内部；按钮在列表内容滚动时始终可见，点击后才手动定位当前曲目。 |
| 2026-06-18 | Codex | Follow-up polish：悬浮「跳到当前歌曲」按钮调整为列表区域内水平居中、靠上显示，并使用 primary 背景强化主动作语义。 |
| 2026-06-18 | Codex | Follow-up polish：悬浮「跳到当前歌曲」按钮位置从居中靠上改为靠上居右，保留 primary 主动作样式。 |

---

> **Note:** 本 PRD 强调复用既有代码（`nav-store` deep-link / `player-store` 来源 / `VirtualTrackList` scroll-to-index / coverflow 手势 / `gallery-cover` 封面 morph），仅新增一个纯函数文件 `lib/playing-source.ts` 与一条可见菜单项；其余均为既有文件的小幅修改，符合「修改优先、不新建结构」与硬规则。
