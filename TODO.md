# TODO — Implementation Priority

> 跨 PRD 实施顺序。排序依据:**存储抽象先行**(share PRD Phase 1 的投影发布必须走 `CloudObjectStore`,避免在 S3 直连代码上继续堆量);broker 线与 WebDAV 线在抽象落地后**可并行**;分享功能按 Q1 决议整批 ship。
>
> 相关 PRD:
> - **[storage-prd]** [Cloud Storage Provider Abstraction + WebDAV](docs/prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd/20260612-muzero-cloud-storage-provider-abstraction-webdav-prd.md)
> - **[share-prd]** [mu0 Share Links + Control Plane](docs/prd/20260612-muzero-mu0-share-links-control-plane-prd/20260612-muzero-mu0-share-links-control-plane-prd.md)

## P0 — 前置重构(阻塞两条线)

- [ ] **[storage-prd] Phase 1** — 抽出 `CloudObjectStore` 接口 + S3 adapter + in-memory fake + contract test suite(纯重构,行为冻结:现有 sync 测试全绿)
- [ ] **[storage-prd] Phase 2** — capability model + 降级策略(guarded single-writer 等)+ registry,消灭 `provider === "r2"` 散落分支

## P1 — 分享地基(依赖 P0)

- [ ] **[share-prd] Phase 1** — share projection writer(激活已有 `muzero-r2-share-manifest-v1` schema;经 `CloudObjectStore` 发布)+ raw-URL 分享/导入闭环

## P2 — 双线并行

**A 线:分享(整批 ship,Q1 决议——Phase 1–6 同一个 release)**

- [ ] **[share-prd] Phase 2** — mu0 broker(Worker + D1 + 设备 Ed25519 认证 + 稳定短链 + revoke)
- [ ] **[share-prd] Phase 3** — `mu0.app/s/<slug>` 网页 viewer(打开即播 + OG unfurl + 政策页,Q6)
- [ ] **[share-prd] Phase 4** — Owner Sharing 管理面板(复制/改权限/过期/撤销 + 访问计数)
- [ ] **[share-prd] Phase 5** — 接收流 + `muzero://` 深链 + Add-to-Set 即 track 级 fork(Q5)
- [ ] **[share-prd] Phase 6** — invite-only + redeem-to-grant(Q7:逐收件人可撤销)

**B 线:WebDAV(独立于 broker 线,落地即随时可 ship)**

- [ ] **[storage-prd] Phase 3** — WebDAV adapter(PROPFIND/MKCOL/Basic auth/capability probe,contract suite 三服务器画像全绿)
- [ ] **[storage-prd] Phase 4** — WebDAV 添加云盘 UX(storage 选择器 + app password 引导 + trusted setup link v2)

## P3 — 收尾增强

- [ ] **[storage-prd] Phase 5** — drive-aware 媒体源解析(WebDAV 认证播放走 store-fetch→blob;实现 R2 PRD OQ5 的 per-drive 抽象)
- [ ] **[share-prd] Phase 7** — 私有桶:凭证 vault(opt-in)+ broker presign(S3-only;真撤销)
- [ ] **[share-prd] Phase 8** — ops/审计/abuse 处理 + broker 自托管打包
- [ ] **[storage-prd] Phase 6** — 服务器兼容矩阵 + 文档 + 跨 PRD 对齐(CLAUDE.md 增 storage registry 纪律)

## 备注

- WebDAV 云盘默认 **own-devices only**:无匿名公读的服务器不能背书 public 分享(storage-prd §2.5);broker presign 是 S3 专属。
- 两份 PRD 的 Open Questions 已全部 resolve(2026-06-12,见各自 §10):share-prd 7 个;storage-prd 4 个(自动化测试仅 fixtures+人工真机矩阵、single-writer 硬阻断、publicReadBaseUrl 手动录入+探测验证、web 端可用性由 CORS 探测决定)。
