# Issue 创建器 (GitHub CLI)

## 🎯 概述

使用 GitHub CLI (`gh`) 高效创建 GitHub Issue 的标准化工作流。基于项目的 Issue 模板和标签规范，提供标准化的 Issue 创建流程。

## 📝 快速使用指南

### 1. 环境准备
```bash
# 安装 GitHub CLI
brew install gh  # macOS
# 或访问: https://cli.github.com/

# 登录认证
gh auth login

# 验证状态
gh auth status
```

### 2. Issue 创建流程

## 🚀 快速命令

### 创建 Issue
```bash
# 基础创建
gh issue create --title "🐛 Bug: Login page crashes on mobile" \
               --body "Steps to reproduce:
 1. Open app on mobile
 2. Navigate to login
 3. Enter credentials
 4. Click login button
 5. App crashes" \
               --label "bug,frontend,high-priority"

# 指定标签和分配人
gh issue create --title "✨ feat: Add dark mode support" \
               --assignee "developer1,developer2" \
               --label "enhancement,frontend,medium-priority" \
               --milestone "v2.1.0"

## 📋 创建提示

### 模板选择
```bash

### 高级创建选项
```bash
# 指定里程碑
gh issue create --title "Feature" --milestone "v2.0.0"

# 批量分配
gh issue create --title "Task" --assignee "user1,user2,user3"

# 复杂标签系统
gh issue create --title "Issue" --label "bug,high-priority,frontend"
```

## 🔧 故障排除

### 常见问题
```bash
# 认证问题
gh auth refresh

# 权限问题
gh auth status
## � 故障排除

### 常见问题
### 标签规范
- **类型标签**: `bug`, `enhancement`, `documentation`, `question`
- **优先级标签**: `low-priority`, `medium-priority`, `high-priority`, `critical`
- **状态标签**: `status/backlog`, `status/in-progress`, `status/review`, `status/done`
- **模块标签**: `frontend`, `backend`, `api`, `database`


---
tle "✨ Feature" --label "enhancement"` - 快速创建功能 Issue

**⚠️ 重要命令技巧**:
- **强制使用 `| cat` 避免分页器**：所有可能产生大量输出的 gh 命令都必须使用 `| cat`
  - `gh issue list --template | cat` - 查看可用模板

**❗ 强制要求**:
- 任何 gh issue list 等可能分页的命令都必须添加 `| cat`
- 不要使用不带 `| cat` 的 gh 命令，这会导致分页器问题
- 创建临时的 .md 文件编写 description 后再用 gh cli 创建 issue
- 先检查需要创建的 label 是否存在，如果不存在，先创建 label
- 先检查需要创建的 milestone 是否存在，如果不存在，先创建 milestone

我现在需要创建1个issue，请用中文编写，参考以下内容：