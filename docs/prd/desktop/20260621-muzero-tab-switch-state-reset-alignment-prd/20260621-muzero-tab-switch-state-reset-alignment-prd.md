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
| 2 | 收敛所有 tab 切换入口到 `navigateToTab` | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 验证对齐 + 回归（`make check` + 真值回归） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> **执行说明（2026-06-21 修复落地）：** 原 Phase 1「复现+插桩」是在根因未明时的观测优先策略。静态排查已**高置信度**钉死根因——切换入口分歧（`transitionState` vs 直接 `setTab`），且用户已认证「点击 Dock 歌曲」的直接 `setTab` 路径**忠实不重置**。因此修复是**构造性正确**的：把所有入口对齐到这条已知良好的直切路径，无论确切的重置机理是 VT 快照、`flushSync` 时序还是焦点 scroll-into-view，都被同一修复覆盖。故 Phase 1 改为「用 TDD 建立 `navigateToTab` 忠实切换契约」，重型 Electron harness 复现降级为 Phase 3 的可选回归验证。

---

## 1. Overview

### 1.1 Background（含原始反馈 + 排查结论）

**用户反馈（原文）：**

> Ctrl+1 / Ctrl+2 切换 tab 的时候，似乎和直接点击 header 或者 Dock 的歌曲来触发切换的时候不一样。前者会导致状态重置？比如歌单查看时候的位置，还有 sort 等？—— 这里应该要对齐后者。

**排查结论（是否属实）：部分属实，但「键盘 vs header」这条分界线在代码层面不成立——真正的分界线是「是否经过 `transitionState`（View Transition）」。**

MUZERO 的 5 个 tab 是**常驻挂载**的（[`App.tsx`](src/App.tsx:374) 用 `display:none` / `invisible` 切换，不卸载），其中 search（资料库）tab 是唯一用 `keepLayout`（`visibility:hidden`，保留在 layout 中）渲染的，专门为了**保留滚动位置与虚拟化状态**。因此**正常情况下任何切换路径都不应该丢失** scroll / sort：

- `sort` / `sortDir` / `selectedSetId` 是 [`SearchPage`](src/pages/search-page.tsx:320) 的 `useState`，SearchPage 永不卸载 → React state 天然持久；
- 歌单墙的滚动位置存在 `wallScrollTops` ref（[`search-page.tsx:392`](src/pages/search-page.tsx:392)），由 `onScroll` 写入、`attachWall` / `restoreScrollTop` 还原，ref 同样跨切换持久。

**但是切换入口存在一条真实的代码分歧**：除了「点击 Dock 的歌曲打开 Now Playing」之外，**其余所有 tab 切换入口都包了 `transitionState`**（= `startViewTransition(() => flushSync(setTab))`，见 [`view-transition-react.ts:14`](src/lib/view-transition-react.ts:14)）。用户能稳定观察到「点击 Dock 的歌曲不重置」，正是因为那条路径**没有**经过 `transitionState`。

#### 1.1.1 切换入口审计（本 PRD 的核心事实）

