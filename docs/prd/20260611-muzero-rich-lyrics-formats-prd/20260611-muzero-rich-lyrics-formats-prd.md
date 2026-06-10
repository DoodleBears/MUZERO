# PRD: MUZERO Rich Lyrics Formats（逐字卡拉OK + 多歌词格式适配：Enhanced LRC / YRC / QRC / TTML）

**Status:** Final（Open Questions 已锁定 → §10；按 phase TDD 推进中）
**Created:** 2026-06-11
**Author:** DoodleBear
**Module:** `src/lyrics/`（新增 format parsers + 统一模型）· `src/components/player/synced-lyrics-view.tsx`（逐字渲染）· `src/lyrics/registry.ts`（新 provider）· Settings · i18n

> 调研来源：[AMLL 支持的歌词格式](https://amll.dev/en/guides/lyric/formats.html)（TTML 为 native 富格式）· [amll-ttml-db](https://github.com/amll-dev/amll-ttml-db)（社区 TTML 逐字歌词库）· [LyciaMusic](https://github.com/Billy636/LyciaMusic)（基于 AMLL 的本地播放器）· [Enhanced LRC 规范](https://www.quicklrc.com/subtitle-formats/enhanced-lrc) · [LRC（维基）](https://en.wikipedia.org/wiki/LRC_(file_format))。本 PRD 把这些**音节级歌词格式**在 MUZERO 现有「LyricsProvider + parseLrc + resolveTrackLyrics + SyncedLines」管线上落地，**全部纯函数解析、home-grown、不引入新 runtime owner**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 基础设施：统一歌词模型 + 格式探测 + Enhanced-LRC `<…>` 健壮性（纯函数 + 单测，不改渲染） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 词级解析器：parseEnhancedLrc / parseYrc / parseQrc 归一化到统一模型 + `format` 落库 | 🔄 In Progress（2a 解析器+dispatch+resolve 完成；2b 网易 yrc opt-in 待做） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 逐字卡拉OK渲染：SyncedLines 按词 fill（active 行）+ Settings 开关 + 回退整行高亮 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 翻译 / 罗马音双行：模型携带 translation/roman 子行 + Settings 开关 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5（可选）| TTML 解析器 + amll-ttml-db 作为新 LyricsProvider（逐字+翻译+对唱的天花板源） | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 的歌词能力（[synced-lyrics PRD](../20260610-muzero-synced-lyrics-lrclib-prd/)）目前**只吃「行级 LRC」一种格式**：

- [`parse-lrc.ts`](../../../src/lyrics/parse-lrc.ts) 把 `[mm:ss.xx]文本` 解析成 `LyricsLine { timeMs, text }[]`，[`SyncedLines`](../../../src/components/player/synced-lyrics-view.tsx) **整行高亮** + rAF 跟随滚动（Apple-Music 风但**行级**）。
- LRCLIB（行级）与网易云（取 `lrc.lyric` 行级，刚修了 yrc 署名 JSON 泄漏）都只供行级。

但歌词格式的现实是一大堆**音节/词级**格式，MUZERO 既**渲染不出逐字卡拉OK**，也对它们**缺乏健壮性**（见 §1.3 风险）：

| 格式 | 粒度 | 翻译/对唱 | 来源 |
|---|---|---|---|
| **LRC** `[mm:ss.xx]文本` | 行级 | ✗ | LRCLIB / 网易 lrc |
| **Enhanced LRC / LRC A2** 行内 `<mm:ss.xx>词` | **逐字** | ✗ | LRCLIB 部分条目 / 通用 |
| **网易 YRC** `[start,dur,0]` 行 + `(s,d,0)词` | 逐字 | ✗ | 网易 `yrc` 字段 |
| **QQ QRC** `[start,dur]文本(s,d)词` | 逐字 | ✗ | QQ 音乐 |
| **TTML（AMLL）** XML，逐字 + 翻译 + 罗马音 + 对唱/背景和声 + ruby | 逐字++ | ✓✓ | amll-ttml-db / Apple Music |

AMLL 生态（[amll-ttml-db](https://github.com/amll-dev/amll-ttml-db)、[LyciaMusic](https://github.com/Billy636/LyciaMusic)）证明 **TTML 是逐字歌词的事实标准**，且有**现成的高质量社区库**可作音源。本 PRD 让 MUZERO 把这条「逐字 + 多格式」能力补齐。

### 1.2 Target Users

| Role | Description |
|------|-------------|
| **本地用户（owner）** | 想要 Apple-Music 式**逐字渐亮跟唱**体验；听 CJK 歌想看**翻译 / 罗马音**；接入的在线源（网易/QQ）本就带逐字歌词，希望不丢精度。 |

### 1.3 Core Value（含一个必须先修的健壮性风险）

1. **逐字卡拉OK**：当前行随播放**逐字渐亮**（音节级），把「Apple-Music 风」从整行升级到真·逐字。
2. **多格式适配**：Enhanced LRC / YRC / QRC / TTML 都能正确解析，不再降级或出乱码。
3. **🚩 健壮性（必须先修）**：[`parse-lrc.ts`](../../../src/lyrics/parse-lrc.ts) 的时间戳正则只认方括号 `[mm:ss]`。若某源（LRCLIB A2 条目 / 误用 yrc）返回 **Enhanced LRC**（行内 `<00:27.50>`），现在会**把 `<00:27.50>` 当歌词文字渲染出来**——与刚修的网易 yrc-JSON 泄漏同类。Phase 1 必须先剥离/解析这些词标签。
4. **翻译 / 罗马音**：CJK 歌的双行歌词（原文 + 译文 / 罗马音），TTML/双语 LRC 携带。
5. **可插拔音源**：[amll-ttml-db](https://github.com/amll-dev/amll-ttml-db) 作为一个新 `LyricsProvider`，并入现有 registry，与 LRCLIB / 网易并列。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                         原始歌词文本（raw）+ format 标记
   LRCLIB ─┐             （TrackLyrics.synced + TrackLyrics.format，落库）
   网易    ─┤  Provider                          │
   QQ      ─┤  .fetch()  ──▶ LyricsHit { raw, format }  ──写库──▶ lyrics 表
   amll-ttml├ (Phase 5)                          │
   manual  ─┘                                    ▼  （渲染期，纯函数，不预存解析结果）
                          parseLyrics(raw, format) ── 唯一解析入口（按 format 分发）
                                │   detectLyricsFormat(raw) 兜底探测
                                ▼
              ┌────────────────────────────────────────────────┐
              │  统一歌词模型 LyricLine[]                          │
              │   { timeMs, endMs?, text,                        │
              │     words?: { timeMs, durMs, text }[],   ← 逐字   │
              │     translation?: string, roman?: string, ← 双行  │
              │     agent?: "v1" | "v2" | "bg" }          ← 对唱  │
              └────────────────────────────────────────────────┘
                                │
                                ▼
   SyncedLines（渲染）：active 行有 words → 逐字 fill（CSS/motion）；否则整行高亮
                       translation/roman → 子行（Settings 开关）
                       rAF 跟随滚动、行间距、字号/透明度/对齐/阴影（沿用现有 lyric-style）
```

**两条不变量（best practice）：**

| 不变量 | 说明 |
|---|---|
| **存 raw + format，解析在渲染期** | `lyrics` 表存**原始文本** + `format` 判别（不存解析结果）。格式解析器升级 → 只重解析，**零迁移**（沿用现有「parseLrc 在渲染期」哲学）。 |
| **每格式一个纯函数解析器，归一到一个模型** | `parseEnhancedLrc / parseYrc / parseQrc / parseTtml` 各自纯函数、穷举单测、归一到 `LyricLine[]`，UI/渲染**只认统一模型**，不散落 `if(format===…)`（沿用 musicgen/lyrics registry 纪律）。 |

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **格式解析** | **全 home-grown 纯函数**（`src/lyrics/formats/*.ts`），无第三方歌词 lib | prd-create §3：**不引入新 runtime owner**。AMLL 的 `@applemusic-like-lyrics/*` 解析器是「第二套事实来源」+ 体积；这些格式语法已知且轻量（每个 ~80–200 LOC），clean-room 自研可控、可单测、跨格式归一 |
| **TTML 解析（Phase 5）** | 浏览器原生 `DOMParser`（XML）→ 遍历 `<p>/<span>` | TTML 是 XML，无需引 XML lib；`DOMParser` 在 Electron/Tauri/web 都有 |
| **逐字渲染** | CSS `background-clip:text` + 线性渐变 mask 或 motion 的 per-word fill | GPU 友好、无 layout 抖动（沿用「不动 font-size、用 transform/CSS」纪律） |
| **存储** | Dexie `lyrics` 表加**附加非索引字段** `format`（仿 `coverThumbhash`）| 规则 4/6：附加、**不 bump 版本**、零迁移 |
| **音源（Phase 5）** | amll-ttml-db 经 `getAppFetch()` 拉 TTML（公开 GitHub raw / DB 索引）| 规则 5/10：走桌面 bridge；新 provider 并入 registry |

### 2.3 Project Structure

```
src/lyrics/
├── model.ts                 # 新增：LyricLine / WordTiming / LyricFormat 统一模型 + 类型
├── parse.ts                 # 新增：parseLyrics(raw, format) 唯一入口 + detectLyricsFormat(raw)
├── formats/                 # 新增：每格式一个纯函数解析器（穷举单测）
│   ├── lrc.ts               # 行级 LRC（迁移自 parse-lrc，+ 兼容/剥离 Enhanced-LRC <…>）
│   ├── enhanced-lrc.ts      # LRC A2：行内 <mm:ss.xx> 词级 → words[]
│   ├── yrc.ts               # 网易 yrc：[start,dur,0] 行 + (s,d,0)词 → words[]（+ 复用 yrc-meta 剥离）
│   ├── qrc.ts               # QQ qrc：[start,dur]文本(s,d)词 → words[]
│   └── ttml.ts              # (Phase 5) TTML XML → words[] + translation/roman/agent
├── parse-lrc.ts             # 保留（line-level 入口）；内部委托 formats/lrc + activeLineIndex 不变
├── active-word.ts           # 新增：activeWordIndex(words, ms)（纯函数二分，仿 activeLineIndex）
├── resolve-lyrics.ts        # 扩展：ResolvedLyrics 的 synced 模式携带 LyricLine[]（含 words）
├── registry.ts              # (Phase 5) amll-ttml provider 并入 resolveLyricsProvider*
└── amll-ttml-provider.ts    # (Phase 5) LyricsProvider：按 metadata 拉 amll-ttml-db
components/player/
└── synced-lyrics-view.tsx   # 逐字 fill 渲染 + translation/roman 子行
```

---

## 3. Data Model Design

### 3.1 统一歌词模型（核心）

```ts
// src/lyrics/model.ts
export type LyricFormat = "lrc" | "elrc" | "yrc" | "qrc" | "ttml" | "plain";

export interface WordTiming {
  timeMs: number;   // 词起始（绝对 ms）
  durMs: number;    // 词时长
  text: string;     // 词/音节文本（含其自带的尾随空格，保留以免「youdon't」）
}

export interface LyricLine {
  timeMs: number;             // 行起始
  endMs?: number;             // 行结束（用于 active 行的整体进度 / 间奏判定）
  text: string;               // 整行纯文本（无词级时仍可整行高亮）
  words?: WordTiming[];       // 逐字时间轴（缺省=行级，回退整行）
  translation?: string;       // 译文子行（TTML/双语 LRC）
  roman?: string;             // 罗马音子行
  agent?: "v1" | "v2" | "bg"; // 主唱/对唱/背景和声（TTML），渲染左右对齐/弱化
}
```

`resolve-lyrics.ts` 的 `synced` 模式由 `lines: LyricsLine[]` 升级为 `lines: LyricLine[]`（向后兼容：无 `words` 即现有行为）。

### 3.2 Database Schema

⚠️ 优先扩展、不重构。`lyrics` 表（v20，synced-lyrics PRD）已存 `synced`（raw 文本）/`plain`/`status`。

- **Required Changes（附加非索引字段，仿 `coverThumbhash`，零迁移、不 bump）：**
  ```ts
  // src/db/types.ts — TrackLyrics
  format?: LyricFormat;   // raw 文本的格式判别；缺省按 detectLyricsFormat(synced) 兜底
  ```
- **`synced` 字段语义放宽**：从「raw LRC」放宽为「raw **timed** 文本」（LRC/ELRC/YRC/QRC/TTML 皆存于此）。`format` 决定用哪个解析器；TTML(XML) 直接存字符串。
- **解析在渲染期**：不存解析后的 `LyricLine[]`（解析器升级=重解析，零迁移），与现有 `parseLrc@render` 一致。
- **Provider 写库**：`LyricsHit` 增 `format?: LyricFormat`（provider 知道自己给的是什么）；`setTrackLyrics` 透传到 `TrackLyrics.format`。
- **Privacy/Retention**：歌词为公开内容；TTML 拉取（Phase 5）把 title/artist 发给 amll-ttml-db（GitHub），同 LRCLIB 隐私口径（§8）。

### 3.3 Data Relationship Diagram

```
TrackLyrics(&trackId)
  ├── synced (raw timed text: lrc|elrc|yrc|qrc|ttml)
  ├── format  ← 新增（解析器分发）
  ├── plain / status / source / matched / fetchedAt（不变）
  └──（渲染期）parseLyrics(synced, format) → LyricLine[]（含 words/translation/roman/agent）
```

---

## 4. Parser / API Design

### 4.1 唯一解析入口（按 format 分发，纯函数）

```ts
// src/lyrics/parse.ts
export function parseLyrics(raw: string, format?: LyricFormat): LyricLine[] {
  switch (format ?? detectLyricsFormat(raw)) {
    case "ttml": return parseTtml(raw);     // Phase 5
    case "qrc":  return parseQrc(raw);      // Phase 2
    case "yrc":  return parseYrc(raw);      // Phase 2
    case "elrc": return parseEnhancedLrc(raw); // Phase 2
    default:     return parseLrc(raw);      // Phase 1（含 <…> 兼容）
  }
}

/** 兜底探测（provider 没给 format 时）。纯函数，穷举单测。 */
export function detectLyricsFormat(raw: string): LyricFormat {
  if (/^\s*</.test(raw) && /<tt\b|<\/p>/i.test(raw)) return "ttml";
  if (/\[\d+,\d+\]/.test(raw) && /\(\d+,\d+,\d+\)/.test(raw)) return "yrc";
  if (/\[\d+,\d+\].*\(\d+,\d+\)/.test(raw)) return "qrc";
  if (/<\d{1,2}:\d{2}([.:]\d{1,3})?>/.test(raw)) return "elrc";
  if (/\[\d{1,2}:\d{2}/.test(raw)) return "lrc";
  return "plain";
}
```

### 4.2 每格式解析器（归一到 `LyricLine[]`）

| 格式 | 语法要点 | 解析隔离点（纯函数 + 穷举单测） |
|---|---|---|
| **LRC**（Phase 1 扩） | `[mm:ss.xx]文本`；多时间戳；`[offset]` | 复用现有 parseLrc + **新增：把行内 `<mm:ss.xx>` 词标签从 text 中剥离**（健壮性，§1.3） |
| **Enhanced LRC**（Phase 2） | 行 `[mm:ss.xx]` + 行内 `<mm:ss.xx>词<mm:ss.xx>词` | `parseEnhancedLrc`：行时间 + 逐个 `<…>` 切词 → `words[]`，词时长 = 下一个 `<…>` − 当前 |
| **网易 YRC**（Phase 2） | 行头 `[start,dur,0]` + 词 `(start,dur,0)词`；前导 JSON 署名行 | `parseYrc`：先 `stripNeteaseMetaLines`（已实现），再 `[start,dur]` 行 + `(s,d,0)词` → `words[]` |
| **QQ QRC**（Phase 2） | 行头 `[start,dur]` + 词 `文本(start,dur)` | `parseQrc`：text-then-time 顺序解析 → `words[]`（注意与 yrc 的 time-then-text 相反）|
| **TTML**（Phase 5） | XML `<p begin end agent>` + `<span begin end>词</span>` + `ttm:role=x-translation/x-roman` | `parseTtml`：DOMParser → 遍历 `<p>/<span>`，role 归到 translation/roman/agent |

> YRC/QRC 的「词自带空格」要原样保留（拼接时不再丢空格 → 修掉「youdon't」类问题）。

### 4.3 active 词 / 行（渲染辅助，纯函数）

```ts
// src/lyrics/active-word.ts
export function activeWordIndex(words: WordTiming[], positionMs: number): number; // 二分，仿 activeLineIndex
```

### 4.4 Provider 扩展（amll-ttml-db，Phase 5）

`LyricsHit` 增 `format?: LyricFormat`。新 `amll-ttml-provider.ts` 实现 `LyricsProvider`：按 title/artist（或外部 id）查 amll-ttml-db 索引 → 拉 `.ttml` raw（`getAppFetch()`）→ `{ raw, format: "ttml" }`。并入 [`registry.ts`](../../../src/lyrics/registry.ts) `resolveLyricsProvider*`（与 LRCLIB/网易并列，规则 5：不散落 `if`）。

### 4.5 Error Handling

- 解析器对**畸形输入**返回**尽力而为的部分结果**或回退 `parseLrc`/`plain`，**绝不 throw**到渲染层。
- `detectLyricsFormat` 误判 → 解析器内部再校验，失败回退 plain（整段当无时间轴文本）。
- 词级缺失/越界 → 该行回退整行高亮（`words` 视为 undefined）。
- Telemetry：本地优先、无遥测（规则 1）；解析失败走本地 logger（规则 8），不上报歌词内容。

---

## 5. Frontend Design

### 5.1 逐字渲染（Phase 3）

[`SyncedLines`](../../../src/components/player/synced-lyrics-view.tsx) 升级：

- **active 行**：若 `line.words` 存在 → 逐字 fill —— 用 `activeWordIndex` + 当前词内进度（rAF 读 `getCurrentTime()`，沿用现有 follow rAF），CSS `background-clip:text` + 渐变把「已唱」部分填成高亮色、未唱部分用 inactive 色。**不动 layout**（与现有「scale 不动 font-size」纪律一致，避免重排）。
- **非 active 行**：整行 inactive 样式（不变）。
- **无 words（行级源）**：回退现有整行高亮（零回归）。
- 跟随滚动 / 行间距 / 字号 / 透明度 / 对齐 / 阴影：**全部复用现有** [`lyric-style.ts`](../../../src/lyrics/lyric-style.ts) + rAF follow。
- **Settings 开关**：`逐字歌词`（默认开；关 → 始终整行高亮，省渲染）。

### 5.2 翻译 / 罗马音子行（Phase 4）

- `line.translation` / `line.roman` 存在时，在主行下渲染**弱化子行**（更小、更透明，复用 inactive 样式派生）。
- **Settings 开关**：`显示翻译`、`显示罗马音`（默认：翻译开、罗马音关）。
- 对唱 `agent`：v1/v2 左右对齐、bg 弱化缩进（仅 TTML，Phase 5 起生效）。

### 5.3 State / i18n

- 解析在渲染期 `useMemo(parseLyrics(raw, format))`，rAF 读引擎时间（沿用，规则 6）。
- 新 Settings 控件 + 文案走 `t()`，先加 en 再补 zh/ja/ko（4 locale，prd-create §3）。

---

## 6. Implementation Plan

> 顺序遵循 prd-create.md §3「基础设施先于覆盖广度」：模型 + 解析器（Phase 1/2）先于渲染广度（Phase 3）。

### Phase 1: 基础设施 + Enhanced-LRC 健壮性

**Goal:** 统一模型 `model.ts` + `parseLyrics`/`detectLyricsFormat` 入口 + `parse-lrc` 兼容/剥离行内 `<…>` 词标签（消除潜在乱码）。纯函数 + 单测，**不改渲染**（仍整行）。

**Tasks:**
- [x] [`model.ts`](../../../src/lyrics/model.ts)：`LyricLine`/`WordTiming`/`LyricFormat`（统一模型，`words[].text` 含尾随空格防丢空格）。
- [x] [`parse.ts`](../../../src/lyrics/parse.ts)：`parseLyrics(raw, format?)` 分发 + `detectLyricsFormat`（穷举单测 [`parse.test.ts`](../../../src/lyrics/parse.test.ts)）。
- [x] **剥离行内 `<mm:ss.xx>`**：实现写在 [`parse-lrc.ts`](../../../src/lyrics/parse-lrc.ts) `stripInlineWordTags`（**不另建 `formats/lrc.ts`** —— 直接扩 parseLrc，零 importer 改动、即时修复 live 渲染路径 resolve-lyrics→parseLrc）。
- [x] `TrackLyrics.format?` 附加字段（零迁移：`TrackLyrics extends LyricsRecord` 自动继承）；`LyricsRecord.format?` / `LyricsHit.format?`（[`provider.ts`](../../../src/lyrics/provider.ts)）；`lyricsRecordFromHit` 透传（[`auto-fetch.ts`](../../../src/lyrics/auto-fetch.ts)），`setTrackLyrics` 已 spread record 自动落库。

> 实现差异（vs 初稿 task 列表）：未建 `formats/lrc.ts` 子目录迁移。理由：现 live 渲染路径是 `resolve-lyrics → parseLrc`，把 `<…>` 剥离直接放进 parseLrc 即可**即时修复**且零 importer 改动；`parseLyrics` 作为前向基础设施新增（带测试），Phase 2/5 再在其 `switch` 里挂 elrc/yrc/qrc/ttml 专用解析器。`formats/` 子目录留到 Phase 2 落第一个词级解析器时再建。

#### Phase 1 Checklist
- [x] `detectLyricsFormat` 穷举：lrc/elrc/yrc/qrc/ttml/plain 各命中（含 yrc 优先于 qrc 的歧义用例）。
- [x] Enhanced-LRC 行 `[00:10.00]<00:10.00>Cause <00:10.50>you <00:10.80>don't` → 渲染文本无 `<…>`（健壮性，`parseLrc` + `stripInlineWordTags` 单测）。
- [x] 现有行级 LRC 行为零回归（parseLrc 既有用例全绿）。
- [x] 54 lyrics 单测全过；my-files `tsc` / biome 干净（whole-repo tsc 0 error）。

### Phase 2: 词级解析器

**Goal:** `parseEnhancedLrc / parseYrc / parseQrc` 归一到 `words[]`；provider 写库带 `format`。

**2a Tasks（完成）：**
- [x] [`formats/enhanced-lrc.ts`](../../../src/lyrics/formats/enhanced-lrc.ts)：`<mm:ss.xx>` 词标签 → `words[]`，词时长=下一词/下一行起点（末词默认 800ms）。
- [x] [`formats/yrc.ts`](../../../src/lyrics/formats/yrc.ts)：`[start,dur]` 行 + `(s,d,0)词`（绝对时间、显式时长），跳过 credit-JSON。
- [x] [`formats/qrc.ts`](../../../src/lyrics/formats/qrc.ts)：`[start,dur]` 行 + `词(s,d)`（text-then-time，与 yrc 相反）。
- [x] [`parse.ts`](../../../src/lyrics/parse.ts) `switch` 挂载 elrc/yrc/qrc（ttml 占位返回 `[]`，Phase 5 接）。
- [x] [`resolve-lyrics.ts`](../../../src/lyrics/resolve-lyrics.ts)：synced 模式改走 `parseLyrics(synced, format)`，`lines: LyricLine[]`（含 words；view 结构兼容零改动）。

**2b Tasks（待做）：**
- [ ] 网易 provider：除 `lrc.lyric` 外可取 `yrc`（带 `format:"yrc"`，有则优先）；保留 `stripNeteaseMetaLines`。

#### Phase 2 Checklist
- [x] yrc/qrc 词时间轴解析对拍参考样本（固定输入 → 期望 words）。
- [x] 「youdon't」类丢空格回归测试（词尾空格保留，三个 parser 各覆盖）。
- [x] 无词级源回退整行（lrc 路径 words undefined，resolve-lyrics 既有用例零回归）。
- [x] 58 lyrics 单测全过；my-files tsc/biome 干净。
- [ ] 2b：网易 yrc opt-in 落地 + `make check`。

### Phase 3: 逐字卡拉OK渲染

**Goal:** `SyncedLines` active 行逐字 fill（CSS background-clip）+ rAF 词内进度 + Settings 开关 + 回退整行。

**Tasks:**
- [ ] `active-word.ts` + 逐字 fill 渲染（不动 layout）。
- [ ] Settings `逐字歌词` 开关 + i18n ×4。

#### Phase 3 Checklist
- [ ] 有 words 的曲：当前行逐字渐亮、跟随播放。
- [ ] 关开关 → 整行高亮（省渲染）；reduced-motion → 瞬切。
- [ ] 无 words 源零回归。
- [ ] 播放期不每帧整树重渲（仅 active 行/词，规则 6）。

### Phase 4: 翻译 / 罗马音双行

**Goal:** 模型携带 translation/roman → 弱化子行 + Settings 开关。

**Tasks:**
- [ ] 双语 LRC（连续两行同时间戳）/ TTML role 归一到 `translation`。
- [ ] 子行渲染 + `显示翻译`/`显示罗马音` 开关 + i18n ×4。

#### Phase 4 Checklist
- [ ] 双语条目渲染原文 + 译文子行；开关生效。
- [ ] 无译文零回归。

### Phase 5（可选）: TTML + amll-ttml-db provider

**Goal:** `parseTtml`（DOMParser）+ `amll-ttml-provider` 并入 registry（逐字 + 翻译 + 对唱）。

**Tasks:**
- [ ] `formats/ttml.ts`：`<p>/<span>` + role(x-translation/x-roman) + agent → LyricLine[]。
- [ ] `amll-ttml-provider.ts`：查 amll-ttml-db → 拉 TTML（getAppFetch）；registry 注册 + `AppSettings.lyricsProviderId += "amll"`。
- [ ] 对唱 agent 左右/弱化渲染。

#### Phase 5 Checklist
- [ ] 一个真实 TTML 端到端：逐字 + 翻译 + 对唱渲染正确。
- [ ] amll-ttml-db 拉取走 getAppFetch；命中/未命中处理。
- [ ] License/attribution 入 `THIRD-PARTY-LICENSES.md`（§8）。

---

## 7. Out of Scope

- **歌词编辑/打轴工具**（AMLL TTML Tool 那种制作端）：只读取/渲染，不做制作。
- **酷狗 KRC**（加密）：解密链路与 ToS 风险，单列未来评估。
- **逐字 fly-in/3D**（AMLL 的高级动效）：v1 做逐字 fill；更花哨动效后续。
- **贡献回 amll-ttml-db**：只读取。
- **把解析结果预存进 DB**：坚持渲染期解析（解析器升级零迁移）。

---

## 8. Security / Dependency / License Considerations

- **🚩 不引入新 runtime owner（prd-create §3）**：**不依赖** `@applemusic-like-lyrics/*` 等第三方歌词 lib（第二套事实来源 + 体积）。所有格式解析 **clean-room home-grown 纯函数**；TTML 用浏览器原生 `DOMParser`。
- **License 第一公民（§3）**：Phase 5 接 amll-ttml-db 须在 `THIRD-PARTY-LICENSES.md` 声明其数据 license（社区 DB，多为 CC 系；**拉取时按需取、不 bundle 歌词数据**）。解析器是 self-authored = `MIT (MUZERO)`。
- **本地优先 / 无后端（规则 1）**：歌词存设备本地；amll-ttml-db 是第三方**只读**源（GitHub raw），不经任何 MUZERO 服务端。出站经 `getAppFetch()`（规则 5/10）。
- **隐私**：amll-ttml-db 查询会把 title/artist 发给 GitHub，同 LRCLIB 口径——受 `autoFetchLyrics` 开关与隐私说明约束（规则 3）。
- **codename 稳定（规则 4）**：`format` 取值 `lrc|elrc|yrc|qrc|ttml|plain`、provider id `amll` 跨品牌/壳稳定；db 名/前缀不变。
- **i18n 4 locale 全量**（§3）：新开关/子行文案 en→zh/ja/ko，少 locale 标 pending。
- **回退 = `git revert`（§3 / 规则 3）**：格式/渲染不藏 hidden flag；逐字/翻译/罗马音是可见 Settings 控件。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [synced-lyrics PRD](../20260610-muzero-synced-lyrics-lrclib-prd/) | 被扩展的基线（LRCLIB + 行级 LRC + SyncedLines + lyric-style）|
| [`parse-lrc.ts`](../../../src/lyrics/parse-lrc.ts) / [`resolve-lyrics.ts`](../../../src/lyrics/resolve-lyrics.ts) | 现有解析 + 唯一裁决（被扩展）|
| [`synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx) / [`lyric-style.ts`](../../../src/lyrics/lyric-style.ts) | 渲染 + 样式（逐字 fill 落点）|
| [`registry.ts`](../../../src/lyrics/registry.ts) / [`netease-lyric-map.ts`](../../../src/lyrics/netease-lyric-map.ts) | provider registry + 网易（yrc-meta 剥离已实现）|
| 外部 | [AMLL 格式](https://amll.dev/en/guides/lyric/formats.html) · [amll-ttml-db](https://github.com/amll-dev/amll-ttml-db) · [LyciaMusic](https://github.com/Billy636/LyciaMusic) · [Enhanced LRC](https://www.quicklrc.com/subtitle-formats/enhanced-lrc) |
| CLAUDE.md | 规则 1/3/4/5/6/7/8/10 |

---

## 10. Open Questions

> 全部已锁定（用户 2026-06-11「按倾向走」）。

| # | Question | Status | Decision |
|---|----------|--------|------|
| Q1 | 逐字默认开还是关？ | ✅ 锁定 | **默认开**（有 words 才逐字，无则整行；零额外成本）|
| Q2 | 网易是否默认取 yrc（逐字）而非 lrc？ | ✅ 锁定 | **有 yrc 用 yrc，回退 lrc**（精度优先）|
| Q3 | 翻译/罗马音默认显示？ | ✅ 锁定 | **翻译默认开、罗马音默认关** |
| Q4 | Phase 5 接 amll-ttml-db 的范围 | ✅ 锁定 | **仅手动**「搜索歌词」里加 TTML 源，不自动出站第三端点 |
| Q5 | 逐字 fill 用 CSS 还是 motion？ | ✅ 锁定 | **CSS background-clip**（GPU、无重排、便宜）；复杂动效再上 motion |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-11 | DoodleBear | 初稿：多歌词格式（Enhanced LRC / YRC / QRC / TTML）+ 逐字卡拉OK + 翻译/罗马音。统一模型 + home-grown 纯函数解析器（不引入 AMLL lib）+ 渲染期解析零迁移；5 phase（基础设施→词级解析→逐字渲染→双行→TTML/amll-ttml-db）。Q1–Q5 待定 |
| 2026-06-11 | DoodleBear | Status→Final，Q1–Q5 锁定（按倾向）。**Phase 1 完成**：`model.ts`（统一模型）+ `parse.ts`（`parseLyrics`/`detectLyricsFormat` 穷举单测）+ `parseLrc` 行内 `<…>` 剥离（`stripInlineWordTags`，修 Enhanced-LRC 乱码健壮性）+ `format?` 贯穿 `LyricsRecord`/`LyricsHit`/`lyricsRecordFromHit`。未建 `formats/lrc.ts`（直接扩 parseLrc，零 importer 改动）。54 单测全过 |

---

> **Note:** 本 PRD 优先**扩展**现有结构（parse-lrc / resolve-lyrics / SyncedLines / lyric-style / provider registry），新建仅限：`src/lyrics/model.ts`、`parse.ts`、`formats/*`（新 parser，符合 §3「新文件只给新 parser」）、`active-word.ts`、`amll-ttml-provider.ts`。所有格式脏活收进纯函数穷举单测，渲染只认统一模型，不散落 `if(format===…)`。
