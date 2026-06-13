# PRD: 网易云在线推荐（每日推荐 + 推荐歌单）— Gallery 第 5 个「发现」Tab

**Status:** Final
**Created:** 2026-06-14
**Author:** MUZERO Team
**Module:** streamsrc/netease · pages/search（Gallery）· stores/player — 在线发现层（不入库，实时联网）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Provider 层：纯解析 + 接口扩展（netease 推荐端点） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 数据获取层：react-query hooks（不入库、可缓存） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | UI：Gallery 第 5 个「发现」tab + 空态引导登录 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 播放 / 保存：复用 playStreamedHit + importStreamedPlaylist | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | i18n（en/zh/ja/ko）+ 收尾 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

我们已经有完整的网易云接入（[`netease-source.ts`](../../../src/streamsrc/netease/netease-source.ts)）：eapi 加密、cookie（`MUSIC_U`）注入、`muzfetch://` 代理绕 CORS、`account/get → user/playlist → v6/playlist/detail → v3/song/detail` 的「列歌单 → 取 trackIds → 批量歌曲详情」全链路，并已在 Settings 里支持登录后同步**用户自己的**歌单（[`stream-sources-settings.tsx`](../../../src/components/settings/stream-sources-settings.tsx) 的 `SourcePlaylists`）。

但用户**最想要的「每日推荐（日推 30 首）」和「推荐歌单」还没接**。这两类是网易云体验的核心入口——它是「续上歌单」DJ 之外、给本地优先播放器补上「每天有新东西听」的发现面。调研（见 §9）确认：这两类只是换几个 API path，复用现有全套机器，没有新的加密/认证/网络难题。

**关键产品约束（用户指定）**：这些在线内容**不做入库**，全是**实时联网请求**，用 **TanStack Query（react-query）** 做请求态缓存/持久（已在 [`main.tsx`](../../../src/main.tsx) 装好 `QueryClientProvider`）。它们落在「tab 2」（导航 search 页 = Gallery）现有 4 个 mode tab（sets/tracks/albums/artists，快捷键 1/2/3/4）之上，**新增第 5 个 tab**。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **已登录网易云用户** | 在 Settings 登录过网易云（有 `MUSIC_U`）；看个性化「每日推荐歌曲」「每日推荐歌单」+ 匿名「推荐歌单」 | 桌面端（需 `muzfetch://` 代理）|
| **未登录用户** | 照常浏览匿名「推荐歌单」（可点播/保存）；「每日推荐」区挂一个**非强制**登录 chip（点击跳 Settings），不阻断、不把整 tab 变空 | 桌面端 |
| **非桌面 / 未启用 streaming** | `hasStreamingSources()` 为 false → 不显示该 tab（与现有 streaming 一致） | — |

### 1.3 Core Value

