# PRD: MUZERO — AI DJ Library Tree 与 Local ID Tool Call 架构

**Status:** In Progress（Phase 1 Local ID registry + chat transport 接线已完成；Phase 2 `library_tree` browse tool 已完成；Phase 3 现有工具输入输出 local-ID 化已完成：search/list/get/memory/queue/play/set/generate tools 统一 encode/decode `#T/#S/#M/#Q/#R`，Phase 4 prompt 与错误恢复待推进。）
**Created:** 2026-06-13
**Author:** MUZERO
**Module:** AI DJ Chat Agent Tools — 曲库结构可见性、tool-call ID 压缩、上下文预算

> **需求来源**：AI DJ Agent 在 tool call 中经常不知道用户到底有哪些歌曲，只能靠搜索或当前播放上下文猜测。产品需要让 Agent 能主动查看「整个音乐库按歌单组织的 tree」或「某个歌单的全部歌曲」，并参考 `D:\code\project\anysoul` 的 local ID 方案，用短的 LLM-facing ID 代替真实 `trk_...` / `ses_...`，降低 token 成本并减少 ID 幻觉。
>
> **AnySoul 参考实现**：
> - `D:\code\project\anysoul\docs\prd\20260415-llm-local-id-compaction\20260415-llm-local-id-compaction-prd.md`
> - `D:\code\project\anysoul\packages\server\src\services\llm-formatting.ts`
> - `D:\code\project\anysoul\packages\server\src\services\tools\communication\list-events-readers.ts`

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Local ID registry primitive + chat transport 接线 | Completed（2026-06-13：registry/session/context/transport 基础接线 + tests） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Library tree / set tree browse tools | Completed（2026-06-13：`library_tree` tool + tests） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 现有工具输入输出 local-ID 化 | Completed（2026-06-13：existing read/write/playback tools encode/decode local refs + tests） | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Prompt、错误恢复、测试与验收 | Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO 的 AI DJ Chat 已有一组很强的工具：

- `library_search`：统一搜索 track / set / lyrics，支持 cursor。
- `set_list` / `set_get`：读歌单。
- `set_create` / `set_add_tracks` / `set_add_by_search`：创建、扩充歌单。
- `play_set` / `play_track` / `queue_add` / `queue_clear`：驱动播放。
- `memory_search` / `add_memory`：读写「音乐承载回忆」。

但现状有两个结构性问题：

1. **Agent 没有稳定的曲库全局视野。** 它可以搜索关键词，但当用户说「看看我的歌，帮我整理」或「这个歌单里有哪些歌」时，缺一个可浏览的 tree 工具。`set_list` 现在直接返回 `DjSession[]`，可能带完整 `trackIds`；`set_get` 返回 session + tracks，但不是专门为 Agent 的 token budget 设计。
2. **真实 ID 直接进入对话。** `buildNowPlayingContext` 会把 `ses_...` / `trk_...` 注入 system prompt；tool 输出与 tool input 也直接使用真实 ID。长 ID 浪费 token，而且模型容易抄错。AnySoul 已通过 per-turn `LocalIdRegistry` 把长 ID 压成 `#E1/#TE1`，证明这是成熟模式。

本 PRD 要把这两个问题一起解决：**Agent 通过 tree 工具看见曲库结构，通过 local ID 操作曲库实体。**

### 1.2 Target Users

| Role | Description | Value |
|------|-------------|-------|
| Listener | 想让 AI DJ 理解自己的本地曲库、歌单、未整理歌曲 | 能说「看看我的库」「整理未分配歌曲」「把这个歌单补完整」 |
| AI DJ Agent | 需要低成本、低错误率地引用歌曲和歌单 | 用 `#T1/#S1` 操作，不再抄长 ID |
| Engineering | 维护 chat tools、Dexie 数据、prompt budget | 工具边界清晰，可单测，不把 ID 规则散在各处 |

### 1.3 Core Value

1. **曲库可见性**：Agent 可以按树状结构读取「全部歌单 -> 歌曲」和「未分配到歌单」。
2. **Token 节省**：LLM-facing payload 使用 `#S1/#T1` 短码，不在对话中反复传真实 ID。
3. **更低 tool-call 失败率**：短码比真实 ID 更容易准确引用；未知短码给可恢复错误。
4. **本地优先不变**：registry 和 tree 都只读写 IndexedDB，无 MUZERO 后端、无遥测、无 hidden flag。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
User prompt
   |
   v
DjChatRuntimeActor
   |
   v
createDjChatTransport.sendMessages(chatId)
   |
   |-- hydrate DjChatLocalIdRegistry from ChatSession.localIdRegistryJson
   |-- buildNowPlayingContext(db, localIds) -> "#S1/#T1"
   |-- createDjChatTools({ db, localIds, persistLocalIds })
   |
   v
