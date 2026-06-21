# PRD: ⌘F 全局搜索结果封面「只有 hover（Selected）才显示」—— 封面加载被门控在「选中」而非「可见」

**Status:** Final（已实现，采纳 Phase 2 方案 A）
**Created:** 2026-06-21
**Author:** DoodleBears / Claude
**Module:** 全局搜索 ⌘F overlay 结果行封面缩略图（`GlobalTrackSearch` 各结果行的 `loadCover` 门控）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测/复现：结果行封面恒灭、仅 hover 才出现的根因定位 | ✅ Completed（源码 + git 定位 c8d93ccc） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复：对齐 tab 2 范式（封面始终加载 + `CoverImage` thumbhash，selected 解耦） | ✅ Completed（方案 A） | [Phase 2 Checklist](#phase-2-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending | ⛔ Superseded

> **实现说明（2026-06-21，方案 A）**
> 采纳 Phase 2 方案 A，对齐 §2.5 的 tab 2 范式，改动集中在 [`global-track-search.tsx`](../../../../src/components/search/global-track-search.tsx) 一个文件：
> - **删除 `loadCover` 整套门控**：移除 `EAGER_COVER_RESULT_ROWS` 常量、五处 `loadCover = index<6 || selectedIndex===index` 表达式、各行 `loadCover` 入参/类型。封面 hook（`useTrackThumbnailUrl` / `useSetResultCoverUrl`）一律收到 `track`/`coverTrack`/`session`，`selectedIndex` 与封面加载**彻底解耦**。
> - **五个结果行改用共享 [`CoverImage`](../../../../src/components/ui/cover-image.tsx)**（替换手写 `coverUrl ? <img/> : <Disc3/>` 三元式），并补 `thumbhash` 占位：歌曲/歌词行 `track.coverThumbhash`；专辑/艺术家行 `coverTrack?.coverThumbhash`（artist 走 `rounded`）；集行按「集自身封面优先」镜像取 `session.coverThumbhash` 或 `coverTrack?.coverThumbhash`。歌词行的 Captions 角标作为 `CoverImage` 的 `children` 叠加。
> - **未解析出派生图前显示模糊 thumbhash 预览而非 disc 闪烁**；真实 `<img>` `decoding="async"` 离主线程解码、CSS 淡入；跨挂载 decode registry 命中即零闪烁——与 tab 2 完全同一套表现。
> - **在线行（`OnlineResultRow` / `PlaylistLinkCard`）不动**：它们本就直接显示 `hit.coverUrl`、且需 `referrerPolicy="no-referrer"`，是对照组。
> - **验证**：`tsc --noEmit` exit 0；Biome 干净；`vitest` search + cover-image + use-media 共 3 文件 26 例全绿。**仍需** prod bundle（用户运行中的 Electron / `make desktop-build`）手测：⌘F 结果**有封面即显**（无需 hover）、鼠标移开/方向键移动光标封面不消失、首屏滚动无解码 burst（必要时叠加方案 B 的滚动 defer）。

---

## 1. Overview

### 1.1 Background

用户在 ⌘F / Ctrl+F 全局搜索 overlay 里报告：歌曲 / 专辑 / 艺术家结果行**有封面的也不直接显示**——左侧封面位是占位 disc 图标，**只有当鼠标 hover 到该行（行进入 Selected 高亮态）时封面才加载出来**，鼠标移开后又退回 disc 图标。

预期行为：**只要该结果有封面，就应当直接显示**，不该要求用户 hover 才出现。

截图佐证（[附用户截图]）：搜索 `ss`，「歌曲」区第一首 `おばけは怖くない` 显示了专辑封面，其下的 `ほろよい` / `タイムマシンにのって` / `glitch` 全是 disc 占位；「专辑」区里**只有当前 Selected 的 `僕らしさ` 显示封面**，下面的 `Summer Skies` / `ISLAND オリジナルサウンドトラック` / `Sing My Pleasure` 全是 disc 占位。这条「分界线」恰好落在**第 6 行之后**——正是根因（见 §2）。

> 注：在线（网易云 / Bilibili / YouTube / QQ）结果行**不受影响**——它们直接 `<img src={hit.coverUrl}>`，无 `loadCover` 门控（[`global-track-search.tsx:1308`](../../../../src/components/search/global-track-search.tsx#L1308)）。本 bug 仅限**本地库**结果（集 / 歌曲 / 歌词 / 专辑 / 艺术家）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **听歌用户（桌面 Electron）** | 用 ⌘F 全局搜索本地库的歌曲 / 专辑 / 艺术家 / 集 | 纯本地 |

### 1.3 Core Value

1. **封面随结果即显**：有封面的结果行打开即显示封面，不必 hover。
2. **对齐全局封面范式**：⌘F 复用 tab 2 已验证的 [`CoverImage`](../../../../src/components/ui/cover-image.tsx) + 「滚动才 defer、selected 与封面无关」做法，去掉手写 `coverUrl ? <img/> : <Disc3/>` 三元式（顺带补上 thumbhash 占位，消除 disc 闪烁）。
3. **不回退性能**：修复不能把 c8d93ccc 想消除的「⌘F 打开瞬间一次性解码大量封面派生图」的卡顿带回来（靠 thumbhash 即时占位 + `decoding="async"` + 240ms missDelay + 跨挂载缓存达成）。

---

## 2. 现状机制（根因定位）

### 2.1 封面加载被 `loadCover` 门控，而 `loadCover` 把「Selected」当成了加载信号

每个本地结果行都收一个 `loadCover: boolean`，并据此把封面 hook 的入参在 `track` / `undefined` 间切换——`undefined` 时 hook 直接返回 `null`，即不显示封面、只画占位 disc。各行的取色 hook：

- 歌曲行 [`GlobalTrackSearchRow`](../../../../src/components/search/global-track-search.tsx#L1005)：`useTrackThumbnailUrl(loadCover ? track : undefined, …)`（[L1023](../../../../src/components/search/global-track-search.tsx#L1023)）
- 歌词行 [`GlobalLyricSearchRow`](../../../../src/components/search/global-track-search.tsx#L1081)：同上（[L1101](../../../../src/components/search/global-track-search.tsx#L1101)）
- 专辑 / 艺术家行 [`GlobalEntityRow`](../../../../src/components/search/global-track-search.tsx#L1164)：`useTrackThumbnailUrl(loadCover ? coverTrack : undefined, …)`（[L1185](../../../../src/components/search/global-track-search.tsx#L1185)）
- 集行 [`GlobalSetRow`](../../../../src/components/search/global-track-search.tsx#L859) → [`useSetResultCoverUrl(session, coverTrack, loadCover)`](../../../../src/components/search/global-track-search.tsx#L837)：`loadCover` 为 false 时整支 hook 传 `undefined`（[L843-855](../../../../src/components/search/global-track-search.tsx#L843)）

父组件计算 `loadCover` 的表达式（**五处一致**，以歌曲行为例 [L648-650](../../../../src/components/search/global-track-search.tsx#L648)）：

```ts
loadCover={trackStart + i < EAGER_COVER_RESULT_ROWS || selectedIndex === trackStart + i}
//          └─ 仅前 6 行预加载 ─┘                      └─ 否则：只有「被选中」才加载 ─┘
```

其中 `EAGER_COVER_RESULT_ROWS = 6`（[L96](../../../../src/components/search/global-track-search.tsx#L96)）。展开成自然语言：

> **一行的封面被加载，当且仅当：它的绝对导航序号 < 6（前 6 行预加载），或者它正好是当前被选中的那一行。**

### 2.2 「Selected」其实就是「hover」——所以封面跟着鼠标走

每个结果行都有 `onMouseEnter={() => setSelectedIndex(index)}`（如歌曲行 [L652](../../../../src/components/search/global-track-search.tsx#L652)）。`selectedIndex` 全列表只有**唯一一个**值，鼠标移到哪行、哪行就 Selected。键盘上下键同理移动这个唯一光标。

于是对**第 6 行之后**的行：
- 鼠标 hover 上去 → `selectedIndex === index` → `loadCover` 变 true → 封面开始解析、显示。
- 鼠标移开 → `loadCover` 变回 false → 传 `undefined` 给 hook → 返回 `null` → **封面消失，退回 disc 占位**。

即「封面跟着鼠标走」「只有 Selected 的那一行有封面」，与用户描述、截图完全吻合。前 6 行因为命中 `index < 6` 的预加载分支，始终有封面——这正是截图里「分界线在第 6 行」的来源。

> 细节：本地缩略图派生（`cvd_…`）其实有跨挂载缓存（[`use-media.ts` `coverDerivativeUrlCache`](../../../../src/hooks/use-media.ts#L273)），但 hover 离开后 `track=undefined` → `cacheKey=null` → 连 `peek` 都不走，返回 `null`。所以即使刚才解析过、缓存里仍有 URL，离开后照样灭——闪烁感更强。

### 2.3 结果数量是硬上限，且列表**未虚拟化**——所以「门控」本不必要

各 section 的结果硬上限（[L92-95](../../../../src/components/search/global-track-search.tsx#L92)）：集 ≤5、歌曲 ≤8、歌词 ≤8、专辑 ≤5、艺术家 ≤5。无 filter 默认视图**不含歌词**（歌词需 `@lyrics`），所以默认本地行 ≤ `5+8+5+5 = 23`。截图「31 条结果」= 23 本地 + 8 在线（在线封面始终显示，不计本 bug）。

且结果列表是直接 `.map` 渲染（[L621](../../../../src/components/search/global-track-search.tsx#L621) 等），**没有用 TanStack Virtual**——所有结果行一开始就全部挂载在 DOM 里。也就是说，「第 6 行之后不加载封面」**省下的只有封面派生图的解码**，行本身的渲染成本一个没省。在 ≤23 行、320px 小缩略图、且已有 240ms `missDelayMs`（[L99](../../../../src/components/search/global-track-search.tsx#L99) `SEARCH_THUMBNAIL_MISS_DELAY_MS`）去抖 + 跨挂载缓存合并的前提下，这个门控带来的体验损失（绝大多数行无封面）远大于它省下的解码成本。

### 2.4 回归提交：`c8d93ccc`（"perf: reduce import and playback jank"，2026-06-19）

`EAGER_COVER_RESULT_ROWS` / `SEARCH_THUMBNAIL_MISS_DELAY_MS` 均由该 commit 引入（`git log -S`）：

```diff
+const EAGER_COVER_RESULT_ROWS = 6;
+const SEARCH_THUMBNAIL_MISS_DELAY_MS = 240;
```

**意图**（合理）：⌘F 打开瞬间若一次性给所有结果行解析封面派生图，会在打开帧上堆叠一串解码 → 卡顿。于是「只给前 6 行预加载、其余等需要时再加载」+「240ms miss-delay」想把解码挪出打开关键帧。

**事故**：把「其余等需要时再加载」实现成了 `selectedIndex === index`——用「选中」近似「用户正在看这一行」。但**选中是单行光标，而「用户能看到的」是一整屏（~6-7 行）**。二者一旦不相等，「能看到但没被选中」的行就永远缺封面。正确的加载信号应是**该行是否在视口内（visible）**，不是它是否被选中（selected）。

> 这与同一 commit 引发的 [`20260621 now-playing-backlight-derivative-missing`](../20260621-muzero-now-playing-backlight-derivative-missing-prd/20260621-muzero-now-playing-backlight-derivative-missing-prd.md) 是**同一波性能改动下的姊妹回归**——都是「为了省成本把某个加载/生成路径关掉，但关得过头」。

> 与硬规则 3 一致：这是代码回归，回退/修复走 `git`，不是 runtime flag。

### 2.5 参照实现：tab 2（歌单详情 / 专辑 / 艺术家列表）的封面渲染才是正确范式

用户要求「参考歌曲列表怎么渲染封面」。tab 2 的虚拟列表行 [`TrackRow`](../../../../src/components/library/track-row.tsx) → [`TrackThumb`](../../../../src/components/library/track-row.tsx#L131) 的做法与 ⌘F 截然不同，而且**正确**：

1. **封面 hook 永远收到 `track`，从不传 `undefined`、从不 gate 在选中态**（[track-row.tsx:142](../../../../src/components/library/track-row.tsx#L142)）：
   ```ts
   const coverUrl = useCoverDerivativeUrlWithCropSetting(track, "thumbnail", coverCropped, {
     defer: deferCoverLoad,            // ← 唯一的「省」是 defer，且只在「滚动中」为 true
     traceSource: "row:thumbnail",
   });
   ```
2. **`defer` 的语义是「滚动中别 START 新解码，但已解析出的封面继续显示」**——不是「不显示」。驱动它的是**滚动状态**，不是选中：[virtual-track-list.tsx:203](../../../../src/components/library/virtual-track-list.tsx#L203) `deferCoverLoad = rowVirtualizer.isScrolling`。停止滚动 → defer 翻 false → 没解析的行补上封面。
3. **渲染走共享的 [`CoverImage`](../../../../src/components/ui/cover-image.tsx)，带 thumbhash 占位梯度**（[track-row.tsx:154](../../../../src/components/library/track-row.tsx#L154)）：解码好的 thumbhash 模糊预览 → 否则 `bg-secondary` 静态块 →**只有完全没有 url 时**才显示 disc/icon。真实 `<img>` 用 `decoding="async"` 离主线程解码、CSS `opacity 0→1` 淡入；跨挂载 decode registry 让重挂载的封面**零闪烁**直接出现。

> 对照差异一句话：tab 2「**封面始终加载，只在滚动瞬间暂缓新解码，且全程有 thumbhash 兜底而非 disc**」；⌘F「**封面只在选中时加载，否则一律 disc**」。⌘F 还**没用** `CoverImage`，而是手写了 `coverUrl ? <img/> : <Disc3/>` 三元式——正是 `CoverImage` 文档里点名「每个表面都该停止重复实现」的那段。把 ⌘F 对齐 tab 2 范式即可一并解决本 bug 与占位闪烁。

---

## 3. 验收信号

沿用本仓库 harness 方法学（CDP 真交互 + **prod rebuild**；dev StrictMode 双 effect 会污染时序，性能数字必须在 prod bundle 下采）：

- **有封面即显（核心）**：搜索一个能命中多条**带封面**本地结果的词，**不做任何 hover / 方向键**——断言**每一条有封面的可见结果行**都渲染 `<img>`（而非 disc 占位）。当前 bug 下仅前 6 行 + 选中行有 `<img>`。
- **hover 不再是显示条件**：鼠标移开任一行后，其封面**不应消失**。
- **键盘/鼠标导航解耦**：上下键移动选中光标时，封面不随光标「点亮 / 熄灭」（封面与 selected 态彻底无关）。
- **不卡顿回归**：在 prod bundle 下，⌘F 打开瞬间与首屏滚动时，对比 c8d93ccc 前后，`longtask max` / `frame max`（[`scripts/perf-frames.mjs`](../../../../scripts/perf-frames.mjs) / perf-control 端点）**不恶化**——即「让所有可见行显示封面」不得把当初想消除的解码 burst 带回打开关键帧（靠保留 `missDelayMs` 去抖 + 视口门控 + 跨挂载缓存达成）。
- **在线结果不受影响**（对照组）：在线行封面行为不变。

---

## 4. Implementation Plan

> 共识：无论选哪个方案，核心改动都是**从 `loadCover` 里拿掉 `selectedIndex === index` 这一项**——封面的显示绝不该 gate 在「选中」上。差异只在「拿掉之后用什么替代来仍然不一次性解码全部」。

### Phase 1: 观测/复现
**Goal:** 用证据钉死「`loadCover` 把封面加载门控在 Selected，第 6 行后仅 hover 才显示」。

**Tasks:**
- [x] 源码定位：五处 `loadCover = index < EAGER_COVER_RESULT_ROWS || selectedIndex === index`；`onMouseEnter→setSelectedIndex` 使 selected≈hover。
- [x] git 定位：`EAGER_COVER_RESULT_ROWS` / `SEARCH_THUMBNAIL_MISS_DELAY_MS` 来自 c8d93ccc（与 backlight 回归同源）。
- [x] 确认列表未虚拟化、结果有硬上限（≤23 本地行）、在线行不走门控——故门控收益小、体验损失大。

### Phase 1 Checklist
- [x] `loadCover` 表达式与 `selected≈hover` 因果链有据
- [x] 「分界线在第 6 行」与截图吻合（`EAGER_COVER_RESULT_ROWS=6`）
- [x] 在线行不受影响（直接 `hit.coverUrl`）已确认

### Phase 2: 修复（对齐 tab 2 范式：封面始终加载，selected 与封面无关）
**Goal:** 有封面的结果行直接显示封面，复用全局 `CoverImage` 范式，且不把打开瞬间的解码 burst 带回来。

**候选（推荐 A，对齐 §2.5 的 tab 2 实现；B 作为可选的「滚动 defer」加固）：**

- **(A) 推荐：去 `loadCover` 门控 + 改用 `CoverImage`（thumbhash 占位）。**
  - **拿掉 `loadCover` 整套机制**——五处 `loadCover = index < EAGER_COVER_RESULT_ROWS || selectedIndex === index` 全删，封面 hook 一律收到 `track`（与 [`TrackThumb`](../../../../src/components/library/track-row.tsx#L142) 一致），`selectedIndex` 不再参与封面加载。
  - **把五个结果行手写的 `coverUrl ? <img/> : <Disc3/>` 三元式换成 [`CoverImage`](../../../../src/components/ui/cover-image.tsx)**，传 `thumbhash`（歌曲/歌词行 `track.coverThumbhash`；专辑/艺术家行 `coverTrack?.coverThumbhash`；集行第一首/封面对应 track 的 thumbhash）。这样未解析出派生图前显示**模糊 thumbhash 预览**而非 disc 闪烁，真实 `<img>` `decoding="async"` 离线解码、CSS 淡入，跨挂载缓存命中即零闪烁。
  - 取舍：本地结果硬上限 ≤23、缩略图 320px、已有 `SEARCH_THUMBNAIL_MISS_DELAY_MS=240` 去抖 + 跨挂载缓存合并 + thumbhash 即时占位（不占解码）——打开帧解码压力远低于 c8d93ccc 当初担心的场景，需用 §3 的 `longtask`/`frame` 指标证伪「打开掉帧」。改动集中在 [`global-track-search.tsx`](../../../../src/components/search/global-track-search.tsx) 一个文件。

- **(B) 可选加固：若 (A) 实测仍有打开/滚动解码 burst，再补「滚动 defer」。**
  仿 tab 2，给 ⌘F 结果容器（[`listRef`](../../../../src/components/search/global-track-search.tsx#L616)）加一个轻量 `isScrolling` 标志（scroll + 去抖 settle），把它作为 `defer` 传给 `useTrackThumbnailUrl`（hook 已支持 `defer`，语义同 tab 2：滚动中不 START 新解码，已解析的继续显示）。**注意：defer 仍不等于 selected——它只暂缓「滚动瞬间的新解码」，停下即补全。** 仅在 (A) 的指标显示需要时才做；多数情况下 ≤23 行无需此步。

> ⚠️ 不再推荐先前草案里的 IntersectionObserver 视口门控：tab 2 证明「始终加载 + thumbhash 占位 + 滚动 defer」已足够，且复用现成 `CoverImage`/`defer`，无需为一个 ≤23 行的非虚拟化列表新引入 observer 机制。

**Tasks:**
- [x] (A) 删除五处 `loadCover` 表达式与 `EAGER_COVER_RESULT_ROWS`、`GlobalSetRow`/各行的 `loadCover` 入参；封面 hook 一律传 `track`/`coverTrack`。
- [x] (A) 五个结果行改用 `CoverImage`，补 `thumbhash`；保留 `traceSource`/`missDelayMs`。
- [x] 回归（静态）：`tsc`/Biome/`vitest`(search+cover-image+use-media 26 例) 全绿；在线行未改动。
- [ ] prod bundle 下用 `longtask`/`frame max` 对比打开 + 首屏滚动；若有 burst → 上 (B) 滚动 defer。（待用户在运行中的 Electron 手测）

### Phase 2 Checklist
- [x] 五处 `loadCover` + `EAGER_COVER_RESULT_ROWS` 移除，`selectedIndex` 与封面加载解耦
- [x] 结果行复用 `CoverImage` + thumbhash（与 tab 2 同范式，无 disc 闪烁）
- [ ] 有封面的结果行**打开即显**（无需 hover）；鼠标移开 / 方向键移动光标封面不消失（待手测确认）
- [x] 在线结果封面行为不变（对照组，未改动）
- [ ] ⌘F 打开 + 首屏滚动 `longtask max` / `frame max` 不劣于 c8d93ccc 前（必要时叠加 (B)，待手测）

---

## 5. Out of Scope

- 在线（网易云 / Bilibili / YouTube / QQ）结果行封面——本就直接显示、不走 `loadCover`，是对照组。
- 全局搜索的**搜索性能 / 索引**（worker 搜索、@filter、转写）——见 [`20260615 global-search-index-performance`](../../20260615-muzero-global-search-index-performance-prd/20260615-muzero-global-search-index-performance-prd.md)，本 PRD 只动封面加载门控。
- 封面派生图生成管线本身（`cvd_…` 生成 / 缓存 / 缩略图质量）——不改。
- 移动端触摸专属调优（移动无 hover，本 bug 在触屏上表现为「除前 6 行 + 点过的行外都无封面」，同根因，B 方案的视口门控天然覆盖）。
- hidden flag（硬规则 3：回退 = `git revert`）。

---

## 6. Related Documents

| Document | Description |
|----------|-------------|
| [20260621 now-playing-backlight-derivative-missing PRD](../20260621-muzero-now-playing-backlight-derivative-missing-prd/20260621-muzero-now-playing-backlight-derivative-missing-prd.md) | **同一 commit c8d93ccc** 引发的姊妹回归（静置背光派生图不生成）；同属「性能改动关得过头」 |
| [20260615 global-search-index-performance PRD](../../20260615-muzero-global-search-index-performance-prd/20260615-muzero-global-search-index-performance-prd.md) | ⌘F 全局搜索的索引/worker 搜索性能背景（本 PRD 不动搜索路径，只动封面门控） |

---

## 7. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 直接对齐 tab 2 范式（A：始终加载 + `CoverImage`）还是另搞门控？ | Open | 建议 A：复用 `CoverImage`/`defer`，与全局一致，改动集中在一个文件；(B) 滚动 defer 仅在实测有 burst 时叠加 |
| 2 | ≤23 行是否真有打开解码 burst、需要 (B)？ | Open | 先按 A 实现并用 prod `longtask`/`frame max` 实测；thumbhash 占位不占解码，多半无需 (B) |
| 3 | c8d93ccc 把「需要时加载」写成 `selectedIndex===index` 是有意还是想当然？ | Open | 从「选中是单行光标、视口是一整屏」看高度疑似把 selected 误当成 visible；且没沿用既有 `CoverImage`/`defer` 范式；需作者确认 |

---

## 8. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | DoodleBears / Claude | 初稿：定位 ⌘F 结果行封面被 `loadCover = index<6 \|\| selectedIndex===index` 门控，且 `selected≈hover`，致第 6 行后仅 hover 才显示封面；回归源自 c8d93ccc（与 backlight 回归同源）。给出 A（全量预加载）/ B（IntersectionObserver 视口门控）两档修复 |
| 2026-06-21 | DoodleBears / Claude | 按用户要求参照 tab 2 歌曲列表封面渲染：新增 §2.5 记录 tab 2 范式（`TrackThumb` 始终传 track、`defer` 仅滚动态、`CoverImage` thumbhash 占位、跨挂载 decode registry）。修订 Phase 2 推荐改为 (A) 对齐该范式（删 `loadCover`/`EAGER_COVER_RESULT_ROWS` + 改用 `CoverImage` + thumbhash），(B) 滚动 defer 仅按需叠加；弃用 IntersectionObserver 草案 |
| 2026-06-21 | DoodleBears / Claude | 实现方案 A：`global-track-search.tsx` 删除 `loadCover` 门控 + `EAGER_COVER_RESULT_ROWS`，五个结果行改用 `CoverImage` + thumbhash，selected 与封面解耦；在线行不动。tsc/Biome/vitest(26) 全绿。Status → Final，待 prod 手测打开掉帧 |
</content>
</invoke>