1. **每天有新东西听**：把网易云「日推」搬进 MUZERO，补齐 DJ 续歌之外的「人工 + 算法推荐」发现面。
2. **零持久成本**：纯联网 + react-query 缓存，不动 IndexedDB schema、不引入新表、不破坏本地优先存储纪律。
3. **复用既有架构**：provider 接口扩两个可选方法即可；播放/保存走现成的 `playStreamedHit` / `importStreamedPlaylist`，无新播放通路。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                          [ Gallery 页 / search-page.tsx ]
  mode tabs:  1 sets   2 tracks   3 albums   4 artists   5 发现(NEW)
                                                              │
                                          ┌───────────────────┴───────────────────┐
                                          │  <OnlineDiscoverTab>  (新组件，不入库)   │
                                          │   ├─ 每日推荐歌曲  (flat 歌曲列表)        │
                                          │   ├─ 每日推荐歌单  (playlist 卡片)        │
                                          │   └─ 推荐歌单(匿名) (playlist 卡片)       │
                                          └───────────────────┬───────────────────┘
                                                              │ useQuery（react-query，仅内存缓存）
                                       ┌──────────────────────┴──────────────────────┐
                                       │  hooks: useNeteaseDailyTracks / Recommended  │
                                       └──────────────────────┬──────────────────────┘
                                                              │
                  [ StreamSourceProvider (netease) — 接口 +2 可选方法 ]
                    getDailyRecommendedTracks() → StreamSearchHit[]   (需登录)
                    getRecommendedPlaylists()   → StreamPlaylist[]    (匿名 + 登录态合并日推歌单)
                                                              │ postEapiJson（复用现有）
        ┌──────────────────────────────┬──────────────────────┴──────────────┐
        │  /api/v3/discovery/recommend/songs    (data.dailySongs[])  需登录    │
        │  /api/v1/discovery/recommend/resource (recommend[])        需登录    │
        │  /api/personalized/playlist           (result[])           匿名      │
        └──────────────────────────────────────────────────────────────────────┘

  播放：列表项点播 → playerStore.playStreamedHit(hit)  ← 已存在
        （懒落入自动管理的 "online" set，仅被点播的那首入库 = 播放缓存，非「同步」）
  保存：保存推荐歌单为我的集 → playerStore.importStreamedPlaylist(...) ← 已存在
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **联网请求态/缓存** | TanStack Query `useQuery` | CLAUDE.md「Query 管请求式异步」；先例 [`release-manifest.ts`](../../../src/lib/release-manifest.ts)。**不入库**正好用它而非 Dexie |
| **网易云接入** | 复用 [`netease-source.ts`](../../../src/streamsrc/netease/netease-source.ts) 的 `postEapiJson` + eapi crypto + cookie | 零新加密/网络栈 |
| **纯解析** | `netease-playlists.ts` 新增纯函数 + Vitest | CLAUDE.md 规则 7（纯函数穷举单测）|
| **UI tab** | 复用 Gallery 的 `Tabs`/`ModeTab` + `VirtualCardGrid` | 与现有 1/2/3/4 同构，新增 mode `online` |
| **播放/保存** | `playerStore.playStreamedHit` / `importStreamedPlaylist` | 已存在，无新播放路径 |

### 2.3 Project Structure（改动点；只 append，不新建大结构）

```
src/
├── streamsrc/
│   ├── provider.ts                      # [改] StreamSourceProvider +2 可选方法
│   └── netease/
│       ├── netease-playlists.ts         # [改] +parseNeteaseDailySongs / +parseNeteaseRecommendedPlaylists（picUrl→coverUrl 变体）
│       ├── netease-playlists.test.ts    # [改] 新增解析单测（fixture）
│       └── netease-source.ts            # [改] +URL/PATH 常量 + getDailyRecommendedTracks / getRecommendedPlaylists
├── hooks/
│   └── use-netease-recommend.ts         # [新] react-query hooks（不入库）— 唯一允许的新 hook 文件
├── pages/
│   └── search-page.tsx                  # [改] GALLERY_MODES 加 "online"；新增第 5 个 ModeTab + 内容区
├── components/
│   └── discover/                        # [新] OnlineDiscoverTab + 空态（引导登录）+ 子区块
│       └── online-discover-tab.tsx
└── i18n/locales/{en,zh,ja,ko}/common.json  # [改] gallery.modeOnline / discover.* 文案
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
本期硬约束：不新增任何 IndexedDB 表 / 不 bump muzero-db version。
推荐内容 = 进程内联网读 + react-query 内存缓存（关闭即丢，符合「实时联网」语义）。

  recommendations (ephemeral)        ── react-query cache（内存） ──▶ UI
       │
       └─（用户点播某一首时）─▶ 既有 playStreamedHit ─▶ "online" set 懒落该首
                                  （播放缓存，非把推荐流入库）
```

### 3.2 Database Schema

⚠️ **本期不改 schema。** 明确不引入 `recommendations` / `dailyFeed` 等表。

