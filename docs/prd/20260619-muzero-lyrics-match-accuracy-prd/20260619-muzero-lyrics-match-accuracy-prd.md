# PRD: MUZERO 歌词自动匹配准确度优化（归一化 + 多变体阶梯 + 时长闸门 + 逐字优先）

**Status:** Draft
**Created:** 2026-06-19
**Author:** DoodleBear
**Module:** `src/lyrics/`（`build-query.ts` · `lrclib-map.ts` · `lrclib-provider.ts` · `netease-lyrics-provider.ts` · `match-text.ts`(new) · `registry.ts` · `provider.ts`）· `src/lyrics/auto-fetch.ts`（匹配进度 toast）· `src/db/types.ts`（`LyricsRecord` / `AppSettings` 附加字段）· `src/stores/notification-store.ts`（复用 `notify`）· Settings · i18n

> 接续 [`20260610-muzero-synced-lyrics-lrclib-prd`](../20260610-muzero-synced-lyrics-lrclib-prd/)（LRCLIB 自动抓词 + Apple Music 式逐行播放）、[`20260611-muzero-rich-lyrics-formats-prd`](../20260611-muzero-rich-lyrics-formats-prd/)（yrc/qrc/elrc/ttml 逐字格式）、[`20260613-muzero-amll-style-lyrics-engine-prd`](../20260613-muzero-amll-style-lyrics-engine-prd/) 与 [`20260614-muzero-netease-online-recommendations-prd`](../20260614-muzero-netease-online-recommendations-prd/)（NetEase provider）。本 PRD **不引入新 provider、不改 UI 体验**——只把现有「自动匹配哪一条歌词」的**召回率 + 准确度**提上去，并堵住「匹配到错版本却写进负缓存」的污染。纯函数为主、可穷举单测，落在 provider 边界内（规则 5）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 归一化 + 评分纯函数地基：`match-text.ts`（normalizeTitle / primaryArtist / scoreCandidate）+ 穷举单测，无 IO | ✅ Done | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | LRCLIB 多变体阶梯 + 时长容差闸门 + 候选评分接管 `pickBestHit` | ✅ Done | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | NetEase 搜索路径复用评分（时长 + 标题相似）+ 逐字 tier 收益对齐 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 匹配置信度落库（`LyricsRecord.match?`）+ 低置信不写负缓存 + 匹配进度 toast（正在匹配 → 结果，复用 `notify`）+ Settings 开关 + i18n | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

歌词自动匹配已经能跑（[`20260610` PRD](../20260610-muzero-synced-lyrics-lrclib-prd/) 全 5 phase done），但**召回与准确度有结构性短板**，集中在三处：

**A. Query 一次成型、零归一化（召回低）。** [`build-query.ts:14`](../../../src/lib/build-query.ts) 直接 `track.title` 原样、`trackArtists(track).join(", ")` 全员拼接，发给 LRCLIB / NetEase。真实元数据噪音极多：

- title 带版本后缀：`"Song (Live)"` / `"Song - Remastered 2011"` / `"Song (feat. B)"` / `"歌名 (伴奏)"`；
- artist 是合唱 `"A, B, C"`，但歌词库常只录主唱 `"A"`——`/api/get` 精确签名直接 miss；
- 全角括号 `（）`、`feat.`/`ft.`/`與`、首尾空白、大小写差异。

