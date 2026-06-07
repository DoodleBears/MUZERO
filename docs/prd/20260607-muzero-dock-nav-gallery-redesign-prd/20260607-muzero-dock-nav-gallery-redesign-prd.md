# PRD: MUZERO — Dock / 导航重做 + 歌单 Gallery + 可拖拽 AI FAB

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 外壳导航 —— 极简化导航、把「搜索」改成歌单 Gallery、AI 改悬浮可拖拽 FAB、nav 合并为可折叠 FAB

> ⚠️ **并行协调**：`App.tsx` / `shell/player-dock.tsx` / `nav/nav-row.tsx` / `pages/{now-playing,queue,sessions,settings}` 当前正被并行编辑（`feat/player-dock-redesign`）。本 PRD 把目标定清，但**实现按文件冲突风险排序**：先做落在干净文件的「歌单 Gallery」（`search-page.tsx` 干净 + 新建纯逻辑），nav/FAB 这些动到并行文件的部分后做、避免覆盖。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 歌单 Gallery 纯逻辑（filter / sort，纯函数 TDD） | ✅ Completed | §6 |
| 2 | 歌单 Gallery 页面（search-page 改造：搜索框 + filter/sort chips + list/album-grid） | ✅ Completed | §6 |
| 3 | 导航极简化（first=播放页；移除 AI tab；合并为可折叠 nav FAB 置于播放信息右侧） | ✅ Completed | §6 |
| 4 | 可拖拽 AI FAB（悬浮、自由拖拽，承接 chat PRD 的 `fab` 形态） | 🔲 Pending | §6 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前导航是 player-dock 第三行的扁平 4-tab（queue / search / sessions / settings），Now Playing 靠点播放区进入。用户要把它**重做得更极简、更贴 MUZERO 的「音乐 + 回忆」定位**，并给 AI DJ 助手一个**自由悬浮**的入口（呼应 [chat PRD](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) 的 FAB 形态）。

### 1.2 五点需求（用户原话拆解）

1. **第一个 nav = 播放页**：直接进 playback / Now Playing 页。
2. **第二个 = 歌单 Gallery**（重做「搜索」）：放不同的**歌单**，支持 **list 模式** 或 **album-grid 模式**（每个歌单用其**第一首歌的封面**当 album cover）；顶部有**搜索框** + 几个 **filter / sort**（最近听过、最近红心、红心歌曲等常见过滤/排序）。
3. **第三个（AI）取消**：既然用 minimize FAB 设计，AI 不占 nav，而是**一个悬浮、可自由拖拽的 FAB**。
4. **设置保留**。
5. **按钮很少 → 合并**：把这几个 nav 按钮合并成**一个可 collapse / expand 的小圆 FAB**，直接放在**原第一、二行播放信息的右侧**。

### 1.3 Core Value

- **极简导航**：少即是多——播放信息常驻 + 一个可展开的 nav FAB，不占满屏。
- **歌单作为画廊**：像 album 一样浏览/检索歌单（封面墙 + 搜索 + 过滤排序），强化「歌单承载回忆」。
- **AI 触手可及但不打扰**：悬浮可拖拽 FAB，随处召唤 DJ 助手。

---

## 2. 导航模型（新）

```
┌───────────────────────────── player-dock（常驻底部）─────────────────────────┐
│  ① TrackIdentityRow（封面 + 标题/副标题 + 播放键）        ┌───────────┐        │
│  ② PlayerStatusLine + ProgressScrubber                  │ nav FAB ⊕ │ ←合并   │
│                                                          └───────────┘        │
└───────────────────────────────────────────────────────────────────────────────┘
        nav FAB 展开 → [ 播放页 · 队列 · 歌单 Gallery · 设置 ]
   ┌─────────┐
   │ AI FAB  │  ← 独立悬浮、可拖拽（chat 助手入口）
   └─────────┘
```

- **nav 项收敛为**：播放页(now) · 队列(queue) · 歌单 Gallery(gallery，原 search) · 设置(settings)。（AI 移除）
- **合并为 collapse/expand FAB**：默认是播放信息右侧一个小圆按钮（`⊕`/`Menu`）；点击 expand 出 nav 项（横向小排或弧形/纵向 popover，用 `motion`）；选中后 collapse。移动端同样是小 FAB（舒适 tap）。
- **AI FAB**：独立组件，`position:fixed` 悬浮、可拖拽（记住位置到 localStorage），点击开 chat（minimize/bar/dock 形态见 chat PRD §5）。
- **Tab 类型**：复用现有 `Tab`，把 `search` 语义改为 gallery（id 保持 `search` 以免大改路由？或新增 `gallery`）。**决策见 Open Q1**。