- **Current Schema:** [`muzero-db.ts`](../../../src/db/muzero-db.ts)（v2），不动。
- **Required Changes:** 无。推荐数据不持久。
- **唯一会写 DB 的路径**：用户**主动点播**某首推荐歌 → 既有 `playStreamedHit` → `createStreamedTrack` 落进自动管理的 "online" set（[`player-store.ts:809`](../../../src/stores/player-store.ts)）。这是**已存在**的播放缓存行为，不是本 PRD 新增的持久化，也不构成「推荐流入库」。
- **保存为我的集（可选）**：用户主动「保存这个推荐歌单」→ 既有 `importStreamedPlaylist`（[`player-store.ts:829`](../../../src/stores/player-store.ts)），显式 opt-in，符合预期。
- **Rollback Plan:** 因无 schema 变更，回退 = `git revert` 注册项 + 重新发版（CLAUDE.md 规则 3：无 hidden flag）。
- **Privacy & Retention:** 推荐内容只在内存；cookie 仍只在 `settings` 行（device-local，BYOK）。

### 3.3 Data Relationship Diagram

```
StreamSearchHit  (每日推荐歌曲的元素，已有形状 provider.ts:17)
   externalId/title/artist/album/durationSec/coverUrl/source="netease"

StreamPlaylist   (每日推荐歌单 + 推荐歌单的元素，已有形状 provider.ts:64)
   id/name/coverUrl/trackCount/source="netease"
   └─ 点进 / 保存 → 既有 importPlaylist(id)（v6/playlist/detail → trackIds → song/detail）
```

> 两类返回值**完全复用现有 DTO**，无需新类型。

---

## 4. API Design

### 4.1 API Endpoints（已从 api-enhanced 源码核实，见 §9）

| NetEase API path | crypto | 需登录 | 返回字段 | 映射到 |
|---|---|---|---|---|
| `/api/v3/discovery/recommend/songs` | weapi（eapi 同样可走）| ✅ `MUSIC_U` | `data.dailySongs[]`（标准 song 形状）| `getDailyRecommendedTracks() → StreamSearchHit[]` |
| `/api/v1/discovery/recommend/resource` | weapi/eapi | ✅ `MUSIC_U` | `recommend[]`（`id/name/picUrl/trackCount`）| `getRecommendedPlaylists()`（登录态合并）|
| `/api/personalized/playlist` | weapi/eapi | ❌ 匿名 | `result[]`（`id/name/picUrl/playCount/trackCount`）| `getRecommendedPlaylists()`（匿名基底）|

> 接入方式：全部走现有 `postEapiJson(url, apiPath, payload)`（[`netease-source.ts:148`](../../../src/streamsrc/netease/netease-source.ts)），eapi URL = `https://interface.music.163.com/eapi/<path 去掉 /api/ 前缀>`，apiPath = `/api/...`，与现有 `v3/song/detail` 完全同构。`/recommend/songs` 支持可选 `afresh` 参数强刷。
> **字段坑**：`recommend/resource` 与 `personalized/playlist` 用 **`picUrl`**，而现有 `neteasePlaylistToMeta`（[`netease-playlists.ts:58`](../../../src/streamsrc/netease/netease-playlists.ts)）读的是 `coverImgUrl` → 必须写 picUrl→coverUrl 的映射变体，不要复用原函数。

### 4.2 接口扩展（`StreamSourceProvider`，CLAUDE.md 规则 5：可选方法，只 netease 实现）

```typescript
// src/streamsrc/provider.ts —— 在 getUserPlaylists 等可选方法旁追加
export interface StreamSourceProvider {
  // ...existing...
  /** 每日推荐歌曲（个性化日推，需登录）。返回扁平 hits。 */
  getDailyRecommendedTracks?(opts?: { signal?: AbortSignal }): Promise<StreamSearchHit[]>;
  /** 推荐歌单：匿名 personalized/playlist；登录后并入个性化「每日推荐歌单」。 */
  getRecommendedPlaylists?(opts?: { signal?: AbortSignal }): Promise<StreamPlaylist[]>;
}
```