`/api/get`（精确签名）一旦 miss 就掉到 `/api/search`，而 [`buildSearchUrl`](../../../src/lyrics/lrclib-map.ts#L27) **还带着 `album_name`**——专辑名跨平台最不一致（Single 版 / 合辑 / 地区版），等于二次收紧，把本可召回的也滤掉。**全程没有"省略歌手只搜歌名"的降级**（用户原始诉求之一）。

**B. `pickBestHit` 只挑最近、不设闸门（准确度差 + 污染负缓存）。** [`lrclib-map.ts:89`](../../../src/lyrics/lrclib-map.ts#L89) 的 `pickBestHit` 按 `tier(synced>plain>instrumental)` + `|Δduration|` 选**相对最优**，但**从不拒绝绝对离谱的**：一首 3:30 的歌，库里只有个 1:05 的同名 demo / 错曲，照样被当成 `found` 写进 `lyrics` 表——而 `lyrics` 表带**负缓存语义**（[`auto-fetch.ts`](../../../src/lyrics/auto-fetch.ts) 命中即不再重试），于是**一次错配长期固化**，且会逐行高亮错词。同理 `/api/search` 只 `track_name` 兜底时（未来 D 项），同名歌一大把，没有标题相似度把关就是抽奖。

**C. 逐字优先只在 NetEase 内部成立，跨源/跨格式没拉通（体验未拉满）。** [`netease-lyric-map.ts:78`](../../../src/lyrics/netease-lyric-map.ts#L78) 已偏好 yrc>lrc，是对的；但 [`lrclib-map.ts` 的 `tier()`](../../../src/lyrics/lrclib-map.ts#L83) 把所有 synced 视为同级（LRCLIB 本就只有逐行，无妨），而 **`auto` provider 的 `firstHit`**（[`registry.ts:42`](../../../src/lyrics/registry.ts#L42)）是**"第一个非空即返回"**——它不比较两个源谁的歌词"更逐字 / 更贴时长"。对非 NetEase-id 曲，顺序恒为 `[lrclib, netease]`，于是**只要 LRCLIB 有一条 plain，就再也不看 NetEase 那条逐字 yrc**。用户诉求「优先有时间戳、甚至逐词」在跨源场景没兑现。

> 用户三条诉求 → 现状对照：**①多变体重试（省略歌手只匹配歌名）= 完全缺失**；**②按音频时长匹配 = 已做但无闸门、会错配固化**；**③优先带时间戳/逐词 = 单源内已做、跨源未拉通**。本 PRD 三条全收口。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户（owner）** | 听上传 / NetEase / QQ 流的歌，希望"自动就匹配上、且匹配对版本"，少手动校正。 | 全功能；匹配是后台自动行为，受既有 `autoFetchLyrics` 可见开关控制（规则 3），本 PRD 不新增隐藏开关 |

> 单角色产品（本地优先、无账号系统）。

### 1.3 Core Value

1. **召回率上去**：归一化标题/艺人 + 多级降级（精确 → 去后缀 → 主唱 → 去专辑 → 只标题），把"本来有词却 miss"的曲找回来——尤其上传曲（文件名脏）与合唱曲。
2. **准确度上去、错配不再固化**：时长容差闸门 + 标题相似度把关，**离谱候选判 miss 而非接受**；低置信不写负缓存，下次切回仍可重试或留给手动校正。
3. **逐字体验跨源拉满**：把"优先有时间戳、优先逐字"的偏好从 NetEase 内部提升为**跨 provider 的统一评分**——`auto` 不再"第一个非空即停"，而是在合理时间内取**更优**的一条。
4. **零新增 IO / 零新 vendor / 零新后端**：纯函数评分 + 既有端点的多次调用，全部走 `getAppFetch()`（规则 5/10）；不引入新依赖、不碰本地优先与 BYOK 纪律。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                         buildLyricsQuery(track)  —— 现状：title 原样 + 全员 artist
                                    │
                ┌───────────────────┴────────────────────┐
                │  本 PRD 新增：归一化 + 变体派生（纯函数）   │
                │  normalizeTitle()  去 (Live)/-Remastered/(feat.)/全角/trim/大小写 │
                │  primaryArtist()   "A, B, C" → 主唱 "A"（合唱降级用）            │
                └───────────────────┬────────────────────┘
                                    ▼
       LyricsQueryPlan { primary, variants[] }  ── 一个原始 + 若干降级变体（有序）
                                    │
                                    ▼
   ┌──────────────────────────── LRCLIB 阶梯（lrclib-provider.fetch） ───────────────────────────┐
   │  L0  /api/get   title+artist+album+duration       （精确签名，命中率最高）                   │
   │  L1  /api/get   normTitle+primaryArtist+duration   （去后缀 + 主唱）                          │
   │  L2  /api/search normTitle+primaryArtist           （去 album，客户端评分）                   │
   │  L3  /api/search normTitle                          （只标题 ← 用户诉求①；强时长+标题闸门）    │
   │     每级候选 → scoreCandidate(hit, query) → 过闸门(≥minConfidence)才接受，否则降一级           │
   └───────────────────────────────────────┬────────────────────────────────────────────────────┘
                                    ▼
                          LyricsHit | null（带 matched 元数据）
                                    │
   ┌──────────────── auto provider（registry.firstHit → bestHit 改造）─────────────────┐
   │  现状："第一个非空即返回"  →  改为：收集各源候选 → scoreCandidate 跨源择优        │
   │  逐字(yrc/qrc/ttml) > 逐行(lrc) > plain，再按 时长邻近 + 标题相似 加权             │
   │  （仍保 early-return：L0 精确签名命中即停，省额外出站）                            │
   └───────────────────────────────────────┬───────────────────────────────────────────┘
                                    ▼
        setTrackLyrics(record + match{confidence, durationDelta, titleSim})
                                    │
              低置信(<minConfidence) 且 status 会是 found  →  不写负缓存（见 §4.5）
                                    │
   ┌────────── 匹配进度 toast（auto-fetch.ts，复用 notify，受负缓存天然约束：每曲首次匹配才跑）──────────┐
   │  开始 fetch → notify.loading("正在匹配歌词…", {id: lyr:trackId})    （持久 toast，keyed 去重）       │
   │  结果就地 update/swap：found 高置信→success(自动消失) | found 低置信→info+「搜索」action            │
   │                       notFound→info "未找到歌词"+「搜索」action | error→静默(不打扰,现状)            │
   │  仅当前曲、每曲一次（shouldAutoFetchLyrics 为真才触发）；可被 Settings.lyricsMatchToasts 关（默认开）│
   └───────────────────────────────────────┬───────────────────────────────────────────────────────────┘
                                    │
                                    ▼ （显示链不变：resolveTrackLyrics → SyncedLyricsView）
```

**三个设计支点：**

| 支点 | 说明 |
|---|---|
| **归一化与评分收进一个纯函数文件 `match-text.ts`** | `normalizeTitle` / `primaryArtist` / `titleSimilarity` / `scoreCandidate` / `passesGate` 全是无 IO 纯函数，**穷举单测**（规则 7 精神）。provider 薄壳只负责"按 plan 发请求 + 调评分"，vendor 概念不泄漏（规则 5）。 |
| **变体阶梯是"降级 + 同步收紧闸门"** | 越往下（只标题）召回越广，但**接受门槛同步抬高**（L3 必须时长 + 标题双过闸），否则只标题匹配会引错词。闸门让"宁缺毋滥"可调。 |
| **置信度落库、低置信不固化** | `LyricsRecord` 附加可选 `match` 元数据（**非索引字段，不 bump DB 版本**）。低置信结果照常展示（聊胜于无），但**不写 `notFound`/不锁死**，给手动校正与后续重试留口（呼应 [`20260610` PRD §4.7](../20260610-muzero-synced-lyrics-lrclib-prd/) 负缓存策略，做更细的分级）。 |

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **归一化 / 评分** | 自研 `src/lyrics/match-text.ts`（纯函数，~120-180 LOC）| LRC 后缀/合唱拆分是小规模字符串规则，不引第三方（对齐 prd-create.md §3「优先 home-grown，避免 vendor lock-in」）。**不引入** fuzzy 库（fuse.js / leven 等）——标题相似用自研归一化后的 token Jaccard / 归一化 Levenshtein（短串足够，~30 LOC） |
| **变体派生** | `buildLyricsQueryPlan(track)`（扩 `build-query.ts`，纯函数）| 现 `buildLyricsQuery` 保留为"primary"，**附加** plan 派生；调用点（auto-fetch / 手动搜索）渐进迁移，不破坏现签名 |
| **LRCLIB 阶梯** | 改 [`lrclib-provider.ts:69` 的 `fetch`](../../../src/lyrics/lrclib-provider.ts#L69)（薄壳）+ [`lrclib-map.ts`](../../../src/lyrics/lrclib-map.ts) 新增 `buildSearchUrl` 变体 + `scoreCandidate`/`passesGate` | 全部落在 provider 内部，**对 store/UI 透明**——契约 `fetch(q)→LyricsHit\|null` 不变（规则 5）。注入 fetch 可确定性单测 |
| **跨源择优** | 改 [`registry.ts` 的 `createAutoLyricsProvider`](../../../src/lyrics/registry.ts#L38) `firstHit`→候选打分 | `auto` 内部逻辑改造，对外接口不变；仍尊重 `providersForQuery` 顺序作为同分 tie-break |
| **出站 HTTP** | 复用 `getAppFetch()` → 桌面 bridge（规则 5/10）| 阶梯/多源 = 同一端点多次调用，**全部走既有 bridge**，无新出站面；每次都挂 `AbortSignal`（切歌 abort）+ 8s timeout（[`lrclib-provider.ts:35`](../../../src/lyrics/lrclib-provider.ts#L35) 已有 `withTimeout`） |
| **置信落库** | `LyricsRecord` 附加 `match?`（[`provider.ts:48`](../../../src/lyrics/provider.ts#L48)）+ `TrackLyrics`（`db/types.ts`）| **非索引附加字段，不 bump DB 版本**（同 `matched` 现状：调试元数据，不进索引）；旧行无此字段时按"未知置信"处理 |

### 2.3 Project Structure

```
src/lyrics/
├── match-text.ts            # 新增：normalizeTitle / primaryArtist / titleSimilarity
│                            #        scoreCandidate / passesGate（纯函数，无 IO）
├── match-text.test.ts       # 新增：穷举单测（后缀剥离 / 合唱拆分 / 相似度 / 闸门边界）
├── build-query.ts           # 扩展：buildLyricsQueryPlan(track) 派生变体（保留 buildLyricsQuery）
├── build-query.test.ts      # 扩展：plan 变体序与去重
├── lrclib-map.ts            # 扩展：buildSearchUrl 接受 {dropAlbum, titleOnly} 选项；
│                            #        pickBestHit → 复用 scoreCandidate；新增 GATE 默认值
├── lrclib-map.test.ts       # 扩展：变体 URL / 评分接管 / 时长闸门拒绝
├── lrclib-provider.ts       # 改 fetch：单次 get/search → 阶梯（L0..L3，过闸即停）
├── lrclib-provider.test.ts  # 扩展：L0 命中即停 / L0 miss→L2 召回 / 全程低于闸门→null
├── netease-lyrics-provider.ts  # 搜索路径复用 scoreCandidate（标题相似 + 时长）
├── registry.ts              # createAutoLyricsProvider：firstHit → 跨源候选择优
├── registry.test.ts         # 新增/扩展：逐字 yrc 胜过先到的 lrc plain
└── provider.ts              # LyricsRecord/LyricsHit 附加 match?{confidence,durationDelta,titleSim}

src/lyrics/auto-fetch.ts     # 匹配进度 toast：开始 notify.loading → 结果 update/swap（复用 notify）
src/db/types.ts              # TrackLyrics extends LyricsRecord —— 自动带上 match?（无需改 store）；
                             # AppSettings += lyricsMatchToasts?（默认 true，可见开关）
src/stores/notification-store.ts  # 复用既有 notify.loading/update/success/info + actions（不新建通知系统）
src/components/settings/     # 「匹配通知」开关（默认开）—— 规则 3：runtime toggle = 可见 Settings 控件
src/i18n/locales/{en,zh,ja,ko}/common.json  # toast 文案（正在匹配/未找到/搜索）+ 低置信署名 + Settings（Phase 4）
```

> 新增源文件仅 `match-text.ts`（+test）——符合 prd-create.md §3「不新增源代码文件，除非引入新 parser/lib bridge」的精神：它是**新的匹配评分核**，是这条优化的"lib bridge"，其余全是**扩展既有文件**。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
buildLyricsQueryPlan(track)
  ├── primary    : 现 buildLyricsQuery（title 原样 + 全员 artist + album + duration）
  └── variants[] : 有序降级
        V1  normalizeTitle(title) + primaryArtist + album + duration      （去后缀/全角，主唱）
        V2  normalizeTitle(title) + primaryArtist            （去 album）
        V3  normalizeTitle(title)                            （只标题；需强闸门）
   去重（归一化后相同的变体折叠）；neteaseSongId 在则 plan 退化为单条（精确，无需变体）

scoreCandidate(hit, query) → { confidence: 0..1, durationDelta, titleSim, tier }
  tier         : wordSynced(0) < lineSynced(1) < plain(2) < instrumental(3)
  durationDelta: |hit.duration - query.duration|（query 无 duration → 中性 0.5 权重）
  titleSim     : titleSimilarity(normTitle(hit.trackName), normTitle(query.trackName)) ∈ 0..1
  confidence   : 加权合成（tier 主导 + 时长邻近 + 标题相似）

passesGate(score, level) → boolean   级越靠后（只标题）门槛越高
```

### 3.2 Database Schema

⚠️ 优先扩展、不重构。**本 PRD 不新建表、不 bump DB 版本。**

- **Current Schema:** [`src/lyrics/provider.ts:48`](../../../src/lyrics/provider.ts#L48) `LyricsRecord` / `LyricsHit`（行 65）；[`src/db/types.ts`](../../../src/db/types.ts) `TrackLyrics extends LyricsRecord`（带 `matched`、`fetchedAt`）。
- **Required Changes:**
  1. **`LyricsHit` / `LyricsRecord` 附加可选 `match`**（[`provider.ts`](../../../src/lyrics/provider.ts)）：
     ```ts
     export interface LyricsMatchInfo {
       confidence: number;       // 0..1 合成置信
       durationDelta?: number;   // |hit - query| 秒；query 无 duration 时 undefined
       titleSim?: number;        // 0..1 标题相似（精确签名命中时可省）
       via: "exact" | "norm" | "primaryArtist" | "noAlbum" | "titleOnly"; // 命中的变体级别
     }
     // LyricsRecord / LyricsHit 新增： match?: LyricsMatchInfo
     ```
  2. **`TrackLyrics` 自动继承**（`extends LyricsRecord`）——**无需改 `db/types.ts` 接口体**之外的东西，**无需改 `muzero-db.ts` 版本**（`match` 非索引，Dexie 存任意结构）。
  3. **`AppSettings` 附加 `lyricsMatchToasts?: boolean`**（[`src/db/types.ts`](../../../src/db/types.ts) 的 `AppSettings`，**非索引附加字段，settings 单行，无需 bump**）：匹配进度 toast 总开关，**默认 `true`**（见 [`DEFAULT_SETTINGS`](../../../src/db/types.ts)）。规则 3：runtime toggle = 可见 Settings 控件，不藏 flag。
- **Indexing:** 不新增索引。`match` 仅供 §4.5 写库决策 + 可选 UI 署名 + 调试。
- **Migration / Rollback:** 无迁移（纯附加非索引字段）。回滚 = `git revert`（规则 3）；旧行无 `match` → 按"未知置信"处理（UI 不显示置信、写库决策回退到现行为）。
- **Privacy:** `match` 只含数值/枚举，**不含**任何新增外发内容；归一化在本地完成，**发给 lrclib/netease 的仍只是 title/artist**（同现状，§8）。变体阶梯**不增加外发的数据种类**，只是同样的 title/artist 可能多发几次请求（隐私面不变，出站次数见 §4.6 上限）。

### 3.3 Data Relationship Diagram

```
Track ──buildLyricsQueryPlan──▶ LyricsQueryPlan{ primary, variants[] }
                                      │ (provider 内部消费，不落库)
                                      ▼
                               LyricsHit{ ...content, matched, match? }
                                      │
                                      ▼
Track ──1:0..1── TrackLyrics(&trackId)  extends LyricsRecord
                   ├── synced/plain/format/...        （内容，现状）
                   ├── status: found|notFound|instrumental
                   ├── matched{trackName,artistName,durationSec}  （现状，命中元数据）
                   └── match?{confidence,durationDelta,titleSim,via}  ← 本 PRD 新增
```

---

## 4. Provider / Matching Design

### 4.1 归一化（`match-text.ts`，纯函数）

```ts
/** 去版本后缀 / 全角括号 / feat. / trim / 折叠空白 / casefold。不改写真实标题语义。 */
export function normalizeTitle(raw: string): string
//  剥离尾部括注：(Live) (Remastered 2011) (feat. X) (Explicit) (Bonus Track) （伴奏） [Instrumental]
//  剥离破折后缀：" - Remastered" / " - Live at …" / " - 2011 Remaster"
//  全角→半角括号、CJK 标点归一；折叠连续空白；trim；toLowerCase（仅用于比较，不改展示）
//  注意：保留主标题里的有意义括注无法 100% 判别 —— 只剥「已知版本词表」+ 结构性尾括，白名单驱动

/** 合唱 "A, B & C feat. D" → 主唱 "A"（用于降级查询；不丢原始全员查询） */
export function primaryArtist(joined: string): string
//  按 , / & / feat. / ft. / x / × / 与 / 、 分隔取首段；trim

/** 0..1 标题相似：归一化后 token-set Jaccard 与归一化 Levenshtein 取高者（短串稳） */
export function titleSimilarity(a: string, b: string): number
```

**版本词表（白名单）** 维护在 `match-text.ts` 顶部常量（`live / remaster(ed) / instrumental / acoustic / demo / radio edit / explicit / clean / bonus / 伴奏 / 现场 / 翻自 …`），与 i18n 无关，是匹配规则。**只剥结构性尾括 + 词表命中**，避免误伤把括注当正名的歌（如 `(Don't Fear) The Reaper`——前置括注不剥）。

> **多语版本词表是尽力而为、不是主力召回（per Open Q2 决议）。** 跨语言/脏元数据的**主要召回手段是 artist-drop / title-only 变体（L3）**——「歌名+歌手匹配不到时，把歌手去掉、只用归一化歌名兜底」。词表只是锦上添花：缺一个日韩版本词（`ライブ`/`라이브`）顶多让该曲少召回一点，**不会错配**（仍有 L3 + 时长/标题闸门兜底）。所以词表**不追求穷尽**，优先把 artist-drop 那条路走稳。

### 4.2 候选评分 + 闸门（`match-text.ts`，纯函数）

```ts
export const MATCH_GATE = {
  durationToleranceSec: 8,   // 软阈：超出按比例扣分；
  durationHardSec: 20,       // 硬阈：超出直接 confidence→~0（拒绝离谱版本）
  minConfidence: 0.55,       // 接受门槛（默认级）
  titleOnlyMinSim: 0.82,     // 只标题变体(L3)额外要求的标题相似下限
} as const;

export function scoreCandidate(hit, query): LyricsMatchInfo
//  tierWeight: wordSynced 1.0 / lineSynced 0.9 / plain 0.6 / instrumental 0.2
//  durScore  : query.duration 缺 → 0.5（中性）；|Δ|≤tol → 1..；>hard → ~0
//  titleScore: titleSimilarity；精确签名(L0/L1)可信，给 1.0
//  confidence = wTier*tier + wDur*durScore + wTitle*titleScore   （权重和=1，常量可调）

export function passesGate(info, level): boolean
//  默认级：confidence ≥ minConfidence 且 durationDelta ≤ durationHardSec
//  titleOnly 级：再加 titleSim ≥ titleOnlyMinSim（堵同名错曲）
```

**`pickBestHit` 改造**（[`lrclib-map.ts:89`](../../../src/lyrics/lrclib-map.ts#L89)）：不再"tier + 最近 duration"两段比较，而是**全候选算 `scoreCandidate` 取 confidence 最高**，再 `passesGate` 过滤——**过不了闸门返回 null（判 miss），而非接受最优烂候选**。这是堵 §1.1-B 污染的关键一刀。

### 4.3 LRCLIB 多变体阶梯（`lrclib-provider.fetch` 改造）

[`lrclib-provider.ts:69`](../../../src/lyrics/lrclib-provider.ts#L69) 现状是 `get → 404 → search → pickBestHit` 一遍过。改为按 plan 逐级，**过闸即停**：

```ts
async fetch(q, signal) {
  const plan = buildLyricsQueryPlan(q);              // primary + variants
  // L0 精确签名（最高命中、最省）—— 过闸即返回（early-return 不变）
  const l0 = parseHit(await getJson(buildGetUrl(plan.primary)));
  if (l0 && passesGate(scoreCandidate(l0, plan.primary), "exact")) return withMatch(l0, "exact");
  // L1 归一化 + 主唱 精确签名
  const l1 = parseHit(await getJson(buildGetUrl(plan.v1)));
  if (l1 && passesGate(scoreCandidate(l1, q), "norm")) return withMatch(l1, "norm");
  // L2 search 去 album → 客户端评分
  const l2 = pickBestHit(parseSearchResults(await getJson(buildSearchUrl(plan.v2, {dropAlbum:true}))), q);
  if (l2) return withMatch(l2, "noAlbum");
  // L3 只标题 search → 强闸门（时长 + 标题相似）
  const l3 = pickBestHit(parseSearchResults(await getJson(buildSearchUrl(plan.v3, {titleOnly:true}))), q, "titleOnly");
  return l3 ? withMatch(l3, "titleOnly") : null;
}
```

- 每级 404 / 空 → 降级；HTTP 5xx → throw（保持现 `LyricsError` 语义，上层区分 notFound vs 错误）。
- **短路**：L0 命中即停，**最常见路径出站次数不变**（精确曲库命中率高）；只有 miss 才逐级追加请求。
- `buildSearchUrl` 扩 `{dropAlbum, titleOnly}` 选项（[`lrclib-map.ts:27`](../../../src/lyrics/lrclib-map.ts#L27)）——`dropAlbum` 去掉 `album_name`，`titleOnly` 连 `artist_name` 也去。

### 4.4 NetEase 搜索路径 + 跨源择优

- **NetEase 搜索打分**（[`netease-lyrics-provider.ts`](../../../src/lyrics/netease-lyrics-provider.ts)）：现 `pickClosestByDuration`（[`netease-lyric-map.ts:96`](../../../src/lyrics/netease-lyric-map.ts#L96)）只看时长。改为 `scoreCandidate`（时长 + 标题相似），**不改 neteaseSongId 精确路径**（songId 在 = 官方精确，跳过搜索，最高优先）。归一化标题也喂给 NetEase cloudsearch 关键词，提召回。
- **`auto` 跨源择优**（[`registry.ts:42` `firstHit`](../../../src/lyrics/registry.ts#L42)）：现"第一个非空即返回"改为——
  - **保留 early-return 的省流意图**：若某源返回**精确签名级（exact/norm，confidence 高）命中，直接采用**（最常见、最省）；
  - 否则**收集该 plan 下各源的候选**，`scoreCandidate` 跨源比较，**逐字 yrc/qrc/ttml 经 tier 自然胜过先到的 lrc plain**（兑现诉求③）；同分按 `providersForQuery` 既有顺序 tie-break。
  - 仍尊重短路：一旦拿到 confidence ≥ 高阈（如 0.9）的候选即停，不为榨取边际把所有源跑满（出站预算见 §4.6）。

### 4.5 写库决策：低置信不固化负缓存

接 [`auto-fetch.ts`](../../../src/lyrics/auto-fetch.ts) 写库分支：

| 结果 | confidence | 写库 |
|---|---|---|
| 命中且过闸 | ≥ minConfidence | `status:"found"` + `match`，正常缓存 |
| 命中但低置信（聊胜于无） | < minConfidence 但 > floor | **照常展示**，写 `status:"found"` + `match`，但 **UI 标"低置信/可能不准"**（Phase 4 i18n），**不锁死**：留「歌词不对?搜索」入口（[`20260610` PRD §5.6](../20260610-muzero-synced-lyrics-lrclib-prd/) 已有空态搜索）覆盖为 `manual` |
| 全级 miss / 过不了闸门 | — | `status:"notFound"` 负缓存（与现状一致：确实查无，避免每播放重打 API） |
| instrumental | — | `status:"instrumental"`（现状不变） |

> 关键区分：**"查无"才写负缓存（合理）；"匹配到但很可能是错版本"不该被当成查无固化**——后者现状会被 `pickBestHit` 当 found 接受并锁死（§1.1-B）。新逻辑里它要么过闸成 found（且带 confidence），要么过不了闸门成真 notFound——不再有"接受了一条烂的还锁死"的中间态。

### 4.6 出站预算 / Error Handling

- **出站上限（防阶梯放大）**：单次 `fetch` LRCLIB 最多 4 级（L0..L3）；`auto` 跨源最多 `providers × 阶梯`，但**精确命中短路**让常见路径仍是 1 次。**硬上限**：单曲单次匹配出站 ≤ 8 请求（常量），超出停止降级返回当前最优/ null，并 `log.debug`（规则 8）记实际级数，**不静默无限放大**（对齐 prd-create.md §4「无声 cap 要 log」）。
- 每级请求挂同一 `AbortSignal`（切歌 abort）+ 既有 8s timeout；切歌中途 abort 直接退出阶梯。
- 网络/5xx → throw `LyricsError`（不写库，下次可重试，**静默**走 logger，不打断播放——现状不变）。
- **Telemetry：** 本地优先无遥测（规则 1）。`match.confidence` 等只落本地库 / 本地 logger，**绝不外发**。归一化/评分全本地，无新出站数据种类。

### 4.7 匹配进度通知（in-app toast，per Open Q-toast 决议）

> 前作 [`20260610` PRD §4.7](../20260610-muzero-synced-lyrics-lrclib-prd/) 对抓词**全程静默**（失败不打扰）。本 PRD **有意打破"成功也静默"那一半**：用户希望看到"正在匹配 / 匹配到了 / 没匹配到"，因为**负缓存天然防刷**——同一首失败后落 `notFound` 记录，不会反复匹配（[`auto-fetch.ts` `shouldAutoFetchLyrics`](../../../src/lyrics/auto-fetch.ts) 命中记录即跳过），所以 toast 也不会刷屏。

**复用既有通知系统，不新建**：[`src/stores/notification-store.ts`](../../../src/stores/notification-store.ts) 的 `notify`（`loading`/`update`/`success`/`info` + `actions` 按钮 + `dismiss`），范式照搬 [`sync-indicator.ts`](../../../src/stores/sync-indicator.ts) 的"持久 `loading` toast → 就地 `update` → 终态 swap"。

**触发点**：[`auto-fetch.ts` `runAutoFetchLyrics`](../../../src/lyrics/auto-fetch.ts)（已是 current track 变化时的后台编排）。仅当 `shouldAutoFetchLyrics` 为真（即真要发起一次匹配，每曲一次）且 `settings.lyricsMatchToasts !== false` 时弹。

| 阶段 | toast | 说明 |
|---|---|---|
| **开始匹配** | `notify.loading(t("lyrics.matching"), { id: "lyr:"+trackId })` | 持久 toast，**key 用 trackId 去重**——切歌/重入不堆叠。"全部含正在匹配"= 用户明确选项 |
| **找到（高置信）** | `notify.success(t("lyrics.matched", { source }))`（就地 swap，**自动消失**） | 正确匹配只一闪而过，不留噪音 |
| **找到（低置信）** | `notify.info(t("lyrics.matchedLowConfidence"))` + `action:「搜索」` | 点 action 进既有歌词搜索面板（[`lyrics-search-panel.tsx`](../../../src/components/player/lyrics-search-panel.tsx)），覆盖为 `manual` |
| **未找到** | `notify.info(t("lyrics.notFound"))` + `action:「搜索」` | actionable：直接给手动入口 |
| **网络/错误** | **静默**（只 logger，规则 8） | 非播放错误、可重试，不打扰（**保持前作静默**，不退化成报错 toast） |

- **切歌取消**：current track 变了 → 既有 AbortController abort，同时 `notify.dismiss("lyr:"+oldTrackId)`（不留旧曲的"正在匹配"挂着）。
- **去重/防堆叠**：toast id 恒 `lyr:<trackId>`；同曲重入 `update` 而非新增。background 批量匹配（若有）不归这条路——auto-fetch 只对 current track 跑，**天然限于"听到哪首弹哪首"**，不会一次性弹一屏。
- **范围**：仅自动匹配（auto-fetch）弹。手动搜索面板有自己的 inline 反馈，不复用此 toast。

---

## 5. Frontend Design

> **匹配核心零 UI 改动**：归一化/阶梯/评分都在 provider 内部，显示链（`resolveTrackLyrics` → `SyncedLyricsView`）完全不动。下列是 **Phase 4** 的两处增量：匹配进度 toast（用户明确要的）+ 低置信署名 + Settings 开关，均复用既有组件。

### 5.0 匹配进度 toast（Phase 4，复用 `NotificationStack`）

设计见 §4.7。复用 [`notification-store`](../../../src/stores/notification-store.ts) + [`notification-stack.tsx`](../../../src/components/shell/notification-stack.tsx)（已挂 `main.tsx`，锚定左上、避开 PlayerDock）——**无新组件**。`loading` 态用既有 `Loader2` spinner icon，结果态用 `success`/`info` icon，`action:「搜索」` 用既有 `actions` 按钮槽。

### 5.1 低置信署名（Phase 4）

- 既有歌词来源署名（`lyrics.source` "歌词来自 {{source}}"）旁，**低置信时**追加一行可关提示：`lyrics.lowConfidence`（"自动匹配，可能不是该版本 · 点此搜索"），点击进既有空态搜索面板（[`lyrics-search-panel.tsx`](../../../src/components/player/lyrics-search-panel.tsx)）。
- 高置信 / 精确签名命中 **不显示任何额外噪音**（避免对正确匹配也打扰）。
- 纯展示读 `TrackLyrics.match?.confidence`，**不进 store**（规则 6，随既有 `useLiveQuery` 的歌词行一起来）。

### 5.2 Settings（Phase 4）

- 「歌词」/「播放」区加 `匹配通知` 开关（`settings.lyricsMatchToasts`，**默认开**）+ 一行说明（"匹配开始/结果会有轻提示；关闭后静默"）。规则 3：可见控件，不藏 flag。写法仿既有 `saveSettings({...})`。

### 5.3 State Management

- 无新 store / 无新 rAF。匹配是 `auto-fetch` 的后台编排（模块作用域 + AbortController，现状），`match` 元数据随 `lyrics` 表 `useLiveQuery` 自然流入（规则 6）。toast 走既有 `notify`（命令式，非组件 state）。

### 5.4 i18n（Phase 4，4 locale）

新增 key 先 en 再 zh/ja/ko：
- toast：`lyrics.matching`（"正在匹配歌词…"）、`lyrics.matched`（"已匹配歌词 · 来自 {{source}}"）、`lyrics.matchedLowConfidence`（"自动匹配，可能不是该版本"）、`lyrics.notFound`（"未找到歌词"）、`lyrics.searchAction`（"搜索"）。
- 署名/Settings：`lyrics.lowConfidence`、`lyrics.lowConfidenceHint`、`settings.lyricsMatchToasts`、`settings.lyricsMatchToastsHint`。

少 locale 标 "pending translation"（prd-create.md §3）。

---

## 6. Implementation Plan

> 遵循 prd-create.md §3「基础设施先于覆盖广度」：Phase 1 纯函数地基零风险先合，Phase 2/3 在其上叠加，Phase 4 才碰 UI。

### Phase 1: 归一化 + 评分纯函数地基

**Goal:** `match-text.ts` 全部纯函数 + 穷举单测就位，不接 provider/DB/UI。

**Tasks:**
- [ ] `match-text.ts`：`normalizeTitle`（词表 + 结构尾括 + 全角 + casefold）、`primaryArtist`、`titleSimilarity`、`scoreCandidate`、`passesGate`、`MATCH_GATE` 常量。
- [ ] `provider.ts`：`LyricsMatchInfo` 接口 + `LyricsRecord/LyricsHit.match?` 字段。

#### Phase 1 Checklist
- [x] `normalizeTitle` 穷举：`(Live)`/`- Remastered 2011`/`(feat. X)`/`（伴奏）`/`[Instrumental]` 剥离；**前置括注 `(Don't Fear) The Reaper` 不误伤**；全角括号归一；trim/折叠空白。
- [x] `primaryArtist` 穷举：`,` / `&` / `feat.` / `与` / `、` 分隔取主唱；单名不误拆（`Charli XCX`）。
- [x] `titleSimilarity`：完全相同=1、完全不同≈0、大小写/空白差≈1、词序差合理、小 typo 高。
- [x] `scoreCandidate`：tier 主导（yrc>lrc>plain>instrumental）；时长缺→中性；硬阈外→~0；报 durationDelta/titleSim。
- [x] `passesGate`：默认级 / titleOnly 级边界（minConfidence、durationHardSec、titleOnlyMinSim）。
- [x] 新测全过（23 例）+ biome 干净 + tsc 干净。

> **Phase 1 实现说明（2026-06-19）：** `src/lyrics/match-text.ts` 落地——`MATCH_GATE` 常量 + `normalizeTitle`/`primaryArtist`/`titleSimilarity`（token Jaccard ∪ 归一化 Levenshtein 取高）/`scoreCandidate`（tier×0.5 + 时长×0.3 + 标题×0.2）/`passesGate`（基线 minConfidence + 硬时长闸门，titleOnly 加标题相似下限）。`provider.ts` 加 `LyricsMatchInfo` 接口 + `LyricsHit/LyricsRecord.match?`。`match-text.test.ts` 23 例全绿，无 DB/UI 依赖。多语版本词表按 Open Q2 决议保持尽力而为（artist-drop/titleOnly 才是主召回）。

### Phase 2: LRCLIB 多变体阶梯 + 时长闸门

**Goal:** LRCLIB `fetch` 走 L0..L3 阶梯，`pickBestHit` 由 `scoreCandidate` 接管并设闸门；契约对外不变。

**Tasks:**
- [ ] `build-query.ts`：`buildLyricsQueryPlan(track)`（primary + variants，去重；neteaseSongId 在则退化单条）。
- [ ] `lrclib-map.ts`：`buildSearchUrl(q, {dropAlbum, titleOnly})`；`pickBestHit` 复用 `scoreCandidate` + `passesGate`（过不了→null）。
- [ ] `lrclib-provider.ts`：`fetch` 改阶梯（过闸即停 + 出站硬上限 + abort 退出）+ `withMatch` 注入 `match`。

#### Phase 2 Checklist
- [x] L0 精确命中 → 仅 1 次出站、`match.via="exact"` + confidence 落 hit（短路验证）。
- [x] L0 miss（title 版本后缀 + artist 合唱）→ L1 用归一化标题 + `primaryArtist` 召回成功（`via="norm"`）。
- [x] `buildSearchUrl(q,{dropAlbum})` 去 album、`{titleOnly}` 只留 track_name（URL 单测）。
- [x] 只剩同名错版本（Δduration 30/40s）→ `pickBestHit`/`fetch` **判 null（拒绝）**，不接受。
- [x] titleOnly 级：时长邻近但标题不符（`Completely Different`）→ 拒绝（titleOnly 闸门）。
- [x] `normalizedDiffers=false` 时跳过 L1，不发冗余请求（plan 单测 + provider 调用次数）。
- [x] 现有 LRCLIB 单测全保持绿（pickBestHit/fetch 语义兼容）。
- [x] `src/lyrics/` 228 测试绿 + biome 干净 + tsc 干净。

> **Phase 2 实现说明（2026-06-19）：** `build-query.ts` 加 `buildLyricsQueryPlan(q)`（primary + normalized + `normalizedDiffers`）。`lrclib-map.ts`：`buildSearchUrl` 加 `{dropAlbum,titleOnly}` 选项；`pickBestHit` 改为 `scoreCandidate` 最高置信 + `passesGate`（过不了→null），新增 `attachMatch`。`lrclib-provider.ts` `fetch` 改 L0→L1→L2→L3 阶梯：L0/L1 精确签名（gate `exact`/`norm`），L2 search 去 album（`noAlbum`），L3 只标题（`titleOnly` 强闸门）；每级 abort 退出，404 降级、5xx throw。出站天然 ≤4（L1 可跳）。新增 11 例，`src/lyrics/` 共 228 例全绿。

### Phase 3: NetEase 搜索打分 + auto 跨源择优

**Goal:** NetEase 搜索路径复用 `scoreCandidate`；`auto` 不再"第一个非空即停"，跨源按置信择优（逐字优先兑现）。

**Tasks:**
- [ ] `netease-lyric-map.ts` / `netease-lyrics-provider.ts`：搜索候选用 `scoreCandidate`（标题相似 + 时长）；songId 精确路径不变；归一化标题喂 cloudsearch。
- [ ] `registry.ts` `createAutoLyricsProvider.firstHit`：精确签名命中短路；否则收集候选跨源择优 + 高阈短路 + tie-break 保既有顺序。

#### Phase 3 Checklist
- [ ] NetEase songId 在 → 走精确，**不进搜索打分**（路径不回归）。
- [ ] auto：LRCLIB 先返回 plain、NetEase 有 yrc → **采用 NetEase yrc**（tier 胜出，诉求③）。
- [ ] auto：LRCLIB exact 高置信命中 → 短路，**不再打 NetEase**（省流验证）。
- [ ] auto：某源 throw、另一源命中 → 返回命中（错误不阻断，现状语义保持）。
- [ ] `make check` 绿。

### Phase 4: 置信落库决策 + 匹配进度 toast + 低置信署名 + Settings

**Goal:** 低置信不固化负缓存；匹配开始/结果走 in-app toast（复用 `notify`）；低置信署名入口；`匹配通知` Settings 开关。

**Tasks:**
- [ ] `auto-fetch.ts` 写库分支按 §4.5 表分级（found 带 match / 真 notFound）。
- [ ] `auto-fetch.ts` 匹配进度 toast（§4.7）：开始 `notify.loading`（keyed `lyr:trackId`）→ 结果 swap（found/低置信/notFound + 「搜索」action）；error 静默；切歌 `notify.dismiss`；受 `lyricsMatchToasts` 开关 + `shouldAutoFetchLyrics` 约束。
- [ ] `db/types.ts`：`AppSettings.lyricsMatchToasts?`（默认 true，`DEFAULT_SETTINGS`）。
- [ ] Settings「匹配通知」开关 + 说明；`lyrics.source` 署名旁低置信提示 + 进既有搜索面板。
- [ ] i18n（§5.4）en→zh/ja/ko。

#### Phase 4 Checklist
- [ ] 高置信 found → 正常缓存、无额外 UI 噪音；toast 一闪即逝（success 自动消失）。
- [ ] 全 miss → `notFound` 负缓存（现状保持，避免重打）；toast = `info` + 「搜索」action。
- [ ] 低置信 found → 展示 + 标低置信 + 搜索入口；手动覆盖为 `manual`（不被自动覆盖，[`20260610` §4.8](../20260610-muzero-synced-lyrics-lrclib-prd/)）。
- [ ] toast id `lyr:trackId` 去重：快速切歌不堆叠；切歌 dismiss 旧曲 loading toast。
- [ ] `lyricsMatchToasts:false` → 全程静默（仍正常写库）。
- [ ] error → 静默（不弹错误 toast，保持前作语义）。
- [ ] `make check` 绿；i18n 4 locale（缺则标 pending translation）。

---

## 7. Out of Scope

- **新 provider / 新 vendor**：不接 QQ 音乐歌词、不接 Musixmatch/Genius；只优化现有 LRCLIB + NetEase + AMLL 的匹配。（QQ 流见 [`20260616-muzero-qq-music-stream-source-prd`](../20260616-muzero-qq-music-stream-source-prd/)，其歌词另议。）
- **歌词内容编辑器 / 时间轴微调 UI**：本 PRD 只管"选对哪条"，不管"选后编辑"（已有手动粘贴/编辑，[`20260610` §5.6](../20260610-muzero-synced-lyrics-lrclib-prd/)）。
- **离线声学指纹 / AcoustID 匹配**：纯 metadata 匹配，不引入音频指纹（重、需外部服务，违本地优先）。
- **机器学习 / 模糊匹配大库**：不引 fuse.js 等第三方 fuzzy 库；标题相似用自研短串算法即可。
- **DB schema 大改 / 版本 bump**：`match` / `lyricsMatchToasts` 都是非索引附加字段，不 bump、不迁移。
- **系统 / OS 级通知**：匹配通知**只做 in-app toast**（Open Q-toast 决议）；不走 Electron `Notification` / 原生系统通知（更重、且匹配是听歌时的前台行为，无需后台弹）。未来若有诉求另开 PRD。
- **手动搜索面板的反馈**：手动搜索有自己的 inline UI，不复用匹配 toast。
- **遥测匹配命中率**：本地优先无遥测（规则 1）；命中率评估靠本地 logger + 手测。

---

## 8. Security / Privacy Considerations

- **本地优先 / 无后端**（规则 1）：归一化、评分、阶梯决策全在设备本地；唯一出站仍是 LRCLIB / NetEase 的只读歌词查询，受 `autoFetchLyrics` 可见开关控制（规则 3，无隐藏 flag）。
- **隐私面不扩大**：变体阶梯**不新增外发的数据种类**——发出去的仍只是 title/artist（归一化后甚至更少专辑/合唱信息）。代价是 miss 时同样的 title/artist 可能多发几次请求；出站次数有硬上限（§4.6）。
- **BYOK 纪律**（规则 2）：NetEase cookie 仍只从 settings 读、不入日志；`match` 元数据只含数值/枚举，不含 key、不含外发内容。
- **回退** = `git revert` + 重发版（规则 3）；不藏 `localStorage`/URL/`window.*` 开关。
- **Telemetry whitelist**：即便将来加本地诊断，也只记 `via` / `confidence`（bool/enum/number），**绝不记** title/artist/歌词文本（对齐 [`structured-diagnostics-trace`](../20260611-muzero-structured-diagnostics-trace-prd/) 与 prd-create.md §3 telemetry 白名单）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260610-muzero-synced-lyrics-lrclib-prd`](../20260610-muzero-synced-lyrics-lrclib-prd/) | 自动抓词 + 负缓存 + 手动校正 + R2 同步地基（本 PRD 接续其匹配层） |
| [`20260611-muzero-rich-lyrics-formats-prd`](../20260611-muzero-rich-lyrics-formats-prd/) | yrc/qrc/elrc/ttml 逐字格式 + `parse.ts` 格式探测（tier 的逐字依据） |
| [`20260613-muzero-amll-style-lyrics-engine-prd`](../20260613-muzero-amll-style-lyrics-engine-prd/) | AMLL TTML provider（neteaseSongId 精确路径，跨源择优需尊重） |
| [`20260614-muzero-netease-online-recommendations-prd`](../20260614-muzero-netease-online-recommendations-prd/) | NetEase provider + cloudsearch（搜索打分复用其 search） |
| [`20260616-muzero-qq-music-stream-source-prd`](../20260616-muzero-qq-music-stream-source-prd/) | QQ 流（其歌词来源 out of scope，未来另议） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `MATCH_GATE` 各阈值（minConfidence 0.55 / durationHardSec 20 / titleOnlyMinSim 0.82）初值是否合理？ | **Resolved** | 初值合理（owner 确认）。仍建议 Phase 2 用一批已知曲（合唱/版本后缀/同名错曲）实测微调；阈值为常量，调参=改常量+revert，不做 runtime flag |
| 2 | `normalizeTitle` 多语版本词表覆盖到哪？ | **Resolved** | **词表只是尽力而为，不是主力**。跨语言/脏元数据的主召回是 **artist-drop / title-only（L3）**——"歌名+歌手匹配不到时去掉歌手、只用归一化歌名"。词表缺漏只降召回不致错配（L3 + 闸门兜底）。优先把 artist-drop 走稳（§4.1 已据此调整）|
| 3 | auto 跨源是否值得为逐字把所有源都跑满？ | **Resolved (best practice)** | 精确高置信命中短路省流；仅低置信时才跨源榨取逐字 yrc（§4.4）。高阈 0.9 随 Q1 校准 |
| 4 | 低置信结果"展示+标记"还是"不展示"？ | **Resolved (best practice)** | **展示+标记+搜索入口**（聊胜于无、不锁死，§4.5）。`匹配通知` 开关已给保守用户静默途径；如再需"低置信不显示"另加可见 Settings 控件（不藏 flag）|
| 5 | 匹配通知形态与时机？ | **Resolved** | **in-app toast**（非系统通知）；**全部事件**（正在匹配 → found/低置信/notFound），error 静默。负缓存天然防刷；toast 受 `lyricsMatchToasts` 开关（默认开）控制（§4.7）|

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-19 | DoodleBear | Initial draft —— 归一化 + 多变体阶梯 + 时长容差闸门 + 跨源逐字择优 + 置信落库 |
| 2026-06-19 | DoodleBear | Open Q1–4 定稿（Q2 改：词表降级、artist-drop 提为主召回）；新增 §4.7 匹配进度 in-app toast（复用 `notify`，全事件 + 负缓存防刷 + `lyricsMatchToasts` 开关）；Phase 4 扩 toast/Settings |

---

> **Note:** 本 PRD 严格走"扩展既有 provider 边界、不新增 vendor/后端/UI"路线，唯一新源文件 `match-text.ts` 是匹配评分核（lib bridge 性质）。所有匹配逻辑落纯函数 + 穷举单测（规则 7），对 store/UI 透明（规则 5/6）。
