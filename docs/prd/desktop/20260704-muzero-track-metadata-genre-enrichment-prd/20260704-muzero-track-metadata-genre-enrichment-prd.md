# PRD: 曲目元数据补齐（风格 / 流派 / 情绪标签）— 让导入歌曲能被 DJ 过滤

**Status:** Draft
**Created:** 2026-07-04
**Author:** MUZERO Team
**Module:** enrich/*（新，镜像 `src/lyrics/`）· db/types（`Track.enrichment` 追加字段）· dj/dj-engine（RecentTrack.genres）· chat/dj-chat-tools（library_search 按风格过滤）· settings

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 数据模型 + enrichment 契约（独立 `enrichments` 表 + Zod schema + 纯 normalize 映射） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Provider registry + MusicBrainz（keyless / web 可用）+ 后台 auto-enrich 队列 + DJ 接线 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Last.fm（BYOK，标签质量最高）+ Discogs（style 分类法）+ auto 组合 + Settings 面板 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 华语复用：QQ 原生 genre provider（排首、自我 gate）；NetEase 回退外部库 | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 消费方接线：DJ 续歌 + chat agent 按风格过滤 + 搜索语料 + annotation 手动补齐 + i18n | ✅ Completed | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | （可选 / 可拆独立 PRD）Essentia.js 内容分析兜底：零元数据也能出风格 | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

产品经理反馈：**AI DJ 目前只能靠「歌名 + 歌手」来判断和过滤歌曲，对外界导入的歌曲很不友好**。希望即便是用户自己导入 / 从流媒体拉进来的歌，也能被较好地过滤——**如果能拿到歌曲的风格 / 流派 / 情绪等信息就很好**。

关键事实：DJ 的 prompt **早就在消费风格数据**了。[`dj-prompt.ts`](../../../../src/dj/dj-prompt.ts) 的 `RecentTrack` 有 `metadata.genres`（第 12 行）和 `tags`（第 16 行）两路，`dj-engine.ts` 第 183–188 行会把 `track.mediaMetadata.genres` 灌进 `RecentTrack.genres`。也就是说**消费端是通的，缺的是「导入 / 外部曲目根本没有人往这些字段里填风格」**。

三类曲目的现状：

| 曲目来源 | 有没有风格数据 | 缺口 |
|---|---|---|
| **AI 生成**（`origin: "generated"`） | 有——`brief.caption`（genre/instrumentation/mood）+ `mediaMetadata.parser: "track-brief"` | 无缺口 |
| **用户上传文件**（`origin: "uploaded"`） | **仅当文件 ID3 带 genre tag 才有**（`music-metadata` parser 解析）；大量文件、被抹过标签的、AI 站下载的都没有 | **主要缺口** |
| **流媒体导入**（netease / qq / bili / youtube） | 源站其实**知道**风格，但当前导入链路没把它带进来 | **次要缺口（华语尤甚）** |

所以本 PRD 要做的事很聚焦：**给「没有风格数据」的曲目补一路 `genres / styles / moods`，写进一个新的追加字段，让 DJ 续歌、DJ chat agent 的 `library_search`、以及用户搜索三个消费方自动受益。**

这不是「DJ 读不到风格」的问题，而是「风格数据源缺失」的问题。参照系已经现成：[`src/lyrics/`](../../../../src/lyrics/) 用完全一样的形状解决了「导入曲目没有歌词」——pluggable provider registry（[`registry.ts`](../../../../src/lyrics/registry.ts)）+ 外部 API provider（[`lrclib-provider.ts`](../../../../src/lyrics/lrclib-provider.ts)，走 `getAppFetch`）+ 后台 auto-fetch 队列（[`auto-fetch.ts`](../../../../src/lyrics/auto-fetch.ts)，失败即背景非事件）+ 纯匹配（[`match-text.ts`](../../../../src/lyrics/match-text.ts)）+ 负缓存。**本 PRD 的 `src/enrich/` 就是 `src/lyrics/` 的同构复刻。**

### 1.2 资源库调研结论（2026-07 复核）

给定 (歌手, 歌名) 查风格标签，主流资源库现状（已用 web 搜索复核当前可用性，见 §9 Related）：

| 资源库 | 给什么 | key | CORS / 平台 | 定位 |
|---|---|---|---|---|
| **MusicBrainz** | genre 标签（**录音级稀疏 / 艺人级密集**）+ MBID | 无需 | **发 CORS 头 → web 也能用** | **v1 首发 + keyless 基线**；**E2E 实测艺人级覆盖华语**（周杰伦→mandopop/中国风、邓紫棋→cantopop/r&b）；录音→艺人回退；1 req/s |
| **Last.fm** ⭐ | `track.getTopTags` 众包标签（genre + mood + style 混合，质量最好） | 免费 key（BYOK） | 不发宽松 CORS → **仅桌面**（muzfetch） | v1 主力（欧美/独立音乐标签最丰富） |
| **Discogs** | 精编 genre + **style** 二级分类法 | 免费 token（BYOK） | 仅桌面（muzfetch） | 可选；style 粒度比众包干净 |
| **QQ 音乐**（已接入） | ✅ **原生 genre + 语种**（`data.info.genre`/`info.lan`，**E2E 实测确认**，见 §Phase 4） | 复用现有登录 | 仅桌面 | **华语曲目最佳来源**：稻香=Pop/国语 · Yellow=Alternative/英语 |
| **NetEase**（已接入） | ❌ **song/detail 无 genre**（**E2E 实测确认**，`genreFields:[]`） | — | 仅桌面 | 只能提供 artist/title 供外部库查；自身不产 genre，须回退 Last.fm/MusicBrainz |
| **Essentia.js**（内容分析） | 从音频字节推理 genre / mood | 无（本地模型） | worker，全平台 | 零元数据也能出结果；但模型权重数十 MB，Phase 6 / 可拆 |
| ~~Spotify audio-features~~ | ~~danceability/energy/genre~~ | — | — | ❌ **已于 2024-11-27 对新应用停用**，不可选，别再考虑 |

### 1.3 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **AI DJ / DJ chat 用户** | 导入的歌被自动补上风格 → DJ 续歌上下文更准、`library_search` 能按「放点 city pop / lo-fi」这种风格过滤 | 全平台（消费端），桌面补齐质量最高 |
| **音乐收藏用户** | 上传 / 流媒体导入的曲目在搜索里能被风格命中；annotation editor 里可手动「补齐风格」 | 全平台 |
| **web 轻量用户** | 只有 MusicBrainz 一路补齐（keyless + CORS）；Last.fm / Discogs / 华语源在桌面才启用 | web 降级 |

### 1.4 Core Value

1. **导入即可过滤**：给「歌名+歌手之外一无所知」的导入曲目补上可过滤的风格维度，直接命中 PM 诉求。
2. **消费端零改造受益**：写进 `Track.enrichment` 后，DJ 续歌（RecentTrack.genres）、chat agent（library_search）、搜索三路**自动**能用，不动 `TrackBrief` 契约。
3. **完全复用既有惯例**：`src/enrich/` 复刻 `src/lyrics/`（provider registry + 后台队列 + 负缓存 + BYOK + getAppFetch），零新架构风险；BYOK 第三方 API 不违反本地优先（同 musicgen / LLM）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
导入 / 上传 / 流媒体落库
        │
        ▼
  Track（mediaMetadata.genres 可能为空）
        │  播放变 current 时 / 导入后台批量（镜像 lyrics auto-fetch）
        ▼
  shouldAutoEnrich(track, settings, existing)  ── 纯 gate（无 key/关闭/已补/生成曲 → false）
        │ true
        ▼
  ┌──────────────  src/enrich/（镜像 src/lyrics/）  ──────────────┐
  │  registry.ts → MetadataEnrichmentProvider（按 settings 顺序）    │
  │    musicbrainz-provider   (keyless, web 可用)                   │
  │    lastfm-provider        (BYOK key, 桌面)                      │
  │    discogs-provider       (BYOK token, 桌面, style)             │
  │    ↑ 每个 provider 三个纯函数：mapQuery / parseResponse / toHit  │
  │       HTTP 一律 getAppFetch() → muzfetch 代理（rule 10）        │
  └───────────────────────────────┬───────────────────────────────┘
                                  │ EnrichmentHit（rawTags）
                                  ▼
                normalize.ts（纯：canonical genre/style 映射 + 去重）
                        （可选 LLM 归一化：Vercel AI SDK BYOK，脏标签才走）
                                  │ EnrichmentRecord（genres/styles/moods + match 置信度）
                                  ▼
              setTrackEnrichment(id, rec) → Track.enrichment（追加字段，非索引，无 schema bump）
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
  dj-engine.ts               dj-chat-tools.ts          track-search.ts
  RecentTrack.genres =       library_search 支持       matchesQuery 纳入
  ∪(mediaMetadata.genres,    按 genre/style 过滤        enrichment.genres
    enrichment.genres)       （PM 的「过滤」落点）       （风格词能搜到歌）
```

**华语路（Phase 4，已 E2E 实测）**：**QQ** 导入时 `get_song_detail_yqq` 的 `data.info.genre`/`info.lan` 本就带人类可读流派+语种（实测 Pop/Alternative + 国语/英语），直接映射进 `EnrichmentRecord`（`source: "qq"`），**不发新请求、不新增网络栈**——复用 [`qq-source.ts`](../../../../src/streamsrc/qq/qq-source.ts) 详情解析。**NetEase** 实测 `v3/song/detail` **无 genre**（[`netease-source.ts`](../../../../src/streamsrc/netease/netease-source.ts)），只把 artist/title 交给外部 provider 补齐。

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Provider 边界** | 新 `MetadataEnrichmentProvider` 接口 + registry | 镜像 [`LyricsProvider`](../../../../src/lyrics/provider.ts) / `MusicGenProvider`；**禁止** `if (source===…)` 散落 |
| **外部 HTTP** | [`getAppFetch()`](../../../../src/lib/platform.ts) → Electron `muzfetch://` 代理 | rule 10；绕 CORS / mixed-content；worker 里没有 bridge → 补齐跑主线程 |
| **后台补齐队列** | 镜像 [`auto-fetch.ts`](../../../../src/lyrics/auto-fetch.ts)：`shouldAutoEnrich` 纯 gate + 负缓存 + 失败即背景非事件 | rule 8；一次一首、幂等、不 toast、不阻塞播放 |
| **契约校验** | Zod 4 `enrichmentResultSchema` | 与 `TrackBrief` 同纪律：provider 输出统一校验后才落库 |
| **归一化** | 纯 canonical genre/style 映射（默认，离线）+ 可选 LLM（Vercel AI SDK BYOK） | 纯映射穷举单测（rule 7）；LLM 仅处理脏/歧义标签，无 key 也能跑 |
| **持久化** | `Track.enrichment?` 追加、非索引字段 | 同 `coverThumbhash` / `mediaMetadata` 追加模式 → **无 Dexie version bump** |
| **消费方** | dj-engine / dj-chat-tools / track-search | 均为既有文件的**追加式**改动，无新播放/检索通路 |

### 2.3 Project Structure（改动点；append-only，镜像 `src/lyrics/`）

```
src/
├── enrich/                              # [新] 整个模块镜像 src/lyrics/
│   ├── provider.ts                      # [新] MetadataEnrichmentProvider 接口 + EnrichmentQuery/Hit/Record + EnrichmentSource union
│   ├── registry.ts                      # [新] pluggable registry（按 settings 顺序解析 provider）
│   ├── build-query.ts                   # [新] Track → EnrichmentQuery（artists+title from mediaMetadata）纯
│   ├── normalize.ts                     # [新] 纯：canonical genre/style 映射 + 去重 + 置信度
│   ├── normalize.test.ts                # [新] 穷举单测（脏标签 → 规范标签）
│   ├── musicbrainz-provider.ts          # [新] Phase 2：三纯函数 + getAppFetch（keyless）
│   ├── musicbrainz-provider.test.ts     # [新]
│   ├── lastfm-provider.ts               # [新] Phase 3：BYOK key（settings 行）
│   ├── discogs-provider.ts              # [新] Phase 3：BYOK token（style 分类法）
│   ├── auto-enrich.ts                   # [新] 后台补齐编排（shouldAutoEnrich 纯 gate + record-from-hit）
│   └── auto-enrich.test.ts              # [新] fake-indexeddb + canned provider 集成测
├── db/
│   ├── types.ts                         # [改] +Track.enrichment?: TrackEnrichment（追加非索引）+ TrackEnrichment/EnrichmentSource
│   └── repositories.ts                  # [改] +setTrackEnrichment / getTrackEnrichment（与 setTrackTags 同段）
├── dj/
│   └── dj-engine.ts                     # [改] RecentTrack.genres = ∪(mediaMetadata.genres, enrichment.genres/styles)
├── chat/
│   ├── dj-chat-tools.ts                 # [改] library_search 增加 genre/style 过滤维度
│   └── dj-chat-tool-descriptions.ts     # [改] 工具描述补「可按风格过滤」
├── lib/
│   └── track-search.ts                  # [改] matchesQuery 纳入 enrichment.genres（不进用户 tag chip）
├── components/
│   ├── track/annotation-editor.tsx      # [改] +「补齐风格」按钮 + 只读风格 chips（与用户 tag 区分）
│   └── settings/                        # [改] 元数据补齐面板（autoEnrich 开关 + provider 顺序 + Last.fm/Discogs key + 可选 LLM 归一化）
├── stores/
│   └── player-store.ts                  # [改] track 变 current / 导入后触发 auto-enrich（镜像 lyrics 触发点）
├── db/types.ts (AppSettings)            # [改] +autoEnrich / enrichProviderOrder / lastfmApiKey / discogsToken / enrichLlmNormalize
└── i18n/locales/{en,zh,ja,ko}/common.json  # [改] enrich.* 文案（4 语言全量）

# Phase 6（可选）
src/workers/                             # [新] essentia-enrich.worker.ts（内容分析，懒加载模型，仅在无元数据命中时跑）
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
enrichments 表（v32，1:1 via &trackId）——【实现修正】独立表，NOT 在 Track 行
 TrackEnrichment extends EnrichmentRecord
      ├─ id: string / trackId: string    ← 表主键 + 唯一索引
      ├─ source: EnrichmentSource        ← musicbrainz|lastfm|discogs|qq|netease|content|manual
      ├─ genres: string[]                ← 规范化后（canonical）
      ├─ styles?: string[]               ← 更细（Discogs style）
      ├─ moods?: string[]                ← last.fm 情绪类 tag / essentia
      ├─ rawTags?: string[]              ← 归一化前原始标签（调试 / 重新归一化用）
      ├─ status: "found" | "notFound"    ← 负缓存，避免反复空查
      ├─ match?: EnrichmentMatchInfo     ← 置信度 + via(recording|artist|native|search|manual)
      └─ fetchedAt: number

Track.mediaMetadata.genres?: string[]   ← 文件 ID3 自带（已有，DJ 已消费）；与 enrichment 表物理隔离
```

**为什么独立 `enrichments` 表、不写进 Track 行（也不写 `mediaMetadata.genres` / 用户 `tags`）：**
- **性能（实现期关键修正）**：enrichment 是「每首首次播放时写一次」。若写进 `tracks` 行，会在**每首歌首播时**触发虚拟队列/列表 liveQuery 扇出（正是 switch-song / like-toggle 扇出修复消除掉的成本）。故**镜像 `lyrics` 表**（v20，注释明写「NOT on the Track row」），enrichment 走独立表 → 写入不碰 `tracks` 表、零列表扇出。
- 与文件自带 genre **物理隔离** → 可区分「文件本来就有的」vs「我们补的」，可整批重新归一化 / 换 provider 重取，不覆盖文件真值。
- 不污染用户 `tags`（"音乐承载回忆" 的个人标注空间）；但 DJ / 搜索照样能读 enrichment（DJ 走 `getEnrichmentsByTrackIds` 批量 join）。

### 3.2 Database Schema

- **Current Schema:** [`src/db/types.ts`](../../../../src/db/types.ts) `Track`、`TrackMediaMetadata`（已含 `genres?: string[]`）、`TrackLyrics`（独立表先例）。
- **Required Changes（已实现）:**
  - 新增 `enrichments` 表（[`muzero-db.ts`](../../../../src/db/muzero-db.ts) `this.version(32).stores({ enrichments: "id, &trackId" })`）+ `EntityTable` 声明。
  - 新增 `TrackEnrichment`（[`types.ts`](../../../../src/db/types.ts)）+ `EnrichmentRecord`/`EnrichmentSource`/`EnrichmentMatchInfo`（[`enrich/provider.ts`](../../../../src/enrich/provider.ts)）。
  - repo：`getTrackEnrichment`/`getEnrichmentsByTrackIds`/`setTrackEnrichment`/`clearTrackEnrichment`（[`repositories.ts`](../../../../src/db/repositories.ts)，镜像 lyrics repo）。
  - `AppSettings` 追加 `autoEnrich?: boolean`（默认 **true**，与 `autoFetchLyrics` 同 egress/隐私画像）；`lastfmApiKey`/`discogsToken`/`enrichProviderOrder` 留 Phase 3。
- **Data Migration:** **Dexie v31→v32，加新 `enrichments` store**（新表 = 干净追加 bump，legacy 行无需 backfill；不原地改既有 stores）。选独立表而非 Track 追加字段是**为避开列表扇出**（见上）。
- **Constraints & Indexing:** `enrichments` 只索引 `&trackId`（唯一，1:1 点读）；`EnrichmentSource` 用集中 `ENRICHMENT_SOURCES as const` 做单一真值来源（同 [`LYRICS_SOURCES`](../../../../src/lyrics/provider.ts)）。
- **Rollback Plan:** `git revert` + redeploy；`enrichments` 表是惰性数据，回滚后 consumer 直接忽略（rule 3）。
- **Privacy & Retention:** enrichment 全是公开曲目元数据（风格标签），非 PII；`rawTags` 不含用户内容。**BYOK key 只进 `settings` 行**，永不进 enrichment / 日志（rule 2）。

### 3.3 契约（Zod）

```typescript
// src/enrich/provider.ts —— 与 TrackBrief 同纪律：provider 输出统一校验后才落库
export const ENRICHMENT_SOURCES = [
  "lastfm", "musicbrainz", "discogs", "netease", "qq", "content", "manual",
] as const;
export type EnrichmentSource = (typeof ENRICHMENT_SOURCES)[number];

export const enrichmentResultSchema = z.object({
  genres: z.array(z.string()).max(12).default([]),
  styles: z.array(z.string()).max(12).optional(),
  moods: z.array(z.string()).max(12).optional(),
  rawTags: z.array(z.string()).max(50).optional(),
});

export interface EnrichmentQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  /** 源站曲目 id（netease/qq），命中时免模糊搜索直接取详情 genre。 */
  externalId?: string;
  /** MBID：文件 ID3 已带 musicBrainzRecordingId 时精确查 MusicBrainz。 */
  musicBrainzRecordingId?: string;
}

