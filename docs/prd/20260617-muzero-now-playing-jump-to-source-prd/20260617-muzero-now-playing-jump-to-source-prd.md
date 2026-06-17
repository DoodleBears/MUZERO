# PRD: Now Playing →「跳转到歌曲所在歌单」(Jump-to-Source)

**Status:** Draft
**Created:** 2026-06-17
**Author:** UX / Frontend (MUZERO)
**Module:** Navigation · Now Playing · Library Deep-link

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 来源解析 + 锚点深链基础设施 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 入口：Dock 信息 tab 感知点击 + 右键菜单项 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Now Playing 封面上/下滑手势 → 跳转 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | View Transition 平滑过渡 + a11y 兜底 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前从底部 `PlayerDock` 点击歌曲信息（封面 + 标题），会切到 tab 1「Now Playing」
（[`track-identity-row.tsx:171`](../../../src/components/player/track-identity-row.tsx#L171) 的 `handleOpen()`
→ `transitionState(onOpen)`，`onOpen` 在 [`App.tsx`](../../../src/App.tsx) 里是 `() => setTab("now")`）。

问题：**这个动作没有终点感**。

1. 当用户**已经在 Now Playing tab** 时再点 Dock 信息 —— 没有任何变化（已经在 now，`setTab("now")` 是 no-op），
   点击像是「坏掉了」。用户此刻真正想做的是：**回到这首歌所在的歌单（集 / 系统歌单 / 在线歌单），并定位到这首歌在列表里的位置**
   （「我现在听的这首，在歌单里它前后是什么？」）。
2. Now Playing 的封面目前只有**横滑切上一首 / 下一首**（[`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx)
   `drag="x"`）+ 移动端 tap 切歌词，**纵向手势完全未用**。竖直方向是一块「免费的」、符合直觉的手势空间，可以承载
   「上拉/下拉看这首歌的来源歌单」。

这是一个典型的「Now Playing ↔ 歌单上下文」双向导航缺口。Apple Music / Spotify 都提供从正在播放跳回「来源队列 / 专辑 / 歌单并高亮当前曲目」。
MUZERO 已经具备所有零件（见 §2），只缺把它们接起来 + 一个让人愿意用的过渡。

产品经理明确要求：**过渡要走 View Transition 的平滑效果**（已有 `transitionState` + motion `layoutId` 共享元素基建，见 §2.4）。

### 1.2 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **听歌用户（桌面主力）** | 在 Now Playing 沉浸看封面/可视化，想快速回到歌单上下文 | 一个手势 / 一次点击就能跳到「这首歌在哪个歌单的第几首」 |
| **混合集策展用户** | 维护 DJ 集 / 上传集 / 系统歌单（最近、红心） | 从正在播放直达该集详情，顺手编辑、加歌、调序 |
| **移动端用户（后续打磨）** | 全屏封面，触摸优先 | 上/下滑封面这种触摸友好手势直达来源 |

### 1.3 Core Value

1. **闭环导航**：Now Playing 与「来源歌单」之间建立双向跳转，消除「点了没反应」的死角。
2. **定位即上下文**：跳过去不是只打开歌单，而是 **scroll 到当前曲目 + 高亮**，立刻回答「它在歌单里的位置」。
3. **平滑过渡**：复用既有 View Transition + 共享封面 morph，让跳转有空间连续性，不是生硬切屏。
4. **零新依赖、零隐藏 flag**：全部基于现有 `nav-store` / `player-store` / `view-transition` 基建扩展（符合硬规则 3 & 10）。

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
  ┌─────────────────────┐   ┌───────────────────────────────┐
  │ A. Dock 信息点击     │   │  nav-store（导航意图）         │
  │   (tab 感知)        │──▶│  openSet/openSystemPlaylist/   │
  │ B. 右键/长按菜单项   │   │  openOnlinePlaylist            │
  │ C. Now Playing 封面 │   │  pendingLibraryEntity          │
  │    上/下滑手势       │   │  + anchorTrackId（新增可选）   │
  └─────────────────────┘   └───────────────┬───────────────┘
                                             │ tab="search" + 待开实体
                                             ▼
                          ┌──────────────────────────────────────┐
                          │ search-page 消费 pendingLibraryEntity │
                          │  → SetDetailView / SystemPlaylist     │
                          │    Detail / OnlinePlaylist 详情        │
                          │  → 透传 anchorTrackId 到               │
                          │    TrackListSection → VirtualTrackList │
                          │    (selectedTrackId 高亮 +             │
                          │     initialScrollIndex 滚动到位)        │
                          └──────────────────────────────────────┘
                                             ▲
                       transitionState() 包裹整个状态切换（View Transition）
                       + 共享封面 view-transition-name / layoutId morph
```

### 2.2 Technology Stack（沿用，不新增）

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **导航状态** | Zustand `nav-store`（`tab` + `pendingLibraryEntity`） | 已是 library deep-link 的唯一裁决点 |
| **播放真相** | Zustand `player-store`（`queueSource`/`activeSessionId`/`currentIndex`/`queue`） | 当前曲目与来源的唯一来源 |
| **列表滚动/高亮** | TanStack Virtual（`VirtualTrackList` 的 `initialScrollIndex` + `selectedTrackId`） | 已支持 scroll-to-index & 高亮 |
| **过渡** | 原生 View Transition（`transitionState`）+ motion `layoutId` / `view-transition-name` | 已有基建（reduced-motion + 重背景时自动降级） |
| **手势** | motion drag（`swipeable-media-stage` / `swipeable-cover-stage` 现有 drag 框架） | 纵轴当前空闲，扩展成本低 |

**不引入**：新路由库、新 state manager、新手势库、新动画库（符合硬规则与 PRD「不新增 runtime owner」）。

### 2.3 Project Structure（涉及文件，均为**修改**为主）

```
src/
├── stores/
│   ├── player-store.ts          # [改] QueueSource 增加 online-playlist 来源（见 §3.2）
│   └── nav-store.ts             # [改] LibraryEntityTarget 增 anchorTrackId；新增 openSystemPlaylist
├── lib/
│   └── playing-source.ts        # [新·纯函数] resolvePlayingSource(state) → JumpTarget | null（唯一裁决 + 穷举单测）
├── components/player/
│   ├── track-identity-row.tsx   # [改] Dock 信息点击改 tab 感知（已在 now → 跳转来源）
│   ├── track-context-menu.tsx   # [改] CurrentTrackContextMenu 增「跳转到所在歌单」菜单项
│   ├── swipeable-media-stage.tsx# [改] 纵向 drag 手势：上/下滑 → 跳转来源
│   └── swipeable-cover-stage.tsx# [改] 同上（cover-only 路径）
├── pages/
│   └── search-page.tsx          # [改] SetDetailView / SystemPlaylistDetail / OnlinePlaylist 消费 anchorTrackId
├── components/library/
│   ├── track-list-section.tsx   # [改] 透传 anchorTrackId → 滚动 + 高亮
│   └── virtual-track-list.tsx   # [复用] initialScrollIndex / selectedTrackId（无需改或微调 align:"center"）
└── App.tsx                      # [改] 把 onOpenNowPlaying 从 setTab("now") 升级为 tab 感知 handler
```

### 2.4 现有 View Transition 基建（复用）

- [`view-transition.ts`](../../../src/lib/view-transition.ts) `startViewTransition()`：Chromium（Electron / WebView2 / Chrome）走原生 `document.startViewTransition`，
  WebKit / reduced-motion / **重背景激活时**（`setViewTransitionSuppressed(ambientBackdropActive)`，[`App.tsx:248`](../../../src/App.tsx#L248)）回退为直接 `update()`。
- [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) `transitionState(update)`：`flushSync` + `startViewTransition`，是 Dock / Header / FAB 切 tab 的统一包裹。
- 共享元素：Dock 封面 motion `layoutId="now-cover"`（[`track-identity-row.tsx:250`](../../../src/components/player/track-identity-row.tsx#L250)）；
  集详情头部封面已支持 `coverViewTransitionName`（[`search-page.tsx:1118`](../../../src/pages/search-page.tsx#L1118) 的 `coverMorphName('set:'+id)`）。

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

2. **`nav-store` 新增动作**：
   - `openSystemPlaylist(id, anchorTrackId?)` —— 当前 `search-page` 内部已有 `selectedSystemPlaylistId`
     （[`search-page.tsx`](../../../src/pages/search-page.tsx)），但**没有对应的 nav 意图入口**，需要补齐（与 `openSet` 对称）。
   - `openSet(id, anchorTrackId?)` / `openOnlinePlaylist(playlist, anchorTrackId?)` 增加可选锚点参数（签名向后兼容）。

3. **`QueueSource` 扩展（Open Question #1 决定）**（[`player-store.ts:149`](../../../src/stores/player-store.ts#L149)）：
   ```typescript
   export type QueueSource =
     | { kind: "set"; setId: string }
     | { kind: "system-playlist"; id: SystemPlaylistId }
     | { kind: "online-playlist"; playlist: StreamPlaylist }; // 新增：在线歌单作为播放来源
   ```
   - 「全部来源覆盖」（产品决策）要求在线歌单被播放时也能跳回。需在「播放在线歌单」的入口处写入该 `queueSource`。
   - 若现状在线歌单播放是先导入成 set / 临时 queue 而**不留来源标识**，则该路径要么补 `queueSource`，要么在 §5.2 走降级（见 Open Question #1）。

### 3.3 纯函数：`resolvePlayingSource`

新建 [`src/lib/playing-source.ts`](../../../src/lib/playing-source.ts)（**唯一裁决**，禁止在 UI / store 散落 `if (queueSource.kind === …)`，对齐硬规则 5/6 的「不散落分支」纪律）：

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
| `nav.openSystemPlaylist(id, anchorTrackId?)` | `nav-store.ts` | 新增，对称于 `openSet` |
| `nav.openOnlinePlaylist(playlist, anchorTrackId?)` | `nav-store.ts` | 增加锚点参数 |
| `SetDetailView` props 增 `anchorTrackId?` | `search-page.tsx:1712` | 初次 mount 滚动 + 高亮该曲目 |
| `TrackListSection` props 增 `anchorTrackId?` | `track-list-section.tsx` | 透传 → `VirtualTrackList.initialScrollIndex/selectedTrackId` |

### 4.2 触发流程示例（已在 now，点击 Dock 信息）

```typescript
// track-identity-row.tsx —— Dock 信息点击改为 tab 感知
function handleOpen() {
  if (!track) return;
  const tab = useNavStore.getState().tab;
  if (tab !== "now") {
    transitionState(() => useNavStore.getState().setTab("now")); // 老行为：先回 now
    return;
  }
  // 已在 now → 跳转到来源并定位当前曲目
  const target = resolvePlayingSource(readPlayerSnapshot());
  if (!target) return;                       // 降级：无来源则不动（见 §5.2）
  transitionState(() => dispatchJump(target)); // 调对应 nav.open* + 锚点
}
```

`dispatchJump(target)` 内部按 `target.kind` 调 `openSet` / `openSystemPlaylist` / `openOnlinePlaylist`
（唯一一处 switch，封装在 nav-store helper，UI 不散落）。

### 4.3 Error Handling / Edge Cases

- **无当前曲目 / 无来源**：`resolvePlayingSource` 返回 `null` → 入口 no-op（点击 / 手势不报错、不闪屏）。
- **来源实体已被删除**：`search-page` 消费 `pendingLibraryEntity` 时若实体不存在（如集已删），保持 pending 直到出现或被新意图覆盖（沿用现有 `openArtist`/`openSet` 的「等实体就绪」逻辑，[`search-page.tsx:582`](../../../src/pages/search-page.tsx#L582)）。需补：长时间无法解析时不要卡死（超时清 pending 或 fallback 到列表顶）。
- **锚点曲目不在详情可见列表**（如详情开了「红心过滤」且当前曲目未红心）：高亮 / 滚动**静默跳过**，仍打开详情（不报错）。
- **Telemetry / 日志**：仅走 [`logger.ts`](../../../src/lib/logger.ts)（硬规则 8）；不上报曲目内容 / id 到任何外部（本地优先，无遥测）。

---

## 5. Frontend Design

### 5.1 三个入口（交互规格）

#### 入口 A：Dock 信息点击（tab 感知）
- **不在 now tab**：维持现状 → `transitionState(setTab("now"))`。
- **已在 now tab**：→ `resolvePlayingSource` → 跳转来源详情 + 定位当前曲目。
- 拖拽尾随的 click 仍被 `didDrag` 吞掉（[`track-identity-row.tsx:224`](../../../src/components/player/track-identity-row.tsx#L224)），不影响 Dock 既有「拖拽切歌」。

#### 入口 B：右键 / 长按菜单项（产品决策选定的「可见入口」）
- 在 [`CurrentTrackContextMenu`](../../../src/components/player/track-context-menu.tsx#L194) 增一条菜单项
  「**跳转到所在歌单**」（i18n key，见 §5.4），点击 → 同 §4.2 的 `dispatchJump`。
- `disabled` 当 `resolvePlayingSource() === null`（无来源时灰显，给出可发现但不误导的可见性）。
- 这是**唯一新增的可见 UI**，覆盖 Dock 右键 + Now Playing 当前曲目右键（同一组件包裹）。

#### 入口 C：Now Playing 封面纵向手势（上 / 下滑）
- **上滑 OR 下滑**封面 → 跳转来源（产品明确：两个方向都跳）。
- 复用 [`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx) /
  [`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) 现有 drag 框架，**新增纵轴判定**：
  - 横轴主导（`|Δx| ≥ |Δy|`）→ 维持「上一首 / 下一首」。
  - 纵轴主导且超过阈值（距离或速度，复用 Dock 的 `DOCK_SWITCH_DISTANCE/VELOCITY` 量级常量）→ 触发跳转。
  - 轻 tap（移动端切歌词）保持不变 —— 纵向**位移阈值**区分 tap 与 swipe。
- 视觉：纵向拖拽时给封面一个轻微 `y` 跟手 + 提示（如顶部/底部浮现「歌单」hint chip），松手达阈值即 `transitionState(dispatchJump)`。

> 注：发现性由**入口 B（可见菜单项）**承担；手势是 power-user 加速器，发现性不足可接受。

### 5.2 降级与边界（无来源 / 不支持过渡）

| 场景 | 行为 |
|------|------|
| 无当前曲目 / `resolvePlayingSource()===null` | 入口 A no-op；入口 B 菜单项 disabled；入口 C 手势无动作 |
| WebKit / reduced-motion / 重背景激活 | `startViewTransition` 自动回退为直接切换（无 morph，但功能照常）—— 已由现有基建处理 |
| 在线歌单来源未建模（见 OQ#1） | 临时降级为 no-op 或 fallback 到 now tab，待 §3.2 `QueueSource` 扩展落地后启用 |

### 5.3 列表定位（滚动 + 高亮）

- 详情页（`SetDetailView` / `SystemPlaylistDetail` / `OnlinePlaylist` detail）接 `anchorTrackId`：
  - 在该页 `shownTracks` 里 `findIndex(t => t.id === anchorTrackId)` 求**显示索引**（**不复用 queue index**，§3.3）。
  - 命中 → 设 `selectedTrackId={anchorTrackId}` 高亮 + `initialScrollIndex=显示索引` 传给 `VirtualTrackList`
    （[`virtual-track-list.tsx:178`](../../../src/components/library/virtual-track-list.tsx#L178) 已支持 mount 时 `scrollToIndex`）。
  - 建议把对齐从 `align:"start"` 调成 `align:"center"`（当前曲目居中更符合「定位」语义）—— 仅锚点路径用 center，常规滚动还原仍 start。
  - 未命中（被过滤/排序排除）→ 仅打开详情，不滚动不高亮。

### 5.4 State Management & i18n

- **状态**：不新增持久化状态。`anchorTrackId` 走 `nav-store.pendingLibraryEntity`（ephemeral，**不 persist**，沿用 `partialize` 只存 `tab`/`settingsItem`，[`nav-store.ts:68`](../../../src/stores/nav-store.ts#L68)）。
- **i18n**（4 语言全量 en/zh/ja/ko，硬规则 i18n）：新增 `t("nav.jumpToSource")`（如 en「Go to playlist」/ zh「跳转到所在歌单」），先加 en 再补 zh/ja/ko；封面 hint chip 文案同理。**禁止**内联文案。

---

## 6. Implementation Plan

> 顺序遵循「基础设施先于覆盖广度」：先把来源解析 + 锚点深链管道打通（Phase 1），再接各入口（2/3），最后做过渡打磨（4）。

### Phase 1: 来源解析 + 锚点深链基础设施

**Goal:** 把「播放真相 → 跳转目标」纯函数化，并让三类详情页支持「滚动到 + 高亮」指定曲目。

**Tasks:**
- [ ] 新建 `lib/playing-source.ts` `resolvePlayingSource()` 纯函数 + `JumpTarget` 类型。
- [ ] 扩展 `QueueSource` 增 `online-playlist`（并在播放在线歌单入口写入，见 OQ#1）。
- [ ] `nav-store`：`LibraryEntityTarget` 增 `anchorTrackId` + 新增 `openSystemPlaylist`；`openSet`/`openOnlinePlaylist` 增锚点参数。
- [ ] `search-page` 消费逻辑透传 `anchorTrackId` → `SetDetailView` / `SystemPlaylistDetail` / `OnlinePlaylist` detail。
- [ ] `track-list-section.tsx` 透传 `anchorTrackId` → 计算显示索引 → `VirtualTrackList` 的 `initialScrollIndex` + `selectedTrackId`（`align:"center"`）。

### Phase 1 Checklist
- [ ] `resolvePlayingSource` 穷举单测：set / system-playlist / online / 无来源 / 无当前曲目（`currentIndex < 0`）/ 空队列。
- [ ] 锚点缺省时所有现有调用点行为不变（向后兼容回归测试）。
- [ ] 详情页按 `anchorTrackId` 在排序/过滤后仍能定位（id 而非 index）；未命中静默跳过的单测。
- [ ] `make check` 通过（typecheck + lint + test）。

### Phase 2: 入口 —— Dock 信息 tab 感知点击 + 右键菜单项

**Goal:** 接通最稳的两个入口（点击 + 可见菜单项）。

**Tasks:**
- [ ] `track-identity-row.tsx` `handleOpen()` 改 tab 感知（非 now → 回 now；已在 now → `dispatchJump`）。
- [ ] `App.tsx` 的 `onOpenNowPlaying` 升级（或在 `handleOpen` 内读 `nav-store` 当前 tab）。
- [ ] `CurrentTrackContextMenu` 增「跳转到所在歌单」菜单项（`disabled` 当无来源）。
- [ ] `dispatchJump(target)` helper（唯一 switch，封装在 nav-store 或 lib）。
- [ ] i18n 4 语言加 `nav.jumpToSource`。

### Phase 2 Checklist
- [ ] 不在 now → 点 Dock 信息仍切 now（回归）。
- [ ] 已在 now → 点 Dock 信息跳到正确来源 + 定位当前曲目。
- [ ] 右键菜单项在三类来源都正确；无来源时灰显。
- [ ] Dock 既有「拖拽切歌」不被破坏（`didDrag` 吞 click）。
- [ ] `track-identity-row.test.tsx` / `track-context-menu.test.tsx` 更新并通过。

### Phase 3: Now Playing 封面上/下滑手势 → 跳转

**Goal:** 给封面纵向手势接上跳转，不破坏横滑切歌与 tap 切歌词。

**Tasks:**
- [ ] `swipeable-media-stage.tsx` 增纵轴判定（主导轴 + 距离/速度阈值）→ 上/下滑均 `dispatchJump`。
- [ ] `swipeable-cover-stage.tsx` 同步（cover-only 路径）。
- [ ] 纵向拖拽跟手视觉 + 可选 hint chip（i18n）。
- [ ] tap（移动端切歌词）与 swipe 用位移阈值区分。

### Phase 3 Checklist
- [ ] 横滑 = 上一首/下一首（回归不变）。
- [ ] 上滑 / 下滑都跳转到来源（两方向对称）。
- [ ] 轻 tap 仍切歌词（移动端），不误触发跳转。
- [ ] 对角手势按主导轴干净解析（横主导切歌、纵主导跳转）。
- [ ] 现有 `swipeable-*` 单测更新并通过。

### Phase 4: View Transition 平滑过渡 + a11y 兜底

**Goal:** 让跳转有空间连续性（封面 morph），并在不支持/低动效时优雅降级。

**Tasks:**
- [ ] 全部入口统一走 `transitionState()` 包裹状态切换。
- [ ] 共享封面 morph：Now Playing 封面 → 详情头部封面 / 目标行封面，复用 `view-transition-name`（`coverMorphName`）/ `layoutId`，确保命名一致可桥接。
- [ ] 验证重背景激活（`viewTransitionSuppressed`）/ reduced-motion / WebKit 下回退为直接切换、功能照常。
- [ ] 跳转后焦点落到高亮曲目行（键盘可达 / a11y）。

### Phase 4 Checklist
- [ ] Chromium（Electron）下可见封面 morph，无闪烁/跳变。
- [ ] WebKit / reduced-motion / 重背景下直接切换不报错、定位仍正确。
- [ ] 键盘从 Now Playing 触发跳转后，焦点/aria 落在当前曲目行。
- [ ] `make check` + 手动 Electron 端到端验证（点击/菜单/上滑/下滑 × set/system/online）。

---

## 7. Out of Scope

- **集详情页本身的重构**：仅透传锚点 + 微调滚动对齐，不改详情页布局/功能。
- **反向高亮联动**：详情页「当前播放行」的常驻动态高亮 / 跟随（本期只做「跳转那一刻」的定位）。
- **新建独立「队列上下文」页面**：复用现有 library 详情，不引入新页面/新路由。
- **手势配置化 / 自定义方向**：不提供 Settings 里改手势方向（避免硬规则 3 的 hidden toggle 与过度设计）。
- **桌面 ↔ 移动数据迁移 / sheet 全屏交互重做**：移动端全屏 sheet 的纵向手势细节打磨在后续移动端 phase（参考 mobile KMP 方向）。
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
| [20260614 list-scroll-affordances PRD](../20260614-muzero-list-scroll-affordances-prd/20260614-muzero-list-scroll-affordances-prd.md) | `TrackListSection` 滚动锚点（`scroll.anchorIndexRef`）来源，本特性复用其 scroll-to-index 管道 |
| [20260610 artist-album-library-entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | `nav-store` library deep-link（`openArtist`/`openAlbumForTrack`）模式，本特性对称扩展 |
| [20260615 now-playing background layer consolidation PRD](../20260615-muzero-now-playing-background-layer-consolidation-prd/) | `viewTransitionSuppressed`（重背景时降级）背景，影响过渡降级路径 |
| [`view-transition.ts`](../../../src/lib/view-transition.ts) / [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts) | View Transition 基建 |

## Related Issues
- （待建）Closes: Now Playing「点了没反应」/ 封面纵向手势缺口
- Related: 移动端全屏 sheet 纵向手势细节（后续 mobile phase）

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 在线歌单作为播放来源当前**未建模**（`QueueSource` 只有 set / system-playlist）。播放在线歌单是否会留下可跳转的来源标识？ | Open | 倾向：扩展 `QueueSource` 增 `online-playlist`，在播放入口写入；若该路径实际是「导入成 set 再播」，则直接走 set 分支，无需新 kind。Phase 1 先确认现状再定。 |
| 2 | 纵向手势的「上滑 / 下滑」是否需要**不同语义**（如下滑=收起到 mini、上滑=去歌单）？ | Resolved | 产品已定：两方向都跳转到来源。 |
| 3 | 详情页定位的滚动对齐用 `center` 还是 `start`？ | Open | 倾向 `center`（定位语义更强），但列表很短时 center 可能无效，需实测回退 `start`。 |
| 4 | 当前曲目被详情页过滤（如红心过滤开启且未红心）时，是否要**自动清过滤**以保证可定位？ | Open | 倾向不自动清（尊重用户当前视图），仅静默跳过高亮。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | UX / Frontend | Initial draft（来源覆盖：全部来源；可见入口：复用右键/长按菜单项） |

---

> **Note:** 本 PRD 强调复用既有代码（`nav-store` deep-link / `player-store` 来源 / `VirtualTrackList` scroll-to-index / `view-transition` 基建），仅新增一个纯函数文件 `lib/playing-source.ts` 与一条可见菜单项；其余均为既有文件的小幅修改，符合「修改优先、不新建结构」与硬规则。