ToolLoopAgent
   |
   |-- read tools encode result ids:
   |     library_tree -> set "#S2" / track "#T9"
   |     library_search -> track "#T10"
   |     now_playing_get -> queue track "#T1"
   |
   |-- write tools decode input ids:
   |     set_get({ sessionId:"#S2" }) -> "ses_..."
   |     set_add_tracks({ trackIds:["#T9"] }) -> ["trk_..."]
   |     play_track({ trackId:"#T1" }) -> "trk_..."
   |
   v
Dexie repositories / player-store bridge use real ids only
```

### 2.2 Key Decision: AnySoul Pattern, MUZERO Scope Adaptation

AnySoul 的核心 best practice：

- `toLocal(realId, type)` 幂等，同一个真实 ID 在同一作用域内永远得到同一个 local ID。
- `fromLocal(arg)` 对非 local-ID 字符串 pass-through，保证 rollout 兼容。
- `resolveLocal(arg)` 可返回 type + meta，供跨类型 routing。
- unknown local ID 抛类型化错误，tool handler 转成模型可恢复的错误。
- 双 Map：`realToLocal` + `localToReal`，每种 prefix 独立计数。
- 严格 regex：只接受 `#<UPPERCASE_PREFIX><digits>`。

MUZERO 需要做一处适配：**registry 生命周期建议为 chat-session scoped，而不是 purely per-turn scoped。**

原因：

- MUZERO Chat 会把 tool results 持久化在 `chatSessions.messagesJson`，后续 turn 仍可能把旧 tool result 放回模型上下文。
- 如果 local ID 每 turn 失效，模型在下一轮看到历史里的 `#T7` 时无法 decode，容易误用。
- 因此 v1 使用「每个 chat session 一个 registry snapshot」，每次 `sendMessages` hydrate，tool loop 中更新，结束/工具调用后写回 Dexie。

边界：

- registry 仍然不是全局曲库 ID，不跨 chat session，不进 Settings。
- 新建 chat session 从 `#T1/#S1` 重新开始。
- raw `trk_.../ses_...` 在 handler 里仍 pass-through，用于兼容旧消息和人工调试；system prompt 明确要求 Agent 优先用 local ID。

### 2.3 Local ID as Universal Tool Reference Layer

Local ID 不是 `library_tree` 的私有输出格式，而是 **所有 AI DJ tool call 的统一引用层**：

- LLM 看到歌曲、歌单、记忆、队列项时，只需要记住 `#T1` / `#S1` / `#M1` / `#Q1`。
- LLM 调用创建歌单、播放歌曲、添加队列、添加记忆等工具时，可以直接把这些 local ID 填进现有参数字段。
- Tool handler 在进入 repository / player-store 之前统一调用 resolver，把 local ID 翻译回真实 `trk_...` / `ses_...`。
- Repository、Dexie、player-store、sync、media blob 层永远只接触真实 ID；local ID 不泄漏进核心数据模型。
- 同一个真实 track 在同一 chat session 内无论从 `library_tree`、`library_search`、`now_playing_get` 还是 `set_get` 出现，都得到同一个 `#Tn`，让 LLM 可以稳定地跨工具引用。
- **Search/list/tree 的结果也必须统一使用 local ID**：只要 tool result 里出现 track/set/memory/queue-entry，就输出 `#T/#S/#M/#Q`，不输出 raw `trk_.../ses_...`。

示例：

```ts
// LLM-facing
set_create({ name: "Late night focus", trackIds: ["#T3", "#T8"] })
play_track({ trackId: "#T3" })
queue_add({ trackIds: ["#T8"], position: "next" })

// Tool handler 内部
const trackIds = input.trackIds.map((id) => resolveTrackRef(id, localIds));
// -> ["trk_...", "trk_..."]
```

这意味着后续优化不需要为每个 tool 重写一套「LLM 怎么找真实 ID」逻辑。只要一个工具参数语义上引用 track/set/memory，它就应该使用共享 resolver。

### 2.4 Result References for Multi-Round Tool Results

Entity refs 和 tool result refs 要分层：

- `#T/#S/#M/#Q`：实体引用，代表真实 track/set/memory/queue-entry，在 chat session 内稳定。
- `#R`：一次 read/search/list/tree tool 的**回传窗口**引用，只用来区分「哪一次结果」。它不是歌曲，不进 Dexie domain model，也不能传给 `play_track` / `set_add_tracks` 这类 entity resolver。

每个会返回列表或树的读工具都必须输出统一 envelope：

```ts
type AgentToolResultEnvelope<TItem> = {
  resultRef: "#R1";
  tool: "library_search" | "library_tree" | "set_list" | "set_get" | "memory_search" | "now_playing_get";
  request: Record<string, unknown>; // sanitized args, no raw ids after decode
  page?: {
    cursor: string | number | null;
    nextCursor: string | number | null;
    returned: number;
    total?: number;
  };
  items: Array<TItem & { ordinal: number }>;
};
```

Example:

```json
{
  "resultRef": "#R4",
  "tool": "library_search",
  "request": { "types": ["track"], "queries": ["lofi"], "cursor": 0 },
  "page": { "cursor": 0, "nextCursor": 50, "returned": 50, "total": 210 },
  "items": [
    { "ordinal": 1, "id": "#T3", "title": "Metro Bloom" },
    { "ordinal": 2, "id": "#T8", "title": "Rain Mirror" }
  ]
}
```