---

## 3. 歌单 Gallery（§需求点 2）

替换 `search-page.tsx`（当前是 track 搜索）为**歌单画廊**。

### 3.1 布局
- 顶部：**搜索框**（按歌单名 / seed 过滤）+ **filter/sort chips**。
- **view 切换**：`list`（每行一个歌单：封面缩略 + 名 + 曲数 + 最近时间）/ `grid`（album 墙：每个歌单一张大封面 = 第一首歌封面，名 overlay）。view 偏好持久化（localStorage）。
- 空态：引导建歌单 / 上传。

### 3.2 Filter / Sort（常见集，用户点名）
| chip | 行为 |
|---|---|
| 最近 | sort by `updatedAt` desc（默认）|
| 最近听过 | sort by 最近播放时间（派生：歌单内 track 最大 `generatedAt`/播放时间；v1 用 `updatedAt` 近似，Open Q2）|
| 红心歌单 | filter：含红心曲（`likedCount>0`）|
| 红心歌曲 | 特殊：虚拟「Liked Songs」集合（跨歌单所有 `liked` track）—— 作为画廊里一个**置顶虚拟歌单**或单独视图（Open Q3）|
| 名称 | sort by name asc |
| 曲数 | sort by trackCount desc |

### 3.3 纯逻辑（`src/lib/set-gallery.ts`，Phase 1，TDD）
```ts
export interface SetGalleryItem {
  session: DjSession;
  trackCount: number;
  likedCount: number;
  lastActivityAt: number;     // 排序用（updatedAt 或派生最近播放）
  coverTrackId?: string;      // 第一首歌 id → album cover
}
export type SetSort = "recent" | "name" | "size";
export type SetFilter = "all" | "liked";
export function filterSets(items: SetGalleryItem[], query: string, filter: SetFilter): SetGalleryItem[];
export function sortSets(items: SetGalleryItem[], sort: SetSort): SetGalleryItem[];
```
- `filterSets`：query 大小写不敏感子串匹配 `session.name` + `seedPrompt`；`filter==="liked"` 留 `likedCount>0`。
- `sortSets`：recent=`lastActivityAt` desc、name=本地化 `localeCompare`、size=`trackCount` desc。
- 页面用 `useLiveQuery(sessions)` + `useLiveQuery(tracks)` 组装 `SetGalleryItem[]`（trackCount/likedCount/coverTrackId 由 track 派生），再过纯函数。封面用现有 `getTrackCover` / `useTrackCoverUrl`。

---

## 4. 可拖拽 AI FAB（§需求点 3）

- 新组件 `src/components/chat/chat-launcher-fab.tsx`（也是 chat PRD Phase 2 的 FAB 形态）：`position:fixed`、可拖拽（`motion` drag 或 pointer 事件），位置持久化 localStorage（`muzero-ai-fab-pos`），边界 clamp 进视口。
- 点击 → 打开 chat（chat-store mode `fab→bar/dock`）；streaming/未读角标。
- 与 dock 的 nav FAB 区分（AI 是独立悬浮、随处可达）。

---

## 5. 导航极简化（§需求点 1/4/5）

- **first nav = 播放页**：`now` 进 Now Playing（当前靠点播放区，新增显式入口）。
- **AI tab 移除**；**Settings 保留**。
- **NavRow → collapse/expand nav FAB**：`nav-row.tsx` 重做为一个小圆 FAB（collapsed）+ expand 出 4 项（`motion`）。置于 player-dock 第一/二行右侧（`player-dock.tsx` 布局调整）。
- ⚠️ 这些动 `App.tsx`/`player-dock.tsx`/`nav-row.tsx`（并行编辑中）→ 实现前先 `git status` 看最新、与并行改动协调。

---

## 6. Implementation Plan

> **冲突风险排序**：先做落在干净文件的（Gallery 纯逻辑 + 页面），再做碰并行文件的（nav/FAB）。每 phase TDD + 原子 commit + 浏览器验证 + 更新本 PRD。