```typescript
// src/streamsrc/netease/netease-playlists.ts —— 新增纯解析（带单测）
export function parseNeteaseDailySongs(json: unknown): StreamSearchHit[];          // data.dailySongs → neteaseSongToHit
export function parseNeteaseRecommendedPlaylists(json: unknown): StreamPlaylist[]; // recommend[] / result[]（picUrl→coverUrl）
```

### 4.3 数据获取层（react-query，**不入库**）

```typescript
// src/hooks/use-netease-recommend.ts
export function useNeteaseDailyTracks() {
  const settings = useSettings();
  const loggedIn = cookieStringHasAuth(settings.streamSources?.netease?.cookie, "MUSIC_U");
  return useQuery({
    queryKey: ["netease", "daily-tracks", settings.streamSources?.netease?.cookie ? "auth" : "anon"],
    queryFn: ({ signal }) => createNeteaseSource({ http, getCookie }).getDailyRecommendedTracks?.({ signal }) ?? [],
    enabled: loggedIn,             // 未登录不打请求；UI 出空态引导
    staleTime: 1000 * 60 * 60,     // 日推每天刷新一次 → 1h stale 足够
    gcTime: 1000 * 60 * 60 * 6,
    retry: 1,
  });
}
// useNeteaseRecommendedPlaylists 同构，但 enabled 始终（匿名也可），登录态返回更丰富。
```

- **queryKey 含登录态指纹**（"auth"/"anon"）：登录/登出后自动失效重取，不串号。
- **绝不 `setQueryData` 写 Dexie / 不 createStreamedTrack**：浏览阶段零 DB 写。
- 失败/空/未登录三态显式区分（见 §4.4）。

### 4.4 Error Handling

- **未登录**（无 `MUSIC_U`）：日推两类 `enabled:false` → 不发请求；但**匿名「推荐歌单」照常展示**，日推区只挂一个**非强制**登录 chip（点击跳 Settings），不把整 tab 变空态。
- **请求失败 / 非 JSON**（反爬 HTML / 过期 cookie）：沿用现有 `log.warn("netease", …)` + 返回 `[]`；UI 出「暂时拿不到推荐，稍后重试」+ retry 按钮（react-query `refetch`）。
- **空结果**：出友好空态而非报错。
- **Telemetry：本期无遥测**（本地优先，无后端）；仅 `src/lib/logger.ts` 的 warn/error，**绝不记 cookie / 歌曲 id 之外的 PII**。

---

## 5. Frontend Design

### 5.1 Page Structure

「发现」是 Gallery（[`search-page.tsx`](../../../src/pages/search-page.tsx)）的**第 5 个 mode**，不新增路由：

```
GALLERY_MODES: ["sets","tracks","albums","artists","online"]   // [改] 追加 "online"
GALLERY_TAB_ACTIONS: ... + ["nav.galleryTabOnline","online"]    // 快捷键 5（rebindable）
ModeTab value="online" shortcut="5" → {t("gallery.modeOnline")}
内容区 {mode === "online" && <OnlineDiscoverTab />}
```

### 5.2 UI Components

- **`OnlineDiscoverTab`（新）**：三段式（标题分区）
  1. **每日推荐歌曲**：扁平歌曲列表（复用 `TrackListSection` 的展示，或轻量行），每行点播 → `playStreamedHit(hit)`；顶部「播放全部」「换一批（afresh）」。
  2. **每日推荐歌单**（登录态）：`VirtualCardGrid` playlist 卡片。
  3. **推荐歌单**（匿名/通用）：playlist 卡片。卡片点击 → 进 playlist 详情（复用 `importPlaylist` 拉 hits 做临时预览）或直接「保存为我的集」→ `importStreamedPlaylist`。
