# PRD: 曲目行激活模型统一（单击选中 / 双击播放）

**Status:** Final（Phase 1 已落地实现；交互模型经 owner 拍板 = 单击选中、双击播放）
**Created:** 2026-06-21
**Author:** MUZERO Core / Library UX
**Module:** Library Track List — 曲目行点击语义（[`TrackRow`](../../../../src/components/library/track-row.tsx)）：消除「第一次点击只选中、不播放」的困惑，统一为桌面 master-detail 标准。

> **一句话**：歌单详情 / 全部歌曲 / 专辑 / 歌手四个详情页**用的是同一套 `TrackRow` 代码**，并非「实现不一样」。它们都采用旧的「两段式激活」（first click 选中、再点已选中行才播放），与用户「点歌即播」的直觉冲突。本期把它对齐为 **单击选中（更新右侧 inspector）、双击播放** 的桌面 master-detail 标准（Spotify / Apple Music / iTunes / foobar 同款），并删除「再次单击已选中行就播放」这条令人意外的隐式路径。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | `TrackRow` 激活模型重写（单击选中 / 双击播放）+ 单测 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

**用户报告：** 歌单详情页（以及「全部歌曲」库列表）里，**点一首歌的第一次点击只是把它选中（Selected），不会切歌播放**；只有双击、再次点击已选中的那一行、或键盘快捷键才会真正播放。用户感觉这与「专辑」「歌手」页面的歌曲列表实现不一致。

**排查结论（代码层事实）：**

- 歌单详情（[`SetDetailView`](../../../../src/pages/search-page.tsx)）、库「全部歌曲」（[search-page.tsx](../../../../src/pages/search-page.tsx)）、专辑/歌手（[`EntityDetailView`](../../../../src/components/library/entity-detail.tsx)）、系统歌单（红心/最多/最近，[`SystemPlaylistDetail`](../../../../src/components/library/system-playlist-detail.tsx)）**四者渲染的是同一个 [`TrackListSection`](../../../../src/components/library/track-list-section.tsx) → [`VirtualTrackList`](../../../../src/components/library/virtual-track-list.tsx) → [`TrackRow`](../../../../src/components/library/track-row.tsx)**，并且都同样传入 `onView`（选中）+ `onPlay`（播放）+ `selectedTrackId`。所以**四个页面的点击行为完全相同**——「专辑/歌手实现不一样」是错觉。
- 真正造成「看起来不一样」的是：四个页面都会 **auto-select 第一行**（`shownTracks[0]`，见各详情页的 `useEffect`）。专辑常从第 1 首点（已选中 → 第一次点击就播放，像「单击即播」）；歌单里常点第 N 首（未选中 → 需要点两次），于是对比之下产生「实现不同」的错觉。
- 旧逻辑集中在 [`TrackRow.activate()`](../../../../src/components/library/track-row.tsx)：
  ```
  selectable        → 切换勾选
  isSelected && !disabled → 播放（requestPlay）   ← 「再次单击已选中行就播放」
  否则              → onView()（仅选中）
  ```
- 对照：队列页 / Now Playing（[`QueuePanel`](../../../../src/components/player/queue-panel.tsx) / [queue-page](../../../../src/pages/queue-page.tsx)）**不传** `onView` / `selectedTrackId`，所以 `handleView = onPlay ?? playIndex`，`isSelected` 恒为 false → **单击直接播放**。这就是「库列表」与「队列」体感不同的根因。

### 1.2 问题严重性

| 维度 | 旧行为 | 影响 |
|------|--------|------|
| **直觉冲突** | 库详情页第一次点歌只选中、不播放 | 用户预期「点歌即播」，第一次点击「没反应」让人困惑（本报告主诉） |
| **隐式路径** | 「再次单击同一已选中行」会突然开始播放 | 非标准、不可预期：用户只想再看一眼，却触发了播放 |
| **跨表面不一致** | 库详情=两段式；队列/Now Playing=单击即播 | 同一个「点歌曲行」手势在不同页面含义不同，难以形成肌肉记忆 |
| **错觉性不一致** | 四个详情页同代码，但 auto-select 第一行让专辑「像」单击即播 | 用户误判为「实现不一样」，增加认知负担 |

### 1.3 Target Users