export interface MetadataEnrichmentProvider {
  readonly id: EnrichmentSource;
  readonly label: string;
  /** 命中返回 hit，未命中返回 null（写负缓存），网络/服务端错误 throw（背景吞掉）。 */
  fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null>;
  /** 手动补齐：列候选（annotation editor 用户挑选）。 */
  search?(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit[]>;
  /** Settings 可达性探测。 */
  health?(): Promise<boolean>;
}
```

---

## 4. API Design（外部资源库端点 + 补齐编排）

### 4.1 外部端点（vendor 映射隔离在各 provider 三纯函数里）

| Provider | Endpoint | 取字段 | Auth |
|----------|----------|--------|------|
| **MusicBrainz** | `GET /ws/2/recording?query=...&fmt=json` + `.../recording/{mbid}?inc=genres+tags` | `genres[].name` / `tags[].name` | 无（需 User-Agent） |
| **Last.fm** | `GET /2.0/?method=track.getTopTags&artist=&track=&api_key=` | `toptags.tag[].name`（按 count 排序取 top-N） | BYOK `api_key`（settings） |
| **Discogs** | `GET /database/search?type=release&artist=&track=&token=` → `GET /releases/{id}` | `genres[]` / `styles[]` | BYOK `token`（settings） |
| **netease / qq** | 复用现有歌曲详情（导入时已取，不新增请求） | 详情里的 genre / tag | 复用现有登录 |

所有 HTTP 走 `getAppFetch()`；Last.fm / Discogs 不发宽松 CORS → 仅桌面（muzfetch），web 只启用 MusicBrainz。

### 4.2 Request/Response 示意

```typescript
// lastfm-provider.ts —— 三纯函数：mapQuery / parseResponse / toHit（vendor 概念不泄漏）
const url = mapQuery(q, apiKey);               // 纯：拼 URL
const raw = await getAppFetch()(url, { signal }).then((r) => r.json());
const parsed = parseResponse(raw);             // 纯：{ tags: [{name, count}] }
return toHit(parsed);                          // 纯：EnrichmentHit{ rawTags, genres 初筛 }
// → normalize.ts 把 rawTags 收敛成 canonical genres/styles/moods
// → enrichmentResultSchema.parse(...) 校验 → EnrichmentRecord → setTrackEnrichment
```

### 4.3 Error Handling

- **失败 = 背景非事件**（rule 8 + 参照 [`auto-fetch.ts`](../../../../src/lyrics/auto-fetch.ts) 头注释）：network / 4xx / 限速一律 `log` 后放过，**不 toast、不阻塞播放、不重试风暴**。
- **负缓存**：未命中写 `status: "notFound"`，`shouldAutoEnrich` 见 existing 即跳过，避免每次播放重查。
- **限速**：MusicBrainz 1 req/s——后台队列串行 + 间隔（镜像 lyrics 队列节流）；批量导入时 defer 到 idle，不与播放/滚动抢主线程（呼应性能纪律）。
- **Telemetry whitelist**：只可上报 `enrich_source` / `enrich_status`(found|notFound) / `enrich_genre_count`；**永不上报** 具体标签值、歌名/歌手、API key、raw 响应（同 `feedback_no_hidden_backend_flags` 纪律）。

---

## 5. Frontend Design

### 5.1 Settings —「元数据补齐 / 风格标签」面板

- **Current Implementation:** 参考现有 streaming / lyrics 的 Settings 面板（[`src/components/settings/`](../../../../src/components/settings/)，如 `stream-sources-settings.tsx`）。
- **Required Changes（描述改什么，不写怎么实现）:**
  - `autoEnrich` 开关（默认关，避免未配置就静默联网；开启时联网补齐属可见行为，非 hidden flag → rule 3）。
  - Provider 顺序（musicbrainz / lastfm / discogs 拖拽或勾选）。
  - Last.fm `api_key`、Discogs `token` 录入（BYOK，只存 settings 行，password-style 输入不回显）。
  - 可选「用 LLM 归一化脏标签」开关（依赖已配置的 DJ LLM key）。
  - 每个 provider 一个 health 探测 chip（复用 lyrics/streaming 的 health 模式）。

### 5.2 Annotation editor —— 手动补齐 + 只读风格 chips

- **Current:** [`annotation-editor.tsx`](../../../../src/components/track/annotation-editor.tsx)（tags + note + cover）。
- **Required Changes:** 加「补齐风格」按钮（触发 `provider.search` → 列候选让用户挑，或一键 auto）；把 `enrichment.genres/styles` 渲染成**只读 chips**，视觉上与用户手打的 `tags` chip 区分（如不同色 / 加 provider 角标），点击可搜同风格。用户 `tags` 空间不被自动写入污染。

### 5.3 State Management

- **DJ 续歌:** [`dj-engine.ts`](../../../../src/dj/dj-engine.ts) 第 183–188 行，`RecentTrack.genres = 去重(∪(mediaMetadata.genres, enrichment.genres, enrichment.styles))`——纯追加，DJ prompt（[`dj-prompt.ts:79`](../../../../src/dj/dj-prompt.ts)）已渲染 genres，无需改 prompt 结构。
- **DJ chat agent（PM「过滤」核心落点）:** [`dj-chat-tools.ts`](../../../../src/chat/dj-chat-tools.ts) 的 `library_search` 增加按 genre/style 过滤/排序的能力 + 工具描述说明「可按风格过滤」，让「放点 city pop / 换成更 chill 的」这类指令能在导入库里精确命中。
- **搜索:** [`track-search.ts`](../../../../src/lib/track-search.ts) `matchesQuery` 把 `enrichment.genres/styles` 纳入检索语料（`house` 能搜到 house 曲），但不作为用户 tag chip 展示。
- **触发编排:** [`player-store.ts`](../../../../src/stores/player-store.ts) 在 track 变 current / 导入完成后调 `auto-enrich`（镜像 lyrics 触发点），非响应式、模块作用域，不进 store state（rule 6）。

---

## 6. Implementation Plan

> **Phase 顺序 = 基础设施先于覆盖广度**：Phase 1 契约/数据模型 → Phase 2 registry + 首个 provider + 后台队列（打通端到端）→ Phase 3–4 加宽 provider 覆盖 → Phase 5 消费方接线。避免覆盖广度的 PR 反复 rebase 等基础设施。

### Phase 1: 数据模型 + enrichment 契约

**Goal:** 立 `Track.enrichment` 追加字段 + `EnrichmentRecord` Zod 契约 + 纯 normalize 映射，打好可单测的地基。

**Tasks:**
- [ ] `db/types.ts`：`Track.enrichment?: TrackEnrichment`（追加非索引）+ `TrackEnrichment` / `EnrichmentSource`(`ENRICHMENT_SOURCES as const`) / `EnrichmentMatchInfo`；`AppSettings` 追加补齐相关可选字段。
- [ ] `enrich/provider.ts`：接口 + `EnrichmentQuery/Hit/Record` + `enrichmentResultSchema`。
- [ ] `enrich/normalize.ts`：纯 canonical genre/style 映射（`00s→2000s`、大小写、同义词、中英）+ 去重 + 置信度；穷举单测。
- [ ] `enrich/build-query.ts`：Track → EnrichmentQuery（从 `mediaMetadata.artists/title` 提取；generated 直接跳过）。
- [ ] `repositories.ts`：`setTrackEnrichment` / `getTrackEnrichment`（与 `setTrackTags` 同段）。

### Phase 1 Checklist
- [ ] `enrichment` 为追加非索引字段，确认**无** Dexie version bump（对照 coverThumbhash 模式）。
- [ ] `enrichmentResultSchema` 校验通过 + `normalize.test.ts` 覆盖脏标签矩阵。
- [ ] `make check`（typecheck + biome + vitest）绿。

### Phase 2: Provider registry + MusicBrainz + 后台 auto-enrich 队列

**Goal:** 端到端跑通「导入 → 补齐 → 落库 → RecentTrack.genres」，首个 provider 选 keyless + web 可用的 MusicBrainz。

> **E2E 实测结论（2026-07-04，Node 直连公开 API，无 key）：**
> - **录音级 genre 稀疏**：华语录音全空（周杰伦《稻香》、林俊杰《江南》matched score 100 但 `genres:[]`）；英文也不稳（Coldplay《Yellow》空，Taylor Swift《Cruel Summer》有 country pop/synth-pop）。
> - **艺人级 genre 密集且覆盖华语**：周杰伦→`mandopop/pop/contemporary r&b/pop rap/zhongguo feng`，林俊杰→`c-pop/mandopop/ballad`，邓紫棋→`cantopop/mandopop/r&b/rock/soul`，Coldplay→`alternative rock`(33 票)，Taylor Swift→16 genre，YOASOBI→`j-pop`。
> - **别罗马化**：原生 CJK 名（周杰伦/稻香）匹配比罗马音（Jay Chou/Dao Xiang，均 no-match）更准 → query 用源站原名，不做罗马化。
> - ⇒ **即便无任何 BYOK key，MusicBrainz 录音→艺人回退就能给华语曲目可过滤的粗流派**，直接兜住 PM 诉求；QQ/Last.fm 是精度升级。

**Tasks:**
- [x] `enrich/registry.ts`：`resolveEnrichmentProvider` 解析 provider（镜像 [`lyrics/registry.ts`](../../../../src/lyrics/registry.ts)）。
- [x] `enrich/musicbrainz-provider.ts`：`mapQuery/parseResponse/toHit` 纯函数 + `getAppFetch` + User-Agent + 1req/s 节流；**录音→艺人 genre 回退阶梯**；单测。
- [x] `enrich/auto-enrich.ts`：`shouldAutoEnrich` 纯 gate + `enrichmentRecordFromHit` + 失败背景吞 + in-flight 去重（sweep 与播放触发不撞同一首）。
- [x] `player-store.ts`：track 变 current 触发（串行 + 幂等 + 负缓存）。
- [x] **后台 sweep 队列**（[`enrich/enrich-sweep.ts`](../../../../src/enrich/enrich-sweep.ts)）：`startEnrichmentSweepScheduler` 启动后延迟触发（App.tsx `useEffect`），`collectEnrichmentWorkList` 派生「合格且无 enrichment 行」→ 逐首 `runAutoEnrich`，`autoEnrich` gate + 单并发 + 限速 + abortable。**无持久 job 表**——`enrichments` 表即「已处理」状态，work-list 每次启动从 DB 重派生 → 重启安全、自愈；手动重来 = `clearTrackEnrichment`。
- [x] 集成测（fake-indexeddb + canned provider）：import→enrich→DB→`RecentTrack.genres` 出现补齐风格 + sweep 只补合格未处理、负缓存跳过、limit/gate。

### Phase 2 Checklist
- [x] web 端 MusicBrainz 补齐可用（CORS 通过）；桌面走 muzfetch。
- [x] 失败/限速不 toast、不阻塞播放（rule 8 验证）。
- [x] 后台队列不与播放/滚动抢主线程（写只碰 `enrichments` 表 → 零列表扇出；单并发 + 限速）。

### Phase 3: Last.fm（BYOK）+ Discogs + Settings 面板

**Goal:** 补上标签质量最高的 Last.fm 与 style 分类法 Discogs（桌面），Settings 可配 key；registry 变「auto 组合」按序取首个命中。

**Tasks:**
- [x] `enrich/lastfm-provider.ts` + `lastfm-map.ts`：`track.getTopTags`（count 阈值过滤 folksonomy），BYOK `api_key`（settings 行，永不进日志）；error 6→null、坏 key→throw；单测。
- [x] `enrich/discogs-provider.ts` + `discogs-map.ts`：search 直取 genre+style，BYOK `token`；单测。
- [x] `enrich/registry.ts`：`enrichmentProviderOrder`（lastfm→musicbrainz→discogs，按 key 存在装配）+ `createAutoEnrichmentProvider`（首个命中即停；单 provider 全 error 才 throw，clean miss→null 可缓存）；`AppSettings.lastfmApiKey`/`discogsToken`；单测。
- [x] Settings「风格标签」面板（[`genre-enrichment-settings.tsx`](../../../../src/components/settings/genre-enrichment-settings.tsx)，AI section）：autoEnrich 开关 + Last.fm/Discogs key 录入（password、不回显、失焦保存）+ sweep 进度（轮询）+ 手动「立即补齐/停止/重试未找到」按钮 + web 降级说明。`clearFailedEnrichments`（只清 notFound）驱动「重试未找到」。
- [x] web 降级：Settings 面板注明 Last.fm/Discogs 仅桌面（CORS 限制）；MusicBrainz 全平台。

### Phase 3 Checklist
- [x] BYOK key 只在 settings 行，永不进 bundle/log/URL（rule 2）。
- [x] provider 顺序生效，首个命中即停（负缓存正确）。
- [x] Settings 面板 + i18n（en/zh/ja/ko 全量）+ web 降级标注。

### Phase 4: 华语复用（QQ 原生 genre；NetEase 回退外部库）

**Goal:** 华语曲目优先走 QQ 原生 genre（西方库覆盖差），**不新增网络栈**；NetEase 实测无 genre → 只出 artist/title 交给外部 provider。

> **E2E 实测结论（2026-07-04，`scripts/enrich-probe.mjs` via 控制端点，带用户 cookie 打真实 API）：**
> - **QQ `get_song_detail_yqq`** → `data.info.genre.content[].value` = 人类可读流派（Pop / Alternative），`data.info.lan.content[].value` = 语种（国语 / 英语），另有 `track_info.genre` 数字码。**每首都有、稳定。**
> - **NetEase `v3/song/detail`** → `genreFields: []`（周杰伦《稻香》、林俊杰《江南》官方版均无）。**NetEase 不产 genre**，只能提供 artist/title 供 Last.fm/MusicBrainz 查。
> - 证据脚本 + renderer 探测：[`scripts/enrich-probe.mjs`](../../../../scripts/enrich-probe.mjs) + [`src/dev/enrich-probe.ts`](../../../../src/dev/enrich-probe.ts)（`POST /enrich/probe`）。

**实现方式（比原「import 时捕获」更干净）**：做成 **QQ enrichment provider**（[`enrich/qq-provider.ts`](../../../../src/enrich/qq-provider.ts)）进 auto 组合、排**首位**，按 `EnrichmentQuery.streamSourceId==="qq"` **自我 gate**（非 QQ 曲直接 null、零网络）→ 覆盖**所有** QQ 曲（不止 import 那批），复用 sweep/播放触发。QQ 签名/URL 留在 [`streamsrc/qq/qq-genre.ts`](../../../../src/streamsrc/qq/qq-genre.ts)（`parseQqNativeGenre` 纯 + `fetchQqNativeGenre` 复用导出 crypto），enrich 只注入 `fetchNativeGenre`（可单测、不含签名）。

**Tasks:**
- [x] **QQ**：`streamsrc/qq/qq-genre.ts`（`parseQqNativeGenre` 从 `data.info.genre`/`info.lan` 取 `content[].value` + `fetchQqNativeGenre` guest 详情）+ `enrich/qq-provider.ts`（gate `streamSourceId==="qq"`、normalize、`source:"qq"` via `native`、confidence 0.85）；registry 装配（guest，cookie 可选）。TDD：解析器用**真实 E2E 响应形状**测。
- [x] **NetEase**：不实现原生 genre（实测无）；`streamSourceId` 非 qq → QQ provider 自我跳过 → artist/title 落到 Last.fm/MusicBrainz。
- [x] `EnrichmentQuery.streamSourceId` + `externalId` 打通：QQ 用 mid 直取详情，其它源不误伤。
- [x] 合并顺序：QQ 原生排首、首个命中即停；`normalize` 统一小写去重（Pop→pop）。

### Phase 4 Checklist
- [x] QQ provider 对 QQ 曲返回 native genre（解析器 vs 真实 `get_song_detail_yqq` 形状单测：稻香→Pop/国语）。
- [x] NetEase / 其它源曲目：QQ provider 自我跳过、不误报、落外部 provider。
- [x] QQ 侧复用 `get_song_detail_yqq`（同早先 live 实测的请求）；guest 可用。
- [ ] （待）用户库含 QQ 曲时的 in-app pipeline E2E（当前测试库全 NetEase；原始详情 + 解析器已验证）。

### Phase 5: 消费方接线 + 可选 LLM 归一化 + i18n

**Goal:** 让 DJ 续歌 / chat 过滤 / 搜索 / 手动补齐四路吃到 enrichment，PM 诉求闭环。

**Tasks:**
- [x] `dj-engine.ts`：RecentTrack.genres = ∪(mediaMetadata.genres, enrichment.genres/styles)（Phase 2 已接，`getEnrichmentsByTrackIds` 批量）。
- [x] `dj-chat-tools.ts` + `dj-chat-tool-descriptions.ts`：`library_search` 把 enrichment.genres/styles 折进搜索语料（`enrichmentGenresByTrackIdMap` + `searchTracks` 加 `enrichmentGenresByTrackId` 参数）；三语工具描述注明「导入曲可按补齐风格搜」。**PM「过滤导入歌曲」核心落点。TDD：搜 "city pop" 命中仅被补该风格的曲。**
- [x] `track-search.ts`：`searchTracks`/`matchesQuery`/`trackSearchScore` 加 `enrichmentGenresByTrackId`/`extraFreeFields`（镜像 `memoryNotesByTrackId`），enrichment 进 free 字段可搜；TDD。
- [x] `annotation-editor.tsx`：`TrackGenreChips` 只读风格 chips（dashed + Sparkles，区分用户 tag）+ 每曲「重新获取风格」按钮（`clearTrackEnrichment` + `runAutoEnrich`）；i18n。
- [ ]（deferred/可选）LLM 归一化：脏 rawTags 过 Vercel AI SDK 收敛——纯 `normalize` 映射已覆盖主要噪声（含真实 MB 标签迭代），LLM 为后续增强。
- [ ]（followup）⌘F 全局搜索 worker（`global-search-local-core`）+ search-page/entity-detail 主列表纳入 enrichment 语料（需把 enrichment 传进 worker）。
- [x] i18n 4 语言（en/zh/ja/ko）全量（enrichSettings.* + annotation.autoGenre/reEnrich/... + 三语工具描述）。

### Phase 5 Checklist
- [x] chat `library_search` 能按风格从导入库过滤出歌（TDD：`executeSearchTracks` 搜 enrichment genre 命中）。
- [x] 搜索「city pop」能命中补齐了该风格的导入曲（track-search + chat 单测）。
- [x] i18n 4 locale 全覆盖，无缺翻译（全量测通过含 i18n parity）。
- [ ]（deferred）LLM 归一化 / ⌘F worker 语料 = followup。

### Phase 6: （可选 / 可拆独立 PRD）Essentia.js 内容分析兜底

**Goal:** 对「元数据全空、外部库也查不到」的孤儿曲目，从**音频内容**推理 genre/mood。

**Tasks:**
- [ ] `src/workers/essentia-enrich.worker.ts`：TF.js/ONNX 自动标注（genre/mood），懒加载模型，仅在外部 provider 全 miss 时兜底。
- [ ] Settings 显式开关（默认关）；标注模型体积与首次下载成本。
- [ ] 与性能纪律对齐：worker 内跑、不卡主线程、prod build 复测内存。

### Phase 6 Checklist
- [ ] 模型权重懒加载，不进主 bundle（bundle 预算：主包增量 < 100KB gzipped）。
- [ ] 内存/CPU 在 prod build 二次循环复测达标（呼应内存复现规则）。
- [ ] **若成本超预算 → 拆为独立 PRD**，不阻塞 Phase 1–5 上线。

---

## 7. 硬规则对齐（CLAUDE.md）

| 规则 | 对齐方式 |
|------|---------|
| **1 本地优先/无后端** | 补齐 = 用户配置的第三方 API（Last.fm/MusicBrainz/Discogs）BYOK + 已接入的 netease/qq；无 MUZERO 服务端，同 musicgen/LLM 例外。存储层仍全 IndexedDB。 |
| **2 BYOK/密钥纪律** | Last.fm `api_key` / Discogs `token` 只进 `settings` 行；永不进 bundle/log/URL/telemetry/`enrichment` 字段。 |
| **3 无 hidden flag** | 补齐开关 = 可见 Settings 控件（`autoEnrich`）；回滚 = `git revert` + redeploy，非 runtime kill switch。 |
| **4 codename 稳定** | 不改表名/id 前缀/`TrackBrief` 字段/provider id；只**追加** `Track.enrichment` 字段。 |
| **5 provider 边界** | `MetadataEnrichmentProvider` + registry，vendor 映射隔离在三纯函数；**禁止** `if (source===…)` 散落；HTTP 走 `getAppFetch()`。 |
| **6 Zustand selector** | auto-enrich 编排 = 模块作用域非响应式，不进 store state。 |
| **7 Vitest 集成** | normalize 纯映射穷举 + auto-enrich 集成测（fake-indexeddb + canned provider）。 |
| **8 日志/失败策略** | 补齐失败 = 背景非事件，走 `logger`，不 toast、不阻塞播放。 |
| **10 桌面壳抽象** | fetch 走 bridge（muzfetch）；补齐跑主线程（worker 无 bridge）；web 降级 MusicBrainz-only。 |

---

## 8. Out of Scope

- **不引入 MUZERO 自有后端**做代理/缓存/聚合（rule 1）。
- **不引入 Spotify audio-features / recommendations**——2024-11-27 已对新应用停用，不可用。
- **不做全库一次性批量联网补齐的强制流程**：默认按播放/导入增量补，避免开箱即打爆限速；「全库补齐」如需要，作为 Settings 里显式的、可中断的后台任务另议。
- **不把补齐的风格自动写进用户 `tags`**（个人标注空间）——只进独立 `enrichment` 字段。
- **Essentia.js 内容分析（Phase 6）若工程/体积成本偏大 → 拆独立 PRD**，不阻塞主线。
- **不做「风格 → 自动歌单」的策展编排**：那属于 DJ chat agent（curate/propose）范畴，本 PRD 只把风格数据备好、让其可过滤。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`src/lyrics/`](../../../../src/lyrics/) | **架构母版**：provider registry + 外部 API provider + 后台 auto-fetch + 负缓存 + 纯匹配，`src/enrich/` 同构复刻 |
| [20260610-muzero-synced-lyrics-lrclib-prd](../../20260610-muzero-synced-lyrics-lrclib-prd/20260610-muzero-synced-lyrics-lrclib-prd.md) | 按 (歌手,歌名) 查外部库 + 后台补齐 + 匹配置信度的直接先例 |
| [20260616-muzero-qq-music-stream-source-prd](../../20260616-muzero-qq-music-stream-source-prd/20260616-muzero-qq-music-stream-source-prd.md) | qq 接入（华语 genre 复用来源之一） |
| [20260614-muzero-netease-online-recommendations-prd](../../20260614-muzero-netease-online-recommendations-prd/20260614-muzero-netease-online-recommendations-prd.md) | netease 详情解析（华语 genre 复用来源之一） |
| [20260607-muzero-ai-dj-chat-agent-panel-prd](../../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | DJ chat agent（`library_search` 过滤维度的消费方） |
| [Spotify: changes to Web API (2024-11-27)](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) | audio-features/recommendations 停用公告（为何不选 Spotify） |
| [Last.fm: track.getTopTags](https://www.last.fm/api/show/track.getTopTags) | 主力标签源 API |
| [Essentia.js ML inference](https://mtg.github.io/essentia.js/docs/api/tutorial-3.%20Machine%20learning%20inference%20with%20Essentia.js.html) | Phase 6 内容分析候选 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 补齐风格是否也进用户搜索的默认语料（vs 需 `#genre:` 前缀）？ | Open | 倾向默认纳入语料但不进 tag chip UI；待定 |
| 2 | 多 provider 命中如何合并——首个命中即停 vs 合并去重？华语源 vs Last.fm 优先级？ | Open | 倾向「首个命中即停 + 华语曲优先源站原生」，Phase 4 定 |
| 3 | LLM 归一化默认开还是保守关（省 token）？ | Open | 倾向默认关，纯映射兜底；有 key 且用户开启才走 |
| 4 | Last.fm/Discogs 的 attribution/使用条款是否需要在 UI 标注来源？ | Open | 个人 BYOK 本地用途一般可，展示风格时标 provider 角标即可；上线前复核条款 |
| 5 | Phase 6 Essentia 是并入本 PRD 还是独立 PRD？ | Open | 视 Phase 1–5 落地后模型体积/性能实测决定 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-04 | MUZERO Team | Initial draft — 资源库调研（MusicBrainz/Last.fm/Discogs + 华语源 + Essentia，Spotify 已停用）落地为 `src/enrich/`（镜像 `src/lyrics/`）+ `Track.enrichment` 追加字段 + DJ/chat/搜索三消费方接线，6 phase |
| 2026-07-04 | MUZERO Team | **Phase 4 华语源 E2E 实测**（`scripts/enrich-probe.mjs` + `src/dev/enrich-probe.ts`，`POST /enrich/probe` 带用户 cookie 打真实 API）：**QQ ✅** 有原生 genre+语种（`info.genre`/`info.lan`）；**NetEase ❌** `v3/song/detail` 无 genre。据此重写 §1.2 表 / §2.1 架构 / Phase 4 |
| 2026-07-04 | MUZERO Team | **Phase 2 外部库 E2E 实测**（Node 直连公开 API 无 key）：MusicBrainz **录音级 genre 稀疏**（华语全空）但**艺人级密集且覆盖华语**（周杰伦→mandopop/中国风）→ Phase 2 加录音→艺人回退阶梯；原生 CJK 名比罗马音匹配更准。**结论：keyless MusicBrainz 已能兜住华语过滤基线，不必依赖 BYOK key。** Last.fm 精度腿待免费 key 补测 |
| 2026-07-04 | MUZERO Team | **Phase 1+2 实现完成**（`src/enrich/*` 镜像 `src/lyrics/`）：provider/normalize/build-query/registry/musicbrainz(-map)/auto-enrich + `enrichments` 表(v32，**改独立表避列表扇出**) + repo + player-store 播放触发 + dj-engine `RecentTrack.genres` 合并。**33 单测 + 162 既有测全绿、tsc/biome 干净**。**In-app E2E（真实 MusicBrainz + 用户真实 NetEase 库）**：Fun Fun Fun→soundtrack(recording)、HOYO-MiX→soundtrack(artist)、初音ミク→j-pop/vocaloid(artist) 等，NetEase 无 genre 曲目全部补齐；normalize 按真实 MB 噪声(vgm/hoyoverse/composer…)迭代收紧 |
| 2026-07-04 | MUZERO Team | **后台 sweep 队列**（[`enrich-sweep.ts`](../../../../src/enrich/enrich-sweep.ts)）：自动补齐全库未处理曲目（不必逐首播放），启动延迟触发 + `autoEnrich` gate + 单并发 + 限速 + abortable + in-flight 去重；**无持久 job 表**（`enrichments` 表即状态，work-list 每次从 DB 重派生 → 重启安全/自愈），处理过(found/notFound)即 skip，手动 `clearTrackEnrichment` 重来。**38 单测全绿**。**In-app E2E**：启动约 20s 后自动开跑，从用户真实库派生 **5937** 首 work-list，~1.1s/首推进(0→13)，`sweepStop` 干净停止，重启续跑 |
| 2026-07-04 | MUZERO Team | **Phase 3 provider 层（TDD）**：Last.fm（`track.getTopTags`，BYOK key，count 阈值过滤）+ Discogs（search 直取 genre+style，BYOK token）+ registry 改「auto 组合」（`enrichmentProviderOrder` lastfm→musicbrainz→discogs 按 key 装配 + `createAutoEnrichmentProvider` 首个命中即停 / 全 error 才 throw）+ `AppSettings.lastfmApiKey`/`discogsToken`。**67 enrich 单测全绿（+29）、tsc/biome 干净**。Settings UI + web 降级标注留下一 commit |
| 2026-07-04 | MUZERO Team | **Phase 3 Settings UI 完成**：`genre-enrichment-settings.tsx`（AI section「风格标签」，图标 tags）= autoEnrich 开关 + Last.fm/Discogs key（password/失焦保存）+ sweep 进度轮询 + 立即补齐/停止/重试未找到按钮 + web 降级说明；`clearFailedEnrichments`（TDD，只清 notFound）；i18n en/zh/ja/ko 全量。**全量 3637 测全绿（+30）**。Phase 3 完成 |
| 2026-07-04 | MUZERO Team | **Phase 4 QQ 原生 genre（TDD）**：`streamsrc/qq/qq-genre.ts`（`parseQqNativeGenre` 纯 + `fetchQqNativeGenre` guest 详情，复用导出签名）+ `enrich/qq-provider.ts`（`streamSourceId==="qq"` 自我 gate、via `native`、conf 0.85）；`EnrichmentQuery.streamSourceId`；registry auto 组合 QQ 排首。解析器用**真实 E2E 响应形状**测。**74 enrich 单测全绿（+7）、tsc/biome 干净**。Phase 4 完成（待用户库含 QQ 曲时补 in-app pipeline E2E） |
| 2026-07-04 | MUZERO Team | **Phase 5 消费方接线（TDD）**：`track-search` `searchTracks`/`matchesQuery` 加 `enrichmentGenresByTrackId`（镜像 memoryNotes，enrichment 进 free 语料）；`dj-chat-tools` `library_search` 折进 enrichment genre（**PM「过滤导入歌曲」落点**）+ 三语工具描述；`annotation-editor` `TrackGenreChips` 只读风格 chips + 每曲重新获取按钮；i18n 4 语言。DJ RecentTrack.genres Phase 2 已接。**全量 3648 测全绿（+4）**。LLM 归一化 / ⌘F worker 语料 = deferred followup。Phase 5 完成 |