Rules:

- `ordinal` is **local to one `resultRef`**. "item 2" means nothing without `#R4`.
- If the same track appears in `#R4` and `#R7`, it keeps the same `#Tn`; only the result window changes.
- Tool execution should prefer entity IDs (`#T3`, `#S2`) over result ordinals. A future batch helper may accept `{ resultRef:"#R4", ordinals:[1,2] }`, but v1 write tools should still receive explicit entity refs.
- `#R` can be generated by the same registry type with real id `result:<toolCallId>` plus metadata, or by a tiny separate result-ref allocator. Either way, it is persisted with `ChatSession.localIdRegistryJson` so multi-turn references to visible historical results remain decodable for diagnostics.

### 2.5 Local ID Prefix Table

| Entity | Prefix | Real ID | Used By |
|--------|--------|---------|---------|
| Track | `#T` | `trk_...` | `library_tree`, `library_search`, `set_get`, `play_track`, `queue_add`, `set_add_tracks`, `add_memory` |
| Set / DjSession | `#S` | `ses_...` | `library_tree`, `set_list`, `set_get`, `set_update`, `set_add_*`, `play_set` |
| Memory | `#M` | `mem_...` | `memory_search`, future memory edit/delete |
| Play queue entry | `#Q` | `pqe_...` | `now_playing_get`, future queue reorder/remove |

Non-entity refs:

| Ref | Prefix | Real Backing | Used By |
|-----|--------|--------------|---------|
| Tool result window | `#R` | `result:<toolCallId>` or generated `res_...` | Distinguishing multi-round `library_search` / `library_tree` / `set_get` outputs |

Virtual groups do **not** need durable real IDs:

- Library root: `"library"`
- Unassigned group: `"unassigned"`

If future tools need to act on virtual groups, add `#G` with explicit meta. Do not overload `#S` for virtual groups.

### 2.6 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Chat loop | AI SDK v6 `ToolLoopAgent` in `src/chat/dj-chat-agent.ts` | Existing architecture |
| Storage | Dexie `chatSessions` non-indexed field | Local-only, no schema index bump |
| Entity reads | Existing `db.sessions`, `db.tracks`, `db.memories`, `db.lyrics` repositories | No backend, no new source of truth |
| Ordering | `orderedSetTrackIds(trackIds, trackRanks)` | Tree must match UI set order |
| Logging | `src/lib/logger.ts` | No direct `console.*` |
| Tests | Vitest + `fake-indexeddb` | Existing project pattern |

### 2.7 Project Structure

```
src/chat/
├── dj-chat-agent.ts              # hydrate/persist registry, pass into tools/context
├── dj-chat-context.ts            # buildNowPlayingContext(db, localIds)
├── dj-chat-library-tree.ts       # new: tree projection + pagination helpers
├── dj-chat-local-ids.ts          # new: registry primitive + resolve helpers
├── dj-chat-prompt.ts             # prompt teaches short ids + tree workflow
├── dj-chat-sessions.ts           # persist ChatSession.localIdRegistryJson
├── dj-chat-tools.ts              # tools use encode/decode wrappers
└── *.test.ts                     # registry/tree/tool contract tests
```

New files are justified because local-ID formatting and tree projection are shared architecture primitives, not one-off helpers inside `dj-chat-tools.ts`.

---

## 3. Data Model Design

### 3.1 ChatSession Additive Field

Add a non-indexed optional field to `ChatSession` in `src/db/types.ts`:

```ts
export interface ChatSession {
  // existing fields...
  localIdRegistryJson?: string; // JSON.stringify(DjChatLocalIdSnapshotEntry[])
}
```

No Dexie store/index bump is required because the field is not indexed. `chatSessions` remains `"id, updatedAt"`.

### 3.2 Local ID Types

```ts
export type DjChatLocalIdType = "T" | "S" | "M" | "Q" | "R";

export interface DjChatLocalIdMeta {
  /** Optional context for debugging and future routing; never required for authorization. */
  setId?: string;
  /** Only meaningful for `R`: which tool produced this result window. */
  toolName?: string;
  /** Only meaningful for `R`: sanitized request/page summary for diagnostics. */
  resultSummary?: Record<string, unknown>;
}

export interface DjChatLocalIdSnapshotEntry {
  local: string;
  real: string;
  type: DjChatLocalIdType;
  meta?: DjChatLocalIdMeta;
}

export interface DjChatLocalIdResolution {
  real: string;
  type: DjChatLocalIdType | null;
  meta?: DjChatLocalIdMeta;
}
```

### 3.3 Registry Contract

```ts
export interface DjChatLocalIdRegistry {
  toLocal(realId: string, type: DjChatLocalIdType, meta?: DjChatLocalIdMeta): string;
  fromLocal(arg: string): string;
  resolveLocal(arg: string): DjChatLocalIdResolution;
  snapshot(): DjChatLocalIdSnapshotEntry[];
}

export class UnknownDjChatLocalIdError extends Error {
  readonly localId: string;
}

export function createDjChatLocalIdRegistry(
  initialEntries?: readonly DjChatLocalIdSnapshotEntry[],
): DjChatLocalIdRegistry;
```

