# PRD: MUZERO 列表滚动操控(hover 滚动条 + A–Z 快速索引)

**Status:** Draft
**Created:** 2026-06-14
**Author:** Claude
**Module:** Library(全部歌曲 / 专辑 / 歌手)虚拟列表 - 大库快速定位/拖拽体验

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Hover 浮层滚动条(可拖拽快速滚动) | ✅ 代码完成(待实测) | [Phase 1](#phase-1-hover-浮层滚动条) |
| 2 | A–Z 字母快速索引(按名称排序时,拼音/假名感知) | ✅ 代码完成(待实测) | [Phase 2](#phase-2-az-字母快速索引) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

库大(用户实测 1650 / 6000+ 首)时,虚拟列表([`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx) / [`virtual-card-grid.tsx`](../../../src/components/library/virtual-card-grid.tsx))滚动现在不卡了(封面去抖 + 不闪已修),但**快速定位手段不足**:
1. 滚动条隐藏/极细,**没法一把拖到大概位置**(像 YouTube Music / 文件管理器 hover 出滚动条快拖)。
2. 按名称排序时,**没有 A→Z 跳转**(像 iOS 音乐/通讯录右侧字母条),大库找歌靠滚很久。

两者都是「大库快速定位」的标准操控,且**纯前端、无后端、复用已有 `scrollToIndex` + Lenis**。

### 1.2 Target Users

| Role | Description |
|------|-------------|
| 大库桌面用户 | 鼠标 hover 出滚动条一把拖到位;按名称找歌点字母直达 |
| 触摸/移动用户 | 沿字母条滑动跳转(iOS 式),大字母浮层提示当前字母 |

### 1.3 Core Value

1. **一把拖到位**:hover 浮层滚动条,大库粗定位秒到。
2. **A→Z 直达**:按名称排序时点/滑字母直接跳,拼音/假名感知(中日韩标题归到对应字母)。
3. **零后端、复用现有**:`useVirtualizer().scrollToIndex` + Lenis 已具备,只加交互层。

---

## 2. System Architecture

### 2.1 现有可复用能力

- 虚拟化:`@tanstack/react-virtual`,滚动容器 `parentRef`(`overflow-y-auto`),`rowVirtualizer.scrollToIndex(i, {align})` 已用([`virtual-track-list.tsx:147/193`](../../../src/components/library/virtual-track-list.tsx#L147))。
- 平滑滚动:Lenis(`scrollToIndex` 已路由经 Lenis,见 :128 注释)——**两个新操控的滚动都必须经同一通道**,避免和 Lenis 抢 `scrollTop`。
- 转写:`use-transliteration-ready` + `freeTextMatches`(⌘F 已用拼音/假名)——**A–Z 取首字母直接复用**,中日韩标题映射到拼音/罗马音首字母。
- 排序:全部歌曲单选 sort 字段 + 方向([`search-page.tsx:229`](../../../src/pages/search-page.tsx#L229)),含按名称。

### 2.2 两个新组件(交互层,叠在虚拟列表上)

```
VirtualTrackList (parentRef scroller + Lenis)
  ├── HoverScrollbar(浮层,绝对定位右缘):读 scrollTop/scrollHeight/clientHeight → 算 thumb;拖动 → 经 Lenis scrollTo
  └── AlphabetIndex(浮层,右缘字母条,仅按名称排序时):点/滑字母 → scrollToIndex(该字母首行);拖动时中央大字母提示
```

---

## 3. Data Model

**无新增表/字段、无设置项**(纯交互)。可选:`AppSettings.listAlphabetIndex?: boolean`(默认 on)——若要可关再加,初版不加,遵守硬规则 3(不藏 flag)。

---

## 4. Frontend Design

### 4.1 Phase 1 — HoverScrollbar(`src/components/library/hover-scrollbar.tsx`,新)

- 一条**浮层 thumb**(绝对定位贴 `parentRef` 右缘),默认透明/极窄,**hover 滚动区或 thumb 时淡入加宽**;离开延时淡出。
- thumb 高度 = `clientHeight/scrollHeight * trackHeight`,位置 = `scrollTop/(scrollHeight-clientHeight)`。`ResizeObserver` + 滚动事件更新(节流到 rAF)。
- **拖拽**:pointerdown 在 thumb → 跟随指针把目标 `scrollTop` 通过**Lenis(若 active)否则原生 `scrollTo`** 设置,松手停。点击 track 空白处 = page jump。
- 触摸:thumb ≥44px 命中区;移动端可不显示(用 Phase 2 字母条更顺手)。
- 与 Lenis 协同:拖拽时若 Lenis 在跑要 `lenis.scrollTo(target, { immediate: true })`,避免惯性回弹打架。

### 4.2 Phase 2 — AlphabetIndex(`src/components/library/alphabet-index.tsx`,新)

- **仅当排序 = 名称(title)且条目数超阈值(如 >50)时**显示;右缘竖排 `A B C … Z #`(以及 CJK 归并后的字母)。
- **纯数据**:`buildAlphabetIndex(sortedRows, getTitle)` → 有序 `{ label, firstIndex }[]`;首字母经**转写**(拼音/假名)取,非字母归 `#`。可单测(穷举:英文、数字、`#`、中文按拼音、日文按假名)。
- 点字母 → `scrollToIndex(firstIndex, { align: "start" })`(经 Lenis)。
- 触摸/拖动沿字母条 → 实时 `scrollToIndex` + **中央大字母浮层**提示当前字母(iOS 式)。
- 字母条本身不滚动列表数据(只触发跳转);窄屏字母可抽稀(每隔一个 + `·`)。

### 4.3 State

- 两个组件订阅最小:`HoverScrollbar` 自管 hover/drag 本地态 + 读 scroller 尺寸;`AlphabetIndex` 接收 `sortedRows` + `sort` + `scrollToIndex` 回调。**不进 Zustand**(交互态,ephemeral)。

---

## 5. Implementation Plan

### Phase 1: Hover 浮层滚动条

**Goal:** 大库 hover 出可拖拽滚动条,一把粗定位;不破坏 Lenis 平滑滚动。

**实现(落地):** [`hover-scrollbar.tsx`](../../../src/components/library/hover-scrollbar.tsx) 用 `sticky top-0 h-0` 浮层贴右缘(不随内容滚、不重构列表),`group-hover/list:` 显隐;thumb 拖拽经 `scrollToTop`(Lenis immediate / 原生回退)。位置由纯 [`scrollbar-thumb.ts`](../../../src/lib/scrollbar-thumb.ts) 算,scroll+resize 经 rAF 节流(ResizeObserver 守卫 jsdom)。

**Tasks:**
- [x] 纯助手 [`scrollbarThumb`](../../../src/lib/scrollbar-thumb.ts) + `scrollTopForThumbOffset`(5 例单测,含内容不足/超长/min-thumb 钳制/拖拽反解)。
- [x] [`hover-scrollbar.tsx`](../../../src/components/library/hover-scrollbar.tsx):sticky 浮层 thumb + hover 淡入 + 拖拽 → Lenis/原生 `scrollTo`。
- [x] 接进 [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx)(scroller 加 `group/list` + 挂 `<HoverScrollbar>` + `scrollToTop` 经 Lenis)。

**Checklist:**
- [x] `scrollbarThumb` 单测(5)全绿;`tsc`/Biome 通过;`src` 全量 2388 例通过。
- [ ] **待实测**:hover 出条、拖动跟手、与 Lenis 惯性不打架;触摸不误触。

### Phase 2: A–Z 字母快速索引

**Goal:** 按名称排序时右缘字母条,点/滑直达;中日韩按拼音/假名归字母。

**实现(落地):**
- 纯 [`alphabet-index.ts`](../../../src/lib/alphabet-index.ts):`firstAlphaLabel`(NFKD 去音标取首字母,非字母归 `#`)+ `buildAlphabetIndex(rows, letterOf)` → 有序 `{label, firstIndex}[]`,**全局去重**(`seen` set,首次出现胜)——即便运行时 `localeCompare` 按 Han 码点排(而非读音)致同字母不连续,字母条也只出一条、跳第一处,不出现重复字母。
- 转写首字母 [`transliterateInitial`](../../../src/lib/search-transliterate.ts)(**复用搜索引擎**的 pinyin-pro / wanakana,kana-first 检测同 `searchVariants`):中文 Han→拼音首字母、日文 kana→罗马音首字母、拉丁→自身、其它→`#`;字典未载入前退化为原始首字母(载入后 `transliterationReady` 触发重算)。**已知边界**:kanji 起头的日文标题(wanakana 不读 kanji)归 `#`——读它需 JP 词典,超范围,kana-first 门也刻意不让它走中文拼音。
- [`alphabet-index.tsx`](../../../src/components/library/alphabet-index.tsx):`sticky top-0 h-0` 浮层右缘竖排字母条(高度 = scrollport `clientHeight`,不重构列表);点字母 / 沿条拖动 → `rowVirtualizer.scrollToIndex(firstIndex,{align:"start"})`(经 Lenis)+ 拖动时中央大字母浮层。`buckets<2` 或测得高度为 0(jsdom)时不渲染。
- 接线:[`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx) 加 `alphabetLetterOf?` prop(memo 出 buckets + 挂 `<AlphabetIndex>`)→ [`track-list-section.tsx`](../../../src/components/library/track-list-section.tsx) 透传 → [`search-page.tsx`](../../../src/pages/search-page.tsx) **仅** `trackSort==="name"` 且 无搜索词 且 非红心过滤 且 `shownTracks > 50`(`ALPHABET_INDEX_MIN_TRACKS`)时传入。

**Tasks:**
- [x] 纯 `buildAlphabetIndex` + `firstAlphaLabel`(单测穷举英/数/`#`/去音标/CJK 注入字母/去重);`transliterateInitial`(单测英/中拼音/日假名/数字/kanji 边界)。
- [x] [`alphabet-index.tsx`](../../../src/components/library/alphabet-index.tsx):字母条 + 点击/拖动跳 `scrollToIndex`(经 Lenis)+ 拖动大字母浮层。
- [x] 接进 `virtual-track-list` → `track-list-section` → `search-page`:仅名称排序 + 无 query + 非红心 + `>50` 时挂载;`sortedRows`/`transliterationReady` 变化重算(memo)。

**QA 跟进(字母条乱序 + 点 Q 显示 K):** 实测字母条不是 A→Z、点一个字母跳到/提示成另一个。**根因:列表排序与标签不同源**——名称排序用 `title.localeCompare`(在 Electron 默认 locale 下按 Han **码点**排,非拼音),而标签是**拼音**首字母 → 两者错位 → `buildAlphabetIndex` 按出现顺序得到一条乱序、彼此不连续的字母带,拖动/点击按比例映射就指错字母。**修法:让名称排序本身转写感知**——新增 [`transliterateSortKey`](../../../src/lib/search-transliterate.ts)(整串读音化:Han→全拼、kana→罗马音、其余 NFKD 折叠小写),[`sortTracks`](../../../src/lib/track-gallery.ts) 名称排序改按它(每 track 预算一次 key,避免比较器里 O(n log n) 调拼音);`transliterateInitial` 重定义为 `firstAlphaLabel(transliterateSortKey(...))` → **标签与排序同源**。于是列表读音 A→Z、字母带连续有序、点/拖精确命中。附带修对混合标题(`iPhone手机`→`I`,旧实现取内部 Han 拼音误判 `S`)。

**Checklist:**
**QA 跟进(占位/可读性):** 字母条贴最右边、压在封面上且背景花时看不清。**修法:让字母条独占右侧 gutter**——字母条 `right-1` + 半透明 `bg-background/35 backdrop-blur` 圆角 rail(busy 背景也可读),hover 滚动条经新 `rightInset` prop 内移 24px 到字母条**左侧**(`virtual-track-list` 在 `hasAlphabet` 时传),行内容加 `pr-6` 让封面/时长躲开 rail。三者各占其位,不再叠。

**Checklist:**
- [x] `buildAlphabetIndex` / `transliterateInitial` / `transliterateSortKey`(读音排序键 + 混合标题 + 拼音序)单测全绿;`tsc`/Biome 通过;`src` 全量 2407 例通过。
- [ ] **待实测**:点字母准确跳到该字母首行;中日韩标题归类正确;触摸滑动跟手 + 大字母提示;字母条 rail 在花背景上可读、与 hover 滚动条不再重叠、行内容不被遮。

---

## 6. Out of Scope

- 不改虚拟化本身、不改排序逻辑(只读 `sortedRows`)。
- 不做「拖拽重排歌单」(那是 set-track-drag-reorder PRD)。
- 不引入第三方滚动条库(自研浮层,~100–150 LOC),遵守「不新增 runtime owner」。
- A–Z 仅 track 列表;专辑/歌手网格的字母条留作后续(同 `buildAlphabetIndex` 可复用)。

---

## 7. Security / 本地优先

- 纯前端交互,无出站、无后端、无遥测;无隐藏 flag(硬规则 3),要开关就建可见 Settings 控件(初版不需要)。
- codename 层不变。

---

## 8. Related Documents

| Document | Description |
|----------|-------------|
| [smooth-scroll-lenis PRD](../20260611-muzero-smooth-scroll-lenis-prd/) | Lenis 平滑滚动;两个新操控的滚动都要经它 |
| [cover-quality-and-scroll PRD](../20260614-muzero-cover-quality-and-scroll-prd/20260614-muzero-cover-quality-and-scroll-prd.md) | 同一虚拟列表的封面/滚动性能(前置,已修不卡) |

---

## 9. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | hover 滚动条用自研浮层 thumb,还是 CSS 美化原生 `::-webkit-scrollbar`? | Open | 倾向自研浮层(可控 + 跟 Lenis 协同 + 跨平台一致);CSS 原生难和 Lenis 协调 |
| 2 | A–Z 仅按名称排序显示,其他排序(最近/时长)隐藏? | ✅ Resolved | 是:`search-page` 仅 `trackSort==="name"` 且无 query/红心/`>50` 时传 `alphabetLetterOf` |
| 3 | 中日韩首字母:拼音/假名首字母还是按 Unicode 段归「#/中/日」? | ✅ Resolved | `transliterateInitial` 复用搜索 pinyin/kana 取首字母,取不到归 `#`;kanji 起头日文标题归 `#`(无 JP 词典,已知边界) |
| 4 | 触摸端是否两个都上,还是移动端只上字母条? | Open | 移动端字母条为主;hover 滚动条桌面为主(触摸隐藏) |

---

## 10. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Claude | 初稿:hover 浮层滚动条(Phase 1)+ A–Z 字母快速索引(Phase 2,拼音/假名感知);复用 `scrollToIndex` + Lenis + 转写 |
| 2026-06-14 | Claude | Phase 1 代码完成:`scrollbar-thumb.ts`(纯几何,5 例)+ `hover-scrollbar.tsx`(sticky 浮层 thumb,拖拽经 Lenis)接进 `virtual-track-list`。commit `ee8bd23` |
| 2026-06-14 | Claude | Phase 2 代码完成:`alphabet-index.ts`(`firstAlphaLabel`+`buildAlphabetIndex` 全局去重)+ `transliterateInitial`(复用 pinyin/wanakana)+ `alphabet-index.tsx` 浮层字母条;接线 `virtual-track-list`→`track-list-section`→`search-page`(名称排序+无 query+非红心+>50)。`src` 全量 2401 例通过 |
| 2026-06-14 | Claude | QA 修(字母条乱序/点 Q 显示 K):名称排序与拼音标签不同源致错位。新增 `transliterateSortKey`(整串读音化),`sortTracks` 名称排序改按它(预算键),`transliterateInitial` 重定义为同源 `firstAlphaLabel(sortKey)`;附带修混合标题 `iPhone手机→I`。`src` 全量 2407 例通过 |
| 2026-06-14 | Claude | QA 修(占位/可读性):字母条独占右 gutter——`bg-background/35 backdrop-blur` 圆角 rail + hover 滚动条 `rightInset` 内移到其左 + 行 `pr-6` 让内容躲开。`src` 全量 2407 例通过 |
| 2026-06-14 | Claude | QA 修(全部歌曲排序不持久化):`trackSort`/`trackSortDir` 改 localStorage 持久(`muzero-gallery-track-sort`/`-dir`,同 `MODE_KEY`/`VIEW_KEYS` 一类 UI 偏好),初始从存储读、`onTrackSortClick` 写回。`src` 全量 2408 例通过 |
| 2026-06-14 | Claude | QA 修(按 B 显示 G):拖动命中错位。根因——字母条容器是满屏高 `justify-center`,字母挤在中间留大空隙,但 `jumpAt` 按**整高**比例映射 → 顶部空隙把指针推到靠后字母。修法:把命中测试改到**贴合字母的内层块**(stripRef 移到内层 tight block,外层满高容器只负责居中),并抽纯函数 `bucketIndexAt`(单测含 B-not-G 回归)。`src` 全量 2412 例通过 |
| 2026-06-14 | Claude | 性能回归修(滚动 `fps low 4` / jank 267ms):Fix 1 把名称排序从 `localeCompare` 换成**逐 title 拼音** `transliterateSortKey`,**无缓存**——大库(~6k 首)名称排序时,播放心跳每 flush 改 `lastPlayedByTrack` → `shownTracks` memo 重排 → 6k 次拼音 ≈ 200ms 主线程阻塞,边播边滚就掉到 4fps。修法:给 `transliterateSortKey` 加**结果缓存**(按 title,载入字典时清,上限 12k),重排变 ~几 ms。`src` 全量 2422 例通过 |
| 2026-06-14 | Claude | 性能续修(`fps low 12` / jank 125ms):同一条「播放心跳」(`trackPlaybackStats`/`playbackEvents` 每 flush 重写)还在驱动一串大库 O(N) 派生(`statsByTrackId`/`artistStats`/`albumStats`/`artistItems`/`albumItems`/`systemPlaylistRows`),哪怕在「全部歌曲」tab 看不到也照算。修法:① 用 `useDeferredValue` 把整条 stats cascade 移到 transition 优先级(不阻塞滚动,仿 `indexSource`);② `systemPlaylistRows`(对全库 2× 排序)**门控到 `mode==="sets"`**——其它 tab 返回稳定空 `EMPTY_SYSTEM_PLAYLIST_ROWS`,不再每心跳排 6k。审计结论:⌘F 全局搜索已 worker + defer + throttle,非主线程卡顿源。`src` 全量 2422 例通过 |
| 2026-06-14 | Claude | 性能续修(「全部歌曲」列表滚动仍 `fps low 10`/avg 38fps,而专辑/歌手网格顺):差异定位到**行重**——每个 `TrackRow` 都挂一整套 hover 操作条(2 个 Base UI Popover + 多个按钮),CSS 隐藏到 hover 才显,却**为每个已挂载行都实例化**(网格 `EntityCard` 没有任何 per-card popover,所以顺)。修法:操作条改**惰性挂载**——仅 `onMouseEnter`(非 pointer,免触摸误触)/`onFocus` 时才渲染,快速滚过几百行不再建 popover。新增惰性挂载单测。`src` 全量 2427 例通过。**遗留**:`virtual-track-list` 给每行传内联箭头 props(`onPlay`/`onDelete`/…新身份每帧),令 `TrackRow` 的 `memo` 失效→滚动时可见行仍整体重渲染;稳定化 props 是进一步优化(更大改动,待实测后定) |
| 2026-06-14 | Claude | 性能续修(`fps low 24`/avg 86fps,惰性挂载后):接上条遗留。`TrackRow` 加**自定义 `memo` 比较器** `trackRowPropsEqual`——只比数据 props(`track`/`isCurrent`/`isSelected`/`checked`/`selectable`/`deferCoverLoad`/`listIndex`/`sessions`/`secondaryMeta`/`metricColumns`),**忽略回调身份**(回调行为完全由 `track`+模块级 store 函数决定,故安全)。纯滚动时 `track` 对象稳定 → 可见行**不再重渲染**,只有新进窗口的行才 mount;切歌/选中/scroll start-stop 仍正确更新。新增 render-count 单测(只换回调身份 → 不重渲;改 `isCurrent` → 重渲)。`src` 全量 2428 例通过 |
| 2026-06-14 | User+Claude | QA 观察:**开 smooth scroll(Lenis)反而更顺**(avg 90/low 20 → 115-120/low 40)。根因:Lenis 把原生 wheel(120Hz)事件**按 rAF 合并**,虚拟列表每帧只重算一次窗口;原生滚动每个事件都重算 = 冗余。用户选「保持 smooth scroll opt-in,转而优化 native」。新增 [`rafObserveElementOffset`](../../../src/components/library/raf-scroll-offset.ts)(drop-in 替换 TanStack `observeElementOffset`,**按 rAF 合并 scroll 读取**、保留 `isScrolling` 去抖给 `deferCoverLoad`),接进 `virtual-track-list` 的 `useVirtualizer`——不开 Lenis 也每帧只重算一次。4 例单测(初值同步/多事件合一/`isScrolling` 复位/cleanup)。library 全绿 |