- **软引导登录（不强制，用户指定）**：tab 常驻。未登录时**匿名「推荐歌单」区照常渲染**，可浏览/保存/点播；仅「每日推荐歌曲 / 每日推荐歌单」两段因需登录而隐藏内容，改挂一个**非阻断的登录 chip**（「登录网易云解锁每日推荐」→ 跳 Settings streaming 区）。**不**把整 tab 变 empty state，也**不**「登录才显示 tab」（见 §10 Q1/Q3）。匿名歌曲点播时若 resolve 返回 `requires-login`，沿用既有 verdict 处理（提示登录），不在此 tab 额外拦截。
- **桌面门控**：`hasStreamingSources()` 为 false（web/未启用）时，该 tab 不渲染——与 Settings streaming 区一致。
- **加载态**：react-query `isLoading` → skeleton 卡片；`isError` → 重试。

### 5.3 State Management

- **联网态**：react-query（hooks），**不进 Zustand、不进 Dexie**（CLAUDE.md 规则 6：可由远端派生的数据不塞 Zustand）。
- **tab 选择态**：复用现有 `mode` 本地 state + `localStorage(MODE_KEY)`（已存在）。
- **播放/保存**：经 `usePlayerStore` 既有 action，最小 selector 订阅。

---

## 6. Implementation Plan

### Phase 1: Provider 层（纯解析 + 接口扩展）

**Goal:** 网易云推荐端点可调、可解析，纯函数有单测。

**Tasks:**
- [x] `provider.ts` 加 `getDailyRecommendedTracks?`（带可选 `afresh`）/ `getRecommendedPlaylists?`
- [x] `netease-playlists.ts` 加 `parseNeteaseDailySongs` / `parseNeteaseRecommendedPlaylists`（picUrl→coverUrl，独立 `neteaseRecommendedToMeta`，不复用读 `coverImgUrl` 的旧 mapper）
- [x] `netease-source.ts` 加 URL/PATH 常量 + 两方法实现（复用 `postEapiJson`；`getRecommendedPlaylists` 匿名 personalized 基底 + 登录态 resource 合并去重，resource 失败降级仅 personalized）

### Phase 1 Checklist
- [x] `parseNeteaseDailySongs` / `parseNeteaseRecommendedPlaylists` 单测（含字段坑 picUrl、空/异常 JSON、防误用 `coverImgUrl`）
- [x] 两方法 source 层单测（注入 mock http）：日推映射 `data.dailySongs[]`、`afresh` 触发请求、登录态 resource 合并在 personalized 前、resource 失败仍出 personalized
- [x] 匿名态 `getRecommendedPlaylists` 仍返回 personalized 结果，且**不**打 login-gated `recommend/resource`
- [ ] 登录态本机冒烟（真 cookie + 网络）：日推/推荐歌单非空 — 待 Phase 4 联调时在桌面壳验证

### Phase 2: 数据获取层（react-query，不入库）

**Goal:** hooks 提供缓存的联网读，登录态正确门控，零 DB 写。

**Tasks:**
- [x] `use-netease-recommend.ts`：`useNeteaseDailyTracks`（带可选 `afresh`）/ `useNeteaseRecommendedPlaylists`
- [x] queryKey 含登录指纹（`auth`/`anon`）；`staleTime` 1h / `gcTime` 6h / `enabled`（日推门控登录、推荐歌单恒开）/ `retry` 1，按 §4.3

### Phase 2 Checklist
- [x] 登出 → 日推 query `enabled:false`、`fetchStatus==="idle"`、不调 provider（renderHook 单测）
- [x] 登录 → 自动取数（renderHook 单测断言 `getDailyRecommendedTracks` 被调一次、data 落地）；queryKey 含 auth/anon 指纹 → 切走切回命中缓存不重打（react-query staleTime 行为）
- [x] 匿名 → 推荐歌单仍取数（`enabled:true`）
- [x] 全程无 Dexie 写（grep `src/hooks/use-netease-recommend.ts` 无 `createStreamedTrack`/`db.`/`saveSettings`）

### Phase 3: UI（第 5 个「发现」tab + 空态）

**Goal:** Gallery 出现第 5 个 tab，三段内容 + 未登录空态引导。