Rules:

- Idempotent by `realId`.
- Prefix counters are independent: first track is `#T1`, first set is `#S1`.
- Hydration resumes counters from max existing index.
- Corrupt hydration entries are skipped, not fatal.
- Unknown prefix such as `#Z1` pass-through, matching AnySoul's rollout-safe behavior.
- Known but unassigned local ID such as `#T999` throws `UnknownDjChatLocalIdError`.
- Regex is strict: `/^#([A-Z]+)(\d+)$/`.

### 3.4 Tree Relationship

```
Library
├── Set #S1 "Rain Focus"
│   ├── Track #T1
│   └── Track #T2
├── Set #S2 "Roadtrip"
│   ├── Track #T2   # same real track, same local id
│   └── Track #T3
└── Unassigned
    └── Track #T4   # tracks not present in any session.trackIds
```

Unassigned definition:

```ts
const assigned = new Set((await listSessions(db)).flatMap((s) => s.trackIds));
const unassignedTracks = (await listAllTracks(db)).filter((t) => !assigned.has(t.id));
```

If a track appears in multiple sets, it appears under each set node but keeps the same `#Tn` local ID.

### 3.5 Data Privacy

- Registry stores local-to-real mappings in IndexedDB, same trust boundary as the source `tracks` / `sessions`.
- Registry is never sent wholesale to the LLM.
- Tool outputs sent to LLM use local IDs; real IDs stay inside tool execution.
- No keys, endpoints, file paths, blobs, or lyrics bytes are added to the registry.

---

## 4. Tool / API Design

There is no backend API. "API" here means AI DJ tool contracts.

### 4.1 New Tool: `library_tree`

Purpose: let the Agent browse the library structure without guessing search terms.

```ts
const libraryTreeInputSchema = z.object({
  scope: z.enum(["library", "set", "unassigned"]).default("library"),
  setId: z.string().min(1).optional(), // local #Sn or raw ses_...
  includeTracks: z.boolean().default(true),
  fields: z
    .array(z.enum(["id", "title", "artist", "album", "tags", "duration", "kind", "origin", "status", "memoryCount"]))
    .default(["id", "title", "artist", "tags", "duration", "kind", "origin"]),
  limit: z.number().int().min(1).max(500).default(120),
  cursor: z.string().optional(),
});
```

Output:

```ts
type LibraryTreeOutput = {
  resultRef: "#R1";
  scope: "library" | "set" | "unassigned";
  request: {
    scope: "library" | "set" | "unassigned";
    setId?: "#S1";
    includeTracks: boolean;
  };
  nodes: Array<
    | {
        ordinal: number;
        depth: 1;
        kind: "set";
        id: "#S1";
        name: string;
        trackCount: number;
        autoExtend: boolean;
        updatedAt: number;
      }
    | {
        ordinal: number;
        depth: 1;
        kind: "group";
        group: "unassigned";
        name: "Unassigned";
        trackCount: number;
      }
    | {
        ordinal: number;
        depth: 2;
        kind: "track";
        id: "#T1";
        title: string;
        artist?: string;
        album?: string;
        tags?: string[];
        durationSec?: number;
        mediaKind?: "audio" | "video";
        origin?: "generated" | "uploaded" | "streamed";
        status?: Track["status"];
        memoryCount?: number;
      }
  >;
  returned: number;
  nextCursor: string | null;
  notes: string[];
};
```

Behavior:

- `scope:"library"` returns set nodes and, when `includeTracks:true`, their child tracks in tree order, plus `Unassigned`.
- `scope:"set"` requires `setId`, decodes it to a real session ID, and returns all tracks in that set across pages.
- `scope:"unassigned"` returns tracks not in any set.
- `limit` caps node count, not set count. Always return `nextCursor` when more nodes exist.
- Use `orderedSetTrackIds(session.trackIds, session.trackRanks)` for set ordering.
- `resultRef` distinguishes this specific tree page from other tree/search calls in the same conversation.
- `ordinal` restarts at 1 for each `resultRef`; actions should still pass `id:"#Tn/#Sn"`, not ordinal alone.
- Do not include lyrics in tree output. Use `library_search({ types:["lyrics"] })` for lyric lookup.
- Do not include blob IDs, local paths, remote URLs, or raw IDs.

### 4.2 Existing Tool Changes

