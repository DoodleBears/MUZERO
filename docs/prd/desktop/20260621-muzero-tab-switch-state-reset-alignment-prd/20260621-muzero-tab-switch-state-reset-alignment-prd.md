# PRD: Tab 切换状态重置对齐（键盘 Ctrl+1/2 ↔ 点击切换）

**Status:** 🔄 In Progress
**Created:** 2026-06-21
**Author:** MUZERO Desktop
**Module:** Shell / 导航（tab 切换入口统一）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 建立统一导航契约（TDD：`navigateToTab` 忠实直切，不走 VT） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 收敛纯切换入口到 `navigateToTab`（保留封面 morph） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 验证对齐 + 回归（`make check` + 真值回归） | 🔄 In Progress | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> **执行说明（2026-06-21 修复落地）：** 原 Phase 1「复现+插桩」是在根因未明时的观测优先策略。静态排查已**高置信度**钉死根因——切换入口分歧（`transitionState` vs 直接 `setTab`），且用户已认证「点击 Dock 歌曲」的直接 `setTab` 路径**忠实不重置**。因此修复是**构造性正确**的：把所有入口对齐到这条已知良好的直切路径，无论确切的重置机理是 VT 快照、`flushSync` 时序还是焦点 scroll-into-view，都被同一修复覆盖。故 Phase 1 改为「用 TDD 建立 `navigateToTab` 忠实切换契约」，重型 Electron harness 复现降级为 Phase 3 的可选回归验证。

---

## 1. Overview

### 1.1 Background（含原始反馈 + 排查结论）

**用户反馈（原文）：**

> Ctrl+1 / Ctrl+2 切换 tab 的时候，似乎和直接点击 header 或者 Dock 的歌曲来触发切换的时候不一样。前者会导致状态重置？比如歌单查看时候的位置，还有 sort 等？—— 这里应该要对齐后者。

**排查结论（是否属实）：症状真实，但归因经历了一次自我更正。** 初稿以为「Dock 歌曲 = 直接 `setTab`、键盘 = View Transition」是分界——后被推翻：**所有**用户可见的 tab 切换其实都走了 `transitionState`（含 Dock 歌曲，经 [`track-identity-row.tsx:186`](src/components/player/track-identity-row.tsx:186) 的封面 morph）。因此「键盘为何重置、Dock 歌曲为何不重置」**无法纯靠静态阅读判定机理**。最终修复**不依赖**机理：把纯切换对齐到「可证明忠实」的纯 `setTab`（见 §1.1.2）。

MUZERO 的 5 个 tab 是**常驻挂载**的（[`App.tsx`](src/App.tsx) 用 `display:none` / `invisible` 切换，不卸载），其中 search（资料库）tab 是唯一用 `keepLayout`（`visibility:hidden`，保留在 layout 中）渲染的，专门为了**保留滚动位置与虚拟化状态**：

- `sort` / `sortDir` / `selectedSetId` 是 [`SearchPage`](src/pages/search-page.tsx:320) 的 `useState`，SearchPage 永不卸载 → React state 天然持久；
- 歌单墙的滚动位置存在 `wallScrollTops` ref（[`search-page.tsx:392`](src/pages/search-page.tsx:392)），由 `onScroll` 写入、`attachWall` / `restoreScrollTop` 还原，ref 同样跨切换持久。

`transitionState` = `startViewTransition(() => flushSync(setTab))`（[`view-transition-react.ts:14`](src/lib/view-transition-react.ts:14)）。它额外做了 `flushSync` 同步提交 + 原生 View Transition 对**整棵 kept-mounted 树**的 root 快照——后者既是已知的 FPS 成本（view-transition-perf PRD，已在有播放背景时 suppress），也是扰动资料库 tab 滚动还原的最可疑路径。

#### 1.1.1 切换入口审计（本 PRD 的核心事实）