**Tasks:**
- [x] `GALLERY_MODES` / `GALLERY_TAB_ACTIONS` 加 `online`；新增 ModeTab(shortcut 5)（仅 `streamingSupported` 时渲染）；shortcut registry 加 `nav.galleryTabOnline`(Digit5) + 更新 registry 单测（Digit1–5）
- [x] `OnlineDiscoverTab`：日推歌曲段 + 推荐歌单段 + skeleton + error/retry + empty（**两段**而非三段：依 §4.2/§4.3 的两方法/两 hook 契约，「每日推荐歌单」由 provider 合并进「推荐歌单」grid 前列，不另起第三段/第三 hook；详见 §2.1 `getRecommendedPlaylists` 合并语义）
- [x] 未登录：匿名推荐歌单照常渲染 + 日推区非强制登录 chip（`setSettingsItem("stream-sources")` + `setTab("settings")`）；`hasStreamingSources()` 门控（tab 隐藏 + 数字/循环跳过 + 持久化 online 回退 tracks）
- [x] 推荐歌单卡片用轻量响应式 CSS grid（有界 ~30 项，非 `VirtualCardGrid`，避免嵌套滚动容器复杂度）；播放/保存 handler 以可选 props 预留，Phase 4 由 search-page 注入

### Phase 3 Checklist
- [x] 登录态：日推歌曲行 + 推荐歌单 grid 正常渲染（component 单测 `render` 断言日推标题、无登录 chip）
- [x] 未登录：匿名推荐歌单可见、日推区显示登录 chip（点击 → setSettingsItem/setTab 路由 Settings streaming），tab 不变空（component 单测覆盖）
- [x] error → retry（component 单测断言点击 retry 调 `refetch`）
- [x] web/未启用：tab 不出现（`streamingSupported` 门控 ModeTab + handlers；typecheck 通过；逻辑直读，桌面/web 视觉冒烟随 Phase 4 联调）
- [x] 快捷键 5 切到该 tab；与 1/2/3/4 一致（registry 加 Digit5 + registry 单测扩到 Digit1–5）

### Phase 4: 播放 / 保存（复用既有）

**Goal:** 点播日推歌曲能放；推荐歌单能保存为我的集。

**Tasks:**
- [ ] 日推歌曲行点播 → `playStreamedHit(hit)`；「播放全部」
- [ ] 「换一批」→ `afresh` 重取（react-query `refetch` 带新参数）
- [ ] 推荐歌单卡片「保存为我的集」→ `importStreamedPlaylist`

### Phase 4 Checklist
- [ ] 点播日推 → 进 "online" set 播放，封面懒缓存
- [ ] 保存推荐歌单 → 新建集，trackIds 正确，可离线下载
- [ ] 「换一批」拿到不同 30 首

### Phase 5: i18n + 收尾

**Tasks:**
- [ ] `gallery.modeOnline` + `discover.*`（标题/空态/错误/按钮）先加 en，再 zh/ja/ko
- [ ] `make check`（typecheck + lint + test）通过

### Phase 5 Checklist
- [ ] 4 语言无缺键（类型源 en 全覆盖）
- [ ] 无 `console.*` 直连（走 logger）；无硬编码用户可见字符串

---

## 7. Out of Scope

- **不入库 / 不持久推荐流**：不建 `recommendations` 表、不缓存到 Dexie、不离线持久日推列表（react-query 内存缓存即上限）。
- **不做 bili / youtube 的发现页**：本期只 netease 实现这两个可选方法；其它源以后各自补（接口已 source-agnostic）。
- **不做「私人 FM」/「心动模式」/「雷达歌单」**等其它个性化流（后续可加同型方法）。
- **不引入 NeteaseCloudMusicApi 这类外部服务/Node 中间层**：纯前端直连，复用现有 eapi 栈（本地优先）。
- **不做推荐理由（recommendReasons）展示**：日推接口虽返回，但本期先只用歌曲本身。
- **不改 DJ 续歌逻辑**：发现 tab 与 DJ autoExtend 无关；「把日推喂给 DJ」是后续独立增强。

---

## 8. Security Considerations

