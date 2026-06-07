# MUZERO — Implementation TODO

> **优先级 = 依赖驱动 + 基础设施先于广度（infra-before-breadth）。** 三份 PRD：① 数据模型（地基）→ ② AI DJ chat（依赖 ①）；③ musicgen provider（已实现，剩收尾）。每项 TDD、原子 commit、做完更新对应 PRD 状态。

## 依赖与建议顺序

```
musicgen ✅(已实现) ──┐
                      ├─ (provenance 自动 Note 依赖 Memory)
① 数据模型 (P0 地基) ──┴──▶ ② chat agent (P1)
   歌单/播放列表/记忆          多 session / 三形态 / 工具
P2 独立小项（Tauri opener / providerPreset 字段）可随时插入
```

**起步点：`DM-1`（播放列表地基）** —— 它重构 `player-store` 让 player 消费 `playQueue`，是 chat 工具与一切队列能力的前置。

---

## ✅ 已完成

- **musicgen provider 选型（4 phase）** — preset infra / ACE-Step / Mureka / Settings+成本+Get-key 链接，全 commit、76 tests 绿。
  - 战略：**ACE-Step 音质差已降级 → 只主推 Mureka**（默认 mureka）；ACE-Step 保留为可选便宜档但不再验证。
- 三份 PRD 与全部 Open Question 已定稿。

---

## 🔴 P0 — 数据模型地基（关键路径，chat 前置）

PRD: [`20260607-muzero-set-playqueue-memory-data-model-prd`](docs/prd/20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md)

- [x] **DM-1 播放列表 Play Queue 地基** ✅ — 纯函数 play-queue(12测) + Dexie v3 playQueue 表 + repo + v2→v3 seed 迁移(8测) + player-store 改消费 playQueue + high-water 追加。浏览器验证迁移 seed+播放、零报错；全套件绿。（用户级编辑 actions 延后 DM-4）
- [x] **DM-2 autoExtend → 播放列表** ✅ — `refillIfNeeded(sessionId,queueLength,currentIndex)` 阈值改测播放列表 upcoming；`maybeRefill` 传 queue.length；续歌喂队列由 DM-1c high-water 承担。dj-engine 9 测更新、全套件 148 绿。
- [ ] **DM-3 歌曲记忆 Memory** — `Memory` 类型 + `memories` 表 + `mediaBlobs` `role:"memory"` + repo；迁移 `Track.note`→首条 Memory；`annotation-editor` 改记忆列表（加/编辑/删/照片/时间）；`track-search` 搜 memory.note；`RecentTrack` 喂记忆给 DJ。**（解锁 musicgen provenance 自动 Note）**
  - 验收：一曲多记忆（含照片）；搜索命中记忆文字；旧 note 变首条记忆；DJ 上下文带记忆。
- [ ] **DM-4 UI 打磨** — 歌单管理（CRUD+播放/加入队列/切换）；播放列表视图（play-next/add/remove/reorder/loop）；记忆相册；封面取自记忆；i18n 4 语。
  - 验收：浏览器 preview 全流程 + 暗色 + 响应式 + 零报错；四语种齐全。

---

## 🟠 P1 — AI DJ Chat Agent（数据模型 DM-1~3 后）

PRD: [`20260607-muzero-ai-dj-chat-agent-panel-prd`](docs/prd/20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md)

- [x] **CHAT-1 runtime 地基** ✅ — `muzero-db` v5 `chatSessions` 表 + Runtime Actor（模块作用域 + `Chat`+懒解析 `ToolLoopAgent` transport，`resolveDjModel`+`getAppFetch`）+ chat-store + 单 session 流式/快照恢复 + `streamdown`（加依赖；组件内导入 package CSS，未触碰 dirty `styles.css`）+ 补 `textarea` 原语。
  - 验收：send→stream→快照落库→重建 actor 恢复（fake-indexeddb）；runtime 全模块作用域；`make check` 绿。
- [ ] **CHAT-2 三形态外壳** 🟡 — `mode: fab|bar|dock|fullscreen` + FAB + 底部输入条 + Dock(桌面 1∕3 / 移动全屏) + **顶部 Notification toast 折叠态回复**（`motion/react`，仿 anysoul MessageToast）。已完成可独立落地的 shell 组件 + store/hook 测试；`App.tsx` 挂载仍等并行 Now Playing WIP 落地后补 CHAT-2b。
  - 验收：三形态切换+偏好持久化；折叠态回复弹通知/点击展开已单测覆盖；preview/App 挂载待 CHAT-2b。
- [ ] **CHAT-3 DJ 工具** 🟡 — `set_*`/`queue_*`/`add_memory`/`now_playing_get`/`dj_propose_briefs`→`dj_generate_tracks`（Zod，**审批=成本驱动**只 generate 审批，C 方案 propose→确认，无审批模式开关）；落 DjEngine/repos/数据模型；now-playing 注入 system；能力 gate 接 musicgen §4.5。已完成 Phase 3a：工具核心、`dj_generate_tracks` 审批标记、pending track + set + play-next 队列写入、memory-aware search 测试。已完成 Phase 3b：`dj_propose_briefs` 校验 TrackBrief + 摘要 + 零写入、无审批。已完成 Phase 3c：核心 propose→generate→mock materialize→ready/blob 集成测。已完成 Phase 3d：runtime approval response 桥接 AI SDK tool loop。已完成 Phase 3e：无内置文案的 `chat-tool-collapsible` 展示审批/结果/错误。已完成 Phase 3f：ChatTurns/ChatPanel 可选接入 tool UI + approval callbacks。
  - 验收：工具核心写入/拒绝前 schema 校验/读工具无审批已测；propose→generate 的非花钱/花钱边界已测；`chat-tool-collapsible` 审批 UI、pump 物化 E2E 待后续提交。
