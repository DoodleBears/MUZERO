# PRD: MUZERO — 多文件粘贴 / 拖放 ingest（一次导入多个素材）

**Status:** Draft
**Created:** 2026-06-07
**Author:** MUZERO
**Module:** 上传 ingest —— 修复「复制多个音频文件、粘贴只进一个」，让**拖放与粘贴对齐**，都能一次导入全部素材

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | `filesFromTransfer` 多源合并去重（纯函数 TDD） | ✅ Completed | [§6](#phase-1-filesfromtransfer-多源合并去重tdd-纯函数) |
| 2 | 端到端 ingest 接缝回归 + 应用冒烟 + 文案核对 | 🔲 Pending | [§6](#phase-2-端到端-ingest-接缝回归--冒烟--文案) |

> Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

[`GlobalDropZone`](../../../src/components/upload/global-drop-zone.tsx) 已支持「**拖拽**多个文件一次上传」，但**粘贴（Cmd/Ctrl+V）多个音频文件时只进一个**。

**根因**在 [`filesFromTransfer`](../../../src/lib/file-drop.ts)：它优先读 `DataTransfer.files`，非空就直接 `return Array.from(dt.files)` 短路。而**粘贴**场景下多数 WebView 引擎只在 `.files` 暴露**第一个**文件，要拿全多个文件得走 `.items[].getAsFile()`（`kind === "file"`）；**拖放**则两者都全。于是粘贴走了 `.files` 短路 → 只拿到 1 个文件。（Web 共识：多文件粘贴以 `.items` 为可靠来源，`.files` 兼容性差。）

> 旁证：粘贴 overlay 计数与「已上传 N」notice 读的是 `e.clipboardData.items`（[`summarizeDragItems`](../../../src/lib/file-drop.ts)），所以**提示显示 N 正确、实际只进 1**——正是 ingest 走了 `.files` 短路的表现。

### 1.2 用户复现

Finder / 资源管理器里一次复制多个音频 → 在 App 内 `Cmd/Ctrl+V` → 期望全部进当前歌单，实际只进 1 个。

### 1.3 Core Value

1. **拖放 / 粘贴一致**：两条 ingest 路径都能一次进多个素材。
2. **不漏文件**：以「宁可去重也不漏」为底线，契合「音乐承载回忆」批量入库。
3. **零副作用**：纯函数级修复，drop / paste 共用同一入口；不动 store / DB / Tauri 插件、不引入 hidden flag。

---

## 2. 根因与方案

### 2.1 现状（有 bug）

```ts
// src/lib/file-drop.ts — 短路：粘贴时 dt.files 往往只含第一个文件
if (dt.files && dt.files.length > 0) return Array.from(dt.files); // ← 多文件粘贴丢失
// 仅当 .files 为空才走 .items
```

### 2.2 方案：多源合并 + 去重

- **合并** `.items[].getAsFile()`（`kind === "file"`）**∪** `.files`，按 `(name, size, lastModified, type)` **去重**。
- `.items` 是多文件粘贴的可靠来源；`.files` 兜底保留 `.items` 可能漏掉的容器（如 `.mkv`）。
- **去重**避免拖放场景两源各含全量导致 `2N`（应为 `N`）——这是必须守住的回归点。
- 顺序：先 `.items` 后 `.files`（粘贴/拖放下 items 顺序贴近用户选择顺序），去重后顺序稳定。

### 2.3 不做什么

- 不引入 Tauri 原生剪贴板插件（当前无该插件，WebView `clipboardData` 足够）。
- 不动文件选择器：`<input multiple>` 已在 [`queue-page`](../../../src/pages/queue-page.tsx) / [`sessions-page`](../../../src/pages/sessions-page.tsx) 支持多选。
- 不改 store / DB：`ingestDroppedMedia` 已接收 `File[]` 全量。

---

## 3. Out of Scope

- **多张图片一次导入**：当前拖放/粘贴多图仅取第一张（`images[0]`）做封面/背景/画廊，其余忽略。批量图片是独立 UX（见 Open Q1），本期不做。
- 切 tab 不中断播放、background/gallery 等其它 ingest 周边，不在本 PRD。

---

## 4. Implementation Plan

> 每 phase：TDD（先红后绿）+ 原子 commit + 更新本 PRD。

### Phase 1: `filesFromTransfer` 多源合并去重（TDD 纯函数）

**Goal:** 从根上让 drop / paste 都拿到全部文件。

**Tasks:**
- [x] 先写**失败**测试：粘贴态 transfer（`files=[a]`、`items=[a,b,c]`）→ 期望 3（红 → 绿）。
- [x] 改 `filesFromTransfer`：`items ∪ files` + 按 `(name,size,lastModified,type)` 去重。
- [x] 回归测试：拖放态（`files=[a,b]`、`items=[a,b]`）→ **N 不是 2N**；截图数据（`files=[]`、`items=[img]`）→ 1；`string` item 跳过；`.mkv` 仅 `.files` 暴露仍保留；`null`/空 → `[]`。

**Phase 1 Checklist:**
- [x] `file-drop.test.ts` 新增 `filesFromTransfer` 套件 6 例全绿（含红→绿的多文件粘贴用例），整文件 14 例通过。
- [x] biome（staged）清 + 全项目 `tsc --noEmit` 通过（commit gate）。

### Phase 2: 端到端 ingest 接缝回归 + 冒烟 + 文案

**Goal:** 锁住「粘贴 → 分类 → 入库」接缝，确认 UI 计数/提示一致。

**Tasks:**
- [ ] 接缝回归测试：`classifyDrop(filesFromTransfer(粘贴态 transfer)).media` 长度 = N（把 Phase 1 的修复钉在真实使用路径上）。
- [ ] 应用冒烟（preview）：粘贴路径无 console 报错；overlay 计数与「已上传 N」notice 读 N。
- [ ] 文案核对：`drop.uploaded` 复数在 en / zh / ja / ko 正确（多文件 notice）。

**Phase 2 Checklist:**
- [ ] 接缝回归测试绿。
- [ ] preview 冒烟无报错；`make check` 全绿。

---

## 5. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 多张图片一次粘贴/拖放是否批量处理？ | Open | 倾向：多图全部入**画廊**（gallery），cover/background 仍单图走 modal；本期 out of scope |

---

## 6. Related Documents

| Document | Description |
|----------|-------------|
| [`file-drop.ts`](../../../src/lib/file-drop.ts) | 受影响纯函数 `filesFromTransfer`（drop/paste 共用入口） |
| [`global-drop-zone.tsx`](../../../src/components/upload/global-drop-zone.tsx) | 消费者：window 级 drop/paste 监听 → `handleFiles` → `ingestDroppedMedia` |
| [Player Shell 重做 PRD](../20260607-muzero-player-shell-redesign-prd/20260607-muzero-player-shell-redesign-prd.md) | 上传/「音乐承载回忆」UX 上位语境 |

---

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | MUZERO | Initial draft —— 修复「复制多个音频文件、粘贴只进一个」：`filesFromTransfer` 合并 `.items ∪ .files` 并去重；drop 回归守 `N` 不变 `2N` |
| 2026-06-07 | MUZERO | Phase 1 实现：6 例新测（多文件粘贴红→绿 + 去重/容器/截图/字符串/null）全绿。dedup key 用 `JSON.stringify([name,size,lastModified,type])`——可打印且抗冲突（初版误用 `\0` 分隔符，git 把源文件当二进制，已修正为文本） |