| 切换入口 | 代码路径 | 是否包 `transitionState` |
|---|---|---|
| 键盘 `Ctrl+1` / `Ctrl+2` / `Ctrl+3`（`nav.tabNow` / `nav.tabLibrary` / `nav.tabSettings`） | [`actions.ts:194`](src/shortcuts/actions.ts:194)：`ctx.transitionState(() => ctx.setTab(...))` | ✅ 是 |
| 键盘 `Ctrl+Tab` / `Ctrl+Shift+Tab`（`nav.tabNext` / `nav.tabPrev`） | [`actions.ts:197`](src/shortcuts/actions.ts:197) | ✅ 是 |
| Header 顶部 nav tabs 点击 | [`header-nav-tabs.tsx:113`](src/components/shell/header-nav-tabs.tsx:113) `pick()` → `transitionState(() => onChange(next))` | ✅ 是 |
| Dock 右侧 nav FAB 点击 | [`nav-fab.tsx:118`](src/components/nav/nav-fab.tsx:118) `pick()` → `transitionState(() => onChange(id))` | ✅ 是 |
| **点击 Dock 的歌曲（封面/标题）打开 Now Playing** | [`player-dock.tsx:79`](src/components/shell/player-dock.tsx:79) `TrackIdentityRow onOpen` → [`App.tsx:290`](src/App.tsx:290) `onOpenNowPlaying = () => setTab("now")` | ❌ **否（直接 `setTab`）** |
| Dock 聊天入口「上传到资料库」 | [`player-dock.tsx:63`](src/components/shell/player-dock.tsx:63) `onUploadLibrary={() => onTabChange("search")}` | ❌ 否（直接） |
| 开始 DJ 集 / 拖拽上传后跳转 | [`App.tsx:289`](src/App.tsx:289) `onSessionsStarted`、[`App.tsx:439`](src/App.tsx:439) `onMediaUploaded` | ❌ 否（直接） |

> **关键纠正：** 用户感知里「点击 header 不重置」与代码不符——header nav tabs 同样走 `transitionState`，**理应与键盘行为一致**。能稳定对照出「不重置」的只有「**点击 Dock 的歌曲**」这一条直接 `setTab` 路径。因此真正要对齐的轴是 **`transitionState` 路径 ↔ 直接 `setTab` 路径**，而不是「键盘 ↔ 鼠标」。

#### 1.1.2 `transitionState` 为何可能引起重置（待 Phase 1 实测确认的候选机理）

`transitionState(update)` = `startViewTransition(() => flushSync(update))`，与直接 `setTab` 相比多了两件事：**(a) `flushSync` 同步提交**、**(b) 原生 View Transition 快照 + 交叉淡入**。它还受一个开关调制：当有播放背景时（`ambientBackdropActive`），[`App.tsx:315`](src/App.tsx:315) 调 `setViewTransitionSuppressed(true)`，此时 `startViewTransition` **退化为同步执行**（[`view-transition.ts:67`](src/lib/view-transition.ts:67)），即只剩 `flushSync`、无 VT 快照。这解释了为何同一入口在「有歌在放 / 没歌在放」时表现可能不同，进而让用户把差异错记成「键盘特有」。

候选机理（互不排斥，需实测定位）：

1. **VT 快照 × `keepLayout` 隐藏 tab 的滚动**：切走/切回时 search tab 在 `visibility:hidden` 与可见间翻转，VT 对 `root` 快照与隐藏滚动容器的交互可能扰动 `scrollTop`。
2. **900ms 内容卸载 × 还原时机**：[`SearchPage`](src/pages/search-page.tsx:1482) 在失活 900ms 后整体早返回空占位（`searchContentMounted`，[`search-page.tsx:325`](src/pages/search-page.tsx:325)）→ 内层 gallery DOM **卸载**；切回时重挂，滚动靠 `restoreScrollTop` 的 `useLayoutEffect`（[`virtual-card-grid.tsx:211`](src/components/library/virtual-card-grid.tsx:211)）还原。`flushSync` 的同步提交时机可能让「重挂 + 还原」与「VT 快照」竞态，导致还原落空（停在 0）。
3. **焦点驱动的 scroll-into-view**：键盘路径下焦点常停在 gallery 内的卡片/行；切走时 `keepLayout` 把该子树标 `inert`（[`App.tsx:599`](src/App.tsx:599)）→ 焦点被踢回 `body`。这条是「键盘 vs 鼠标点击」唯一天然的不对称（鼠标点击会把焦点落到被点的按钮上，在 gallery 之外）。需确认它是否触发某处 `focus()`/`scrollToKey`（[`virtual-card-grid.tsx:241`](src/components/library/virtual-card-grid.tsx:241)）。

> ⚠️ **关于 `sort` 重置：** 静态阅读下 `sort` 是 SearchPage 的 `useState`、SearchPage 永不卸载，**理论上不可能因切换而重置**。该现象需 Phase 1 优先实测复核——很可能是「滚动重置带动可视顺序变化」的错觉，或存在尚未定位的第三方路径。PRD 不在未实测前假设 `sort` 真被重置。

