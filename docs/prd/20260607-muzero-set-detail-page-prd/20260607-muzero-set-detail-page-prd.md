# PRD: MUZERO — 歌单详情页 + 封面/描述 + 创建/上传/粘贴目标

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 歌单（DjSession）—— 二级详情页、歌单级封面/描述、新增 prepend 到顶部、创建歌单、上传/粘贴/拖拽目标选择

> 承接 [Gallery PRD](../20260607-muzero-dock-nav-gallery-redesign-prd/20260607-muzero-dock-nav-gallery-redesign-prd.md)（一级歌单画廊）与[数据模型 PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md)（歌单/播放列表/记忆）。本 PRD 加二级**歌单详情页**与歌单级元信息。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 数据模型：`DjSession.description`/`coverBlobId` + **新增 prepend 到顶部** + 歌单封面 repo + high-water id-diff | ✅ Completed | §5 |
| 2 | 歌单详情页（曲目列表 + 名称/描述编辑 + 封面拖拽/粘贴 + 「播放全部」）+ gallery 卡片改「点进详情 / 小播放键」+ 路由 | 🔄 部分（两级导航+曲目列表✅；名称/描述/封面编辑待 Phase 1） | §5 |
| 3 | 创建新歌单 + 上传到歌单 + 粘贴/拖拽**目标歌单选择**（gallery 无上下文时弹选择器；详情页直接进该歌单） | 🔲 Pending | §5 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. 需求 + 决策（用户已定）

1. **点击歌单 → 二级详情页**（看曲目）。**gallery 卡片点击=进详情；卡片 hover 出小播放键**直接播放（不进详情）。
2. **歌单有元信息**：名字（已有 `name`）、**描述（新 `description`）**、**封面（新 `coverBlobId`）**。封面**拖拽/粘贴图片即应用**（复用 track cover 那套）。**没设封面 → 默认用最上面一首歌的封面**（`trackIds[0]`）。
3. **新增歌曲到歌单 = prepend 到顶部**（最新在最上面 → 作默认封面）。**决策：所有新增都 prepend**（含 DJ 续歌）。⚠️ 见 §2.3 与播放列表(DM-1/DM-2)的交互风险。
4. **创建新歌单** + 上传不同歌曲到歌单。
5. **粘贴/拖拽**：在**详情页** → 直接进该歌单；在 **gallery / 无歌单上下文** → 弹出**选择目标歌单**（选哪个歌单放入）。

---

## 2. 数据模型（Phase 1）

### 2.1 `DjSession` 追加（[`types.ts`](../../../src/db/types.ts)）
```ts
description?: string;   // 歌单描述（自由文本）
coverBlobId?: string;   // 歌单级封面，FK → mediaBlobs；缺省时 UI 取 trackIds[0] 的封面
```
- 无需 bump version（settings/session 行内可选字段追加；但若给 mediaBlobs 加歌单封面行需确认 role，见 2.2）。实际以「改 stores 才 bump」为准——本期只追加 `sessions` 行字段，**无需 upgrade**。

### 2.2 歌单封面存储
- 复用 `mediaBlobs`：`{ id, trackId: <setId>, role: "cover", ... }`（`trackId` 复用为 setId，仿 gallery 的 `GLOBAL_GALLERY_ID` sentinel 思路）。
- `DjSession.coverBlobId` 指向该 mediaBlob。
- repo：`setSessionCover(setId, blob, mime)`（建 mediaBlob + 写 `coverBlobId`）/ `getSessionCover(setId)`（读 blob）。复用现有 cover 处理（crop 等可后续）。

### 2.3 新增 prepend 到顶部（⚠️ 关键，含风险）
- `appendTrackIds(sessionId, ids)` 改为 **prepend**（或新增 `addTrackIdsTop`），新曲进 `trackIds` 开头。
- 用户决策「**所有新增都 prepend**」→ 用户上传 + DJ 续歌都 prepend 到歌单。
- **⚠️ 与播放列表(DM-1/DM-2)的交互**：歌单(`trackIds`) 是策展集合，播放列表(`playQueue`) 是播放顺序，已拆分。
  - 歌单 prepend（最新在上、作封面）——✅ 满足需求。
  - 但 DM-1c 的 high-water「把歌单新增曲追加进播放列表」是按**计数**追加到队尾——若歌单改 prepend，high-water 的「新增检测」需复核（不能再假设新曲在 `trackIds` 末尾）。**Phase 1 必须同步修 high-water 逻辑**（按 id 集合 diff 而非位置/计数），否则续歌入队会错乱。
  - 「播放歌单」`playSet` 把 `trackIds` 灌进队列——prepend 后顺序是最新在前，播放即最新先播（用户已接受）。
- **测试（TDD，硬规则 #7）**：prepend 顺序、封面取 `trackIds[0]`、high-water 按 id diff 不重复入队、DJ 续歌 prepend 后队列仍正确。

---

## 3. 歌单详情页（Phase 2）

