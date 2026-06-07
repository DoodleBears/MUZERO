# PRD: MUZERO — 播放快捷键 + Dock 音量/循环控件 + Kbd 提示

**Status:** Completed（3 phase 全实现，294 tests 绿；浏览器实测音量 hover 滑块 + 循环 cycle + dock 控件，dark/mobile 响应式 OK）
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 播放器 —— 全局键盘快捷键、Dock 音量 hover 滑块 + 循环控件、transport 控件 hover(label + Kbd)

> 用户要求：切歌/暂停等都支持快捷键，且像 nav 一样 hover 显示 label + Kbd。音量做成 Dock 上 hover 出滑块（竖向，见设计图），上下键调音量；循环方式显示在 Dock 并支持 ⌘R；R 从头播放。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 纯快捷键解析 `resolvePlayerShortcut`（key→action，TDD） | ✅ Completed | §5 |
| 2 | 全局键盘处理 + dispatch（接 player-store，让快捷键真正生效） | ✅ Completed | §5 |
| 3 | Dock 音量控件（hover 竖向滑块）+ 循环控件 + transport tooltip(label+Kbd) | ✅ Completed | §5 |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. 快捷键表

| 操作 | 按键 | 备注 |
|---|---|---|
| 播放/暂停 | `Space` · `⌘/Ctrl+P` | `P` 按平台显示（mac=⌘、其它=Ctrl，用现有 `isMac`/`modifierSymbol`）|
| 上一首 | `←` · `A` | |
| 下一首 | `→` · `D` | |
| 后退 5 秒 | `Shift+←` · `Shift+A` | `seek(max(0, pos-5))` |
| 前进 5 秒 | `Shift+→` · `Shift+D` | `seek(pos+5)` |
| 音量 + | `↑` | `setVolume(min(1, vol+0.05))` |
| 音量 − | `↓` | `setVolume(max(0, vol-0.05))` |
| 循环切换 | `⌘/Ctrl+R` | `off→all→one→off`（`nextRepeatMode`，[transport.ts](../../../src/player/transport.ts)）。⚠️ 浏览器里会 preventDefault 掉刷新；Tauri 打包后无影响 |
| 从头播放 | `R` | `seek(0)` |

**守卫**：聚焦在 `input/textarea/select/[contenteditable]` 时不触发；`Space/Enter` 落在 `button/a` 上时让控件自身处理（不重复触发）。`⌘1/2/3`（nav-fab）不冲突——解析器对 `mod+非 P/R` 返回 null。

---

## 2. Dock 控件（§需求 3/4/6）

- **音量**：Dock 上一个音量按钮，hover/focus 弹出**竖向滑块**（设计图：圆角竖条 + 黄色 fill + 圆点 thumb）。`↑/↓` 也调。滑块反映 `volume`，拖动/点击 setVolume。
- **循环**：Dock 显示当前循环方式图标（`off`=Repeat 暗 / `all`=Repeat / `one`=Repeat1），点击 `nextRepeatMode`，`⌘R` 同步。复用 [transport-controls.tsx](../../../src/components/player/transport-controls.tsx) 的 repeat 逻辑。
- **tooltip**：每个 transport 控件（上/下一首、shuffle、repeat、volume）hover 显示 **label + Kbd**（复用 nav 的 `Tooltip`+`Kbd`/`KbdGroup`），快捷键按平台显示。

---

## 3. 受影响代码

| 区域 | 改动 |
|---|---|
| `src/player/player-shortcuts.ts`（新） | 纯 `resolvePlayerShortcut(e) → PlayerShortcut \| null`（Phase 1，TDD）|
| `src/hooks/use-player-shortcuts.ts`（新） | 全局 keydown 守卫 + dispatch 到 player-store（Phase 2）|
| [`App.tsx`](../../../src/App.tsx) | 调一次 `usePlayerShortcuts()`（Phase 2）|
| [`transport-controls.tsx`](../../../src/components/player/transport-controls.tsx) + 新音量控件 | tooltip(label+Kbd) + 音量 hover 滑块 + 循环（Phase 3）|
| `src/i18n/locales/*` | 音量/循环/跳转 label + Kbd 文案 |

---

## 4. 复用 / 一致性

