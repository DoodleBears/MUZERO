# PRD: MUZERO 封面质量与滚动体验(导入去重 + 滚动不闪 thumbhash + 网格高清)

**Status:** Draft
**Created:** 2026-06-14
**Author:** Claude
**Module:** Library(Tab 2)封面渲染 + 导入派生管线 - 三个用户实测问题

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 滚动不再把已加载封面降级成 thumbhash(#C,UX 最痛) | ✅ 代码完成(待实测) | [Phase 1](#phase-1-滚动不闪-thumbhash) |
| 2 | 导入封面解码去重(palette+thumbhash 合并一次)(#1) | ✅ 代码完成(待导入实测) | [Phase 2](#phase-2-导入解码去重) |
| 3 | 专辑/歌手网格用更高清封面(#A) | 🔲 Pending | [Phase 3](#phase-3-网格高清封面) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

三个 QA 实测问题(均为封面相关):

- **#C(最痛):全部歌曲列表滚动时,已经加载好的封面被瞬间降级成模糊的 thumbhash,停下才恢复。** 体验很差。
- **#1:导入时每张封面被 worker 解码两次**(`["thumbhash"]` 和 `["palette"]` 分别一次,各解码整图)——本可一次 `["palette","thumbhash"]` 出两样。worker 侧、一次性,但白花一倍解码。
- **#A:专辑/歌手网格封面偏糊**——网格卡片用的是 160px 缩略派生,桌面 4 列网格在 2x DPI 下渲染宽 ~180px > 160px → 糊。
- **#B:虚拟列表滚动卡顿**——虚拟化本身必要(大库);卡顿来自滚动时大量行进视口触发 worker 派生 + ResizeObserver 频繁重测。**#C 修好后churn 大降**。

### 1.1 Core Value

1. **滚动丝滑不闪**:已加载封面在滚动中保持,不再降级 thumbhash(#C)。
2. **导入更快**:每张封面只解码一次(#1)。
3. **网格更清晰**:网格卡片用足够分辨率的派生(#A)。

---

## 2. 根因(均带 file:line)

### #C 滚动闪 thumbhash(主因)
- [`virtual-track-list.tsx:138`](../../../src/components/library/virtual-track-list.tsx#L138):`deferRowCoverLoad = rowVirtualizer.isScrolling`。
- [`track-row.tsx:117`](../../../src/components/library/track-row.tsx#L117):`useCoverDerivativeUrl(deferRowCoverLoad ? undefined : track, "thumbnail")` —— 滚动时传 `undefined`。
- [`use-media.ts:132`](../../../src/hooks/use-media.ts#L132):track 为空 → 返回 `null`。
- [`cover-image.tsx:120`](../../../src/components/ui/cover-image.tsx#L120):`{preview && (!url || !loaded) && <img src={preview}/>}` + [`:129`](../../../src/components/ui/cover-image.tsx#L129) `{url && <img .../>}`。
- **结果**:滚动一开始 `url` 变 null → 真封面从 DOM 移除、thumbhash 盖上 → **已加载的封面被主动降级**。defer 的本意是「滚动时不要启动新解码」,却误伤了「已经加载好的」。

### #1 导入双重解码
- [`repositories.ts:79-93`](../../../src/db/repositories.ts#L79) `deriveCoverThumbhash`(targets `["thumbhash"]`)与 [`:95-110`](../../../src/db/repositories.ts#L95) `deriveCoverPalette`(`["palette"]`)分别调 worker;in-flight 去重 key 含 targets,故**两者不互相去重、各解码一次**。`deriveCoverMetadata`(`["palette","thumbhash"]`)本可一次出两样。导入路径分开调了它们。

### #A 网格糊
- 网格卡 [`entity-grid.tsx:94`](../../../src/components/library/entity-grid.tsx#L94) `useTrackThumbnailUrl` → 160px 缩略派生([`cover-derivative-core.ts:9`](../../../src/workers/cover-derivative-core.ts#L9) `THUMBNAIL_MAX_EDGE=160`)。桌面网格卡渲染宽 ~90px@1x → 180px@2x > 160px → 放大糊。无更大尺寸派生。

---

## 3. Implementation Plan

### Phase 1: 滚动不闪 thumbhash

**Goal:** 滚动中**保留已解码封面**,只对「尚未解码」的封面用 thumbhash;defer 只阻止「启动新解码」,不丢弃已有。

**方案(择一,实现时定):**
- (a) **缓存命中即返回**:`useCoverDerivativeUrl(track, kind, { defer })` —— defer=true 时,若派生 URL 已在缓存(同步可取)→ 仍返回它;仅缓存未命中才不启动 worker、返回 null。这样已加载封面(缓存命中)滚动中照常显示,只有没缓存的走 thumbhash。**首选**——精准,不误伤。
- (b) track-row 记住「本行当前 track 的最后已解析 URL」,defer 时沿用(注意虚拟行复用:必须按 `track.id` 绑定,track 变了立刻失效,避免串图)。

**实现(落地版,比原方案更稳):** 不依赖「缓存同步 peek」,而是**让 hook 保留 state 里已解析的 entry**:`useCoverDerivativeUrl(track, kind, { defer })`,defer=true 时 `setEntry(prev => keepDeferredCover(prev, coverKey))` 并**直接 return 不启动 worker**;`entry` 带 `forKey`(= coverBlobId+crop+remote),只有「本行 track 没变」才保留,虚拟行复用换 track 时 `forKey` 不匹配 → 转 placeholder,绝不串图。

**Tasks:**
- [x] 纯助手 [`keepDeferredCover(resolved, coverKey)`](../../../src/lib/cover-defer.ts)(3 例单测):同 cover 保留、换 cover 丢弃、未解析 null。
- [x] [`useCoverDerivativeUrl`](../../../src/hooks/use-media.ts) 加 `options.defer`;defer 时保留匹配 entry、不启动 worker;entry 加 `forKey`。默认 `defer=false`,其他调用方不变。
- [x] [`track-row.tsx`](../../../src/components/library/track-row.tsx):`useCoverDerivativeUrl(track, "thumbnail", { defer: deferCoverLoad })`(不再传 `undefined`)。

**QA 跟进(滚动停下的二次闪):** 实测滚动中已不闪,但**停下瞬间会闪一下 thumbhash 再回来**。根因:`defer` 翻回 false 时,effect 对**已解析的封面也重跑 `ensure()`** → 换了新 object URL → `CoverImage` 的 `loaded` 复位 → 闪一帧。修法:effect 顶部加守卫——**`entryRef.current.forKey === coverKey` 即已解析过该封面 → 直接 return,不重解析、不换 URL**(用 ref 读最新 entry,避免把 entry 设成依赖导致每次变更都重跑)。已解析的封面停下时不再重解码 → 不闪。

**Checklist:**
- [x] `keepDeferredCover` 单测(3 例)+ use-media/library 单测(71)全绿;`tsc`/Biome 通过;`src` 全量 2383 例通过(player-store debounce 计时测试满载下偶发 flaky,re-run 全绿)。
- [ ] **待实测**:全部歌曲滚动中 + **停下** 都不再闪 thumbhash;仅真没解析过的封面短暂 thumbhash。

### Phase 2: 导入解码去重

**Goal:** 导入每张封面只解码一次,出齐 palette+thumbhash。

**Tasks:**
- [ ] 定位导入路径(folder import → `createUploadedTrack`/ingest)里**分开调** `deriveCoverThumbhash` + 后续 palette 的地方,合并为单次 `deriveCoverMetadata`(`["palette","thumbhash"]`),把 thumbhash 与 palette 一起拿。
- [ ] 确认 display 侧(`visualizer-dynamic-color`)能命中导入时已存的 palette 派生(避免再解码)。
- [ ] (可选)`extractCoverMetadataViaWorker` 的 in-flight key 对「子集 targets」也能复用(`["thumbhash"]` 命中正在跑的 `["palette","thumbhash"]`),进一步省。

**实现(落地):** 所有导入(upload / NCM / 文件夹)都汇聚到 `createUploadedTrack`。把它从「`deriveCoverThumbhash`(解码1)+ 近似 palette + 后台 `deriveCoverPalette`(解码2)flush」改为**一次 `deriveCoverMetadata`(`["palette","thumbhash"]`,一次解码出两样)**,直接写精确 palette(worker 无果时回退 thumbhash 近似)。**删掉整套延迟 flush 机制**(`queue/flush/schedule/runQueued` + `scheduleIdleTask`);`deriveCoverPalette` 仍被 backfill 用、保留。更新对应单测。

**Tasks:**
- [x] `createUploadedTrack` 改 `deriveCoverMetadata` 一次出 thumbhash+精确 palette;移除后台 palette flush 调用 + 整套机制。
- [x] 更新 `cover-thumbhash-repo.test.ts`:断言导入后**立即**有精确 palette(不再 flush)。

**Checklist:**
- [x] `tsc`/Biome 通过;`src` 全量 2383 例通过。
- [ ] **待导入实测**:trace 里每张封面 worker `enqueue` 从 2 次降到 1 次(targets=`["palette","thumbhash"]`)。

### Phase 3: 响应式封面派生(Pinterest 式)

**Goal:** 像 Pinterest 那样「按 显示尺寸×DPR 取刚好够大的那一档」——网格清晰、内存低。**不是用原图、不是一刀切 320。**

**做法(4 招里我们只缺第 1 招):**
1. **多档预生成尺寸** ← 本 Phase 要做。新增一组缩略派生档(如 `sm=160`(列表行)/ `md=320`(网格卡)/ `lg=512`(大图/详情头)),按 surface + `devicePixelRatio` 选。
2. **按 URL 直出、浏览器原生解码/缓存** ← 已有(`muzfetch://local-media` 协议,electron-local-media-protocol PRD Phase 1/2)。
3. **thumbhash blur-up 占位** ← 已有(且 #C 已修不闪)。
4. **虚拟化** ← 已有(`virtual-card-grid`)。

**Tasks:**
- [ ] [`cover-derivative-core.ts`](../../../src/workers/cover-derivative-core.ts) + [`cover-derivatives.ts`](../../../src/db/cover-derivatives.ts):缩略派生参数化为多档尺寸(`sm/md/lg` 或显式 max-edge),各档独立缓存 + 预算([`enforceCoverDerivativeBudget`](../../../src/db/cover-derivatives.ts))。
- [ ] 纯选择器 `pickCoverSize(surface, dpr)`(可单测):列表行→160、网格→320、详情头→512,2x 屏取对应更大档。
- [ ] `useTrackThumbnailUrl` / `useCoverDerivativeUrl` 支持指定尺寸档;[`entity-grid.tsx`](../../../src/components/library/entity-grid.tsx) 网格用 `md`,[`track-row.tsx`](../../../src/components/library/track-row.tsx) 列表用 `sm`。
- [ ] 派生走协议直出(Electron),保持浏览器原生解码/缓存(对齐 Pinterest 第 2 招)。

**Open Question:** 档位取 `160/320/512` 还是别的?是否要 1x/2x 两套?(默认按 `Math.min(devicePixelRatio,2)` 选一档,不存双份。)

**Checklist:**
- [ ] `pickCoverSize` 单测;桌面网格卡 2x DPI 下清晰;各档进预算管理;不上采样、不下载原图。
- [ ] `tsc`/Biome/`src` 全量通过。

---

## 4. Out of Scope / 说明

- **#B 虚拟化本身**:保留(大库必需)。#C 修好 + 派生不在滚动中暴涨后,卡顿应大降;若仍有,再单独看 ResizeObserver 节流 / overscan。
- 不动存储后端、不动协议(本地媒体协议是另一 PRD)。
- 远端封面走 muzfetch 不变。

---

## 5. Related Documents

| Document | Description |
|----------|-------------|
| [cover-render-pipeline-performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | 封面派生管线(worker 化 thumbnail/backlight/palette);本 PRD 是其质量/体验续作 |
| [electron-local-media-protocol PRD](../20260614-muzero-electron-local-media-protocol-prd/20260614-muzero-electron-local-media-protocol-prd.md) | 本地封面零拷贝直出(内存);与本 PRD 互补 |

---

## 6. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | #C 用「缓存命中即返回」还是「track-row 记住上次 URL」? | Open | 首选 (a) 缓存命中即返回(精准、不串图);实现时确认缓存可同步 peek |
| 2 | #A 新派生尺寸取多大?(256 / 320 / 跟随最大网格列宽) | Open | 默认 ~320px(覆盖桌面 2x 网格);实测再调 |
| 3 | #1 合并是否影响已导入库(老封面已分开存)? | Open | 仅改新导入路径;老库走 Phase 3 的派生重算或保持现状 |

---

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Claude | 初稿:#C 滚动不闪(主)+ #1 导入去重 + #A 网格高清;#B 归因虚拟化非主因 |
| 2026-06-14 | Claude | Phase 1(#C)代码完成:`keepDeferredCover` + `useCoverDerivativeUrl` defer 选项(保留已解析封面、滚动中不启动 worker)+ track-row 改造。`src` 全量 2383 例通过。待实测 |
| 2026-06-14 | Claude | QA 跟进:修「滚动停下二次闪 thumbhash」——effect 顶部加 `entryRef.forKey === coverKey` 守卫,已解析封面不再重跑 ensure/换 URL。`src` 全量通过 |
| 2026-06-14 | Claude | Phase 2(#1)代码完成:`createUploadedTrack` 改一次 `deriveCoverMetadata`(thumbhash+精确 palette),删整套延迟 palette flush;每张封面导入解码 2→1 次。`src` 全量 2383 例通过 |