| Role | Description | 影响 |
|------|-------------|------|
| **普通听众** | 浏览歌单 / 全部歌曲 / 专辑 / 歌手，点歌试听 | 点击语义统一、可预期；既能「选中查看注释/歌词而不打断播放」，又有明确的「双击/播放按钮即播」 |
| **直播主播** | 现场快速点歌 | 双击播放是无歧义的「就播这首」；单击只选中不会误切歌 |

### 1.4 Core Value

1. **一致性**：库内四个详情页 + 队列/Now Playing 的曲目行点击语义形成一套清晰心智模型——**单击选中、双击播放**；删除「再次单击已选中行就播放」的意外路径。
2. **符合桌面 best practice**：对齐 Spotify / Apple Music / iTunes / foobar / Finder 的 master-detail 标准（单击选中、双击/Enter 打开）。
3. **保留 inspector 价值**：单击只选中 → 可以查看一首歌的 tag / 备注 / 歌词（右侧 [`TrackInspectorPanel`](../../../../src/components/track/track-inspector-panel.tsx)）**而不打断当前播放**——这正是 master-detail 布局存在的意义。

---

## 2. System Architecture

### 2.1 现状链路（同一套组件，四个详情页共用）

```
SetDetailView / EntityDetailView / SystemPlaylistDetail / 库「全部歌曲」
        │  都传 onView(选中) + onPlay(播放) + selectedTrackId
        ▼
TrackListSection ──▶ VirtualTrackList ──▶ TrackRow
        │  handleView = onView ?? onPlay        （库：onView≠onPlay）
        │  isSelected = id === selectedTrackId  （库：第一行 auto-select）
        ▼
TrackRow.activate():  isSelected ? play : onView   ← 两段式激活（被替换）

QueuePanel / queue-page / Now Playing
        │  不传 onView / selectedTrackId
        ▼
handleView = onPlay ?? playIndex(index)；isSelected 恒 false
        ▼
单击即播（保持不变）
```

### 2.2 目标交互模型（master-detail 标准）

| 手势 | 库详情页（有选择模型：onView ≠ onPlay） | 队列 / Now Playing（无选择模型：onView == play） |
|------|------------------------------------------|--------------------------------------------------|
| **单击 / 单点** | 选中该行 → 更新 inspector，**不播放** | 单击即播（不变） |
| **双击** | **播放**（前置的两次单击已先选中） | 播放（幂等，与单击同效） |
| **Hover 播放按钮**（封面遮罩） | 单击即播（不变，单击即播的可发现入口） | 单击即播（不变） |
| **键盘 Enter / Space / D / →** | **播放聚焦行**（W/S/↑/↓ 导航时已顺带选中） | 播放（不变） |
| **键盘导航 W/S/↑/↓** | 移动选中 + 聚焦 + 更新 inspector（不变） | 不变 |
| **多选模式（select mode）** | 单击/Enter 切换勾选（不变） | — |

> **关键不变量**：行为由「`onView` 是否等于 `onPlay`」决定，而这恰好就区分了「库详情页（有 inspector，需要选中态）」与「队列/Now Playing（所见即所播）」。无需在 `TrackRow` 内写 `if (surface===…)` 分支（与仓库 provider / visualizer / desktop-bridge 同纪律）。

### 2.3 调研：桌面播放器的 master-detail 标准

| 应用 | 单击行 | 双击 / Enter | 备注 |
|------|--------|--------------|------|
| **Spotify (desktop)** | 选中（高亮） | 双击播放 | 列表选中态与「正在播放」解耦 |
| **Apple Music / iTunes** | 选中 | 双击 / Enter 播放 | 经典 master-detail |
| **foobar2000 / MusicBee** | 选中 | 双击 / Enter 播放 | — |
| **Finder / Explorer** | 选中 | 双击 / Enter 打开 | 「选中 vs 打开」是桌面通则 |
| **YouTube Music (web)** | 单击即播（无 inspector） | — | 无选中态，不适用有 inspector 的布局 |

**结论**：MUZERO 库详情页是带右侧 inspector 的 master-detail 布局，应采用 **单击选中、双击/Enter 播放**（Spotify/Apple 同款），保留「选中查看而不打断播放」的能力；YT 式「单击即播」更适合无 inspector 的纯列表（MUZERO 的队列/Now Playing 已是该模型）。