- 平台显示：`isMac()` / `modifierSymbol()`（[shortcuts.ts](../../../src/lib/shortcuts.ts)）。
- 循环 cycle：`nextRepeatMode`（[transport.ts](../../../src/player/transport.ts)）。
- tooltip + Kbd：`Tooltip`/`Kbd`/`KbdGroup`（nav-fab/旧 nav-row 同款）。
- player-store actions：`togglePlay/next/prev/seek/setVolume/setRepeat`（已全有）。
- 纯逻辑穷举单测（硬规则 #7）；console 走 logger（#8）；文案 i18n 4 语（en 先）。

---

## 5. Implementation Plan

### Phase 1: 纯快捷键解析 ✅
- [x] `player-shortcuts.ts`：`PlayerShortcut` 枚举 + `resolvePlayerShortcut`（Space/⌘P→toggle、←/A→prev、→/D→next、Shift+←/A→seek-back、Shift+→/D→seek-forward、↑/↓→volume、⌘R→cycle-repeat、R→restart；alt 或 mod+其它→null）。
- [x] 穷举单测（含平台无关、shift 组合、mod 组合、空格、大小写、null 情形）。

### Phase 2: 全局键盘 + dispatch ✅
- [x] `use-player-shortcuts.ts`：keydown 守卫（form field;Space/Enter 在 button/a 不重复触发）+ `resolvePlayerShortcut` + 命令式 `getState()` dispatch（seek ±5、volume ±0.05、restart seek 0、`nextRepeatMode` cycle）。`App.tsx` 调一次。
- [x] 浏览器实测：Space 切换(播放↔暂停)、a 上一首(dropped→memory)、↑↓ 音量(±0.05 精确)、R 从头(0.6→0)、Shift+← 后退5s(1→0)、输入框内 Space 不触发、⌘1/2 仍导航不冲突。

### Phase 3: Dock 控件 + tooltip ✅
- [x] **纯助手（TDD）**：`player-hints.ts` —— `playerShortcutHint(action,mac)`(play/prev/next/repeat/volume→keycap tokens；repeat 出平台 ⌘/Ctrl+R chord；volume 出 ↑↓) + `volumeFromPointerY(clientY,top,height)`(竖向滑块取值，top=loud、clamp 0–1、零高除零安全、反转)。9 例穷举单测（shuffle 无实际绑定故不出 Kbd，已从 hint 去掉）。
- [x] **`VolumeControl`**：音量按钮 hover/focus 弹**竖向滑块** popover（圆角 track + `--primary` fill + 圆点 thumb + `%` + ↑↓ Kbd，即「自带 label+Kbd」不另开 tooltip 避免双弹层）；level-aware 图标(VolumeX/1/2)；点击切静音；窄 selector 只订 `volume`。
- [x] **`DockControls`**（repeat + volume 簇）入 player-dock（play 与 NavFab 之间，`hidden sm:flex`——移动端走 Now Playing transport 行不挤）；repeat 用 `ControlTooltip`(label `repeatLabel`+⌘R)。
- [x] **`ControlTooltip`**：Base UI `render`-prop 把 Tooltip 贴到子 `Button`(经 `useRender` 组合)，无额外节点；复用 nav 同款 `Tooltip`+`Kbd`/`KbdGroup`。Now Playing `TransportControls` 每个键(shuffle/prev/play/next/repeat)加 tooltip + 末尾追加 `VolumeControl`，整行包 `TooltipProvider` 共享延时。
- [x] i18n `player.repeatLabel` 4 语；**浏览器实测**(独立 1440 preview)：音量 hover 滑块渲染达设计(track+fill+thumb+90%+↑↓)、循环 cycle off→all→one 变主色换图标、dock 控件就位、mobile 正确隐藏、dark 模式 OK、零 console error。**全套件 294 绿、typecheck/biome 清**。

---

## 6. Out of Scope / Open Questions

- 自定义快捷键映射 UI（v1 固定）。
- `⌘R` 在浏览器 dev 会拦截刷新（preventDefault）——可接受（Tauri 打包无此问题）；如开发期烦，Open Q：是否仅 Tauri 启用 ⌘R。
- 媒体键（MediaPlayPause 等系统键）= 后续（Tauri media-keys）。

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 播放快捷键(Space/⌘P、←→/AD、Shift±5s、↑↓音量、⌘R 循环、R 从头) + Dock 音量 hover 滑块 + 循环控件 + transport tooltip(label+Kbd)，3 phase |