- 新页面 `src/pages/set-detail-page.tsx`（或 `set-page`）：顶部歌单头（封面大图 + 名称[行内编辑] + 描述[行内编辑] + 曲数 + 「播放全部」`playSet`）+ 曲目列表（`VirtualTrackList`，点曲播放该位置）。
- **封面**：歌单头封面区接受**拖拽/粘贴图片** → `setSessionCover`；无封面显示 `trackIds[0]` 的封面（`useTrackCoverUrl`）或占位。
- **路由**：App.tsx 加详情态——`nav-store` 加 `openSetId?: string`（或一个 `route` 概念）；gallery 卡片点击 → 设 `openSetId` + 进详情；详情页返回清空。详情是 gallery(search tab) 的子视图，不占新 nav。
- **gallery 卡片改造**（[`search-page.tsx`](../../../src/pages/search-page.tsx)）：卡片点击 = 进详情（设 openSetId）；卡片 hover 出**小播放键**（`playSet` 直接播放，`stopPropagation` 不进详情）。

---

## 4. 创建 / 上传 / 粘贴目标（Phase 3）

- **创建新歌单**：gallery 顶部「+ 新建歌单」→ `createSession`（空 seed、`autoExtend:false`）→ 进详情页。
- **上传到歌单**：详情页「+ 添加歌曲」→ 文件选择 → `addUploads`（prepend）。
- **粘贴/拖拽目标**：
  - 在**详情页**：粘贴/拖拽媒体 → 直接进该歌单（prepend）。
  - 在 **gallery / 其它无上下文**：粘贴/拖拽媒体 → 弹**目标歌单选择器**（列现有歌单 + 「新建歌单」选项）→ 选定后 ingest。复用 [`GlobalDropZone`](../../../src/components/upload/global-drop-zone.tsx) + `ingestDroppedMedia`，但加「选目标」分支（当前无 active set 时建新集；改为弹选择器）。

---

## 5. Implementation Plan

### Phase 1: 数据模型（TDD，**含 high-water 同步修复**）✅
- [x] `DjSession.description?`/`coverBlobId?`；`appendTrackIds`→**`prependTrackIds`**（prepend，2 调用点 uploads+DJ 全更新）；`setSessionCover`/`getSessionCover` repo（封面进 mediaBlobs role"cover" key=setId）。
- [x] **同步修 high-water**：`consumedSetCount`(计数)→`consumedTrackIds`(Set) + 纯函数 **`unconsumedTrackIds`**（按 id diff，prepend-safe）；player-store `setSub` 改用它。
- [x] 测试：`unconsumedTrackIds` 4 例（prepend/append/批量/全消费）；repo `prependTrackIds`(顺序=新在前)、`setSessionCover`(row role/key/mime)。**全套件 191 绿、typecheck/biome 清、浏览器无报错**。（fake-indexeddb 不保 Blob 字节 → 封面测试断 row 字段而非 blob 内容）

### Phase 2: 歌单详情页 + 路由 + 卡片改造
- [x] **两级结构（在 gallery 内，决策 Q4=`selectedSetId` 局部态，无路由库）**：点歌单卡 → 就地渲染该歌单**虚拟化曲目列表**（`VirtualTrackList`）+ 返回键 + 「播放全部」(`playSet`)；卡片改 div+overlay（点卡=进详情、hover 小播放键 `stopPropagation` 直接播）。浏览器实测：进详情/曲目列表/返回/小播放键 全 OK，零报错。
- [ ] **待 Phase 1 数据模型**：歌单头名称/描述行内编辑、封面拖拽/粘贴（需 `description`/`coverBlobId` 字段 + `setSessionCover`）。

### Phase 3: 创建 + 上传 + 粘贴目标选择
- [ ] gallery「新建歌单」；详情页「添加歌曲」；`GlobalDropZone` 无上下文时弹目标歌单选择器（含新建）；详情页直接进该集。
- [ ] i18n 4 语；浏览器实测全流程。

---

## 6. Out of Scope / Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 新增 prepend 范围 | Resolved | **所有新增都 prepend**（含 DJ）；Phase 1 必须同步修 high-water 按 id diff |
| 2 | gallery 卡片点击行为 | Resolved | 点卡=进详情；卡 hover 小播放键直接播 |
| 3 | 歌单封面是否支持 crop（像 track cover）？ | Open | v1 先直接设封面，crop 后续 |
| 4 | 详情页路由用 `openSetId` 还是真路由库？ | Open | 倾向 `nav-store.openSetId`（轻量，无路由库）；Phase 2 定 |
| 5 | 「播放歌单」顺序：prepend 后最新先播 vs 加载时反转为时间正序？ | Open | v1 直接用 trackIds 顺序（最新先）；如要正序播放再加选项 |

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 歌单二级详情页（名称/描述/封面拖拽粘贴 + 曲列表 + 播放全部）、`DjSession` 加 description/coverBlobId、**新增曲 prepend 到顶部（含 DJ，需同步修 high-water）**、默认封面取最上面一首、创建歌单、上传/粘贴/拖拽目标歌单选择。3 phase，Phase 1 数据模型先行 |