### 2.4 Technology Stack

| Component | Technology | 角色 |
|-----------|------------|------|
| 行组件 | React `memo(TrackRow)` | 点击/双击/键盘手势裁决处（唯一改动点） |
| 虚拟列表 | TanStack Virtual（[`VirtualTrackList`](../../../../src/components/library/virtual-track-list.tsx)） | `handleView = onView ?? handlePlay`；行导航 W/S 选中 |
| 选中态 | 页面本地 `useState`（非 Zustand） | `selectedTrackId` 驱动 inspector + 行高亮 |
| 行为面包屑 | [`recordUserAction("play.click")`](../../../../src/lib/logger.ts) | 仅播放时记录（actionKind: click/keyboard），安全字段 |

### 2.5 涉及文件

```
src/components/library/
├── track-row.tsx           # 唯一行为改动：activate → selectRow / activatePlay；双击播放；键盘播放
├── track-row.test.tsx      # 单测对齐新模型（双击播放 / 单击仅选中 / Enter 播放）
├── virtual-track-list.tsx  # 不改：handleView = onView ?? handlePlay（既有回退已正确）
└── virtual-track-list.test.tsx  # 不改：其 TrackRow mock 早已 onClick=onView / onDoubleClick=onPlay
```

---

## 3. Data Model Design

**无任何数据/持久化变化。** 纯前端交互手势重写，不碰 Dexie schema、不碰 `TrackBrief`、不碰 `QueueSource`、不动 codename 层（硬规则 4）。`selectedTrackId` 仍是页面本地 ephemeral state（硬规则 6：不进 Zustand）。

- **Current Schema:** 不涉及。
- **Required Changes:** 无。
- **Data Migration:** 无。
- **Rollback Plan:** `git revert` 本 PR + 重新发版（硬规则 3：不藏 runtime flag / hidden toggle）。

---

## 4. API Design（组件内手势契约）

### 4.1 `TrackRow` 内部函数（改动）

| 函数 | 旧 | 新 |
|------|----|----|
| `activate(shiftKey, kind)` | selectable→toggle / isSelected→play / else→onView | **拆分删除**（见下两个） |
| `selectRow(shiftKey)` | — | **新**：selectable→`onToggleSelect`；否则 `onView()`（单击 / 单点） |
| `activatePlay(kind)` | — | **新**：`disabled` 时 no-op；否则 `requestPlay(kind)`（双击 / Enter / Space / D / →） |
| `handleRowClick` | `activate(shiftKey)` | `selectRow(shiftKey)` |
| `handleRowDoubleClick` | 仅 `preventDefault()` | `preventDefault()` + （非 select mode 时）`activatePlay("click")` |
| `handleRowKeyDown` | `activate(shiftKey,"keyboard")` | select mode→`onToggleSelect`；否则 `activatePlay("keyboard")` |

> `requestPlay`（面包屑 + `onPlay()`）与封面遮罩播放按钮（`onClick → requestPlay`）**保持不变**——单击即播的可发现入口仍在。

### 4.2 行为契约（伪代码）

```ts
// 单击 / 单点
function selectRow(shiftKey) {
  if (selectable) return onToggleSelect?.(shiftKey);
  onView(); // 库：选中(更新 inspector)；队列/NowPlaying：onView===play → 即播
}

// 显式播放手势：双击 / Enter / Space / D / →
function activatePlay(kind) {
  if (disabled) return;          // 未 ready 不播
  requestPlay(kind);             // 面包屑 + onPlay()
}

handleRowClick       = e => !inActions(e) && selectRow(e.shiftKey);
handleRowDoubleClick = e => { if (inActions(e)) return; e.preventDefault();
                              if (!selectable) activatePlay("click"); };
handleRowKeyDown     = e => { /* Enter/Space/D/→ */ e.preventDefault(); e.stopPropagation();
                              if (selectable) onToggleSelect?.(e.shiftKey);
                              else activatePlay("keyboard"); };
```

### 4.3 Web 双击事件次序（已验证无副作用）

