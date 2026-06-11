# TODO — Implementation Priority

> **当前主线 = 云盘分享双 PRD**(下方 P0–P3)。既有工作流(数据模型/chat/手动验证)的未完成项保留在文末,不丢状态。
> 维护:做完一项勾选 + 更新对应 PRD 的 Phase 状态 + changelog。新需求先进 PRD,再回填本表。

## 当前主线:存储抽象 + 分享(2026-06-12 起)

> 排序依据:**存储抽象先行**(share PRD Phase 1 的投影发布必须走 `CloudObjectStore`,避免在 S3 直连代码上继续堆量);broker 线与 WebDAV 线在抽象落地后**可并行**;分享功能按 Q1 决议整批 ship。
>
> 相关 PRD:
> - **[storage-prd]** [Cloud Storage Provider Abstraction + WebDAV](docs/prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md)
> - **[share-prd]** [mu0 Share Links + Control Plane](docs/prd/20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md)

### P0 — 前置重构(阻塞两条线)

- [ ] **[storage-prd] Phase 1** — 抽出 `CloudObjectStore` 接口 + S3 adapter + in-memory fake + contract test suite(纯重构,行为冻结:现有 sync 测试全绿)
- [ ] **[storage-prd] Phase 2** — capability model + 降级策略(guarded single-writer 等)+ registry,消灭 `provider === "r2"` 散落分支

### P1 — 分享地基(依赖 P0)

- [ ] **[share-prd] Phase 1** — share projection writer(激活已有 `muzero-r2-share-manifest-v1` schema;经 `CloudObjectStore` 发布)+ raw-URL 分享/导入闭环

### P2 — 双线并行

**A 线:分享(整批 ship,Q1 决议——Phase 1–6 同一个 release)**

- [ ] **[share-prd] Phase 2** — mu0 broker(Worker + D1 + 设备 Ed25519 认证 + 稳定短链 + revoke)
- [ ] **[share-prd] Phase 3** — `mu0.app/s/<slug>` 网页 viewer(打开即播 + OG unfurl + 政策页,Q6)
- [ ] **[share-prd] Phase 4** — Owner Sharing 管理面板(复制/改权限/过期/撤销 + 访问计数)
- [ ] **[share-prd] Phase 5** — 接收流 + `muzero://` 深链 + Add-to-Set 即 track 级 fork(Q5)
- [ ] **[share-prd] Phase 6** — invite-only + redeem-to-grant(Q7:逐收件人可撤销)

**B 线:WebDAV(独立于 broker 线,落地即随时可 ship)**

- [ ] **[storage-prd] Phase 3** — WebDAV adapter(PROPFIND/MKCOL/Basic auth/capability probe,contract suite 三服务器画像全绿)
- [ ] **[storage-prd] Phase 4** — WebDAV 添加云盘 UX(storage 选择器 + app password 引导 + trusted setup link v2)

### P3 — 收尾增强

- [ ] **[storage-prd] Phase 5** — drive-aware 媒体源解析(WebDAV 认证播放走 store-fetch→blob;实现 R2 PRD OQ5 的 per-drive 抽象)
- [ ] **[share-prd] Phase 7** — 私有桶:凭证 vault(opt-in)+ broker presign(S3-only;真撤销)
- [ ] **[share-prd] Phase 8** — ops/审计/abuse 处理 + broker 自托管打包
- [ ] **[storage-prd] Phase 6** — 服务器兼容矩阵 + 文档 + 跨 PRD 对齐(CLAUDE.md 增 storage registry 纪律)

### 备注

- WebDAV 云盘默认 **own-devices only**:无匿名公读的服务器不能背书 public 分享(storage-prd §2.5);broker presign 是 S3 专属。
- 两份 PRD 的 Open Questions 已全部 resolve(2026-06-12,见各自 §10):share-prd 7 个;storage-prd 4 个(自动化测试仅 fixtures+人工真机矩阵、single-writer 硬阻断、publicReadBaseUrl 手动录入+探测验证、web 端可用性由 CORS 探测决定)。

---

## 既有工作流(云盘主线之前的延续项,状态保留)

> 完整历史细节见 git history 中本文件的旧版(`git log -- TODO.md`)与各 PRD changelog。已完成:musicgen provider 选型(4 phase,只主推 Mureka)、DM-1/2/3、CHAT-1、OPENER、PROVENANCE 字段。

### 🔴 DM-4 UI 打磨(数据模型 PRD 收尾)

PRD: [`20260607-muzero-set-playqueue-memory-data-model-prd`](docs/prd/20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md)

- [ ] **DM-4 余项** — 歌单管理(CRUD+播放/加入队列/切换);播放列表视图(play-next/add/remove/reorder/loop);记忆相册;封面取自记忆;i18n 4 语。(右键菜单/记忆封面/折叠 rail/虚拟化/记忆时间线/快捷创建等子项已完成,见旧版明细)
  - 验收:浏览器 preview 全流程 + 暗色 + 响应式 + 零报错;四语种齐全。

### 🟠 CHAT-2~6 接线收尾(AI DJ Chat PRD,核心逻辑已测,UI/App 挂载待补)

PRD: [`20260607-muzero-ai-dj-chat-agent-panel-prd`](docs/prd/20260607-muzero-ai-dj-chat-agent-panel-prd/20260607-muzero-ai-dj-chat-agent-panel-prd.md)

- [ ] **CHAT-2b** — 三形态外壳 `App.tsx` 挂载(shell 组件 + store/hook 测试已完成,等 Now Playing WIP 落地)
- [ ] **CHAT-3 余项** — `chat-tool-collapsible` 审批 UI 接入、pump 物化 E2E(Phase 3a–3f 已完成)
- [ ] **CHAT-4 余项** — `ChatSessionHome` App 接线(Phase 4a–4e 已完成)
- [ ] **CHAT-5 余项** — `ChatModelPicker` 的 Settings/App/i18n/DB 接线(Phase 5a–5g 已完成)
- [ ] **CHAT-6 余项** — App+i18n/composer draft/block 接线(Phase 6a–6j 已完成)

### 👤 Manual(用户人工,需真实 key)

- [ ] **Mureka 真实 key 端到端** — 出中/日/韩各一首落库可播;确认确切 model 字符串、商用授权。
- [ ] **Mureka `$/首` 单位** — 默认出 2 首,确认 `n=1` 是否=$0.045(musicgen Q8)。
- [ ] (ACE-Step 已降级,fal 计费/质量验证搁置,如未来重启再测)