- [ ] **CHAT-4 多 session + 历史 + branch/regenerate** 🟡 — session home 列表 + 子串搜索 + 自动标题；多 actor 并发（切走仍流）；regenerate(edit-resend) + branch(截断深拷贝)。已完成 Phase 4a：session 搜索（标题 + user 文本，不搜 assistant）、branch 深拷贝截断、actor edit-resend regenerate。已完成 Phase 4b：两个 session runtime actor 并发发送/持久化隔离测试。已完成 Phase 4c：空 session 首次持久化 user 消息时自动标题。已完成 Phase 4d：并发 session 中审批态与错误态互不串。已完成 Phase 4e：无内置文案的 `ChatSessionHome` 展示层，支持列表、标题/user 文本本地搜索、打开、重命名、删除回调。
- [ ] **CHAT-5 多 provider 模型选型** 🟡 — `ai/llm-providers.ts` preset 化（openrouter/openai/claude/gemini/groq/deepseek/custom）+ `resolveDjModel` 扩展 + key 入 Dexie；补 `command`/`combobox`/`dialog`/`popover` 原语；全局默认 + per-session combobox 覆盖。已完成 Phase 5a：preset registry、settings 字段、legacy openai/anthropic bridge、per-preset key selection、OpenAI-compatible/Anthropic model resolve。已完成 Phase 5b：runtime transport 按 `ChatSession.llmProviderPresetId/llmModel` 覆盖模型选择，key 仍只从 settings 读取。已完成 Phase 5c：Base UI `dialog` primitive（trigger/content/title/description/close）+ 测试。已完成 Phase 5d：Base UI `popover` primitive（trigger/content/title/description/close/positioner）+ 测试。已完成 Phase 5e：Base UI `scroll-area` primitive（root/viewport/content/scrollbar/thumb/corner）+ 测试。已完成 Phase 5f：无内置文案的 `Command` primitive（搜索过滤/empty/select）+ 测试；Settings/combobox/i18n 接线待后续。
- [ ] **CHAT-6 队列/打断 + onboarding + 压缩** 🟡 — 队列托盘（DnD、Stop≠Interrupt、reload 后默认关）；冷启动 chips + 空态引导；上下文预算/压缩（block-and-explain）。已完成 Phase 6a：token 估算、context budget ok/warn/block、压缩起点纯函数。已完成 Phase 6b：session-scoped queued prompts 持久化、actor rebuild 不自动派发、手动派发与 interrupt marker。已完成 Phase 6c：`contextStartIndex` actor/repo 持久化，旧消息仍保留可见。已完成 Phase 6d：composer 键盘矩阵 Enter/Shift+Enter/Cmd/Ctrl+Enter，running+draft 入队/interrupt。已完成 Phase 6e：pending approval 暂停 queued prompt 派发。已完成 Phase 6f：runtime actor 暴露 queued prompt 重排/删除且不触发发送。已完成 Phase 6g：无内置文案的 `ChatQueueTray` 展示层，支持 DnD/按钮重排、立即发送/删除回调与默认关闭的 auto-dispatch switch。已完成 Phase 6h：runtime snapshot 暴露队列详情，`ChatPanel` 可选 `queueLabels` 接入队列托盘并转发 send/delete/reorder 到 actor。已完成 Phase 6i：无内置文案的 `ChatEmptyState` 展示层，preset chips 只触发 insert 回调不发送，并暴露上传库/输入 vibe 引导动作。已完成 Phase 6j：无内置文案的 `ChatContextBudgetNotice` 展示层，支持 ok 隐藏、warn/status、block/alert 与压缩回调；App+i18n/composer draft/block 接线待后续。

---

## 🟢 P2 — 独立小项（低风险，可随时插入）

- [ ] **OPENER Tauri opener 插件** 🟡 — `@tauri-apps/plugin-opener` + `lib.rs` 注册 + capability `opener:allow-open-url` + `openExternalUrl()`（Tauri 用 opener、浏览器回退 `window.open`）已完成并测试；Settings 的 Get-key/docs 链接 + chat 外链接线待并行 Settings/chat UI WIP 落地后补。**（musicgen Q9：必须走系统浏览器）**
  - 注：碰 Rust/Cargo/capability，但独立、小、已决策。可作热身先做掉。
- [ ] **PROVENANCE 字段** 🟡 — `Track.providerPreset?` 已随 DM-3a 落类型；本轮完成生成路径写入 provider/model key + 自动 provenance Memory（mock 不污染 Memory）。UI 展示/过滤待相关页面 WIP 落地后补。

---

## 👤 Manual（用户人工，需真实 key）

- [ ] **Mureka 真实 key 端到端** — 出中/日/韩各一首落库可播；确认确切 model 字符串、商用授权。
- [ ] **Mureka `$/首` 单位** — 默认出 2 首，确认 `n=1` 是否=$0.045（musicgen Q8）。
- [ ] **（ACE-Step 已降级，fal 计费/质量验证搁置，如未来重启再测）**

---

> 维护：做完一项勾选 + 更新对应 PRD 的 Phase 状态 + changelog。新需求先进 PRD，再回填本表。