真实浏览器双击次序为 `click → click → dblclick`：两次 `click` 先把行选中（`onView` 幂等），随后 `dblclick` 播放（`onPlay` 一次）。jsdom 的 `fireEvent.doubleClick` 只派发 `dblclick`，故单测里双击精确触发一次 `onPlay`、不触发 `onView`，断言干净。

### 4.4 Telemetry & Logging

- 仅在**真正播放**时记录 [`recordUserAction("play.click", { actionKind })`](../../../../src/lib/logger.ts)（单击选中不再误记播放面包屑）。字段仍为安全白名单（trackId / sessionId / uiSurface / controlId / actionKind），不打印用户内容（硬规则 8）。
- 不新增任何遥测上报（硬规则 1）。

---

## 5. Frontend Design

### 5.1 UI / Interaction 变化

- **库四详情页**（歌单 / 全部歌曲 / 专辑 / 歌手）：单击行 = 选中（高亮 + 右侧 inspector 显示其 tag/备注/封面/歌词），**不再**第一次点击就播放、也**不再**「再点已选中行就播放」；**双击行 = 播放**；hover 封面播放按钮 = 单击即播（不变）。
- **键盘**：W/S/↑/↓ 导航选中（不变）；Enter/Space/D/→ 播放当前聚焦行。
- **队列 / Now Playing**：单击即播（不变）。
- **多选模式**：单击/Enter 切换勾选（不变）；双击不触发播放。
- **无障碍**：行仍 `role="option"` + `aria-selected`；play 仍有 `aria-label`。

### 5.2 State Management

无新增状态。`selectedTrackId`（页面本地）继续驱动 inspector 与行高亮；播放仍由 `usePlayerStore` 编排。`TrackRow` 的 memo comparator 不变（仍按数据 props 比较、忽略回调身份，避免滚动每帧重渲染）。

---

## 6. Implementation Plan

### Phase 1: `TrackRow` 激活模型重写（单击选中 / 双击播放）

**Goal:** 把四个库详情页共用的 `TrackRow` 从「两段式激活」改为「单击选中、双击/Enter 播放」，删除「再次单击已选中行就播放」的隐式路径；队列/Now Playing 单击即播不变。

**Tasks:**
- [x] [`track-row.tsx`](../../../../src/components/library/track-row.tsx)：`activate` 拆为 `selectRow`（单击→选中/toggle）+ `activatePlay`（双击/键盘→播放）；`handleRowDoubleClick` 增加 `activatePlay("click")`；`handleRowKeyDown` 改为 select-mode→toggle / 否则→play；删除 `isSelected→play` 单击路径。
- [x] 重写行内注释（「Two-tap activation」→「Master-detail activation」），说明 `onView===onPlay` 的回退如何让队列保持单击即播。
- [x] [`track-row.test.tsx`](../../../../src/components/library/track-row.test.tsx)：更新/新增单测对齐新模型。
- [x] `virtual-track-list.tsx` / `.test.tsx` 无需改（其 mock 早已 `onClick=onView` / `onDoubleClick=onPlay`，即新模型）。

### Phase 1 Checklist

- [x] 单测：单击未选中行 → `onView`（选中），**不** `onPlay`。
- [x] 单测：单击**已选中**行 → 仅 `onView`，**不再** `onPlay`（旧隐式路径已删）。
- [x] 单测：**双击**任意行（含未选中）→ `onPlay` 一次。
- [x] 单测：双击当前（暂停）行 → `onPlay`（用双击恢复播放）。
- [x] 单测：Enter/Space/D/→ 聚焦行 → `onPlay`（不论选中态）。
- [x] 单测：仅 focus（无点击）→ 既不 `onView` 也不 `onPlay`。
- [x] 单测：播放面包屑只在播放手势（双击）时记录、字段安全。
- [x] 回归：`virtual-track-list.test.tsx`（click→onView / doubleClick→onPlay）仍通过（29/29 全绿）。
- [x] `pnpm typecheck` + `pnpm biome check`（改动文件）通过。

---

## 7. Out of Scope