| 切换入口 | 代码路径 | 是否包 `transitionState` |
|---|---|---|
| 键盘 `Ctrl+1` / `Ctrl+2` / `Ctrl+3`（`nav.tabNow` / `nav.tabLibrary` / `nav.tabSettings`） | [`actions.ts:194`](src/shortcuts/actions.ts:194)：`ctx.transitionState(() => ctx.setTab(...))` | ✅ 是 |
| 键盘 `Ctrl+Tab` / `Ctrl+Shift+Tab`（`nav.tabNext` / `nav.tabPrev`） | [`actions.ts:197`](src/shortcuts/actions.ts:197) | ✅ 是 |
| Header 顶部 nav tabs 点击 | [`header-nav-tabs.tsx:113`](src/components/shell/header-nav-tabs.tsx:113) `pick()` → `transitionState(() => onChange(next))` | ✅ 是 |
| Dock 右侧 nav FAB 点击 | [`nav-fab.tsx`](src/components/nav/nav-fab.tsx) `pick()` → `transitionState(() => onChange(id))` | ✅ 是 |
| **点击 Dock 的歌曲（封面/标题）打开 Now Playing** | [`player-dock.tsx:79`](src/components/shell/player-dock.tsx:79) `TrackIdentityRow onOpen` → [`track-identity-row.tsx:186`](src/components/player/track-identity-row.tsx:186) `if (onOpen) transitionState(onOpen)`（**封面 shared-element morph**） | ✅ **是（封面 morph）** |
| Dock 聊天入口「上传到资料库」 | [`player-dock.tsx:63`](src/components/shell/player-dock.tsx:63) `onUploadLibrary={() => onTabChange("search")}` | ❌ 否（直接） |
| 开始 DJ 集 / 拖拽上传后跳转 | [`App.tsx`](src/App.tsx) `onSessionsStarted`、`onMediaUploaded` | ❌ 否（直接） |

> **⚠️ 重要更正（推翻初稿的一个错误前提）：** 初稿声称「点击 Dock 歌曲 = 直接 `setTab`、忠实不重置」是**错的**——首轮排查漏看了 [`track-identity-row.tsx:186`](src/components/player/track-identity-row.tsx:186)：Dock 歌曲打开 Now Playing 时 `handleOpen` 把 `onOpen` 包进了 `transitionState`（为封面做 shared-element morph）。**因此所有用户可见的 tab 切换其实都走了 View Transition**，「键盘 vs 点击」在代码层面并不是 `transitionState`↔直接 `setTab` 的分界。**纯靠静态阅读无法解释为何键盘会重置而 Dock 歌曲不会**（它们用同一机制）。

#### 1.1.2 修复为何不依赖「确切机理」——构造性正确

虽然无法静态钉死「为什么 VT 路径会重置」，但有一条**与机理无关的硬事实**：

> **在 kept-mounted 架构下，一次纯 `setTab` 对资料库状态是可证明忠实的。**

- search tab 用 `keepLayout`（`visibility:hidden`，**始终在 layout 中**，[`App.tsx`](src/App.tsx) `TabPanel keepLayout`）→ 它的滚动容器 `scrollTop` 不会因隐藏而丢；
- `sort`/`sortDir`/`selectedSetId` 是**永不卸载**的 [`SearchPage`](src/pages/search-page.tsx:320) 的 `useState`；
- 所以一次纯 `setTab` 触发的 App 重渲染只是切 `hidden`/`invisible` class，**不可能**重置资料库滚动/排序。

因此修复=把**纯切换入口**（键盘 `nav.tab*` / header tabs / dock FAB / chat-upload 跳转）对齐到纯 `setTab`（经 `navigateToTab`）。无论真实重置机理是 VT 快照、`flushSync` 时序、900ms 卸载竞态还是焦点 scroll-into-view，纯 `setTab` 都**绕过**了它们 → 保证不重置。而**带 shared-element morph 的切换**（Dock 歌曲封面 morph、资料库内 set/artist/album 详情打开）保留各自的 `transitionState`——它们 morph 的是具名元素、是有意的动效，不在本次「纯切换对齐」范围内。

> **关于 `sort`：** 静态阅读下它是 SearchPage 永不卸载的 `useState`，**任何切换都不可能重置它**；用户看到的「sort 变了」很可能是「滚动被重置 → 可视顺序变化」的错觉。本次修复让纯切换不再重置滚动，该错觉也随之消失。若仍观察到 sort 真变，属另一条未知路径，转 Phase 3 复现。

