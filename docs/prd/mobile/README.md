# PRD — Mobile（iOS / Android）

本目录收纳**移动端**（iOS / Android）相关的 PRD。命名沿用根 [`prd-create.md`](../../../.cursor/commands/prd-create.md) 约定：`YYYYMMDD-<topic>-prd/`。

> **目录分层（2026-06-16 起）**：MUZERO 进入「桌面 + 移动」双端阶段后，PRD 按平台归档：
> - `docs/prd/mobile/` —— 移动端（本目录）
> - `docs/prd/desktop/` —— 桌面端（Electron / Tauri / web）新 PRD
> - `docs/prd/*-prd/`（根目录）—— 2026-06-16 之前的历史 PRD，**保持原位不迁移**（它们用 `../../../src/...` 相对链接引用源码，移动会成片断链）。新 PRD 走分层目录。
>
> 移动端 PRD 因多一层目录，引用源码的相对路径要多一个 `../`（如 `../../../../src/...`）。

## 索引

| PRD | 状态 | 摘要 |
|---|---|---|
| [20260616-muzero-kmp-mobile-port-prd](20260616-muzero-kmp-mobile-port-prd/20260616-muzero-kmp-mobile-port-prd.md) | Draft | KMP 原生移动端移植：架构选型 + 逐特性（特效/音频/着色器/数据/DJ 循环）可行性与库映射 + 分阶段路线 |
