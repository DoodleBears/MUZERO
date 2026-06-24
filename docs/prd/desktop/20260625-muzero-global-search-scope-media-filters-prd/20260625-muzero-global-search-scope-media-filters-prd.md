# PRD: 全局搜索（⌘/Ctrl+F）作用域 + 本地媒体类型过滤（@online / @local / @Video / @Audio）

**Status:** Draft
**Created:** 2026-06-25
**Author:** MUZERO / DoodleBears
**Module:** Global Search Overlay — `@`-mention scope filters（单选）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 过滤词汇（union+options）+ `resolveFilterScope` 仲裁器 + 菜单/pill 渲染 + 标签 i18n | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 作用域门控接线（@online 跳本地 worker / @local 切在线网络） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 本地媒体类型谓词（@Video/@Audio，worker `mediaKind`） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | placeholder/hint i18n + 完整 `make check` + 性能验收 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> **Phase 排序说明**：作用域门控（Phase 2）先于媒体谓词（Phase 3）——`@video`/`@audio` 需要先把"只显示本地歌曲区 + 切断在线"接通（靠 `resolveFilterScope`），`mediaKind` 谓词才有意义；否则 `@video` 中间态会因旧 include 逻辑显示空。

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

用户在「Ctrl+F 搜索内容的地方」——全局搜索浮层 [`GlobalTrackSearch`](../../../../src/components/search/global-track-search.tsx)（⌘/Ctrl+F 打开）——希望新增 4 个过滤入口：

- `@online`：只搜在线内容；`@local`：只搜本地内容。
- `@Video`：只看**本地**视频内容；`@Audio`：只看**本地**音频内容。

**关键设计决定（已与用户确认）：**
1. **`@` 保持单选**——沿用现有 [`SearchFilter`](../../../../src/lib/global-search-filter.ts) 判别联合，一次只激活一个 filter。新过滤是该联合里**新增的 4 个 variant**，不引入多轴可组合模型。
2. **`@Video` / `@Audio` 仅作用于本地库**——媒体类型谓词只下推到本地 Web Worker，**完全不触及在线源**（无需限源、无需改在线搜索 hook）。

**当前实现已具备的基础**（[`src/lib/global-search-filter.ts`](../../../../src/lib/global-search-filter.ts)）：一套 `@`-mention 单选过滤系统，已有 `@track` / `@set` / `@lyrics` / `@artist` / `@album` / `@bili`(`source`) 等区段/源过滤：

```ts
// src/lib/global-search-filter.ts — 现状（单选）
export type SearchFilter =
  | { kind: "track" } | { kind: "set" } | { kind: "lyrics" }
  | { kind: "artist" } | { kind: "album" }
  | { kind: "source"; source: StreamSourceId };  // 单一在线源 @bili / @网易云 …
```

浮层里就一个槽位 `const [filter, setFilter] = useState<SearchFilter | null>(null)`、一个 `FilterPill`。本需求**正好顺着这个单选结构扩**：加 4 个 kind、扩 section 门控布尔、给 worker 多传一个 `mediaKind`。**无需重构状态模型、无需多 pill。**