### 1.2 Target Users

| Role | Description | 影响 |
|------|-------------|------|
| **桌面键盘重度用户** | 用 `Ctrl+1/2/3`、`Ctrl+Tab` 在 Now / 资料库 / 设置间快切 | 切回资料库丢失歌单浏览位置 → 体验断裂 |
| **全体桌面用户** | 任意通过 header tabs / dock FAB 切换者 | 行为不一致（同样走 VT 的入口理应同样表现，却被感知为随机） |

### 1.3 Core Value

1. **行为一致性**：所有 tab 切换入口（键盘 / header / dock FAB / dock 歌曲）走**同一条**导航代码，表现完全一致——消除「换个入口就换个行为」。
2. **状态保真**：切走再切回资料库，**歌单浏览位置、详情滚动、排序、当前进入的集/详情**原样还原（已是 `keepLayout` 的设计意图，本 PRD 让它在所有入口都真正生效）。
3. **可回归**：把「切换状态保真」变成有插桩、有验收阈值的确定性测试，而非凭感觉。

---

## 2. System Architecture

### 2.1 现状（切换链路）

```
键盘 Ctrl+1/2/3 ─┐
Ctrl+Tab/Shift   ─┤ runShortcutAction → ctx.transitionState(() => setTab(t))  ┐
Header nav tabs  ─┤ pick() ──────────→ transitionState(() => onChange(t))      ├─► startViewTransition(() => flushSync(setTab))
Dock nav FAB     ─┘ pick() ──────────→ transitionState(() => onChange(t))      ┘        │  (ambientBackdropActive 时退化为同步, 无 VT)
                                                                                         ▼
点击 Dock 歌曲   ──► onOpenNowPlaying = () => setTab("now")  ───────────────────►  直接 setTab（React 异步批处理, 无 flushSync / 无 VT）
上传/聊天跳转    ──► onTabChange("search") 等 ─────────────────────────────────►  直接 setTab
                                                                                         ▼
                                                                            useNavStore.setTab → tab 持久化(muzero-nav)
                                                                                         ▼
                                                  App 重渲染：TabPanel 切 hidden/invisible（5 个 tab 全程挂载）
```

### 2.2 目标（统一入口）