- **Authentication:** 复用现有 cookie 登录（`MUSIC_U`，[`login.ts`](../../../src/streamsrc/login.ts)）；日推两端点需登录，匿名推荐歌单无需。
- **Authorization:** 无后端、无账号系统；登录态仅由 device-local cookie 决定。
- **Data Protection:** cookie 只存 `settings` 行（BYOK，device-local，绝不进 bundle/URL/日志/遥测，CLAUDE.md 规则 2）；推荐内容只在内存。
- **出站请求纪律:** 所有 HTTP 走 `getAppFetch()` → 桌面 bridge（`muzfetch://`），不直接 `window.fetch` 外部 API（CLAUDE.md 规则 5/10）。
- **No hidden flags:** 该 tab 显隐由可见条件（登录态 / `hasStreamingSources()`）决定，不藏 localStorage/URL flag（规则 3）。
- **Audit Logging:** 仅 `logger.warn/error`，不记 PII。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [外部流媒体源 PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | 本 PRD 的前序：netease/bili/youtube 接入、登录、importPlaylist 地基 |
| [`netease-source.ts`](../../../src/streamsrc/netease/netease-source.ts) | eapi crypto + cookie + 现有 user 库同步链路 |
| [`provider.ts`](../../../src/streamsrc/provider.ts) | StreamSourceProvider 接口（本期 +2 可选方法）|
| [cwuom/NeriPlayer](https://github.com/cwuom/NeriPlayer) | 参考实现：`getRecommendedPlaylists` 打 `/weapi/personalized/playlist`；**未实现**个性化日推（recommend/songs|resource）|
| [NeteaseCloudMusicApiEnhanced/api-enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) | 端点核实来源：`recommend_songs.js` / `recommend_resource.js` / `personalized.js` |
| [binaryify NeteaseCloudMusicApi 文档](https://binaryify.github.io/NeteaseCloudMusicApi/) | 端点语义参考 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | tab 显隐：「登录才显示」vs「常驻 + 未登录空态引导」 | Resolved | 采「**常驻 + 空态引导登录**」（用户倾向，更可发现）；登录后内容自动填充 |
| 2 | tab 命名：发现 / 在线 / 推荐 | ✅ Resolved | 「**发现**」（Discover）；en `Discover` / zh 发现 / ja 発見 / ko 발견 |
| 3 | 未登录时「推荐歌单」（匿名 personalized/playlist）是否照常展示 | ✅ Resolved | **照常展示**匿名推荐歌单（可点播/保存，不强制登录）；「每日推荐」两段挂**非阻断登录 chip**，不整 tab 引导、不登录才显示 tab |
| 4 | 「换一批」用 `afresh` 强刷 vs 仅 `refetch` | Open | 倾向 `afresh=true` 真换一批；Phase 4 确认网易云对频繁 afresh 是否限流（纯实现细节，不阻断定稿）|
| 5 | eapi vs weapi 调这三端点 | ✅ Resolved | **eapi**（best practice：与现有栈一致、匿名不被反爬门控）；Phase 1 冒烟若 eapi 对某端点异常，再按需将该端点回退 weapi |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | MUZERO Team | Initial draft：网易云每日推荐 + 推荐歌单作为 Gallery 第 5 个「发现」tab；不入库、react-query 缓存；复用 provider/播放/保存既有通路 |
| 2026-06-14 | MUZERO Team | 决议 Q2/Q3/Q5 → Status: Final。tab 名「发现」；未登录照常展示匿名推荐歌单 + 日推区非强制登录 chip（不强制登录）；三端点用 eapi（best practice，异常再按需回退 weapi）|

---

> **Note:** 本 PRD 遵循模板「优先改既有代码、少建新结构」原则：唯一新文件是 `use-netease-recommend.ts`（react-query hook bridge）与 `online-discover-tab.tsx`（新 UI 区块），其余全是 append 到 `provider.ts` / `netease-source.ts` / `netease-playlists.ts` / `search-page.tsx` / i18n catalog。无 schema 变更、无新持久化模型、无新播放路径。