| Tool | Current Issue | Required Change |
|------|---------------|-----------------|
| `library_search` | Returns raw track/set IDs in result items and lacks result-window identity | Return `resultRef:"#Rn"` envelope; encode every track/set/lyrics hit with local entity IDs; each item has `ordinal`; keep cursor numeric as-is |
| `set_list` | Returns full `DjSession[]`, including raw `trackIds` arrays | Return `resultRef:"#Rn"` envelope with compact set summaries: `id:"#Sn"`, `name`, `trackCount`, `autoExtend`, `updatedAt`; no `trackIds` |
| `set_get` | Input expects raw `sessionId`, output returns raw session/tracks | Accept local or raw; output `resultRef:"#Rn"` plus same shape as `library_tree({scope:"set"})` or compact `{set, tracks}` with local IDs |
| `now_playing_get` | Returns raw play queue with raw `trackId` | Return `resultRef:"#Rn"` envelope with projected queue summary using `#Qn`, `#Tn`, `#Sn` |
| `set_create` | Returns raw `sessionId` and raw `trackIds` | Output local `#Sn/#Tn`; input `trackIds` accepts local or raw |
| `set_update` | Input expects raw `sessionId` | Accept local or raw |
| `set_add_tracks` | Input expects raw track IDs and session ID | Accept local or raw; output local IDs |
| `set_add_by_search` | Internally avoids listing IDs, good | Output target set as local ID; matched IDs stay out of LLM output |
| `queue_add` | Input expects raw track IDs | Accept local or raw; output local queue summary |
| `play_set` / `play_track` | Input expects raw IDs | Accept local or raw; output local IDs |
| `memory_search` | Returns raw `memoryId` / `trackId` and lacks result-window identity | Return `resultRef:"#Rn"` envelope; encode memory as `#M`, track as `#T`; each hit has `ordinal` |
| `add_memory` | Input `trackId` optional raw | Accept local or raw; output local IDs |
| `online_add_tracks` | Input target `sessionId` raw | Accept local or raw; created imported tracks return local IDs |

### 4.3 End-to-End Tool Call Examples

The main product win is that once a track/set appears anywhere in Agent context, every later action can use the short reference directly.

**Create a new set from known tracks**

```ts
// library_tree / library_search returned:
// #T3 "Metro Bloom", #T8 "Rain Mirror"

set_create({
  name: "Night train focus",
  autoExtend: false,
  trackIds: ["#T3", "#T8"],
});
```

Handler behavior:

- `resolveTrackRef("#T3") -> "trk_..."`
- `resolveTrackRef("#T8") -> "trk_..."`
- `executeCreateSet` writes real IDs into `DjSession.trackIds`
- result encodes the new set as `#S<n>` and member tracks as their existing `#Tn`

**Play a song the Agent just found**

```ts
play_track({ trackId: "#T3" });
```

Handler behavior:

- `resolveTrackRef("#T3") -> "trk_..."`
- `defaultPlayerControl(db).playTrack(realTrackId)` controls the real player
- result says `diff: { trackId: "#T3" }`

**Grow an existing set**

```ts
// set_list returned #S2 "Gym"
// library_tree(scope:"unassigned") returned #T12

set_add_tracks({
  sessionId: "#S2",
  trackIds: ["#T12"],
});
```

Handler behavior:

- `resolveSetRef("#S2") -> "ses_..."`
- `resolveTrackRef("#T12") -> "trk_..."`
- `prependTrackIds(realSessionId, [realTrackId])`
- output uses `#S2/#T12`, not raw IDs

### 4.4 Input Resolver Helpers

Do not decode IDs ad hoc inside every tool. Add shared helpers:

```ts
export function resolveTrackRef(ref: string, localIds: DjChatLocalIdRegistry): string;
export function resolveSetRef(ref: string, localIds: DjChatLocalIdRegistry): string;
export function resolveMemoryRef(ref: string, localIds: DjChatLocalIdRegistry): string;

export function encodeTrackRef(id: string, localIds: DjChatLocalIdRegistry, meta?: DjChatLocalIdMeta): string;
export function encodeSetRef(id: string, localIds: DjChatLocalIdRegistry): string;
export function encodeMemoryRef(id: string, localIds: DjChatLocalIdRegistry): string;
export function encodeResultRef(toolCallId: string, localIds: DjChatLocalIdRegistry, meta: DjChatLocalIdMeta): string;
```

Type safety:

- `resolveSetRef("#T1")` must fail with a clear wrong-type error.
- `resolveTrackRef("trk_...")` pass-throughs for compatibility.
- `resolveTrackRef("#T999")` returns structured tool error, not an uncaught exception.
- `resolveTrackRef("#R1")` must fail with "result ref is not a track"; `#R` can only identify a returned window, not an actionable entity.

### 4.5 Error Handling

Unknown local ID tool result:

```json
{
  "status": "error",
  "commandId": "muzero.local_id.resolve",
  "summary": "I couldn't resolve #T999 in this chat. Refresh the library tree or search again, then use the returned short id.",
  "diff": { "localId": "#T999" },
  "warnings": ["unknown-local-id"]
}
```

Wrong type tool result:

```json
{
  "status": "error",
  "commandId": "muzero.local_id.resolve",
  "summary": "#T3 is a track id, but this tool needs a set id. Use library_tree or set_list to find the target set.",
  "diff": { "localId": "#T3", "expected": "S", "actual": "T" },
  "warnings": ["wrong-local-id-type"]
}
```

All error logs must use `log.warn(...)` from `src/lib/logger.ts`, never direct `console.*`.