### Phase 1: 歌单 Gallery 纯逻辑 ✅
- [x] `src/lib/set-gallery.ts`（`SetGalleryItem`/`SetSort`/`SetFilter`/`filterSets`/`sortSets`）+ 9 单测（query 子串名+seed、liked 过滤、query×filter 组合、recent/name/size 三种 sort、不可变）。
- 验收：纯函数全绿、typecheck/biome 清；新文件零并行冲突。

### Phase 2: 歌单 Gallery 页面 ✅
- [x] `search-page.tsx` 改造为画廊：`useLiveQuery(sessions+tracks)` 组装 `SetGalleryItem`（trackCount/likedCount/首封面）→ 搜索框 + filter(全部/红心) + sort(最近/名称/曲数) chips + list/grid view 切换(localStorage 持久)；封面 `useTrackCoverUrl` 取首张有封面的曲；点击歌单 → `setActiveSession`+`play`。`gallery` i18n 4 语 ×11 key。
- [x] 验收：浏览器 preview 实测——搜索框/过滤/排序/列表+封面网格 全渲染、album 卡（封面+♡红心标+「N 首」）、零 console 报错。`SetCard` 用独立组件调 `useTrackCoverUrl`（每张封面独立、不互相重渲染）。

### Phase 3: 导航极简化 ✅
- [x] 新 `nav-fab.tsx`（collapse/expand FAB）取代 `nav-row.tsx`（已删）：**3 项 = 播放(now,⌘1) / 歌单(search,⌘2) / 设置(settings,⌘3)**（用户定的最简 3 项）；折叠态显当前页图标、展开 motion 弹出 3 个 pill（icon+label），当前项高亮、click-away 收起；`SHORTCUT_TABS` 同步为 `[now,search,settings]`。
- [x] `player-dock.tsx`：播放信息（identity+status+progress）左列 flex-1，NavFab 钉右侧（去掉第三行 nav）。`nav.menu` i18n ×4。
- [x] 验收：浏览器实测——FAB 折叠/展开、3 pill（正在播放/歌单/设置）、当前高亮、⌘1/2/3 跳转、零报错；nav 7 tests + typecheck + biome 绿。AI 不在 nav（→ Phase 4 拖拽 FAB）。

### Phase 4: 可拖拽 AI FAB
- [ ] `chat-launcher-fab.tsx`：悬浮可拖拽 + 位置持久化 + 点击开 chat。
- 验收：拖拽流畅、边界 clamp、刷新记住位置；preview 验证。

---

## 7. Out of Scope

- chat 助手本体（多 session/流式/工具）= [chat PRD](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md)；本 PRD 只给入口 FAB。
- 歌单的增删改 = [数据模型 PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) DM-4；Gallery 先只读浏览 + 播放/打开。
- 切 tab 播放不中断的根因修复（media-engine overlay）= 单独跟进（已诊断，见会话记录），与本重做协调。

## 8. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | gallery 用现有 `search` tab id 还是新增 `gallery`？ | Open | 倾向沿用 `search` id（少改路由），仅改语义+页面；i18n 文案换「歌单」|
| 2 | 「最近听过」精确口径？ | Open | v1 用 `session.updatedAt` 近似；精确「最近播放时间」需新增 per-set lastPlayedAt（后续）|
| 3 | 「红心歌曲」= 置顶虚拟歌单 vs 单独视图？ | Open | 倾向画廊里一个置顶「Liked Songs」虚拟项，点开看所有红心曲 |
| 4 | nav FAB 展开形态（横排/弧形/纵向 popover）？ | Open | Phase 3 实测体验定；优先简单横排小圆 |

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Chat agent PRD](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | AI FAB 是其 `fab` 形态入口；三形态在那定义 |
| [数据模型 PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | 歌单=`DjSession`；Gallery 浏览的对象；DM-4 给增删改 |
| 受影响代码 | [`App.tsx`](../../../src/App.tsx) · [`nav-row.tsx`](../../../src/components/nav/nav-row.tsx) · [`player-dock.tsx`](../../../src/components/shell/player-dock.tsx) · [`search-page.tsx`](../../../src/pages/search-page.tsx) |

## 10. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 用户定的 dock 重做 5 点：first=播放页、search→歌单 Gallery(搜索+filter/sort+list/album-grid)、AI→可拖拽悬浮 FAB、设置保留、nav 合并为播放信息右侧的 collapse/expand 小 FAB。按文件冲突风险排 phase（先 Gallery 纯逻辑+页面，后碰并行文件的 nav/FAB）|