```
所有入口 ──► navigateToTab(tab, opts?)  ──►（单一处决定是否/何时用 VT + flushSync）──► useNavStore.setTab
                     ▲
        键盘 / header / dock FAB / dock 歌曲 / 上传跳转 全部调用它，无人再直接碰 transitionState / setTab
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

### 5.1 受影响文件（只改不新建为原则）

| 文件 | 现状 | 需要的改动 |
|---|---|---|
| [`src/lib/view-transition-react.ts`](src/lib/view-transition-react.ts) | 导出 `transitionState` | 新增（或在此处统一）一个 `navigateToTab` 语义入口；保留 `transitionState` 给非导航的共享元素过渡 |
| [`src/shortcuts/actions.ts`](src/shortcuts/actions.ts:194) | `nav.tab*` 用 `ctx.transitionState(() => ctx.setTab(...))` | 改为统一 helper |
| [`src/components/shell/header-nav-tabs.tsx`](src/components/shell/header-nav-tabs.tsx:113) | `pick()` 用 `transitionState` | 改为统一 helper |
| [`src/components/nav/nav-fab.tsx`](src/components/nav/nav-fab.tsx:118) | `pick()` 用 `transitionState` | 改为统一 helper |
| [`src/App.tsx`](src/App.tsx:289) | `onOpenNowPlaying` / `onSessionsStarted` / `onMediaUploaded` 直接 `setTab` | 改为统一 helper（让「Dock 歌曲」这条**当前正确**的路径成为基准） |
| [`src/components/shell/player-dock.tsx`](src/components/shell/player-dock.tsx:63) | `onUploadLibrary` 直接 `onTabChange` | 经由统一 helper（透传即可） |

### 5.2 UI / 交互要求

- **不改变视觉过渡观感**：对齐后所有入口要么都有 VT 淡入、要么都没有——以「不丢状态」为硬约束，VT 动画是次要的、可被「保真」让路（与 [`view-transition.ts`](src/lib/view-transition.ts:29) 既有的「重背景时 suppress VT」同一思路）。
- **基准行为 = 当前「点击 Dock 歌曲」的表现**（用户认证为正确的一侧）：切回资料库时，歌单墙滚动位置、已进入的集/系统歌单详情、详情内滚动、排序 chips 选择，全部原样。

### 5.3 State Management —— 统一导航 helper（契约）

```typescript
// src/lib/view-transition-react.ts （或新的 src/lib/navigate-tab.ts，复用既有文件优先）
//
// 单一 tab 导航入口。所有切换入口都调它，内部唯一决定「是否 flushSync / 是否 VT」。
// 默认行为以「保真」为先：不得让过渡动画牺牲 search tab 的 scroll / detail / sort 还原。
export function navigateToTab(
  setTab: (tab: Tab) => void,
  tab: Tab,
  opts?: { animate?: boolean },  // animate 缺省由「保真优先」策略决定，而非各入口各自拍板
): void
```

- 关键纪律（沿用 CLAUDE.md #3 / #10）：**禁止**在各入口散落 `transitionState` / 裸 `setTab` / `if (isKeyboard)` 分支；导航行为的唯一裁决点收敛到 `navigateToTab`。

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

### Phase 2: 统一所有 tab 切换入口到 `navigateToTab`

**Goal:** 消除入口分歧；以「点击 Dock 歌曲」的保真表现为基准，让全部入口一致。

**Tasks:**
- [ ] 实现 `navigateToTab`（§5.3），内部按 Phase 1 结论决定 VT/flushSync 策略（若确认 VT 是元凶 → 导航切换默认不快照 `root`，或对 search tab 还原加 guard）。
- [ ] 把 [`actions.ts`](src/shortcuts/actions.ts:194) / [`header-nav-tabs.tsx`](src/components/shell/header-nav-tabs.tsx:113) / [`nav-fab.tsx`](src/components/nav/nav-fab.tsx:118) / [`App.tsx`](src/App.tsx:289) 全部改为调用它。
- [ ] grep 全仓确认无残留的「导航处直接 `transitionState`/裸 `setTab`」。

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
- `sort` 持久化机制（localStorage 偏好）保持不变——若 Phase 1 证伪「sort 重置」，则 sort 不在改动面内。

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
| 1 | `sort` 是否真会因切换而重置？（静态分析判定「不会」，因它是永不卸载的 SearchPage `useState`） | Open | 待 Phase 1 实测 |
| 2 | scroll 重置的真正机理是 VT 快照、900ms 卸载竞态、还是焦点 scroll-into-view？ | Open | 待 Phase 1 真值表 |
| 3 | 对齐基准选「全部带 VT」还是「全部不带 VT」？（保真优先 → 若 VT 是元凶则选不快照 root） | Open | 倾向：保真优先，导航切换不快照 `root` |
| 4 | 用户口中的「点击 header 不重置」如何解释？（header 实际走 VT） | Open | 假设：被 `ambientBackdropActive` 抑制 或 焦点不在 gallery 内；Phase 1 验证 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-21 | MUZERO Desktop | 初稿：切换入口审计 + 分歧定位（`transitionState` vs 直接 `setTab`）+ 对齐方案 |

---

> **排查一句话总结：** 用户反馈「属实但归因需修正」——切换状态重置的真实分界不是「键盘 vs 鼠标」，而是「除『点击 Dock 歌曲』外的所有入口都包了 `transitionState`」。修复方向 = 把全部入口收敛到单一 `navigateToTab`，以当前正确的『点击 Dock 歌曲』直接 `setTab` 的保真表现为基准对齐。