---

## 5. Frontend / UX Design

This PRD is mostly tool/runtime work. User-facing UI changes are intentionally minimal:

- Existing chat tool collapsibles should display local IDs exactly as the model sees them (`#S1`, `#T4`), not raw IDs.
- No new visible Settings toggle. This is not a runtime feature flag; it is a tool-contract improvement.
- No sidebar or new navigation. If a future UI tree view is needed, it should be a separate product PRD.
- When these tree/search tools run while chat is in Dock compact mode (`icon` / `chip`), their live status should surface through the AI DJ Chat PRD's Compact Agent Activity Popover, not by expanding the full chat automatically.
- The chat prompt and tool descriptions should teach the user-visible distinction:
  - "set / 歌单" = saved collection.
  - "library tree" = Agent-readable view of all sets plus unassigned songs.
  - short IDs such as `#T1` are chat references, not permanent public IDs.

### 5.1 Prompt Changes

Update `DJ_CHAT_SYSTEM_PROMPT`:

- Tell Agent to call `library_tree` when it needs a broad view of the user's songs.
- Tell Agent to use `scope:"set"` to inspect a known playlist fully.
- Tell Agent to use `scope:"unassigned"` when the user asks to organize uncategorized songs.
- Tell Agent local IDs are the preferred way to reference entities in tool calls.
- Tell Agent not to expose or invent raw `trk_...` / `ses_...` IDs.
- Tell Agent local IDs come from tool results/Now Playing context; if uncertain, refresh with `library_tree` or `library_search`.
- Tell Agent every search/list/tree result has a `resultRef` such as `#R4`; use it only to talk about that returned page/window, while actions should pass entity refs such as `#T3` or `#S2`.
- Tell Agent `ordinal` is scoped to one `resultRef`; "the second result" should be understood as "ordinal 2 in #R4", not a global track identity.

### 5.2 Now Playing Context

Change `buildNowPlayingContext(db)` to `buildNowPlayingContext(db, localIds)`.

Before:

```txt
- Playing-from set: "Rain Focus" (id: ses_...)
- Current track: "Blue Hour" (id: trk_...)
```

After:

```txt
- Playing-from set: "Rain Focus" (id: #S1, 42 tracks)
- Current track: "Blue Hour" (id: #T1), position 7 of 42
```

Acceptance: `buildNowPlayingContext` tests must assert no `ses_` or `trk_` appears when a registry is supplied.

---

## 6. Implementation Plan

### Phase 1: Local ID Registry Primitive + Chat Transport

**Goal:** establish the ID mapping layer before changing tool output.

**Tasks:**

- [x] Add `src/chat/dj-chat-local-ids.ts` with registry, errors, encode/decode helpers.
- [x] Add `ChatSession.localIdRegistryJson?: string` to `src/db/types.ts`.
- [x] Add session helpers in `src/chat/dj-chat-sessions.ts`:
  - `loadChatLocalIdRegistry(sessionId, db)`
  - `saveChatLocalIdRegistry(sessionId, snapshot, db)`
- [x] Update `createDjChatTransport` to hydrate registry per `options.chatId`.
- [x] Pass `localIds` into `buildNowPlayingContext` and `createDjChatTools`.
- [x] Persist registry snapshot after Now Playing context generation; pass `persistLocalIds` into tool deps so Phase 2/3 tools can persist after introducing IDs.
- [x] Add pure tests mirroring AnySoul:
  - idempotent encode
  - per-prefix counters
  - `#R` result refs use an independent counter and do not resolve as track/set/memory
  - hydration resumes counters
  - corrupt entries skipped
  - raw ID pass-through
  - unknown local throws typed error
  - wrong-type resolver produces tool-safe error

### Phase 1 Checklist

- [x] No raw IDs in Now Playing context when localIds is present.
- [x] Existing chat tests pass.
- [x] New registry tests cover hydration and strict regex.
- [x] No direct `console.*`.

### Phase 2: Library Tree / Set Tree Browse Tools

**Goal:** give Agent a structural view of the user's library.

**Tasks:**

- [x] Add `src/chat/dj-chat-library-tree.ts`.
- [x] Implement `executeLibraryTree(input, { db, localIds })`.
- [x] Use `orderedSetTrackIds` for set track ordering.
- [x] Compute `Unassigned` from tracks not present in any session's `trackIds`.
- [x] Add `library_tree` to `createDjChatTools`.
- [x] Add cursor pagination over flattened tree nodes.
- [x] Add field projection to avoid always returning tags/memory counts.
- [x] Add tests:
  - library tree includes all sets and unassigned group
  - set scope returns all songs across cursor pages
  - same track in two sets uses same `#Tn`
  - two different tree/search pages get different `#R` values
  - `ordinal` restarts per `#R` while repeated entities keep the same `#Tn`
  - unassigned excludes any track present in at least one set
  - output contains no raw `trk_` / `ses_`

### Phase 2 Checklist

