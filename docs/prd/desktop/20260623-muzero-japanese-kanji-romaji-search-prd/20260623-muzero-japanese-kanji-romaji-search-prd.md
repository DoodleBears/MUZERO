# PRD: 纯汉字日文标题的罗马音搜索（kuromoji 读音 → romaji）

**Status:** Draft
**Created:** 2026-06-23
**Author:** DoodleBear
**Module:** `src/lib/search-transliterate.ts`（变体生成）· `src/workers/`（搜索 worker 懒加载词典）· 构建（Vite worker + Electron `app://` 词典打包）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 可注入的「汉字→读音→罗马音」核心 + 纯汉字双读音（CN+JP）变体（TDD） | ✅ 完成（`kanji-romaji.ts` + `searchVariants` 全汉字分支 CN+JP 双读音 + `setKanjiTokenizer` 注入；41 测试全绿，含既有 34 回归） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 接入 `@sglkc/kuromoji` 真词典 + Vite worker / Electron `app://` 打包 + 构建产物实测 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序（prd-create §3「基础设施先于覆盖广度」）**：Phase 1 是纯 + 可注入的核心（用 fake tokenizer 单测，不碰真词典），Phase 2 才接真 kuromoji 词典 + 解决打包。核心与词典解耦，核心可先合并，词典打包（唯一高风险项）独立验证。

---

## 1. Overview

### 1.1 Background

搜索已支持**音译匹配**（[`search-transliterate.ts`](../../../../src/lib/search-transliterate.ts)）：中文→拼音（全拼 + 首字母，`pinyin-pro`），日文假名↔罗马音（`wanakana`），并按**假名优先**判定脚本（含假名→日文路径，全汉字→中文拼音路径）。`searchVariants` 已接入 ⌘F 全部本地区块（songs / albums / artists / sets / lyrics），worker + 主线程都懒加载词典，加载失败会降级 + 记录（见 `69ac0285` 的硬化）。

**缺口**：一个**纯汉字、且实际是日文**的标题（如 `桜`、`空`、`紅蓮華` 中无假名的部分）会走中文拼音路径，读成中文音（`桜`→`ying`），用户输入 `sakura` 匹配不到。原因：`wanakana` **只能转假名，不能读汉字**（`wanakana.toRomaji("桜")` 原样返回）；要得到日文读音必须做**形态素分析**（分词 + 取读音）。

详见上轮调研结论：JS 生态里只有带词典的形态素分析器（kuromoji / kuroshiro / lindera-wasm / sudachi-wasm）能产出汉字读音；无词典分词器（TinySegmenter / BudouX）只切词、无读音，不可用。

### 1.2 Target Users

| Role | Description | 价值 |
|------|-------------|------|
| **本地优先 owner（CJK 混合曲库）** | 库里混有中文、日文（含纯汉字标题）曲目 | 用罗马音 `sakura` 找到 `桜`，同时纯汉字若是中文仍能用拼音 `ying` 找到——**同一个纯汉字标题，CN + JP 两种读音都生成**，输入任一都命中 |

### 1.3 Core Value

1. **纯汉字标题 JP+CN 双读音**：`桜` 既出 `ying`（拼音）又出 `sakura`（kuromoji 读音→罗马音）；输入任一命中。
2. **复用既有管线**：读音→罗马音复用已有 `wanakana`；懒加载 + 降级复用已有 `ensureTransliterationLoaded` 硬化；接入点只在 `searchVariants` 一处。
3. **一套浏览器方案通吃桌面 + web**：纯 JS 的 `@sglkc/kuromoji` 在 renderer/worker 跑，web（my.mu0.app）+ Electron + 未来移动 webview 同一份代码，无需 browser/desktop 分叉（不引入 native MeCab 路径）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
searchVariants(value):                       ← 唯一接入点（已存在）
  addNormalized(原文 + 去标点紧凑形)
  if 含假名(KANA_RE):  addKana(假名↔罗马音)              ← 既有（wanakana）
  else if 全汉字(HAN_RE):
        addPinyin(value)                                ← 既有（pinyin-pro，中文读音）
        addKanjiRomaji(value)        ← 【新】kuromoji 分词→读音(片假名)→wanakana.toRomaji→JP 罗马音
  （含假名的日文标题维持假名优先，不重复跑拼音——不变）