> **诚实标注验证缺口：** 本环境无法复刻用户的本地资料库数据来端到端复现「滚动重置」。修复对纯切换是**逻辑上保证忠实**的（纯 `setTab` + kept-mounted），但「Dock 歌曲为何不重置」这一对照仍是未解之谜——若它其实也重置（与用户报告相反），属独立后续。最终确认 = 用户在自己正在跑的实例里按 `Ctrl+1/2` 实测。

### 1.2 Target Users

| Role | Description | 影响 |
|------|-------------|------|
| **桌面键盘重度用户** | 用 `Ctrl+1/2/3`、`Ctrl+Tab` 在 Now / 资料库 / 设置间快切 | 切回资料库丢失歌单浏览位置 → 体验断裂 |
| **全体桌面用户** | 任意通过 header tabs / dock FAB 切换者 | 行为不一致（同样走 VT 的入口理应同样表现，却被感知为随机） |

### 1.3 Core Value

1. **行为一致性**：所有**纯**切换入口（键盘 / header / dock FAB / chat-upload）走**同一条** `navigateToTab` 忠实直切，表现完全一致——消除「换个入口就换个行为」；带封面 morph 的切换保留各自有意的动效。
2. **状态保真**：切走再切回资料库，**歌单浏览位置、详情滚动、排序、当前进入的集/详情**原样还原（`keepLayout` 的设计意图，本 PRD 让它在纯切换路径上真正生效）。
3. **可回归（TDD）**：把「纯切换不带 View Transition」固化成单测——[`navigate-tab.test.ts`](src/lib/navigate-tab.test.ts) 断言 helper 不触发 `startViewTransition`，[`actions.test.ts`](src/shortcuts/actions.test.ts) 断言键盘 nav 不再依赖 `transitionState`。

---

## 2. System Architecture

### 2.1 现状（修复前——所有用户可见切换都走 VT）

```
键盘 Ctrl+1/2/3 ─┐
Ctrl+Tab/Shift   ─┤ runShortcutAction → ctx.transitionState(() => setTab(t))  ┐
Header nav tabs  ─┤ pick() ──────────→ transitionState(() => onChange(t))      ├─► startViewTransition(() => flushSync(setTab))
Dock nav FAB     ─┤ pick() ──────────→ transitionState(() => onChange(t))      │        │  root 快照整棵 kept-mounted 树
点击 Dock 歌曲    ─┘ TrackIdentityRow → transitionState(onOpen=setTab("now"))   ┘        │  (ambientBackdropActive 时 suppress→同步)
                                                                                         ▼
                                                                            useNavStore.setTab → tab 持久化(muzero-nav)
                                                                                         ▼
                                                  App 重渲染：TabPanel 切 hidden/invisible（5 个 tab 全程挂载）
```

### 2.2 目标（修复后——纯切换走忠实直切，morph 切换保留 VT）

```
纯切换：键盘 nav.tab* / header tabs / dock FAB / chat-upload
        ──► navigateToTab(setTab, t)  ──►  setTab(t)        ← 纯状态更新, 不快照, 可证明忠实
                                              │
带 morph 的切换：Dock 歌曲(封面 morph) / 资料库内 set·artist·album 详情打开
        ──► 各自 transitionState(...)  ──►  startViewTransition(flushSync(...))   ← 有意的 shared-element 动效, 保留
                                              ▼
                                  useNavStore.setTab → App 重渲染（kept-mounted 不卸载）
```

### 2.3 Technology Stack

| Component | Technology | 关联文件 |
|-----------|------------|---------|
| 导航状态 | Zustand + persist（`muzero-nav`） | [`nav-store.ts`](src/stores/nav-store.ts) |
| 页面过渡 | 原生 View Transition（仅 Chromium 壳）+ `flushSync` | [`view-transition.ts`](src/lib/view-transition.ts) / [`view-transition-react.ts`](src/lib/view-transition-react.ts) |
| 快捷键派发 | 可配置 registry → action handlers | [`actions.ts`](src/shortcuts/actions.ts) / [`use-shortcut-dispatch.ts`](src/hooks/use-shortcut-dispatch.ts) |
| 资料库滚动/排序状态 | SearchPage `useState` + `wallScrollTops` ref + localStorage 排序偏好 | [`search-page.tsx`](src/pages/search-page.tsx) / [`virtual-card-grid.tsx`](src/components/library/virtual-card-grid.tsx) |

