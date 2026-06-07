# PRD: MUZERO — 幻灯片轮播设置（切换间隔 + 顺序/随机）

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** Now-Playing 背景幻灯片 —— 让**切换间隔**与**顺序（顺序 / 随机）**可在 Settings 配置

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | `nextSlideIndex` 纯函数（顺序 / 随机不连续重复，TDD） | ✅ Completed | [§4](#phase-1-nextslideindex-纯函数tdd) |
| 2 | 设置字段 + 轮播接线 + UI + 文案 | ✅ Completed | [§4](#phase-2-设置字段--轮播接线--ui--文案) |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 的幻灯片当前用**固定** `SLIDE_INTERVAL_MS = 7000` **顺序**前进（`(i + 1) % len`），用户无法配置。用户要：**多久切一次**（几秒～几分钟）、**顺序还是随机**。

### 1.2 Core Value

- **可调节奏**：从几秒到几分钟，契合「背景幻灯片」从活泼到安静的不同氛围。
- **顺序 / 随机**：随机不连续重复同一张，避免呆板。
- **纯函数可测**：切换决策抽成注入 `rand` 的纯函数，确定性单测覆盖随机分支。

---

## 2. 方案

### 2.1 新增 settings（[`db/types.ts`](../../../src/db/types.ts) `AppSettings`）

| 字段 | 类型 | 默认 | 含义 |
|---|---|---|---|
| `backgroundSlideshowIntervalSec` | `number` | `300` | 切换间隔（秒）。预设 5/10/15/30/60/120/180/300/600（**默认 5 分钟**）|
| `backgroundSlideshowShuffle` | `boolean` | `true` | true=随机、false=顺序（**默认随机**）|

> 默认 **5 分钟切换 + 随机**（用户指定）。旧硬编码为 7s 顺序。

### 2.2 纯函数 [`slideshow.ts`](../../../src/lib/slideshow.ts) `nextSlideIndex`

```ts
nextSlideIndex(current: number, length: number, shuffle: boolean, rand = Math.random): number
```
- `length <= 1` → `0`。
- 顺序：`(current + 1) % length`。
- 随机：在**除当前帧外**的 `length-1` 个下标里均匀取一个（`floor(rand()*(len-1))`，`>= cur` 时 +1 跳过当前）——**不连续重复**。`current` 越界先归一。
- 放在**新文件** `slideshow.ts`（不动并行在编辑的 `background.ts`），注入 `rand` 以确定性单测随机分支。

### 2.3 接线 + UI

- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx)：`intervalSec`/`shuffle` 读 settings；timer 用 `intervalSec*1000`；advance 用 `nextSlideIndex(i, len, shuffle)`；effect deps 加 `intervalSec`/`shuffle`。
- [`background-settings.tsx`](../../../src/components/settings/background-settings.tsx)：间隔**预设 select** +「随机切换」复选框。
- i18n：`slideshowInterval` / `slideshowShuffle` / `everySeconds`(plural) / `everyMinutes`(plural)，en/zh/ja/ko。

---

## 3. Out of Scope

- 每首歌 / 每集独立轮播参数（本期全局一套）。
- 淡入淡出时长可调（仍固定 ~1s cross-fade）。
- 触摸手势手动翻页。

---

## 4. Implementation Plan

> 每 phase：TDD（适用处）+ 原子 commit + 更新本 PRD。

### Phase 1: `nextSlideIndex` 纯函数（TDD）

**Tasks:**
- [x] 新建 `src/lib/slideshow.ts` `nextSlideIndex(current, length, shuffle, rand)`。
- [x] `slideshow.test.ts` 穷举：顺序前进 + wrap；随机**永不返回当前**（rand 扫 [0,1)）+ 均匀映射（0 与 ~1 边界）；`length<=1`→0；`current` 越界/负数归一。

**Checklist:**
- [x] `slideshow.test.ts` 5 例全绿；biome 清、无 NUL。

### Phase 2: 设置字段 + 轮播接线 + UI + 文案

**Tasks:**
- [x] `db/types.ts`：加 `backgroundSlideshowIntervalSec`(默认 300=5min) + `backgroundSlideshowShuffle`(默认 true=随机) + `DEFAULT_SETTINGS`。
- [x] `now-playing-background.tsx`：interval/shuffle 读 settings，timer 用 `intervalSec*1000`，advance 用 `nextSlideIndex(i,len,shuffle)`，effect deps 加 `intervalSec`/`shuffle`，移除 `SLIDE_INTERVAL_MS` 常量。
- [x] `background-settings.tsx`：间隔预设 select（5s/10s/15s/30s/1m/2m/3m/5m/10m）+「随机切换」复选框。
- [x] i18n 四语：`slideshowInterval`/`slideshowShuffle`/`everySeconds`(en 复数)/`everyMinutes`(en 复数)。

**Checklist:**
- [x] 全量 `vitest run` 263 例全绿；biome 清；whole-project `tsc` 无错。
- [x] UI 控件接入 Settings；轮播行为由 `nextSlideIndex` 单测锁定 + 用户 HMR 实测（preview server 未运行，未自动截图）。

---

## 5. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 幻灯片切换间隔 + 顺序/随机可配；纯函数 `nextSlideIndex`（注入 rand、随机不连续重复）置于新 `slideshow.ts` 隔离并行编辑的 `background.ts` |
| 2026-06-07 | MUZERO | Phase 1+2 完成：`nextSlideIndex`(5 例) + 设置字段(间隔默认 10s / 随机) + `now-playing-background` 接线 + Settings 预设 select /「随机切换」复选框 + 四语文案。全量 263 例全绿、`tsc`/biome 清。**幻灯片切换间隔与顺序/随机现可配。** |
| 2026-06-07 | MUZERO | 默认值改为 **5 分钟切换 + 随机**（用户指定）：`DEFAULT_SETTINGS` + 三处 `??` fallback + 类型注释统一为 `300` / `true`。 |