ensureTransliterationLoaded():               ← 已存在；Phase 2 追加 kuromoji loader（与 pinyin-pro/wanakana 并列懒加载）
  Promise.all([import(pinyin-pro), import(wanakana), import(@sglkc/kuromoji) → build(dicPath)])
  失败 → 降级 normalize-only + 记录 loadError（既有硬化覆盖）
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **日文形态素分析** | [`@sglkc/kuromoji`](https://www.npmjs.com/package/@sglkc/kuromoji)（takuyaa/kuromoji.js 的维护 fork，TS + 浏览器修复） | 纯 JS（无 WASM，Vite/worker/Electron 打包最简）；token 带 `reading`（片假名读音）；原 `takuyaa/kuromoji.js` MIT 但停更，`@sglkc` fork 活跃 |
| **读音→罗马音** | `wanakana`（已是依赖） | kuromoji 给片假名读音，`wanakana.toRomaji` 转罗马音——**复用，不新增转换层**（不引 kuroshiro，因为搜索只要罗马音字符串，不需要 furigana 渲染） |
| **中文读音** | `pinyin-pro`（已是依赖） | 纯汉字仍出拼音；与新增 JP 罗马音**并存** |
| 词典 | kuromoji IPADIC（`@sglkc/kuromoji` 自带，gz ~18MB / brotli ~12MB） | 唯一重成本；**懒加载进搜索 worker chunk**，仅首次 JP 搜索时下载、之后缓存 |

**License / 依赖清单（prd-create §3「License 第一公民」）**：

| 依赖 | license / spdx | 用途 | 备注 |
|------|----------------|------|------|
| `@sglkc/kuromoji` | MIT（fork 自 `takuyaa/kuromoji.js`，Apache-2.0 词典 IPADIC） | 日文分词 + 读音 | ship-friendly；IPADIC 为 ICOT/奈良先端 衍生，Apache-2.0 |
| IPADIC 词典 | Apache-2.0（mecab-ipadic 衍生） | kuromoji 词典 | 需在 `THIRD-PARTY-LICENSES.md` 登记 per-asset attribution |

> 不引入：kuroshiro（多一层、furigana 渲染搜索用不到）、lindera-wasm / sudachi-wasm（WASM + 词典路径打包更复杂；sudachi 词典 ~71MB 过重）、native MeCab（桌面专属、复杂 Electron 打包、分叉行为）。若未来要 JA/KO/ZH 统一引擎再评估 lindera-wasm（单独 dependency-manifest review）。

### 2.3 Project Structure

```
src/lib/
├── search-transliterate.ts        # 改：searchVariants 全汉字分支追加 addKanjiRomaji；ensureTransliterationLoaded 追加 kuromoji loader（可注入）
├── search-transliterate.test.ts   # 改：纯汉字→拼音 AND 罗马音；fake tokenizer 注入
└── kanji-romaji.ts                # 新（可选）：纯函数 readingToRomaji(tokens) — token 读音(片假名)→罗马音；便于单测
src/workers/
└── global-search-local-worker.ts  # 既有：await ensureTransliterationLoaded()（含 kuromoji）后再搜
vite.config.ts / electron/         # 改（Phase 2）：把 kuromoji IPADIC 词典作为静态资源打包，dicPath 在 web(served URL) 与 Electron(app://) 都可解析
THIRD-PARTY-LICENSES.md            # 改：登记 kuromoji + IPADIC license/attribution
```

> 遵循「不新增源代码文件，除非引入新 lib bridge」：`kanji-romaji.ts` 作为 kuromoji bridge / 纯转换核心是允许的新文件；其余只 append。

---

## 3. Data Model Design

无数据库改动。纯运行时变体生成；`searchVariants` 的 LRU `variantCache` 已存在，新增的罗马音变体进同一缓存（key 不变）。词典是**打包静态资源**，非用户数据、非网络抓取——离线可用（本地优先）。

---

## 4. API Design

无网络 API。内部函数契约：

```typescript
// search-transliterate.ts（新增，全汉字分支调用）
// 注入式：tokenizer 由 ensureTransliterationLoaded 准备；未就绪则跳过（降级）
function addKanjiRomaji(out: Set<string>, value: string, locale?: string): void;

// kanji-romaji.ts（纯，单测）
// kuromoji token[] → 读音(片假名)拼接 → wanakana.toRomaji → 归一化罗马音变体（spaced + compact）
export function readingRomajiVariants(
  tokens: readonly { reading?: string }[],
  toRomaji: (kana: string) => string,
): string[];
```

### 4.3 Error Handling

- kuromoji 加载/分词失败：`addKanjiRomaji` 静默跳过（只是少了 JP 罗马音变体，拼音 + 原文匹配仍在）；加载失败整体降级走既有 `ensureTransliterationLoaded` 硬化（记录 `loadError`，`useTransliterationReady` `log.warn`）。
- **Telemetry**：不上报任何标题/读音内容（与 `feedback_no_hidden_backend_flags` 一致）。

---

## 5. Frontend Design

无新 UI。⌘F 搜索行为不变，只是纯汉字 JP 标题现在能被罗马音命中。`useTransliterationReady` 已驱动「词典就绪后重跑匹配」。

---

## 6. Implementation Plan

### Phase 1: 可注入核心 + 纯汉字双读音（TDD，不碰真词典）

**Goal:** 在不引入 kuromoji 真词典的前提下，把「全汉字 → 拼音 + 罗马音」的变体逻辑写出来并单测。

**Tasks:**
- [ ] `kanji-romaji.ts` `readingRomajiVariants(tokens, toRomaji)`（纯）：token 读音(片假名)拼接 → 罗马音（spaced + compact），过滤无读音 token。
- [ ] `search-transliterate.ts`：全汉字分支在 `addPinyin` 后追加 `addKanjiRomaji`；`addKanjiRomaji` 用一个**模块级可注入 tokenizer**（`setKanjiTokenizer(fn)` / 内部句柄），未注入时 no-op（降级）。`ensureTransliterationLoaded` 预留 kuromoji 加载位（Phase 2 填真实现，Phase 1 可留空/注入 fake）。
- [ ] 单测：注入 fake tokenizer（`桜`→`[{reading:"サクラ"}]`），断言 `searchVariants("桜")` 同时含 `ying`（拼音）**与** `sakura`（罗马音）；含假名标题不受影响（仍假名优先、不跑拼音）。

#### Phase 1 Checklist
- [x] 纯汉字（fake tokenizer）→ 变体同时含拼音（`空`→`kong`）AND 罗马音（`sora`）；`scoreVariants(searchVariants("sora"), …)` < `NO_MATCH_SCORE`。
- [x] 全汉字但中文（`北京`）→ 仍出拼音 `beijing`；无 tokenizer 注入时不报错、退化为拼音-only。
- [x] 含假名标题（`さくら` / `君の名は`）变体不变（kana-first；tokenizer 不被 consulted，回归）。
- [x] 既有 34 个 transliterate/search-core 测试全绿（总 41 绿）。
- [x] `setKanjiTokenizer` 注入 + 清缓存；`readingRomajiVariants` 纯函数单测（spaced/compact、跳过 `*`/空读音）。

### Phase 2: 接 `@sglkc/kuromoji` 真词典 + 打包 + 构建产物实测

**Goal:** 真实日文读音端到端可用，词典在 web + Electron 构建产物都能加载。

**Tasks:**
- [ ] `pnpm add @sglkc/kuromoji`；`THIRD-PARTY-LICENSES.md` 登记 kuromoji + IPADIC。
- [ ] `ensureTransliterationLoaded`：并列 `import("@sglkc/kuromoji")` + `builder({ dicPath }).build()`，就绪后 `setKanjiTokenizer`。失败走既有降级。
- [ ] **词典打包（高风险项）**：IPADIC `.dat.gz` 作为静态资源；`dicPath` 在 dev（Vite served）、web build、Electron `app://` 三处都能解析。验证 worker 内 fetch 词典成功。
- [ ] **构建产物实测**：`make build` / `make desktop-build` 后，⌘F 输入 `sakura` 命中纯汉字 JP 标题；测词典 chunk 大小（gzipped），记录进 PRD。
- [ ] perf：首次 JP 搜索触发词典加载（一次性），实测加载耗时 + 之后命中无卡顿；worker 内分词不阻塞主线程。

#### Phase 2 Checklist
- [ ] 构建产物里 ⌘F `sakura` 命中库内纯汉字 JP 标题（真机/构建实测，非仅单测）。
- [ ] 词典在 Electron `app://` 与 web 构建都能加载（worker 内）；加载失败有 `log.warn`（既有硬化）。
- [ ] 词典 chunk 大小记录（目标懒加载、不进主 bundle；prd-create §3 bundle 预算）。
- [ ] `THIRD-PARTY-LICENSES.md` 含 kuromoji + IPADIC attribution。

---

## 7. Out of Scope

- **Furigana 渲染**：歌词的罗马音来自 provider（NetEase `romalrc` / TTML `x-roman`），不在此计算；本 PRD 只做搜索匹配，不渲染 furigana。
- **Sudachi / Lindera / native MeCab**：本期不引；未来若要 JA/KO/ZH 统一引擎再单独评估 lindera-wasm。
- **韩语读音**：超出范围。
- **在线/远端搜索的音译**：远端 API 服务端搜索，客户端音译无法影响（用户已确认理解）。
- **纯汉字读音歧义的「正确性」**：kuromoji 给最可能读音；多音/人名读音不保证 100%——搜索只需「能命中」，宁可多生成候选（拼音 + 罗马音并存），不追求唯一正确读音。

---

## 8. Security Considerations

- **无网络**：词典是打包静态资源，离线可用；不抓取、不上报。
- **隐私**：不上报标题/读音/查询内容（telemetry whitelist 与既有一致）。
- **回退**：`git revert` 注册依赖 + 词典打包配置；不藏 runtime flag（`feedback_no_hidden_backend_flags`）。无 hidden localStorage/URL 开关。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`search-transliterate.ts`](../../../../src/lib/search-transliterate.ts) | 既有音译核心（拼音 + 假名/罗马音 + 加载硬化），本 PRD 的唯一接入点 |
| 上轮调研（本对话） | kuromoji vs kuroshiro vs lindera-wasm vs sudachi-wasm 对比 + 浏览器/桌面不分叉结论 |
| [`feedback_no_hidden_backend_flags`] | 回退 = git revert，不藏 flag |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | kuromoji `dicPath` 在 Electron `app://` 的最稳解析方式（打包为 asset 还是 `extraResources`？） | Open | Phase 2 验证；倾向 Vite `?url` / public 资源 + worker 内相对 fetch |
| 2 | 全汉字「同时拼音+罗马音」是否过度扩大命中（噪声）？ | Open（倾向接受） | 搜索是「能命中优先」；评分仍按相关度排序，罗马音/拼音误命中排在精确匹配之后 |
| 3 | 是否把 kuromoji 加载并入 `ensureTransliterationLoaded`，还是单独懒加载（仅纯汉字 JP 时触发）？ | Open（倾向单独懒加载） | 词典 ~12-18MB，比 pinyin-pro 重得多；仅在遇到纯汉字标题需要时再加载，避免无谓下载 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-23 | DoodleBear | Initial draft：纯汉字日文标题罗马音搜索（kuromoji 读音→wanakana 罗马音），与拼音并存；调研选定 `@sglkc/kuromoji`（纯 JS、浏览器/桌面不分叉、复用 wanakana）；Phase 1 可注入核心(TDD) + Phase 2 真词典打包 |

---

> **Note:** 复用既有地基——`searchVariants`（唯一接入点）、`wanakana`（读音→罗马音）、`ensureTransliterationLoaded` 硬化（懒加载 + 降级）。本 PRD 主要新增「kuromoji 分词读音」一块 + 词典打包，不重造搜索/音译管线。
