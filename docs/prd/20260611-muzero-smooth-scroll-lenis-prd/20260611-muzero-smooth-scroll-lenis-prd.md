# PRD: MUZERO Smooth Scrolling (Lenis · 平滑滚动作为可选项，默认开启 / macOS 默认关闭)

**Status:** Final
**Created:** 2026-06-11
**Author:** MUZERO
**Module:** UX / Scrolling — 引入 [Lenis](https://github.com/darkroomengineering/lenis)（MIT）为歌单列表 / 播放列表 / 歌曲列表 / 专辑页面等可滚动区域提供平滑滚动；作为可见的 Settings 开关，**非 macOS 默认开启、macOS 默认关闭**（触控板本身已平滑），尊重 `prefers-reduced-motion`

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Lenis 依赖 + 纯决策层（`resolveSmoothScroll`）+ 共享 rAF driver | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | `useSmoothScroll(ref)` hook（生命周期 + reduced-motion 响应）+ 程序化滚动路由 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 在范围内的滚动容器接入（虚拟列表 / 卡片栅格 / 各页面） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings「外观」可见开关 + i18n（en/zh/ja/ko）+ 帧节奏/longtask 验收 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 是一个本地优先的 AI DJ 音乐 / 视频播放器，整个 App 就是前端：用户在 `queue` / `search` / `sets` / `set-detail` / `now-playing` / `albums-artists` 等页面里浏览一个可能成千上万首的本地唱片库（[`VirtualTrackList`](../../../src/components/library/virtual-track-list.tsx) / [`VirtualCardGrid`](../../../src/components/library/virtual-card-grid.tsx) 用 TanStack Virtual 虚拟化）。今天所有滚动都是**浏览器原生的瞬时滚动**（[`src/styles.css`](../../../src/styles.css) 里没有任何 `scroll-behavior: smooth`）。

在 Windows / Linux 桌面端（鼠标滚轮 = 离散的「一格一格」delta）和很多外接鼠标上，离散滚轮跳动在长列表 / 专辑页里显得突兀，缺少现代播放器（Apple Music / Spotify / YouTube Music 桌面端）那种顺滑的惯性感。我们希望引入一个**轻量、基于原生 scroll 的平滑滚动层**，把滚轮 delta 用 lerp 平滑成连续动画，提升「逛唱片库」的质感。

**为什么是 Lenis**：Lenis（darkroom.engineering，**MIT**，`1.3.23`，0 运行时依赖）是当前最成熟的 smooth-scroll 库。关键是它**操作原生滚动**（每帧平滑地写 `wrapper.scrollTop`），而不是给内容套 `transform: translate3d` —— 这意味着 `position: sticky`、anchor、可访问性、以及**最重要的：TanStack Virtual 的 scroll 事件**全部继续工作（虚拟化靠监听滚动容器的 `scroll` 事件来更新可见窗口，Lenis 平滑地改 `scrollTop` 会照常触发这些事件）。这与「给 content 套 transform」的旧式 smooth-scroll 不兼容虚拟化截然不同，是本方案可行的根因。

### 1.2 设计约束（来自需求 + CLAUDE.md 硬规则）

1. **作为可选项，默认开启**——但 **macOS 默认关闭**：macOS 触控板的两指滚动本身就是带惯性的平滑滚动，叠一层 Lenis 会「双重平滑」发飘、并和系统惯性打架。所以默认值是**平台相关**的：`!isMac()` → on，`isMac()` → off。
2. **可见的 Settings 控件，不藏 flag**（CLAUDE.md 规则 3 / `feedback_no_hidden_backend_flags`）：开关进 Settings「外观」，用户可随时覆盖平台默认。回滚 = `git revert`，不做 runtime kill switch。
3. **尊重 `prefers-reduced-motion`**：OS 开了减少动态时，无论设置如何都强制原生瞬时滚动（前庭障碍用户安全）。复用现有 [`prefersReducedMotion()`](../../../src/lib/view-transition.ts) / `MotionConfig reducedMotion="user"` 的纪律。
4. **不散落 `if`**（规则 5/6/10 同纪律）：是否平滑、用什么参数，统一由一个**纯函数 [`resolveSmoothScroll`](../../../src/lib/smooth-scroll/resolve.ts)** 裁决；不在各页面里写 `if (isMac())` / `if (settings.smoothScroll)`。
5. **不卡主线程 / 不增 N 个 rAF**：多个滚动容器同时存在（now-playing 左栏、settings 双栏…），不能每个 Lenis 实例各起一个 `requestAnimationFrame`。用**一个模块作用域的共享 rAF driver** 驱动所有活跃实例（规则 6：非响应式单例放模块作用域，不进 store）。
6. **本地优先 / 零遥测**：纯前端 UX，无网络、无新后端、不上报任何东西。

### 1.3 Target Users

| Role | Description | 与本功能关系 |
|------|-------------|-------------|
| **Windows / Linux 桌面用户（鼠标滚轮）** | 用离散滚轮逛长列表 | **主要受益人**：默认开启，滚轮 delta 被平滑成惯性滚动 |
| **macOS 用户（触控板）** | 两指滚动本就平滑 | 默认**关闭**（避免双重平滑）；可在 Settings 手动开启（如外接鼠标） |
| **减少动态 / 无障碍用户** | OS 开启 `prefers-reduced-motion` | 始终原生瞬时滚动，开关被安全覆盖 |
| **移动端用户（iOS/Android）** | 触摸滚动 | **本期不考虑移动端**：保持原生触摸滚动（`syncTouch: false`），只平滑鼠标滚轮（见 §7 / Open Q4） |

### 1.4 Core Value

1. **质感（可调）**：长列表 / 专辑页 / 歌单的滚轮滚动从「一格一格跳」变成连续惯性，向桌面音乐播放器看齐；平滑强度由用户在 Settings 滑杆自定义（飘 ↔ 跟手）。
2. **平台得体**：在 macOS 上不画蛇添足（默认关），在最需要的 Windows/Linux 上默认开，开箱即对。
3. **可控、可访问、可回滚**：可见开关 + reduced-motion 安全网 + `git revert` 回退，零隐藏 flag，符合本地优先纪律。

---

## 2. System Architecture

### 2.1 Architecture Overview

MUZERO **没有单一的 body/html 滚动**：根 `<div>` 与 `<main>` 都是 `overflow-hidden`（[`App.tsx:163,191`](../../../src/App.tsx)），**每个页面各自拥有一个 `overflow-y-auto` 滚动容器**。因此标准的 `<ReactLenis root>`（attach 到 window）**不适用**。正确形态是一个**可复用、按容器 opt-in 的 hook**，由一个共享 rAF driver 统一驱动：

```
                  ┌─────────────────────────────────────────────┐
 AppSettings ─────▶ resolveSmoothScroll(settings, {isMac,        │  纯函数（穷举单测）
 (smoothScroll?)  │   prefersReducedMotion})                     │  → { enabled, options }
                  └───────────────┬─────────────────────────────┘
                                  │ enabled + Lenis options
                                  ▼
   每个滚动容器 ──▶ useSmoothScroll(ref)  ──┐  enabled & mounted → new Lenis({ wrapper:ref,
   (queue / sets /        (React hook)      │                          autoRaf:false, ... })
    search / albums /                       │  disabled / unmount / reduced-motion → destroy()
    now-playing / ...)                      ▼
                                  ┌──────────────────────────────┐
                                  │  lenisDriver (模块作用域单例) │  唯一一个 requestAnimationFrame
                                  │  register(lenis)/unregister   │  循环；Set 非空才跑，空则停
                                  │  raf(t): 遍历调用 lenis.raf(t) │  （不进 Zustand，规则 6）
                                  └──────────────────────────────┘
                                                  │  每帧平滑写 wrapper.scrollTop
                                                  ▼
                          原生 scroll 事件 ──▶ TanStack Virtual 更新可见窗口
                                            （虚拟化照常工作 = 本方案可行的根因）
```

程序化滚动（重置到顶、`scrollToIndex`、`scrollIntoView`）在 Lenis 激活时**必须经由 `lenis.scrollTo(..., { immediate })`**，否则直接写 `scrollTop` 会和 Lenis 的内部 target 失同步导致回弹。

### 2.2 Technology Stack（含 License / 体积，第三方依赖第一公民）

| Component | Technology | License / Size | Rationale |
|-----------|------------|----------------|-----------|
| Smooth scroll core | **`lenis@^1.3.23`** | **MIT** · 0 runtime deps · ~6–7 KB gzip（core） | 基于原生 scrollTop（非 transform）→ 兼容 TanStack Virtual / sticky / a11y；成熟、社区第一 |
| React 绑定 | `lenis/react`（同包 subpath export） | MIT（同包） | 提供 `ReactLenis` / `useLenis`；本方案**主要用 core class** 自建 hook 以精确控制自定义 wrapper + 共享 rAF（见 §2.4 决策） |
| 减少动态 | 复用现有 `window.matchMedia('(prefers-reduced-motion: reduce)')` + `MotionConfig reducedMotion="user"` | — | 不新增依赖 |
| 平台判定 | 复用现有 [`isMac()`](../../../src/lib/shortcuts.ts) | — | 不新增依赖 |
| 设置存储 | 复用 Dexie `settings` 单行 + [`saveSettings`](../../../src/db/repositories.ts) + [`useSettings`](../../../src/hooks/use-app-data.ts) | — | 新增一个 optional bool，无需 DB 版本 bump（§3） |

> **License 四元组**：`source: lenis (npm)` / `spdx: MIT` / `attribution: darkroom.engineering` / `url: https://github.com/darkroomengineering/lenis`。MIT 为 ship-friendly，无需单独 dependency manifest review。
> **Bundle 预算**：Lenis core 约 6–7 KB gzip，远低于「每 cluster < 100 KB gzip」预算。Phase 4 上线前实测一次 `pnpm build` 增量。
> **不引入新 runtime owner**：Lenis 只是被注入的滚动平滑器，不持有应用状态、不替代 TanStack Virtual / motion，不构成「第二套事实来源」。

### 2.3 Project Structure（新增最少文件；其余只改不新建）

```
src/
├── lib/
│   ├── smooth-scroll/                      # 🆕 第三方 lib bridge（唯一允许的新目录）
│   │   ├── resolve.ts                      # 🆕 纯函数 resolveSmoothScroll() —— 唯一决策点（穷举单测）
│   │   ├── resolve.test.ts                 # 🆕 平台默认 × 显式覆盖 × reduced-motion 真值表
│   │   ├── lenis-driver.ts                 # 🆕 共享 rAF 单例 register/unregister/raf（模块作用域，不进 store）
│   │   └── use-smooth-scroll.ts            # 🆕 useSmoothScroll(ref, opts?) hook（生命周期 + 响应式重建）
│   ├── shortcuts.ts                        # ✏️ 复用 isMac()（不改，仅 import）
│   └── view-transition.ts                  # ✏️ 复用 prefersReducedMotion()（不改，仅 import）
├── db/
│   └── types.ts                            # ✏️ AppSettings += smoothScroll?: boolean（§3，无需迁移）
├── hooks/
│   └── use-app-data.ts                     # ✏️ 复用 useSettings()（不改）
├── components/library/
│   ├── virtual-track-list.tsx              # ✏️ 接入 hook + scrollToFn 路由（queue / search / set-detail 共用）
│   └── virtual-card-grid.tsx               # ✏️ 接入 hook + scrollToIndex / 恢复 scrollTop 路由（albums/artists）
├── pages/
│   ├── now-playing-page.tsx                # ✏️ 左栏容器接入 + 切歌重置改走 lenis.scrollTo
│   ├── sessions-page.tsx                   # ✏️ sets 列表容器接入
│   ├── search-page.tsx                     # ✏️ 主滚动容器接入（结果区为虚拟列表，见上）
│   └── settings-page.tsx                   # ✏️ 双栏容器接入 + 「外观」新增开关 UI
├── i18n/locales/{en,zh,ja,ko}/common.json  # ✏️ settings.smoothScroll* 文案（en 为类型源）
└── styles.css                              # ✏️（可选）Lenis 激活态最小 scoped CSS（见 §5.4）
package.json                                # ✏️ + "lenis": "^1.3.23"
```

> **新文件政策**：仅 `src/lib/smooth-scroll/*` 为新增，理由是「第三方 lib bridge」（与 desktop bridge / provider registry 同性质 —— 把 Lenis 概念隔离在一处，不让 `import Lenis` / `if (isMac())` 泄漏进各页面）。所有页面 / 列表 / 设置改动都是**修改既有文件**，符合模板「优先改、不新建」。

### 2.4 关键决策：自建 hook（core class）而非 `<ReactLenis>`

| 选项 | 评估 | 结论 |
|------|------|------|
| `<ReactLenis root>` | attach 到 window/body —— 但 MUZERO root 是 `overflow-hidden`，无 body 滚动 | ❌ 不适用 |
| 每容器一个 `<ReactLenis>`（非 root） | 会注入额外 wrapper+content DOM，破坏现有 `overflow-y-auto / no-scrollbar / chrome-fade / pb-chrome-bottom` 类与布局；且每实例自带 rAF | ❌ 侵入 DOM、多 rAF |
| **`useSmoothScroll(ref)` + core `new Lenis({ wrapper, autoRaf:false })` + 共享 driver** | attach 到**既有**滚动 div，零额外 DOM；统一 reduced-motion / 平台 / 设置门控；单 rAF | ✅ **采用** |

---

## 3. Data Model Design

### 3.1 新增设置字段（单一可选 bool，无需迁移）

`settings` 表 schema 是 `settings: "id"`（按 id 的单行、字段自由形态，见 [`muzero-db.ts:64`](../../../src/db/muzero-db.ts)）。新增**两个可选字段**到 [`AppSettings`](../../../src/db/types.ts)：一个总开关 + 一个用户可自定义的平滑强度参数（Open Q1 决议）：

```ts
// src/db/types.ts — AppSettings 接口内（紧邻 theme/visualizerStyle 等外观字段）
/**
 * 平滑滚动总开关。undefined = 跟随平台默认（!isMac()）。
 * 非 macOS 默认平滑；macOS 触控板本身平滑，默认关闭。受 prefers-reduced-motion 覆盖。
 */
smoothScroll?: boolean;
/**
 * 平滑强度（Lenis lerp）。undefined = 默认 0.10。读取点 clamp 到 [0.04, 0.20]：
 * 越小越「飘/慢」（catch-up 慢），越大越「跟手/snappy」。用户可在 Settings 滑杆调节。
 */
smoothScrollLerp?: number;
```

- **均不写进 `DEFAULT_SETTINGS`**（[`types.ts:604`](../../../src/db/types.ts)）—— 留 `undefined` 表示「未表态、用平台/参数默认」，与现有 `autoFetchLyrics ?? true`、`visualizerAsBackground ?? false` 等「读取点兜底」模式一致。
- **无需 Dexie 版本 bump、无需 `.upgrade()`**：optional 字段，老用户的 settings 行读出来就是 `undefined` → 解析为平台/参数默认；用户一旦在 UI 调整即写入显式值（`saveSettings({ smoothScroll })` / `saveSettings({ smoothScrollLerp })` 合并）。
- **读取点 clamp 防御**：`smoothScrollLerp` 经 `clampLerp()` 收敛到安全区间——任何越界/损坏的存储值都不会让滚动卡死或失控（§3.2）。
- **codename 层不变**（规则 4）：不动表名 / id 前缀 / 既有字段。

### 3.2 决策真值表（`resolveSmoothScroll` 的唯一裁决，穷举单测）

| `settings.smoothScroll` | `isMac()` | `prefersReducedMotion()` | → `enabled` | 备注 |
|---|---|---|---|---|
| `undefined`（未表态） | false（Win/Linux） | false | **true** | 默认开启 |
| `undefined` | **true（macOS）** | false | **false** | macOS 默认关 |
| `undefined` | any | **true** | **false** | a11y 覆盖 |
| `true`（用户显式开） | any | false | **true** | 用户覆盖平台默认（如 macOS 外接鼠标） |
| `true` | any | **true** | **false** | a11y 始终优先 |
| `false`（用户显式关） | any | any | **false** | 用户关闭 |

> `enabled` 与平滑强度 `smoothScrollLerp` 正交：上表只决定「开不开」，开了之后的手感由用户的 lerp 参数经 `clampLerp` 注入 `options.lerp`。

```ts
// src/lib/smooth-scroll/resolve.ts — 纯、可注入、零副作用
import type { AppSettings } from "@/db/types";

export interface SmoothScrollEnv {
  isMac: boolean;
  prefersReducedMotion: boolean;
}
export interface SmoothScrollDecision {
  /** 平台默认（忽略 reduced-motion）—— 供 Settings 开关显示「当前默认态」 */
  preference: boolean;
  /** 实际是否启用 Lenis（已应用 a11y 覆盖） */
  enabled: boolean;
  /** 已注入用户自定义 lerp 的 Lenis 构造选项（见 §4.1） */
  options: LenisInitOptions;
}

/** 平滑强度（lerp）安全区间：越小越「飘/慢」，越大越「跟手/snappy」 */
export const LERP_MIN = 0.04;
export const LERP_MAX = 0.2;
export const LERP_DEFAULT = 0.1;
export function clampLerp(v: number | undefined): number {
  if (typeof v !== "number" || Number.isNaN(v)) return LERP_DEFAULT;
  return Math.min(LERP_MAX, Math.max(LERP_MIN, v));
}

export function resolveSmoothScroll(
  settings: Pick<AppSettings, "smoothScroll" | "smoothScrollLerp">,
  env: SmoothScrollEnv,
): SmoothScrollDecision {
  const preference = settings.smoothScroll ?? !env.isMac;
  const enabled = preference && !env.prefersReducedMotion;
  return {
    preference,
    enabled,
    options: { ...DEFAULT_LENIS_OPTIONS, lerp: clampLerp(settings.smoothScrollLerp) },
  };
}
```

---

## 4. Library Integration & Lenis Configuration

> 本节替代模板的「API Design」：MUZERO 无后端 API，这里定义的是 **Lenis 配置契约 + 程序化滚动路由契约**。

### 4.1 Lenis 构造选项（`DEFAULT_LENIS_OPTIONS`）

每个被 hook 接管的容器以**自身的 `overflow-y-auto` div 作为 `wrapper`**，关闭内部 rAF（交给共享 driver）：

| Option | 取值 | 理由 |
|--------|------|------|
| `wrapper` | `ref.current`（既有滚动 div） | attach 到现有容器，零额外 DOM |
| `content` | `ref.current.firstElementChild ?? ref.current` | 虚拟列表/栅格的内层 sized 容器；缺省回退到 wrapper |
| `autoRaf` | `false` | **关键**：不自带 rAF，由共享 `lenisDriver` 统一 tick |
| `smoothWheel` | `true` | 平滑鼠标滚轮（核心场景） |
| `syncTouch` | `false` | 移动端保持原生触摸滚动（避开 iOS<16 不稳 + 双重惯性） |
| `lerp` | **用户可调**：`clampLerp(settings.smoothScrollLerp)`，默认 `0.10`，区间 `[0.04, 0.20]` | 物理感平滑强度,经 Settings 滑杆开放给用户自定义（Open Q1）；越小越飘、越大越跟手 |
| `wheelMultiplier` | `1` | 不放大 delta，保持系统一致 |
| `orientation` | `'vertical'` | 本期仅纵向；横向 carousel 不在范围 |
| `overscroll` | `true` | 维持 overscroll 行为；与 `styles.css` 的 `overscroll-behavior: none` 不冲突（Lenis 作用于 wrapper 内部） |
| `anchors` | `false` | App 不依赖 hash 锚点导航 |
| `autoResize` | `true` | ResizeObserver 跟随容器/内容尺寸变化（虚拟列表 totalSize 变化必需） |

> `lerp` 一旦设置即覆盖 `duration`/`easing`，采用物理 lerp 平滑。

### 4.2 共享 rAF driver 契约（`lenis-driver.ts`）

```ts
// 模块作用域单例 —— 不进 Zustand（规则 6）。唯一一个 scroll 用 rAF 循环。
const active = new Set<Lenis>();
let frame = 0;
function tick(time: number) {
  for (const lenis of active) lenis.raf(time);   // 一帧驱动所有活跃实例
  frame = active.size > 0 ? requestAnimationFrame(tick) : 0;
}
export function registerLenis(lenis: Lenis) {
  active.add(lenis);
  if (!frame) frame = requestAnimationFrame(tick); // 从 0 → 非空才启动循环
}
export function unregisterLenis(lenis: Lenis) {
  active.delete(lenis);                            // 空了 tick 自然停（frame=0）
}
```

- 集合为空时**完全不跑** rAF（零空转），与现有 visualizer/scrubber/color 的「不可见即暂停」纪律一致。
- 与既有 rAF 循环（[visualizer host](../../../src/visualizer/host.tsx)、progress-scrubber、visualizer-color-store）**互不耦合**，仅多一个用于滚动的共享循环。

### 4.3 程序化滚动路由契约（**正确性关键**）

Lenis 激活时，任何直接写 `scrollTop` / 调 `element.scrollTo` 都会和 Lenis 内部 `targetScroll` 失同步 → 视觉回弹。下列既有调用点必须在「lenis 存在则走 `lenis.scrollTo`，否则原生」之间二选一（由 hook 返回的实例判定）：

| 调用点 | 现状 | 改为 |
|--------|------|------|
| [now-playing 切歌重置](../../../src/pages/now-playing-page.tsx) `sectionRef.scrollTo({top:0})` | 原生 | `lenis ? lenis.scrollTo(0,{immediate:true}) : sectionRef.scrollTo({top:0})` |
| [VirtualTrackList `scrollToIndex`](../../../src/components/library/virtual-track-list.tsx) | 虚拟器内部 `element.scrollTo` | 给 `useVirtualizer` 传 `scrollToFn`：lenis 存在则 `lenis.scrollTo(offset,{immediate:!behavior})` |
| [VirtualCardGrid `scrollToIndex` / 恢复 `scrollTop`](../../../src/components/library/virtual-card-grid.tsx) | 同上 + 直接写 `scrollTop` | 同上路由；恢复位置用 `lenis.scrollTo(top,{immediate:true})` |
| [search-page `scrollIntoView` / `scrollTop=`](../../../src/pages/search-page.tsx) | 原生 | lenis 存在则 `lenis.scrollTo(target,{immediate:true})` |

> hook 暴露的实例放在一个稳定 ref 里，供 `scrollToFn` 闭包读取（避免每次重建虚拟器）。

### 4.4 Error / Edge Cases

- **未挂载 / enabled=false**：hook 不创建实例，返回 `null`，所有路由点回退原生 —— **零行为变化**（安全默认）。
- **运行时切换设置**：`useSettings()` 是 `useLiveQuery`，`smoothScroll` 变化即重跑 hook effect → 创建/销毁实例，无需重载。
- **运行时切 reduced-motion**：用现有 `usePrefersReducedMotion()` 响应式 hook（[`visualizer/host.tsx`](../../../src/visualizer/host.tsx) 已有同款），OS 改偏好即时生效。
- **嵌套原生滚动子区**（下拉/命令面板/lyrics）：这些**不接入** Lenis；若它们落在某个已接管容器内，给其根节点加 `data-lenis-prevent`，让 Lenis 放行原生滚动（不用 `allowNestedScroll`，那有性能代价）。门户渲染的弹层本就在容器外，无需处理。
- **Electron 窗口拖拽**：滚动容器已有 `-webkit-app-region: no-drag`（[`styles.css:209-224`](../../../src/styles.css)），Lenis 不影响。
- **Telemetry / Logging**：本功能**不上报任何遥测**（本地优先、零后端）。如需调试，走 [`src/lib/logger.ts`](../../../src/lib/logger.ts) 的 `debug`（prod 静默），禁止 `console.*`。

---

## 5. Frontend Design

### 5.1 `useSmoothScroll(ref)` hook

```ts
// src/lib/smooth-scroll/use-smooth-scroll.ts （签名示意）
export function useSmoothScroll(
  ref: RefObject<HTMLElement | null>,
  opts?: { contentRef?: RefObject<HTMLElement | null> },
): { lenisRef: RefObject<Lenis | null> } {
  const settings = useSettings();
  const reduced = usePrefersReducedMotion();
  const { enabled, options } = resolveSmoothScroll(settings.smoothScroll, {
    isMac: isMac(),
    prefersReducedMotion: reduced,
  });
  // effect: enabled && ref.current → new Lenis(...) + registerLenis; 清理 unregister + destroy。
  // 依赖 [enabled, ref.current]; 返回稳定 lenisRef 供程序化滚动 / scrollToFn 读取。
}
```

- 单一职责：门控 + 生命周期 + 共享 driver 注册。**所有页面用同一个 hook**，无散落分支。
- 接入即一行：`const { lenisRef } = useSmoothScroll(parentRef);`，再把 `lenisRef` 喂给该容器的程序化滚动点。
- **lerp 变更 = in-place，不重建**：effect 区分两类变化——`enabled` / `wrapper` 变化才 destroy+recreate；**仅 `options.lerp` 变化时直接 `lenisRef.current.options.lerp = newLerp`**（Lenis 每帧读 `options.lerp`，下一帧即生效），保证拖动滑杆时无闪断 / 无丢失滚动位置。若某 Lenis 版本不支持运行时改 lerp，回退为「debounce 后重建」（在 Phase 2 验证）。

### 5.2 接入范围（In Scope）与排除（Out，显式声明，规则「不静默截断」）

| 容器 | 文件 | 接入 | 理由 |
|------|------|------|------|
| 队列（播放列表） | `VirtualTrackList`（queue-page 用） | ✅ | 需求点名「播放列表」 |
| 歌曲列表 / 搜索结果 / 集详情曲目 | `VirtualTrackList`（共用组件） | ✅ | 需求点名「歌曲列表」；一处接入覆盖三处 |
| 专辑 / 歌手栅格 | `VirtualCardGrid` | ✅ | 需求点名「专辑页面」 |
| 歌单（sets）列表 | `sessions-page` | ✅ | 需求点名「歌单列表」 |
| 搜索页主容器 | `search-page` | ✅ | 顶部筛选 + 结果统一平滑 |
| Now Playing 左栏 | `now-playing-page` | ✅ | 长内容列；切歌重置改走 lenis |
| Settings 双栏 | `settings-page` | ✅ | 一致性（左 nav + 右表单各一实例） |
| **下拉 / Select / Command 弹层** | `ui/select`、`ui/command` | ❌ 排除 | 短列表 + `overscroll-contain`，平滑无收益、且是 portal | 
| **同步歌词视图** | `synced-lyrics-view` | ❌ 排除 | 自带 rAF 驱动的自动滚动 + `overscroll-contain`，Lenis 会打架 |
| **记忆时间线 / 检查面板 / 聊天** | `memory-timeline-rail`、`track-inspector-panel`、`chat-turns` | ❌ 排除 | 短内容 / `overscroll-none`，收益低、避免复杂度 |

### 5.3 Settings UI（「外观」新增可见开关）

在 [`settings-page.tsx`](../../../src/pages/settings-page.tsx) 的「外观 / Appearance」分区（`navSecAppearance`，紧邻 Theme / Accent color），加 **(a) 一个总开关 + (b) 一个平滑强度滑杆**。开关复用既有 `changeAutoFetchLyrics` 同款 toggle 模式；滑杆复用本仓库已有的 `react-aria-components` Slider（与 Accent color picker 同库）：

```tsx
// 文案 + checked 态（preference 来自 resolveSmoothScroll，已含平台默认）
const { preference } = resolveSmoothScroll(settings, {
  isMac: isMac(), prefersReducedMotion: false /* 显示「设置态」，不混入 a11y */,
});

// (a) 总开关
// <Toggle checked={preference} onCheckedChange={(v)=>saveSettings({ smoothScroll: v })} />
//   label   = t("settings.smoothScroll")
//   hint    = isMac() ? t("settings.smoothScrollHintMac") : t("settings.smoothScrollHint")
//   reduced-motion 激活时附 t("settings.smoothScrollReducedMotion") 说明当前被 OS 覆盖

// (b) 平滑强度滑杆（仅在 preference === true 时可用；否则 disabled/灰显）
const lerp = clampLerp(settings.smoothScrollLerp); // 默认 0.10
// <Slider min={LERP_MIN} max={LERP_MAX} step={0.02} value={lerp}
//         isDisabled={!preference}
//         onChange={(v)=>saveSettings({ smoothScrollLerp: v })} />
//   label       = t("settings.smoothScrollStrength")
//   endpoints   = t("settings.smoothScrollFloaty") ↔ t("settings.smoothScrollSnappy")  // 飘 ↔ 跟手
//   hint        = t("settings.smoothScrollStrengthHint")
//   resetButton = saveSettings({ smoothScrollLerp: LERP_DEFAULT })   // 「恢复默认」
```

- **滑杆语义**：滑杆值即 Lenis `lerp`（左 `0.04` = 更飘/更慢，右 `0.20` = 更跟手/snappy），默认 `0.10`。步进 `0.02`，避免过细。提供「恢复默认」。
- **滑杆改动走 in-place 更新、不重建实例**：见 §5.1——拖动滑杆只 mutate 现有 Lenis 实例的 `options.lerp`，不 destroy/recreate（拖动期间流畅、无闪断）。
- **联动 disable**：总开关关闭（或 reduced-motion 覆盖）时滑杆灰显，强化「先开才调」的因果。
- **可解释**：hint 文案说明「macOS 触控板已平滑，默认关闭」「减少动态时已被系统覆盖」「强度越低越飘、越高越跟手」，避免用户困惑于平台相关默认与参数含义。

### 5.4 CSS（最小化）

- 不引入 Lenis 官方 `lenis.css`（它针对 `html.lenis` root 场景）。我们的容器已是 `overflow-y-auto`、未设 `scroll-behavior: smooth`（无冲突）。
- 仅在需要时加 **scoped** 兜底：确保接管容器 `scroll-behavior: auto`（防未来误加 smooth），并保留 `no-scrollbar` 视觉。Lenis 会给 wrapper 加 `lenis lenis-smooth lenis-scrolling/​lenis-stopped` 类，可按需挂样式。

### 5.5 State Management

- **持久状态**：`AppSettings.smoothScroll`（总开关）+ `AppSettings.smoothScrollLerp`（平滑强度）—— 均 Dexie 单行，`useLiveQuery` 响应。
- **非响应式单例**：`lenisDriver` 的 active set + frame id 在模块作用域（不进 Zustand，规则 6）。
- 各容器的 Lenis 实例由 hook 持有于 ref，不入任何 store，不触发重渲染。

---

## 6. Implementation Plan

### Phase 1: 依赖 + 纯决策层 + 共享 driver

**Goal:** 把「是否平滑 / 用什么参数 / 怎么统一 tick」的地基打好，全部可单测，零 UI 改动。

**Tasks:**
- [ ] `pnpm add lenis@^1.3.23`；确认 0 运行时依赖、`lenis/react` subpath 可用。
- [ ] 新建 `src/lib/smooth-scroll/resolve.ts`：`resolveSmoothScroll` + `clampLerp` + `LERP_MIN/MAX/DEFAULT` + `DEFAULT_LENIS_OPTIONS` + 类型。
- [ ] 新建 `src/lib/smooth-scroll/lenis-driver.ts`：`registerLenis` / `unregisterLenis` + 单 rAF tick（空集即停）。
- [ ] `AppSettings` += `smoothScroll?: boolean` + `smoothScrollLerp?: number`（注释说明语义；均不进 `DEFAULT_SETTINGS`）。

#### Phase 1 Checklist
- [x] `resolve.test.ts` 覆盖 §3.2 真值表全 6 行（平台默认 × 显式覆盖 × reduced-motion）。
- [x] `clampLerp` 单测：`undefined`/`NaN`→0.10；越界（0 / 1 / 负数）收敛到 `[0.04, 0.20]`；区间内原样返回；`options.lerp` 正确注入。
- [x] driver 单测：register→rAF 启动；unregister 到空→停；多实例同帧均被 `raf(t)`（注入假 Lenis + 假 rAF）。**17 tests passed**（[`resolve.test.ts`](../../../src/lib/smooth-scroll/resolve.test.ts) + [`lenis-driver.test.ts`](../../../src/lib/smooth-scroll/lenis-driver.test.ts)）。
- [x] 体积增量实测：**Lenis core ~7.7 KB gzip**（`node_modules/lenis/dist/lenis.mjs`），远低于 < 100 KB/cluster 预算。
- [x] 全项目 `tsc --noEmit` 通过 + 新文件 biome 通过；无 `console.*`、无散落 `if (isMac())`（唯一决策点是注入 `env.isMac` 的 `resolveSmoothScroll`）。

### Phase 2: `useSmoothScroll` hook + 程序化滚动路由

**Goal:** 一个可复用 hook 封装生命周期与 a11y/设置响应；建立程序化滚动「走 lenis 还是原生」的统一路由。

**Tasks:**
- [ ] 新建 `use-smooth-scroll.ts`：读 `useSettings()` + `usePrefersReducedMotion()` → `resolveSmoothScroll`；enabled 时 `new Lenis({wrapper, autoRaf:false, ...})` + register，cleanup destroy + unregister；返回稳定 `lenisRef`。
- [ ] 设置变更 / reduced-motion 变更 / 容器挂卸载时正确重建或销毁（effect 依赖正确，无泄漏）。
- [ ] **lerp 变更走 in-place**：仅改 `lenisRef.current.options.lerp`，不 destroy/recreate；验证 Lenis 运行时改 lerp 即帧生效，否则回退 debounce 重建（§5.1）。
- [ ] 定义程序化滚动 helper：`scrollToWith(lenisRef, target, { immediate })`（lenis 存在走 Lenis，否则原生）。

#### Phase 2 Checklist
- [ ] hook 单测（jsdom + 假 Lenis）：enabled=false 不创建、返回 null；enabled=true 创建并 register；卸载 destroy+unregister。
- [ ] 切 `smoothScroll` 设置即时创建/销毁；切 reduced-motion 即时销毁/恢复；改 `smoothScrollLerp` 走 in-place、实例不重建（断言 destroy 未被调用）。
- [ ] 多容器同时挂载 → driver 中有多个实例、单 rAF 驱动（集成断言）。
- [ ] `make check` 通过。

### Phase 3: 容器接入（虚拟列表 / 栅格 / 各页面）

**Goal:** 把 §5.2 In-Scope 容器逐个接入，程序化滚动点全部路由到 lenis，虚拟化不回归。

**Tasks:**
- [ ] `VirtualTrackList`：`useSmoothScroll(parentRef)`；`useVirtualizer` 传 `scrollToFn`（lenis 优先）；`scrollToIndex` 路径验证（queue / search / set-detail 三处共用）。
- [ ] `VirtualCardGrid`：接入 + `scrollToIndex` / 恢复 `scrollTop` 路由（albums/artists）。
- [ ] `now-playing-page` 左栏接入 + 切歌重置改 `lenis.scrollTo(0,{immediate:true})`。
- [ ] `sessions-page` / `search-page` / `settings-page`（双栏各一实例）接入。
- [ ] 排除清单容器（select/command/lyrics/timeline/inspector/chat）**保持原生**；必要处加 `data-lenis-prevent`。

#### Phase 3 Checklist
- [ ] 虚拟化回归：长列表（≥1000 行）平滑滚动时可见窗口正确更新，无空白/错位（[`virtual-track-list.test.tsx`](../../../src/components/library/virtual-track-list.test.tsx) 既有断言不破）。
- [ ] `scrollToIndex`（跳到当前播放/搜索结果）平滑/即时表现正确，无回弹。
- [ ] macOS（默认关）下行为与今天完全一致；Win/Linux（默认开）滚轮平滑。
- [ ] 接入与排除清单与 §5.2 一致（无静默漏接 / 误接）。

### Phase 4: Settings 开关 + i18n + 性能验收

**Goal:** 暴露可见开关、四语文案齐全、用「帧节奏 + longtask」证明无卡顿（性能 PRD 纪律）。

**Tasks:**
- [ ] `settings-page` 「外观」新增 (a) Smooth scrolling 开关（checked = `preference`，写 `saveSettings({smoothScroll})`）+ macOS / reduced-motion hint；(b) 平滑强度滑杆（`min/max/step = LERP_MIN/LERP_MAX/0.02`，写 `saveSettings({smoothScrollLerp})`，开关关时灰显，含「恢复默认」）。
- [ ] i18n：en 先加 `settings.smoothScroll` / `smoothScrollHint` / `smoothScrollHintMac` / `smoothScrollReducedMotion` / `smoothScrollStrength` / `smoothScrollStrengthHint` / `smoothScrollFloaty` / `smoothScrollSnappy`，再补 zh/ja/ko。
- [ ] 性能验收（见 §6 验收方法学）：prod build 下采帧节奏 + Long Tasks before/after。

#### Phase 4 Checklist
- [ ] 四语 catalog 均含全部新键（含强度滑杆 4 键），`t()` 类型通过；UI 无内联硬编码字符串。
- [ ] 滑杆 end-to-end：拖动即时改变手感（in-place，不闪断）、写库、`useLiveQuery` 回流；「恢复默认」回到 0.10；总开关关闭时滑杆灰显。
- [ ] **prod build**（`make build` + Electron / `make dev` prod-like）下，开启平滑滚动滚动长列表：`frame p99` / `frame max` / `longtask max` 不显著劣于关闭态（无新增 ≥50ms 长任务）。
- [ ] `prefers-reduced-motion` 开启时强制原生，开关显示被覆盖说明。
- [ ] `pnpm build` 最终体积增量 < 100 KB gzip（实测记录）。
- [ ] `make check` 通过；Status → Completed。

> **验收方法学（性能 / realtime 类 PRD 纪律）**：区分「渲染耗时」与「呈现帧节奏」。Pixi/canvas 无 `<video>`，用 `requestAnimationFrame` 回退测真实合成帧间隔；用 `PerformanceObserver({entryTypes:["longtask"]})` 记录 ≥50ms 主线程停顿。**dev mode（StrictMode+HMR+sourcemap）不作数**，必须 prod build 复测、第二轮（避开首次 warmup）。Lenis 本身不分配每帧大对象，主要风险是虚拟列表在高频 scroll 事件下的重渲染 —— 验收即证伪此项。

---

## 7. Out of Scope

- **横向平滑滚动 / carousel**：本期仅 `orientation: 'vertical'`。
- **移动端（iOS/Android）**：**暂不考虑**（Open Q4 决议）。`syncTouch: false`，保持原生触摸滚动；iOS<16 不稳 + 双重惯性。移动端打磨阶段再单独评估。
- **scroll-snap / 滚动联动动画 / parallax / scroll-linked 视差**：Lenis 仅做平滑，不引入滚动驱动动画。
- **`lenis/snap` 插件**、anchor 平滑导航：App 无 hash 锚点导航需求。
- **排除清单容器**（select / command / synced-lyrics / memory-timeline / track-inspector / chat）：保持原生滚动（§5.2）。
- **per-surface（每页/每列表）独立平滑参数**：平滑强度是**单一全局参数**（Settings 一个滑杆，所有容器共用），不做按页面/列表分别调参的 UI。
- **缓动曲线 / `duration` / `easing` 自定义**：仅开放 `lerp`（物理平滑强度）一个旋钮；不暴露 easing 函数或 duration 模式选择。
- **遥测 / A/B**：本地优先零后端，不上报、不做实验框架。

---

## 8. Security / Privacy Considerations

- **无网络 / 无后端 / 无遥测**：纯前端 UX 改动，不发任何出站请求、不上报任何用户数据，完全符合本地优先（CLAUDE.md 规则 1）。
- **无密钥 / 无 PII**：不触碰 settings 中的 BYOK key，不读写媒体内容。
- **License 合规**：Lenis = **MIT**（darkroom.engineering），ship-friendly；在 `package.json` 依赖与（如维护）`THIRD-PARTY-LICENSES` 中体现 attribution。
- **无隐藏 flag**：唯一开关在可见 Settings；回滚 = `git revert` 注册条目 + redeploy，不做 runtime kill switch（规则 3）。
- **可访问性**：`prefers-reduced-motion` 始终覆盖，保护前庭障碍用户。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Lenis 仓库](https://github.com/darkroomengineering/lenis) | 上游库（MIT），option 语义与 `lenis/react` API |
| [`src/db/types.ts`](../../../src/db/types.ts) | `AppSettings` / `DEFAULT_SETTINGS`（新增 `smoothScroll?`） |
| [`src/components/library/virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx) | 主虚拟列表（queue/search/set-detail 共用），程序化 `scrollToIndex` |
| [`src/components/library/virtual-card-grid.tsx`](../../../src/components/library/virtual-card-grid.tsx) | 专辑/歌手栅格虚拟器 |
| [`src/pages/settings-page.tsx`](../../../src/pages/settings-page.tsx) | 「外观」分区，新增开关 |
| [`src/lib/shortcuts.ts`](../../../src/lib/shortcuts.ts) | `isMac()` 平台判定（复用） |
| [`src/lib/view-transition.ts`](../../../src/lib/view-transition.ts) | `prefersReducedMotion()`（复用） |
| [20260610 multilingual-transliteration-search PRD](../20260610-muzero-multilingual-transliteration-search-prd/20260610-muzero-multilingual-transliteration-search-prd.md) | 同类「纯函数地基 + 单测先行 + 4 语 i18n」范式参考 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `lerp` 是否固定？ | **Resolved** | **开放给用户自定义**：Settings 一个「平滑强度」滑杆，`smoothScrollLerp ∈ [0.04, 0.20]`，默认 0.10，in-place 生效，可恢复默认 |
| 2 | Settings 开关在 macOS 上初始显示「关」，是否需额外引导文案避免用户以为坏了？ | Resolved | 用 `smoothScrollHintMac` 解释「触控板已平滑，默认关闭，可手动开启」 |
| 3 | 是否给排除清单里的某些容器（如 sessions 卡片）也接 Lenis？ | Resolved | 否——按 §5.2，短/特殊容器保持原生，避免双重惯性与复杂度 |
| 4 | 是否考虑移动端（触摸 `syncTouch`）？ | **Resolved** | **暂不考虑移动端**；保持原生触摸滚动，仅平滑桌面鼠标滚轮。移动端打磨阶段再单独评估 |
| 5 | 是否需要给虚拟列表的 `scrollToFn` 在 lenis 切换时强制重建虚拟器？ | Resolved | 否——`scrollToFn` 读稳定 `lenisRef`，运行时无需重建 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-11 | MUZERO | Initial PRD：Lenis 平滑滚动，可见开关、非 macOS 默认开 / macOS 默认关、reduced-motion 覆盖；可复用 hook + 共享 rAF driver + 纯决策函数；4 phase（地基→hook→接入→开关与性能验收） |
| 2026-06-11 | MUZERO | Open Q 决议并入：Q1 → 平滑强度（lerp）开放为用户自定义滑杆（`smoothScrollLerp ∈ [0.04,0.20]`，默认 0.10，clamp + in-place 生效 + 恢复默认）；Q4 → 暂不考虑移动端。相应更新数据模型 / `resolveSmoothScroll` 签名 / Lenis 配置 / Settings UI / 各 Phase 与 Out-of-Scope |

---

> **Note:** 本 PRD 遵循「优先改既有文件、最少新增」：唯一新增目录 `src/lib/smooth-scroll/` 作为第三方 lib bridge（隔离 Lenis 概念，类比 desktop bridge / provider registry）。是否平滑、参数、平台默认、a11y 覆盖全部收敛到单一纯函数 `resolveSmoothScroll`，不在 UI/页面散落 `if`。