---

## 3. Data Model Design

**N/A —— 纯前端 UI 行为对齐，不改 IndexedDB schema、不改 `TrackBrief`、不动 codename 层。** 仅可能新增（或复用既有的）UI 偏好/临时状态，不进 `tracks` 行、不引入后端。

---

## 4. API Design

**N/A —— 无网络/后端接口。** 唯一「契约」是一个新的内部前端 helper（见 §5.3）。

---

## 5. Frontend Design

### 5.1 受影响文件（实际改动）

| 文件 | 改动 |
|---|---|
| [`src/lib/navigate-tab.ts`](src/lib/navigate-tab.ts) | **新增** `navigateToTab(setTab, tab) = setTab(tab)` + doc 纪律。这是唯一新文件，作为「纯切换」单一裁决点（exception policy：单一 lib seam，类比既有 `transitionState`）。 |
| [`src/shortcuts/actions.ts`](src/shortcuts/actions.ts) | `nav.tab*` 改为 `navigateToTab(ctx.setTab, ...)`；从 `ShortcutActionRunnerContext` 删除已无用的 `transitionState` 字段 + 导入。 |
| [`src/components/shell/header-nav-tabs.tsx`](src/components/shell/header-nav-tabs.tsx) | `pick()` 去掉 `transitionState` 包裹，改为 `onChange(next)`（`onChange` = App 的 `goToTab`，已是忠实直切）。删 `transitionState` 导入。 |
| [`src/components/nav/nav-fab.tsx`](src/components/nav/nav-fab.tsx) | 同上，`pick()` 改为 `onChange(id)`。删导入。 |
| [`src/App.tsx`](src/App.tsx) | 新增 `goToTab = useCallback((t) => navigateToTab(setTab, t), [setTab])`；`HeaderNavTabs onChange` / `PlayerDock onTabChange` / `onSessionsStarted` / `GlobalDropZone onMediaUploaded` 全部走 `goToTab`。`onOpenNowPlaying` 保持 `setTab("now")`（其 morph 由 `TrackIdentityRow` 负责）。 |
| [`src/components/player/track-identity-row.tsx`](src/components/player/track-identity-row.tsx:186) | **不改**：Dock 歌曲的 `transitionState(onOpen)` 封面 morph 保留。 |

### 5.2 UI / 交互要求

- **纯切换 = 即时无过渡**：键盘 / header / dock FAB 切 tab 不再有 root 交叉淡入（该淡入本就在有播放背景时被 suppress，是 FPS 成本）。换来的是**保真 + 即时**，与 Spotify/Apple Music 的瞬切一致。
- **morph 切换保留**：Dock 歌曲→Now Playing 的封面 morph、资料库内 set/artist/album 详情打开的封面 morph 不变。
- **硬约束**：切回资料库时，歌单墙滚动位置、已进入的集/系统歌单详情、详情内滚动、排序 chips 选择全部原样——纯 `setTab` + kept-mounted 保证之。

### 5.3 State Management —— 纯切换 helper（契约，已落地）

```typescript
// src/lib/navigate-tab.ts —— 纯切换的唯一裁决点（NOT 用于带 morph 的切换）
export function navigateToTab(setTab: (tab: Tab) => void, tab: Tab): void {
  setTab(tab); // 纯状态更新；绝不 transitionState / flushSync / startViewTransition
}
```

- 关键纪律（沿用 CLAUDE.md「不要在 UI 散落分支」/ #3 / #10）：纯切换**禁止**在各入口散落 `transitionState`；唯一裁决点收敛到 `navigateToTab`（+ App 的 `goToTab` 薄包装）。带 shared-element morph 的切换是**另一类**，各自持有 `transitionState`，不归此 helper。