- [x] `library_tree({ scope:"library" })` can reveal the whole library via pagination.
- [x] `library_tree({ scope:"set", setId:"#S1" })` can reveal one set's complete ordered songs.
- [x] `library_tree({ scope:"unassigned" })` returns uncategorized songs.
- [x] Tool output is bounded by `limit` and returns `nextCursor`.

### Phase 3: Existing Tool Input/Output Local-ID Migration

**Goal:** make local ID the default contract across chat tools.

**Tasks:**

- [x] Update tool deps type to accept `localIds`.
- [x] Wrap all read-tool outputs with compact projectors:
  - `projectTrackForAgent`
  - `projectSetForAgent`
  - `projectQueueForAgent`
  - `projectMemoryForAgent`
- [x] Decode local IDs in all write/playback tools before repository calls.
- [x] Replace `set_list` output with compact set summaries.
- [x] Replace `set_get` output with compact encoded set + track list.
- [x] Replace `now_playing_get` output with compact encoded queue summary.
- [x] Wrap every read/list/search output in a `resultRef:"#Rn"` envelope:
  - `library_search`
  - `library_tree`
  - `set_list`
  - `set_get`
  - `memory_search`
  - `now_playing_get`
- [x] Ensure `set_add_by_search` keeps matched raw IDs out of LLM-facing output.
- [x] Add regression tests for representative write/playback tools accepting local IDs:
  - `set_get`
  - `set_update`
  - `set_add_tracks`
  - `queue_add`
  - `play_set`
  - `play_track`
  - `add_memory`
  - `online_add_tracks`

### Phase 3 Checklist

- [x] Serialized local-ID tool outputs in tests contain no raw `trk_` / `ses_` / `mem_` / `pqe_` refs.
- [x] Every migrated read/list/search output has one `resultRef` and list items have `ordinal`.
- [x] Repeated entities across different `resultRef`s keep the same entity local ID.
- [x] Raw IDs still work for backward compatibility.
- [x] Wrong local ID type is detected by typed resolvers before repository/player calls; model-readable recovery copy is handled in Phase 4.
- [x] Existing `dj-chat-tools.test.ts` behavior remains semantically equivalent.

### Phase 4: Prompt, Error Recovery, Verification

**Goal:** make the Agent use the new capability reliably.

**Tasks:**

- [ ] Update `DJ_CHAT_SYSTEM_PROMPT` with tree-browse workflow and local-ID rules.
- [ ] Update tool descriptions to mention local IDs instead of raw IDs.
- [ ] Add chat transport test proving one hydrated registry is shared by:
  - Now Playing context
  - `library_tree`
  - subsequent write tool call in the same chat session
- [ ] Add a multi-turn test:
  - turn 1: `library_tree` returns `#S1/#T1`
  - registry snapshot is persisted
  - turn 2: `play_track({ trackId:"#T1" })` resolves successfully
- [ ] Add a multi-result disambiguation test:
  - `library_search({ queries:["rain"] })` returns `resultRef:"#R1"` and `#T1`
  - `library_search({ queries:["focus"] })` returns `resultRef:"#R2"` and may also include `#T1`
  - action tools use `#T1`; explanatory text can refer to "ordinal 1 in #R2"
  - `resolveTrackRef("#R2")` fails with a wrong-type/result-ref error
- [ ] Add a curation flow test proving local IDs are universal tool refs:
  - `library_tree(scope:"unassigned")` returns `#T3/#T8`
  - `set_create({ name, trackIds:["#T3","#T8"] })` creates a real set with real `trk_...` members
  - returned set id is encoded as `#S<n>`
  - `play_set({ sessionId:"#S<n>" })` resolves and plays that real set
- [ ] Add a playlist growth test:
  - `set_list` returns an existing set as `#S2`
  - `set_add_tracks({ sessionId:"#S2", trackIds:["#T3"] })` writes the real track into the real session
- [ ] Add context-budget test ensuring tree pagination prevents unbounded output.
- [ ] Manual QA with a seeded fake library:
  - multiple sets
  - overlapping tracks
  - unassigned tracks
  - generated + uploaded + streamed origins
  - at least one video track

### Phase 4 Checklist

- [ ] Agent can answer「这个歌单有哪些歌」by calling `library_tree(scope:"set")`.
- [ ] Agent can answer「看看我的整个音乐库」by paging `library_tree(scope:"library")`.
- [ ] Agent can organize「未分配到歌单的歌曲」via `library_tree(scope:"unassigned")` + `set_create` / `set_add_tracks`.
- [ ] Agent can use a `#Tn` from any read tool to create a set, add to queue, play a song, or add memory without ever seeing raw `trk_...`.
- [ ] Agent can use a `#Sn` from any read tool to update, grow, or play a set without ever seeing raw `ses_...`.
- [ ] No hidden backend flags or localStorage gates.
- [ ] `make test -- src/chat` or equivalent targeted Vitest suite passes.

---

## 7. Out of Scope

