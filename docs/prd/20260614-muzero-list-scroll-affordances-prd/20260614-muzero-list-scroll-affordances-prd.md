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
| 2 | A–Z 字母快速索引(按名称排序时,拼音/假名感知) | 🔲 Pending | [Phase 2](#phase-2-az-字母快速索引) |

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

**Tasks:**
- [ ] 纯 `buildAlphabetIndex(sortedRows, getTitle, transliterate)` → `{label, firstIndex}[]`(复用转写);**单测**穷举英/数/`#`/中(拼音)/日(假名)。
- [ ] `alphabet-index.tsx`:字母条 + 点击/拖动跳 `scrollToIndex`(经 Lenis)+ 拖动大字母浮层;窄屏抽稀。
- [ ] 接进 `virtual-track-list`:仅 `sort === "name/title"` 且 `rows > 阈值` 时挂载;`sortedRows` 变化时重算索引(memo)。

**Checklist:**
- [ ] `buildAlphabetIndex` 单测全绿;`tsc`/Biome/`src` 全量通过。
- [ ] **待实测**:点字母准确跳到该字母首行;中日韩标题归类正确;触摸滑动跟手 + 大字母提示。

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
| 2 | A–Z 仅按名称排序显示,其他排序(最近/时长)隐藏? | Open | 是,仅名称排序有意义;其他排序隐藏字母条 |
| 3 | 中日韩首字母:拼音/假名首字母还是按 Unicode 段归「#/中/日」? | Open | 复用 ⌘F 的转写取拼音/罗马音首字母(A–Z 内);取不到归 `#` |
| 4 | 触摸端是否两个都上,还是移动端只上字母条? | Open | 移动端字母条为主;hover 滚动条桌面为主(触摸隐藏) |

---

## 10. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Claude | 初稿:hover 浮层滚动条(Phase 1)+ A–Z 字母快速索引(Phase 2,拼音/假名感知);复用 `scrollToIndex` + Lenis + 转写 |
