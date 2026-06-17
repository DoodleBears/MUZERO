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
| [20260616-muzero-native-mobile-port-prd](20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md) | Draft | **全原生双栈（SwiftUI + Jetpack Compose）+ 语言中立契约规格** 移植：四轮 deep research 比选 A/B/C 定 **Option C + spec guard**（KMP 已评估并否决，理由见 §2.1）；逐特性可行性/库映射 + 性能 harness + 分阶段路线 |
| [20260616-muzero-native-tech-stack-prd](20260616-muzero-native-tech-stack-prd/20260616-muzero-native-tech-stack-prd.md) | Draft | **逐层具体库选型**（总文档 + [iOS](20260616-muzero-native-tech-stack-prd/ios-tech-stack.md) / [Android](20260616-muzero-native-tech-stack-prd/android-tech-stack.md) 两份独立平台栈）：UI/音频/FFT/shader/DB/网络/DI/LLM/测试逐层推荐+备选+License；跨端 spec guard（quicktype codegen + golden 向量）+ 最低系统 |