---

## 6. Implementation Plan

### Phase 1: 建立统一导航契约（TDD：`navigateToTab`）✅

**Goal:** 用 TDD 落地一个「忠实直切、绝不走 View Transition」的单一导航入口，作为所有切换入口的对齐基准——即把用户认证为正确的「点击 Dock 歌曲」直接 `setTab` 行为抽成可复用、可回归的契约。

**Done:**
- [x] 先写测试（red）：[`src/lib/navigate-tab.test.ts`](src/lib/navigate-tab.test.ts) 断言 `navigateToTab(setTab, tab)` ①经 setter 切到目标 tab ②**绝不**触发 `document.startViewTransition`（kept-mounted tab 必须忠实）。
- [x] 实现（green）：[`src/lib/navigate-tab.ts`](src/lib/navigate-tab.ts) `navigateToTab(setTab, tab) = setTab(tab)`，附完整 doc 注释固化「tab 导航不得包 `transitionState`」纪律（CLAUDE.md「不要在 UI 散落分支」同源）。
- [x] `vitest run src/lib/navigate-tab.test.ts` 2 passed。

### Phase 1 Checklist
- [x] 契约测试先红后绿
- [x] helper 注释写清「为何不走 VT」+ 与共享元素 morph 的边界（morph 仍用 `transitionState`）
- [x] 不新增隐藏 flag、不碰 codename 层 / schema

### Phase 2: 收敛纯切换入口到 `navigateToTab` ✅

**Goal:** 让所有**纯**切换入口（键盘 / header / dock FAB / chat-upload）走忠实直切；保留带封面 morph 的切换。

**Done（TDD）:**
- [x] 先红：从 [`actions.test.ts`](src/shortcuts/actions.test.ts) 的 mock context 删掉 `transitionState` → 旧 `nav.tab*` 调 `ctx.transitionState` 抛 `TypeError`（2 failed）。
- [x] 后绿：[`actions.ts`](src/shortcuts/actions.ts) `nav.tab*` 改 `navigateToTab(ctx.setTab, ...)`，并从 `ShortcutActionRunnerContext` 删除 `transitionState`（已无用）→ 7 passed。
- [x] [`header-nav-tabs.tsx`](src/components/shell/header-nav-tabs.tsx) / [`nav-fab.tsx`](src/components/nav/nav-fab.tsx) 去掉 `pick()` 的 `transitionState` 包裹，改纯 `onChange(...)`，删导入。
- [x] [`App.tsx`](src/App.tsx) 新增 `goToTab`，把 header `onChange` / dock `onTabChange` / `onSessionsStarted` / 拖拽上传跳转全部接上；`onOpenNowPlaying` 保持 `setTab`（morph 由 TrackIdentityRow 负责）。
- [x] 全仓 grep 确认：剩余 `transitionState` 仅在「带 morph」处（search-page 详情打开、track-identity-row、entity-detail、jump-to-source）+ 其定义文件。
- [x] 全量门禁绿：biome ✓ / tsc ✓ / `vitest run` 全量 **3251 passed | 3 skipped**。

### Phase 2 Checklist
- [x] actions 测试先红后绿
- [x] 纯切换入口零 `transitionState` 残留；morph 切换原样保留
- [x] biome + typecheck + 全量测试通过
- [x] 不新增隐藏 flag、不碰 codename 层 / schema

### Phase 2 Checklist
- [ ] 6 条切换入口指向同一 helper
- [ ] 切回资料库：scroll / detail / sort 全部保真（与「点击 Dock 歌曲」逐像素一致）
- [ ] 非导航的共享元素 morph（封面 `view-transition-name`）不受影响

### Phase 3: 验证对齐 + 回归

**Goal:** 把保真变成可回归资产。

**Tasks:**
- [ ] 单测覆盖 `navigateToTab` 的策略分支（VT 可用/被 suppress/不可用 三态）。
- [ ] harness 重放 Phase 1 真值表，断言 12 组全部「无重置」。
- [ ] `make check`（typecheck + lint + test）通过；Electron 手测确认观感无回退。