- Building a user-facing library tree page. This PRD is for Agent tool-call visibility.
- Changing core DB table names, ID prefixes, or `muzero-db`.
- Moving songs between sets by drag UI.
- New backend, telemetry, account system, or cloud index.
- Embedding full lyrics in tree output.
- Exposing local file paths, blob IDs, remote media URLs, or API keys to the LLM.
- Making local IDs globally stable across all chat sessions.

---

## 8. Security Considerations

- **Local IDs are not authorization.** They are compression references only. Every decoded real ID must still be checked against local DB existence and the tool's expected entity type.
- **No raw secret exposure.** Registry never includes provider keys, endpoint URLs, cookies, local file paths, or blob bytes.
- **No hidden flags.** This rolls out as code + tests; rollback is `git revert`.
- **Prompt injection boundary.** `fromLocal` only resolves strict `#PREFIXdigits`; arbitrary strings pass through and are validated by existing repo lookups.
- **Logs.** If logging unknown IDs, log the local ID and tool name only. Do not log track titles, notes, lyrics, or user memory content.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260607-muzero-ai-dj-chat-agent-panel-prd`](../20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md) | Current AI DJ chat/tool-loop architecture |
| [`src/chat/dj-chat-tools.ts`](../../../src/chat/dj-chat-tools.ts) | Existing tool definitions and execution helpers |
| [`src/chat/dj-chat-agent.ts`](../../../src/chat/dj-chat-agent.ts) | `ToolLoopAgent` transport and per-turn tool creation |
| [`src/chat/dj-chat-context.ts`](../../../src/chat/dj-chat-context.ts) | Now Playing context currently injecting raw IDs |
| [`src/db/types.ts`](../../../src/db/types.ts) | `Track`, `DjSession`, `ChatSession` data shapes |
| [`src/db/repositories.ts`](../../../src/db/repositories.ts) | Session/track/play queue repositories |
| `D:\code\project\anysoul\docs\prd\20260415-llm-local-id-compaction\20260415-llm-local-id-compaction-prd.md` | AnySoul local ID design rationale |
| `D:\code\project\anysoul\packages\server\src\services\llm-formatting.ts` | AnySoul registry implementation reference |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Registry 生命周期是 per-turn 还是 per-chat-session？ | Resolved | MUZERO v1 采用 per-chat-session snapshot，因为 chat history persists tool outputs across turns. |
| 2 | `library_tree(scope:"library")` 是否允许一次返回全部曲库？ | Resolved | 不允许无界输出；用 `limit` + `nextCursor` 分页。 |
| 3 | 未分配组是否需要 local ID？ | Resolved | v1 不需要，用 `scope:"unassigned"` 操作。若未来需要直接把 group 当参数，再加 `#G`。 |
| 4 | 是否继续接受 raw IDs？ | Resolved | 是，作为 rollout/backward compatibility；prompt 不鼓励模型使用。 |
| 5 | 是否给 local IDs 做全局持久稳定映射？ | Resolved | 不做。只在 chat session 内稳定，避免跨会话 mapping 膨胀与误引用。 |
| 6 | 如果 registry snapshot 过大怎么办？ | Open | 初版先随 chat session 持久化；若真实大库压测显示 row 过大，再追加 compaction：仅保留当前 context window 中仍出现的 local IDs。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Completed Phase 3: migrated existing AI DJ chat tools to the shared local-ref layer. `library_search`, `set_list`, `set_get`, `memory_search`, `now_playing_get`, queue tools, playback tools, set mutation tools, memory tools, online import, and DJ generation now encode LLM-facing entity refs as `#T/#S/#M/#Q`, wrap read results with `#R` envelopes, decode local refs before repository/player calls, and preserve raw-ID backward compatibility. Verification: `dj-chat-tools-local-ids.test.ts`, `dj-chat-tools.test.ts`, `dj-chat-library-tree.test.ts`, local-id/context tests, Biome, and `tsc --noEmit` passed. |
| 2026-06-13 | Codex | Completed Phase 2: added `dj-chat-library-tree.ts` and registered `library_tree` in `createDjChatTools`; supports `scope:"library"`, `scope:"set"`, and `scope:"unassigned"`, flattened cursor pagination, field projection, unassigned-group computation, `orderedSetTrackIds`, stable local entity refs, per-result `#R` refs, and no raw `trk_` / `ses_` output. Verification: `dj-chat-library-tree.test.ts`, existing `dj-chat-tools.test.ts`, Biome, and `tsc --noEmit` passed. |
| 2026-06-13 | Codex | Completed Phase 1: added `dj-chat-local-ids.ts` with AnySoul-style strict local ID registry (`#T/#S/#M/#Q/#R`), typed unknown/wrong-type errors, encode/decode helpers, and snapshot hydration; added `ChatSession.localIdRegistryJson` plus load/save helpers; updated Now Playing context to emit `#S/#T` when a registry is supplied; hydrated/persisted registry in chat transport and passed `localIds/persistLocalIds` into tools. Verification: local-id/session/context tests + existing chat agent/runtime tests, Biome, and `tsc --noEmit` passed. |
| 2026-06-13 | MUZERO | Initial draft: tree browse tool + AnySoul-style local ID registry adapted to MUZERO chat sessions. |
