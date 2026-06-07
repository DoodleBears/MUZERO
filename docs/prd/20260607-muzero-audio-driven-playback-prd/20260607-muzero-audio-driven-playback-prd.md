# PRD: MUZERO — 音频驱动播放（修「切界面音乐暂停」根因）

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 播放引擎 —— `<audio>` 驱动播放 + 静音 `<video>` 视觉层，使播放跨界面不中断

> 用户多次反馈：切换界面会让音乐暂停。本 PRD 记录**确定性诊断**与正确修复架构。之前的尝试（host re-home / display:none 常驻 / pause 后 resume）都失败并引入新 bug——因为都没抓到真正根因。

---

## 1. 确定性诊断（浏览器实测）

| 测试 | 结果 |
|---|---|
| 在 now-playing 播放 | `paused:false` ✓ |
| 切到设置（Cmd+3） | **`videosInDom: 0`** —— `<video>` 被移出 DOM，播放停 |
| 给 `<video>` 祖先加 `display:none`（元素**仍在 DOM**） | **`paused:true`、t 冻结** —— 仅隐藏也暂停 |

**根因**：MUZERO 用**一个 `<video>` 元素通吃音视频**（[`media-engine.ts`](../../../src/player/media-engine.ts)）。而 **Chrome/WebView 会暂停任何「不可见」的 `<video>`**（移出 DOM / `display:none` / 隐藏 / 被遮挡都触发，是省电优化）。切界面 → now-playing 页卸载 → stage 卸载 → video 被移除/隐藏 → 暂停。

**为什么之前的修法都失败**：
- 「`unmount()` re-home 回常驻 host」：React 先移除子树（已暂停）、cleanup 后跑（太晚）。
- 「常驻挂载 + `display:none`」(Option B)：**实测 display:none 也暂停**（本 PRD 关键新发现）。
- 「pause 后 `play()` resume」：passive 回调脱离用户手势 → autoplay 拦截；且触发过 currentTime 重置(t=0)。

→ 只要播放靠 `<video>`，隐藏即暂停，**无解**。必须换 `<audio>`。

## 2. 正确架构：audio 驱动 + 静音 video 视觉层

- **`<audio>` 元素 = 播放驱动**（声音来源）。常驻 body-host、永不被隐藏暂停。`<audio>` **能播放视频文件的音轨**——所以音频曲和视频 MV 的**声音都走它**。play/pause/seek/volume/timeupdate/ended 以 audioEl 为准。
- **`<video>` 元素（muted）= 仅视觉层**。视频曲时载入同一 URL、**静音**、`currentTime` 同步 audioEl。Now-Playing stage 显示它（现有 mount/unmount）。切界面 → videoEl 隐藏/暂停（无所谓，看不见），**audioEl 继续出声**。
- **可视化** analyser 接 **audioEl**（声音源）；videoEl 静音不接。
- **同步**：audioEl `play→videoEl.play()`、`pause→videoEl.pause()`、`seeked→videoEl.currentTime=audioEl.currentTime`；`timeupdate` 漂移 >0.3s 时纠偏。videoEl 被 Chrome 隐藏暂停后，回到可见时按 audioEl 时间 resync。

```
        ┌──────────── audioEl (body-host, 永远在DOM, 驱动声音) ──────────┐
track ─▶│ load(blob)  play/pause/seek/volume   → analyser → 可视化         │
        └───────┬──────────────────────────────────────────────────────┘
                │ 视频曲时镜像（muted, 同步 currentTime）
                ▼
        videoEl (stage 显示画面; 隐藏/切界面会被浏览器暂停, 但只是没画面, 声音不断)
```

## 3. 受影响代码

| 区域 | 改动 |
|---|---|
| [`media-engine.ts`](../../../src/player/media-engine.ts) | 双元素：`audioEl`(驱动)+`videoEl`(静音视觉)；`loadBlob(blob, kind)` 按 kind 决定是否镜像 videoEl；play/pause/seek 以 audioEl 为准 + 镜像；analyser 接 audioEl；`element` getter 仍返回 videoEl（stage 用）|
| [`player-store.ts`](../../../src/stores/player-store.ts) | `ensureLoadedAndPlay` 调 `loadBlob(media.blob, track.kind)`（小改）|
| [`media-stage.tsx`](../../../src/components/player/media-stage.tsx) | 基本不变（仍 mount `element`=videoEl + getAnalyser）|

## 4. Implementation Plan

### Phase 1: 双元素 MediaEngine ✅（代码完成；连续性验证待真实环境）
- [x] `media-engine.ts` 双元素：`<audio>` 驱动（含视频文件音轨）+ 静音 `<video>` 视觉层（mount 收养/unmount 释放回 host）；audio 'play'/'pause' 镜像 video、'timeupdate' 漂移 >0.3s 纠偏、mount 时按 audio 时间 resync；回调全从 audio 源出；analyser 接 audioEl；persistent host 常驻 body。
- [x] `player-store.loadBlob(blob, track.kind)`。
- [x] 结构单测（audio+video 在 host、`element`=video、mount/unmount）；全套件 **217 绿**、typecheck/biome 清。
- [ ] **⚠️ 连续性验证只能在真实环境做**：Claude Preview 是 **hidden tab**（实测 `document.hidden:true`，audio 不切 nav 也会在 ~2s 后被环境暂停），**无法验证「跨界面不停」**。真实前台 tab / Tauri 里 `<audio>` 隐藏不暂停——需 `make desktop` 或前台浏览器手动验证：播放 → 切设置/歌单 → 音乐继续。

### Phase 2（可选增强）
- [ ] video 隐藏暂停后回可见的 resync 打磨；drift 纠偏阈值调优；mediabunny 抽音轨（CLAUDE.md 提到的后续）。

## 5. Out of Scope / 风险

- **不要在疲劳末尾仓促改**——之前两次仓促改这块引入了更糟的 bug（t=0、autoplay）。本次要专注、逐项浏览器验证后才 commit。
- audio/video 轻微 drift 可接受（纠偏兜底）；完美帧级同步非目标。
- 测试需一条**音频曲**（DJ mock 生成 WAV）验证「audio 跨界面不停」——当前库里多是视频 MV。

## 6. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 确定性诊断「Chrome 暂停一切不可见 `<video>`」（含 display:none 也暂停的关键实测）；定正确修复=`<audio>` 驱动播放 + 静音 `<video>` 视觉层同步。记录之前失败修法及原因 |