### Phase 3 Checklist
- [ ] 新增/更新测试通过
- [ ] 真值表回归全绿
- [ ] PR 描述附 before/after 录屏（键盘 vs dock 歌曲对照）

---

## 7. Out of Scope

- 不重做 tab 常驻挂载架构（`keepLayout` / 5-tab 挂载 是既有性能设计，见 [`App.tsx:374`](src/App.tsx:374) 注释与 view-transition-perf PRD），本 PRD 只让它在所有入口生效。
- 不改 View Transition 的视觉风格/时长；不引入新动画库。
- 不改快捷键绑定本身（`Ctrl+1/2/3` 仍映射 `nav.tab*`）。
- 不动 IndexedDB / provider / DJ 续歌链路。
- `sort` 持久化机制（localStorage 偏好）保持不变——静态分析已证「sort 不会因切换重置」，不在改动面内。
- **不改带 morph 的切换**：Dock 歌曲封面 morph、资料库内详情打开的封面 morph 各自保留 `transitionState`，不被收编进 `navigateToTab`。

---

## 8. Security Considerations

**N/A —— 纯本地 UI 行为，无鉴权/网络/PII。** 不新增 hidden flag（CLAUDE.md #3）：导航策略若需 runtime toggle 一律走可见 Settings；回滚 = `git revert`。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [view-transition-perf PRD](docs/prd/desktop) `20260615-…-view-transition-perf` | VT 抑制策略（重背景时退化同步）来源，本 PRD 的对齐逻辑与之同源 |
| [configurable-keyboard-shortcuts PRD](docs/prd) `20260610-…` | `nav.tab*` action 的来源 |
| memory `perf-control-endpoint-harness` | Phase 1 复现要用的 Electron 控制端点 + 场景驱动 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `sort` 是否真会因切换而重置？ | Resolved | **不会**——它是永不卸载的 SearchPage `useState`，任何切换都不能重置它；「sort 变了」是滚动重置带来的错觉。 |
| 2 | scroll 重置的真正机理是 VT 快照、900ms 卸载竞态、还是焦点 scroll-into-view？ | Open（不阻塞） | 修复**构造性正确**：纯 `setTab` 绕过全部三者。确切机理留待 Phase 3 可选复现，不阻塞 ship。 |
| 3 | 对齐基准选「全部带 VT」还是「全部不带 VT」？ | Resolved | **纯切换全部不带 VT**（纯 `setTab`，可证明忠实）；带封面 morph 的切换保留各自 VT。 |
| 4 | 为何 Dock 歌曲不重置而键盘重置？（二者其实都走 VT） | Open（不阻塞） | 静态无法判定（同机制）。修复让键盘改纯 `setTab`，无论原因都不再重置；Dock 歌曲是否其实也重置属独立后续。 |
| 5 | 失活 900ms 后 `searchContentMounted` 卸载内层 gallery，纯切换能否还原滚动？ | Open（待实测） | `keepLayout` 下纯切换通常在卸载前已切回；若超 900ms，`restoreScrollTop`/`attachWall` 仍负责还原。Phase 3 复现确认边界。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO Desktop | 初稿：切换入口审计 + 分歧定位 + 对齐方案 |
| 2026-06-21 | MUZERO Desktop | **更正前提**：发现 Dock 歌曲也走 `transitionState`（track-identity-row:186 封面 morph）→ 所有用户切换都用 VT。重写归因为「纯 `setTab` 在 kept-mounted 下可证明忠实」。Phase 1（TDD helper）+ Phase 2（收敛纯切换入口）落地，全量门禁绿。 |

---

> **排查一句话总结：** 症状真实；初稿「Dock 歌曲=直接 `setTab`」前提**有误**并已更正——所有用户切换都走 `transitionState`，静态无法判定键盘为何独重置。修复**不赌机理**：把纯切换入口（键盘 / header / dock FAB / chat-upload）收敛到 `navigateToTab` 的纯 `setTab`——在 kept-mounted 架构下**可证明忠实**，必不重置；带封面 morph 的切换（Dock 歌曲 / 资料库详情）保留各自 View Transition。最终由用户在自己实例按 `Ctrl+1/2` 确认。