> **术语界定**：本 PRD 「online / 在线」= 实时外部流媒体源（网易云 / Bilibili / YouTube / QQ 音乐，[`useOnlineSourceSearch`](../../../../src/hooks/use-online-source-search.ts)）。**不含** R2 共享云盘目录缓存 `remoteSearchTracks`（另一个「remote cloud」概念，见 §7）。「local / 本地」= 设备本地库（`origin` 为 `generated` / `uploaded`，**以及已落地缓存的** `streamed` 曲目——已能离线播，算本地，见 [Open Q#3 定论](#10-open-questions)）。

### 1.2 Target Users

| Role | Description | 关键诉求 |
|------|-------------|---------|
| **桌面重度用户** | 库里同时有 AI 生成、上传音频、上传/下载视频（MV），并开了在线源 | `@Video` 一键只看本地视频、`@Audio` 只看本地音频，不被混杂结果淹没 |
| **键盘流用户** | 习惯 ⌘F + `@` 快速定位 | 像 `@set` 一样打出 `@video` / `@online`，单选切换 |
| **省流/弱网用户** | 只想搜本地，不想每次按键触发多个在线源网络请求 | `@local`（及 `@video`/`@audio`）必须**真正切断**在线网络请求 |

### 1.3 Core Value

1. **四个高频意图一键直达**：「只看本地视频 / 只看本地音频 / 只搜在线 / 只搜本地」，沿用既有 `@` 单选心智，零学习成本。
2. **性能即语义**：`@local`/`@video`/`@audio` 不只是隐藏在线结果，而是**不发起在线网络请求**；`@online` 跳过本地整表 worker 扫描。过滤本身就是省功。
3. **零存储、零迁移、零新索引**：纯内存谓词 + 临时 UI 状态，不动 Dexie schema、不加二级索引、不写 localStorage（遵守硬规则 3/4 与 selector 纪律）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                ⌘/Ctrl+F  GlobalTrackSearch (overlay)
                              │
            parseMention(query) → 单选 SearchFilter
                              │
        ┌─────────────────────┼─────────────────────────┐
        ▼                     ▼                          ▼
   filter.kind = ?      section 门控 show*           本地 worker / 在线 hook 开关
        │
   ┌────┼──────────────┬──────────────┬───────────────┬──────────────┐
   ▼    ▼              ▼              ▼               ▼              ▼
 null  track/set/…   online          local          video          audio
 (默认) (既有区段)   ─────────       ─────────       ─────────       ─────────
 本地+在线           只在线          只本地          只本地视频      只本地音频
                    跳过 worker      切断在线网络    切断在线        切断在线
                    showLocal=0      showOnline=0    + mediaKind     + mediaKind
                                                     ="video"        ="audio"
        │                                                │
        ▼                                                ▼
 searchGlobalLocalLibrary({ …, mediaKind })   ← worker 单趟内存评分；mediaKind 谓词在 slice(limit) 之前
 useOnlineSourceSearch(onlineQuery)            ← onlineQuery 为空即不发请求（@local/@video/@audio 时置空）
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **过滤解析** | 现有 `parseMention` + `matchFilterOptions`（[`global-search-filter.ts`](../../../../src/lib/global-search-filter.ts)） | 复用 `@`-token 检测；只往 `FILTER_OPTIONS`/`SearchFilter` 各加 4 项 |
| **本地搜索** | 现有离线 Web Worker（[`global-search-local-worker.ts`](../../../../src/workers/global-search-local-worker.ts) + [`global-search-local-core.ts`](../../../../src/workers/global-search-local-core.ts)） | 已是单趟内存评分；`mediaKind` 谓词加进同一趟 |
| **在线搜索** | 现有 [`useOnlineSourceSearch`](../../../../src/hooks/use-online-source-search.ts) | **不改**——`@Video`/`@Audio` 不碰在线；`@online`/`@local` 仅靠 `onlineQuery` 空/非空门控 |
| **持久化** | **无** | 过滤是临时 UI 状态，打开浮层即 reset（与现有 `filter` 一致），不进 IndexedDB / localStorage |
| **i18n** | i18next（[`globalSearch.*`](../../../../src/i18n/locales/en/common.json)） | 4 语言新增过滤文案 key |

### 2.3 Project Structure

```
src/
├── lib/global-search-filter.ts        # ★ SearchFilter 加 4 kind；FILTER_OPTIONS 加 4 项（别名 latin+CJK）
├── components/search/global-track-search.tsx  # ★ section 门控 + onlineQuery 门控 + mediaKind 传参 + pill 图标/标签
├── workers/
│   ├── global-search-local-core.ts    # ★ GlobalSearchLocalInput 增 mediaKind（slice 前过滤）
│   ├── global-search-local-client.ts  # ★ 透传 mediaKind（含 inline 回退）
│   └── global-search-local-worker.ts  # 无需改（透传 input）
└── i18n/locales/{en,zh,ja,ko}/common.json  # ★ 新增 globalSearch.filter* 文案
```

> 在线侧（`useOnlineSourceSearch` / `download-action`）**本期不改**——这是「@Video/@Audio 仅本地」决定带来的直接简化。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
SearchFilter（单选，浮层内存态）— 在既有基础上 +4 个 kind：
  既有： track | set | lyrics | artist | album | source(+sourceId)
  新增： online | local | video | audio
                              └ video/audio 仅本地，映射 Track.kind

Track.kind:   "audio" | "video"                         （TrackKind，src/db/types.ts:24）  ← @Video/@Audio 判定字段
Track.origin: "generated" | "uploaded" | "streamed"     （TrackOrigin:27）                 ← 本地/在线归属参考
```

```ts
// 目标形状（仍是单选判别联合）
export type SearchFilter =
  | { kind: "track" } | { kind: "set" } | { kind: "lyrics" }
  | { kind: "artist" } | { kind: "album" }
  | { kind: "source"; source: StreamSourceId }
  | { kind: "online" }   // 只在线（全部启用源）
  | { kind: "local" }    // 只本地（全部本地区段）
  | { kind: "video" }    // 只本地视频（Track.kind === "video"）
  | { kind: "audio" };   // 只本地音频（Track.kind === "audio"）
```

### 3.2 Database Schema

⚠️ **本 PRD 不修改任何数据库结构、不新增任何索引、不 bump version。** 逐项说明为什么（直接回应「考虑性能 / indexed / 存储」）：

- **Current Schema:** [`muzero-db.ts`](../../../../src/db/muzero-db.ts)。关键现状：本地 `tracks` 索引在 v28/v29/v30 被**刻意逐步删减**到只剩 `tracks: "id, sessionId, sourcePath"`——`kind` / `status` / `createdAt` / `*tags` / `liked` 的二级索引**全部移除**。

- **Required Changes:** **无 schema 改动。** `@Video`/`@Audio` 用的 `Track.kind` 是**已存在的行字段**；本地搜索本就把整表 `db.tracks.toArray()` 读进 worker 做内存评分，过滤只是那趟遍历里多一个布尔谓词，**无需任何索引**。

- **为什么不加 `kind` 索引（"考虑 indexed" 的明确答案）：**
  1. **历史已证伪**：v29/v30 migration 注释明言——本地 tag 搜索/计数都是「scan the loaded track rows in memory… no runtime path queries Dexie by this index」，留索引「costs extra index work on every imported row, especially large local-folder bulkAdd batches」。`kind` 同理：无任何运行时路径会 `db.tracks.where("kind")`。
  2. **写放大是主成本**：主导写入路径是**大批量本地文件夹导入**（一次几百~几千行 `bulkAdd`），每多一个二级索引每行都要多维护一棵索引树，直接拖慢导入。
  3. **基数太低**：`kind` 仅 2 值，索引选择性极差，建了也几乎无收益。

- **Constraints & Indexing / Performance Impact:** 不新增任何索引。`mediaKind` 谓词复杂度 O(N)，与现有 worker 单趟评分**同阶、同一趟**完成，不新增遍历/查询/表扫描；对导入写入路径**零影响**。

- **Data Migration / Zero-Downtime / Rollback:** 不适用（无 schema 变更）。回退 = `git revert` 注册表/组件改动 + redeploy（硬规则 3 + [`feedback_no_hidden_backend_flags`]）。

- **Privacy & Retention:** 过滤状态不持久化、不上报，不触及 PII。

### 3.3 `@Audio` 语义裁决（Open Q#1 定论 = 方案 B）

「@Audio 过滤所有包含音频的内容」字面有歧义（视频 MV 也含音轨）。**采用方案 B：互斥媒体类型**——

| | @Video | @Audio |
|---|--------|--------|
| **判定** | `Track.kind === "video"` | `Track.kind === "audio"` |
| **含义** | 本地视频（含画面） | 本地纯音频（无画面） |

`Track.kind` 本就是 audio/video 二选一单值字段，方案 B 是零成本、最高可用性的映射，且符合「只看视频 / 只看歌曲」的真实意图。（字面「包含音轨」方案需另加 `hasAudioTrack` 字段且结果近乎全选，弃用。）

---

## 4. Filter 行为契约（单选语义）

### 4.1 新增 `@` 过滤选项

在 [`FILTER_OPTIONS`](../../../../src/lib/global-search-filter.ts) 新增 4 项（别名含 latin + CJK；匹配已 `.toLowerCase()`，故 `@Video` 与 `@video` 等价）：

| id / filter.kind | 别名（aliases） | 行为 |
|------|----------------|------|
| `online` | `online`, `web`, `stream`, `在线`, `线上`, `网络` | 只在线：跳过本地 worker，仅显示在线源结果 |
| `local` | `local`, `library`, `device`, `本地`, `本机`, `离线` | 只本地：切断在线网络，显示全部本地区段（歌单/歌曲/专辑/歌手） |
| `video` | `video`, `mv`, `视频`, `影片`, `影像` | 只本地视频：本地歌曲区，`kind==="video"`；切断在线 |
| `audio` | `audio`, `sound`, `music`, `音频`, `音乐`, `声音` | 只本地音频：本地歌曲区，`kind==="audio"`；切断在线 |

> 无在线源能力时（web/tauri，`hasStreamingSources()===false`）隐藏 `online` 与 `source`，**保留** `local`/`video`/`audio`（纯本地维度，与是否有在线源无关）。

### 4.2 单选行为表（每个 filter 互斥，一次一个）

| filter | 本地 worker | 在线网络 | mediaKind 谓词 | 显示区段 |
|--------|------------|---------|----------------|---------|
| `null`（默认） | ✅ | ✅ | — | 歌单 + 歌曲 + 专辑 + 歌手 + 在线 |
| `track`/`set`/`album`/`artist`（既有） | ✅ | ✅ | — | 对应单区段 + 在线 |
| `lyrics`（既有） | （歌词专路） | ❌ | — | 歌词区 |
| `source`（@bili 等，既有） | ❌ | ✅ 仅该源 | — | 仅该在线源 |
| **`online`** | ❌ **跳过** | ✅ 全部启用源 | — | 仅在线 |
| **`local`** | ✅ | ❌ **不发起** | — | 歌单 + 歌曲 + 专辑 + 歌手 |
| **`video`** | ✅ | ❌ **不发起** | `"video"` | 本地歌曲（仅视频） |
| **`audio`** | ✅ | ❌ **不发起** | `"audio"` | 本地歌曲（仅音频） |

> `video`/`audio` 视为「kind 收窄的本地歌曲视图」：只显示歌曲区（专辑/歌手/歌单不参与 kind 概念，故不显示），与 `@track` 只显示歌曲区同构。空 query 时也跑 worker（浏览「我的全部本地视频/音频」，参照 `album`/`artist` facet 现有的空 query 也请求 worker 的处理）。

### 4.3 worker 输入契约变更

[`GlobalSearchLocalInput`](../../../../src/workers/global-search-local-core.ts) 新增一个可选字段，谓词在 `slice(resultLimit)` **之前**应用（§5.3 正确性要点）：

```ts
export interface GlobalSearchLocalInput {
  includeAlbums: boolean;
  includeArtists: boolean;
  includeTracks: boolean;
  query: string;
  resultLimit: number;
  mediaKind?: "audio" | "video";   // 新增：在 readyTracks 过滤阶段（slice 前）应用 track.kind === mediaKind
  // 注：location 不进 worker——worker 本就只搜本地。@online 在 UI 层"不调用 worker"即可。
}
```

### 4.4 Request 示例

```ts
// @Video，query "live" —— 本地视频
searchGlobalLocalLibrary({
  includeAlbums: false, includeArtists: false, includeTracks: true,
  query: "live", resultLimit: 8, mediaKind: "video",
});
// → 只返回 kind==="video" 且匹配 "live" 的 trackIds；在线 hook 因 onlineQuery="" 不被调用。

// @online，query "周杰伦" —— 仅在线
//   本地 worker 不调用；useOnlineSourceSearch("周杰伦") 查全部启用源；本地区段全部隐藏。
```

### 4.5 Error Handling & Edge Cases

- **`@online` 但未启用任何源**：复用现有「启用在线源」chips（`showEnableChips`）空态；不报错。
- **`@local`/`@video`/`@audio` 且无匹配**：复用 `globalSearch.empty` 空态。
- **`mediaKind` 把 top-N 过滤空**：返回空区段，不降级到无谓词结果（避免误导）。
- **Telemetry**：复用现有 `notePerfWork("globalSearch.localWorker", …)`；新增**白名单 enum 字段** `mediaKind` / `filterKind`——**绝不**上报 query 文本、源 cookie、结果标题（对齐硬规则 2 与 §Telemetry whitelist）。

---

## 5. Frontend Design

### 5.1 Page Structure

仅改动浮层 [`global-track-search.tsx`](../../../../src/components/search/global-track-search.tsx)，无新页面、仍单 `FilterPill`。

### 5.2 UI Components

- **Current Implementation:** 单 `filter` 状态、单 `FilterPill`、`FilterMenu`（菜单项来自 `FILTER_OPTIONS`）。
- **Required Changes（描述"改什么"）：**
  1. **菜单**：`FILTER_OPTIONS` 多 4 项；`FilterPill`/`FilterMenu` 的 `labelFor` 与图标 switch 补 4 个分支：`online`=Globe、`local`=Library/HardDrive、`video`=Video/Film、`audio`=AudioLines/Music（lucide）。
  2. **Section 门控**：`show*` 布尔在现有基础上扩（见下），新增 `mediaKind` 与 `onlineQuery` 门控。
  3. **底栏提示**：`@` 提示行补充新过滤说明。
  4. **状态不变**：仍 `useState<SearchFilter | null>`，单 pill，Backspace 在空输入时清除该 filter（现有逻辑即可，无需多 pill 管理）。

  ```ts
  // 门控（在现有 show* 上扩；伪代码）
  const showSets    = f===null || f.kind==="set"    || f.kind==="local";
  const showTracks  = f===null || f.kind==="track"  || f.kind==="local" || f.kind==="video" || f.kind==="audio";
  const showAlbums  = f===null || f.kind==="album"  || f.kind==="local";
  const showArtists = f===null || f.kind==="artist" || f.kind==="local";
  const showOnline  = streamingSupported && (f===null || f.kind==="source" || f.kind==="online");
  const mediaKind   = f?.kind==="video" ? "video" : f?.kind==="audio" ? "audio" : undefined;
  // onlineQuery 已由 showOnline 门控：showOnline=false ⇒ onlineQuery="" ⇒ 在线 hook 早返回不发请求。
  ```

- **UI/Interaction:** 与现有 `@` 流完全一致（输入 `@`→弹菜单→↑↓ 选→Enter/Tab 确认→pill 化→Backspace 清除）。

### 5.3 State Management & 性能要点（"考虑性能"核心，遵循 [`prd-create.md`](../../../.cursor/commands/prd-create.md) §4）

1. **`mediaKind` 必须 push 进 worker、在 slice 之前过滤（正确性即性能）**：若在 React 侧对 worker 返回的 top-N（8 个 id）再过滤，会把结果砍到 N 以下（返回 8 个、6 个是 video → 只剩 6，即便更深处还有 video）。故谓词必须进 `buildGlobalSearchLocalResults` 的 `readyTracks` 过滤阶段，在 `.slice(resultLimit)` **之前**。
2. **`@local`/`@video`/`@audio` 真正切断在线网络**：当前 `useOnlineSourceSearch` 只要有 query 就 debounce 后**并发请求每个启用源**。这三个 filter 令 `onlineQuery=""`（hook 内 `q` 空即早返回 + `abort`），避免每次按键发起 N 个网络请求——省流/弱网关键，主线程/网络双省。
3. **`@online` 跳过本地 worker**：`localWorkerRequested` 增加 `f?.kind!=="online"` 条件，避免「只搜在线」时仍 `db.tracks.toArray()` 整表读进 worker。
4. **临时状态、零存储、零订阅放大**：`filter` 是组件局部 `useState`，打开浮层 reset；不进 Zustand、不进 IndexedDB、不进 localStorage——不触发 liveQuery 重订阅/全树重渲染（硬规则 6）。
5. **不引入隐藏开关**：过滤是**可见 UI 控件**（pill + 菜单），非 `localStorage`/URL/`window.*` 行为门控（硬规则 3）。
6. **复用既有 debounce / defer**：`deferredSearchText`、`useBurstSettledValue`、`useDeferredValue` 不变；新过滤只改谓词与门控布尔，无每按键新增重活。

**验收性能指标**（prod build，`make build` 后量；dev 不作数）：
- `@local`/`@video`/`@audio` 激活后，搜索期间在线源网络请求数 = **0**（Network 面板验证）。
- `@online` 激活后，`globalSearch.localWorker` / `localInline` perf 计数 = **0**（不触发本地整表读）。
- 加 `mediaKind` 谓词后，`globalSearch.localWorker.workerMs` 相对无谓词**无明显回归**（同趟遍历，Δ 在噪声内）。
- 浮层连续打字无新增 longtask（`PerformanceObserver longtask`，对齐 §4 方法学）。

---

## 6. Implementation Plan

### Phase 1: 过滤词汇 + `resolveFilterScope` 仲裁器 + 菜单/pill 渲染

**Goal:** `SearchFilter` 加 `online`/`local`/`video`/`audio` 四个 kind；`FILTER_OPTIONS` 加对应 4 项（别名 §4.1）；新增**纯函数仲裁器** `resolveFilterScope`（show* + mediaKind + runsLocalWorker，穷举单测）；`FilterPill`/`FilterMenu` 用共享 `filterLabel`/`FilterGlyph` 补图标与标签 + 标签 i18n（4 语言）。行为到「能选中、能 pill 化、能清除、标签/图标正确」；门控接线在 Phase 2/3。

**Tasks:**
- [ ] [`global-search-filter.ts`](../../../../src/lib/global-search-filter.ts)：扩 `SearchFilter` + `FilterOption.id` + `FILTER_OPTIONS` 4 项 + `resolveFilterScope` 仲裁器（`FilterScope`）。
- [ ] [`global-track-search.tsx`](../../../../src/components/search/global-track-search.tsx)：抽出共享 `filterLabel(filter,t)` + `<FilterGlyph>`（pill 与菜单复用，消除 10-深嵌套三元）；新增 4 图标（Film/AudioLines/Library/Globe）。
- [ ] i18n：4 语言新增 `globalSearch.filterVideo/filterAudio/filterLocal/filterOnline`。

### Phase 1 Checklist
- [ ] `@online`/`@local`/`@video`/`@audio`（含 CJK 别名 + 大写 `@Video`/`@Audio`）可在菜单出现、选中、pill 化。
- [ ] 既有 `@track`/`@set`/`@source` 行为零回归（`resolveFilterScope` 单测对照旧 `showOnline` 仅 null/source 行为）。
- [ ] `global-search-filter.test.ts` 覆盖 4 个新别名 + `resolveFilterScope` 全 kind（22 passed）。
- [ ] `pnpm typecheck` + `biome check`（改动文件）通过。

### Phase 2: 作用域门控接线（@online / @local）

**Goal:** 浮层改读 `resolveFilterScope`：`online` 跳本地 worker、只显示在线；`local` 切在线网络、显示全部本地区段；`video`/`audio` 显示本地歌曲区且切在线（此阶段尚未按 kind 过滤，仅门控）。

**Tasks:**
- [ ] 浮层：`scope = resolveFilterScope(filter, streamingSupported)`；用 `scope.show*` 替换内联 `show*`；`localWorkerRequested` AND `scope.runsLocalWorker`；`onlineQuery` 由 `scope.showOnline` 门控（false ⇒ `""` ⇒ 在线 hook 不发请求）。
- [ ] worker include 标志改用 `scope.showTracks/showAlbums/showArtists`。

### Phase 2 Checklist
- [ ] `@local`/`@video`/`@audio` 期间在线网络请求 = 0（Network 验证）。
- [ ] `@online` 期间无本地整表读（`globalSearch.localWorker` perf 计数 = 0），仅显示在线区段。
- [ ] `@local` 显示全部本地区段；`@video`/`@audio` 仅显示本地歌曲区。
- [ ] 既有 facet/source 行为零回归（typecheck + 手测）。

### Phase 3: 本地媒体类型谓词（@Video / @Audio）

**Goal:** `mediaKind` 贯通 worker，本地歌曲按 `Track.kind` 过滤（方案 B），谓词在 `slice` 之前应用。

**Tasks:**
- [ ] [`global-search-local-core.ts`](../../../../src/workers/global-search-local-core.ts)：`GlobalSearchLocalInput.mediaKind`；在 `readyTracks` 过滤、`slice(resultLimit)` **之前**应用 `track.kind === mediaKind`。
- [ ] [`global-search-local-client.ts`](../../../../src/workers/global-search-local-client.ts)：透传 `mediaKind`（含 inline 回退路径）。
- [ ] 浮层：把 `scope.mediaKind` 传入 `searchGlobalLocalLibrary`；`@video`/`@audio` 空 query 时也请求 worker（browse 模式，参照 album/artist）。

### Phase 3 Checklist
- [ ] `@Video` 只出本地 `kind==="video"`；`@Audio` 只出本地 `kind==="audio"`。
- [ ] 谓词在 slice 前应用：构造 >resultLimit 个 video 行，验证返回数 = resultLimit（不被前置过滤砍空）。
- [ ] `global-search-local-core.test.ts` 新增 mediaKind 谓词用例。

### Phase 4: i18n + 提示 + 测试 + 性能验收

**Tasks:**
- [ ] en catalog 先加 `globalSearch.filterOnline/filterLocal/filterVideo/filterAudio`（+ pill aria-label），再补 zh/ja/ko（4 语言全量）。
- [ ] 更新 `globalSearch.placeholder` / `filterHint` 提示，提及新过滤。
- [ ] `make check`（typecheck + lint + test）通过。
- [ ] prod build 量取 §5.3 指标，记录 before/after 于 PR。

### Phase 4 Checklist
- [ ] 4 语言无缺 key（类型安全 `t()` 通过）。
- [ ] 性能指标达标并记录。

---

## 7. Out of Scope

- **画廊「全部歌曲」tab 的 `@` 过滤对齐**：画廊搜索框用 `parseSearchTokens`（`#tag`/`artist:`/`album:`），**不走** `@`-mention 系统。本 PRD 只动 ⌘F 浮层；画廊同维度过滤列为后续 parity。
- **R2 共享云盘目录（`remoteSearchTracks`）纳入 `@online`**：属「另一设备/分享的云盘」概念，与实时流媒体「online」不同。注意它**已索引** `kind`（v11），未来若纳入可低成本扩展，本期不做。
- **在线侧媒体类型过滤**：`@Video`/`@Audio` **仅本地**（用户明确）；在线源不按 kind 限源。
- **多选 / 可组合过滤**：`@` 保持单选（用户明确）；不引入多轴 `SearchFilterState`、不引入多 pill。
- **音轨抽取 / 波形 / 字面"包含音轨"语义**：沿用 `Track.kind` 单值映射（方案 B）。
- **过滤状态持久化**：刻意不持久化（打开即 reset）。

---

## 8. Security Considerations

- **Authentication / Authorization:** 无新增；在线源沿用各自 BYOK cookie（仅存 settings 行，硬规则 2）。
- **Data Protection:** 过滤状态不落盘、不上报；query 文本绝不进 telemetry/log（仅 enum 维度字段，§4.5 白名单）。
- **No hidden flags:** 过滤是可见 UI 控件，回退走 `git revert`，不留 runtime kill switch（硬规则 3 + [`feedback_no_hidden_backend_flags`]）。
- **Codename 稳定:** 不改 DB 名 / 表名 / id 前缀 / provider id / `StreamSourceId`（硬规则 4）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260615-muzero-global-search-index-performance-prd](../../20260615-muzero-global-search-index-performance-prd/) | 全局搜索离线 worker + 索引性能基线（本 PRD 复用其 worker） |
| [20260623-muzero-japanese-kanji-romaji-search-prd](../20260623-muzero-japanese-kanji-romaji-search-prd/) | 搜索 transliteration 管线（谓词不影响 transliteration 评分） |
| [20260610-muzero-external-streaming-sources-prd](../../20260610-muzero-external-streaming-sources-prd/) | 在线源 provider 契约（`@online` 的底座） |
| [20260617-muzero-scalable-track-list-reactivity-prd](../../20260617-muzero-scalable-track-list-reactivity-prd/) | 索引删减（v26-v30）+ selector 纪律（"不加索引"决策依据） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `@Audio` 取「纯音频」还是字面「包含音轨」？ | ✅ Resolved | **方案 B**：`@Audio`=`kind==="audio"`、`@Video`=`kind==="video"`（直接映射 `Track.kind`） |
| 2 | `@Video`/`@Audio` 是否作用于在线？ | ✅ Resolved | **否，仅本地**（用户明确）；在线源不按 kind 限源 |
| 3 | 已落地缓存的 `streamed` 曲目算 local 还是 online？ | ✅ Resolved | **算 local**（已能离线播）；本期靠现有库归属即可，无需额外 `origin` 谓词 |
| 4 | `@` 是否升级为多选/可组合？ | ✅ Resolved | **否，保持单选**（用户明确） |
| 5 | `@video`/`@audio` 是否也过滤本地歌单/专辑/歌手（而不仅歌曲区）？ | Open | 建议仅歌曲区（kind 是 track 级概念）；如需可后续扩 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-25 | DoodleBears | Initial draft |
| 2026-06-25 | DoodleBears | 按用户确认收敛：`@` 保持单选（不做多轴）；`@Video`/`@Audio` 仅本地（不碰在线）；定论 Open Q#1–#4 |

---

> **Note:** 本 PRD 强调**修改既有代码**：复用 `@`-mention 单选解析、离线 worker；不加 Dexie 索引、不 bump schema、不持久化过滤状态。净改动仅为 `SearchFilter` 联合 +4 个 kind（纯内存）+ worker 多一个 `mediaKind` 谓词 + section 门控扩展。