- **不改播放上下文解析**（「从哪个歌单播放」「队列顺序对齐显示顺序」「随机播放×点歌」）——那是独立的 [20260621-muzero-playlist-playback-context-resolution-prd](../20260621-muzero-playlist-playback-context-resolution-prd/20260621-muzero-playlist-playback-context-resolution-prd.md)，与本 PRD 正交（本 PRD 只改「点击行 → 选中还是播放」的手势语义，不改「播放后装载哪个队列」）。
- **不改 auto-select 第一行**：保留各详情页 `useEffect` 的「默认选中第一首」（inspector 有内容、键盘起步清晰）。它在新模型下不再造成「第一行像单击即播、其余要两次」的错觉，因为现在**所有行单击都只选中**。
- **不引入「单击即播」开关 / hidden flag**（硬规则 3）：交互模型是产品决策，回滚走 `git revert`。
- **不动队列 / Now Playing 单击即播**：它们无 inspector，单击即播是对的。
- **不改在线（发现 tab）歌曲行**、不改 ⌘F 全局搜索单曲（如需另议）。
- **不引入移动端长按差异**：触摸 tap 复用单击=选中；多选仍走既有 long-press（[`useLongPress`](../../../../src/hooks/use-long-press.ts)）。

---

## 8. Security / Privacy Considerations

- 纯前端交互修正，无网络出站、无新增遥测、无密钥路径（硬规则 1 / 2）。
- 播放面包屑经 [`logger.ts`](../../../../src/lib/logger.ts)（`src/**` 不直连 `console.*`，硬规则 8），仅安全白名单字段。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260621-muzero-playlist-playback-context-resolution-prd](../20260621-muzero-playlist-playback-context-resolution-prd/20260621-muzero-playlist-playback-context-resolution-prd.md) | **正交**：点歌后「装载哪个队列 / 顺序 / 随机播放」的上下文模型重构（同日、同一批列表交互排查的另一根因） |
| [20260607-muzero-set-detail-page-prd](../../20260607-muzero-set-detail-page-prd/20260607-muzero-set-detail-page-prd.md) | 歌单详情页本体（`SetDetailView`） |
| [20260613-muzero-system-playlists-prd](../../20260613-muzero-system-playlists-prd/20260613-muzero-system-playlists-prd.md) | 系统歌单详情（`SystemPlaylistDetail`，共用 `TrackListSection`） |
| [20260610-muzero-artist-album-library-entities-prd](../../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | 专辑/歌手详情（`EntityDetailView`，共用 `TrackListSection`） |
| [20260617-muzero-now-playing-jump-to-source-prd](../../20260617-muzero-now-playing-jump-to-source-prd/20260617-muzero-now-playing-jump-to-source-prd.md) | inspector / 选中态相关上下文 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 库详情页用「单击即播」还是「单击选中 / 双击播放」？ | ✅ Resolved | **单击选中、双击播放**（owner 拍板）：保留 inspector「选中查看而不打断播放」的能力，对齐 Spotify/Apple 桌面标准。 |
| 2 | 是否保留「再次单击已选中行就播放」的旧路径？ | ✅ Resolved | **删除**：非标准、易误触；播放统一走双击 / 播放按钮 / Enter。 |
| 3 | 键盘 Enter 是「选中未选中行」还是「直接播放」？ | ✅ Resolved | **直接播放聚焦行**：W/S/↑/↓ 导航已顺带选中，Enter 作为「激活/打开」= 播放（Finder/iTunes 同款）。 |
| 4 | 是否需要给「单击即播」留 Setting 开关？ | ✅ Resolved | **暂不**：统一一套标准心智模型；若后续有用户诉求再以**可见 Settings 控件**提供（不藏 hidden flag）。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO Core / Library UX | 初稿 + Phase 1 落地：排查确认四详情页共用 `TrackRow`、根因为两段式激活 + auto-select-first 错觉；按 owner 决策（单击选中 / 双击播放）重写激活模型并更新单测（29/29 通过、typecheck + lint 绿）。 |

---

> **Note:** 本 PRD 强调「修正既有行为」而非新建结构——改动收敛在单个组件 [`TrackRow`](../../../../src/components/library/track-row.tsx) 的手势裁决 + 其单测；四个库详情页因共用该组件而一并对齐，无需逐页改。与同日的 [播放上下文解析 PRD](../20260621-muzero-playlist-playback-context-resolution-prd/20260621-muzero-playlist-playback-context-resolution-prd.md) 正交：那个管「播哪个队列」，本 PRD 管「点击是选中还是播放」。
