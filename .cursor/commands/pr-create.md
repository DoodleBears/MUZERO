# PR 创建助手 (基于 Diff 分析)

## 🎯 功能概述

根据指定的分支自动生成 diff 文件并创建 Pull Request 的完整工作流。通过分析代码变更内容，自动生成合适的 PR 标题和描述。

## 📋 使用方法

### 基本流程
1. **输入分支名**: 提供要比较的目标分支名（默认是 main）
2. **生成 Diff**: 自动执行 `git diff <branch_name>...HEAD > diff.txt`
3. **推送分支**: 推送当前分支到远程
4. **编写 PR 内容**: 创建 临时 .md 文件，描述 PR， 模板参考 `.github/PULL_REQUEST_TEMPLATE.md`
5. **创建 PR**: 基于 diff 内容使用 GitHub CLI 创建 PR

### 执行命令
```bash
# 直接使用（替换 BRANCH_NAME 为实际分支名）
git diff BRANCH_NAME...HEAD > .cursor/ignore/diff.txt
gh pr create --fill --title "Auto-generated PR from diff analysis" --body "Generated from diff analysis of branch: BRANCH_NAME

## Changes Overview
$(cat .cursor/ignore/diff.txt | head -50)

---
*This PR was automatically generated based on git diff analysis.*"
```

## 🔧 自动化脚本

### 推荐的完整工作流脚本
```bash
#!/bin/bash
# pr-create.sh

# 检查参数
if [ $# -eq 0 ]; then
    echo "用法: $0 <目标分支名>"
    echo "示例: $0 main 或者 $0 develop"
    exit 1
fi

TARGET_BRANCH=$1
DIFF_FILE=".cursor/ignore/diff.txt"

echo "🔍 正在生成 diff 文件..."
git diff ${TARGET_BRANCH}...HEAD > ${DIFF_FILE}

if [ ! -s ${DIFF_FILE} ]; then
    echo "❌ 没有发现变更内容，请检查分支名是否正确"
    exit 1
fi

echo "📊 Diff 文件已生成: ${DIFF_FILE}"
echo "📝 正在推送当前分支到远程..."
git push -u origin HEAD

echo "🚀 正在创建 Pull Request..."
gh pr create --fill --title "Auto-generated PR from ${TARGET_BRANCH}" \
             --body "Generated from diff analysis of branch: ${TARGET_BRANCH}

## Changes Overview
$(head -50 ${DIFF_FILE})

---
*This PR was automatically generated based on git diff analysis.*
*Target branch: ${TARGET_BRANCH}*
*Generated at: $(date)*"

echo "✅ PR 创建完成！"
```

## 📈 最佳实践

### 分支选择策略
- **主分支**: `main` 或 `master` - 用于生产环境合并
- **开发分支**: `develop` 或 `dev` - 用于开发环境合并
- **功能分支**: `feature/*` - 用于新功能开发
- **修复分支**: `fix/*` 或 `hotfix/*` - 用于问题修复

### Diff 分析要点
- **文件变更**: 查看修改的文件列表
- **代码变更**: 分析具体的代码修改内容
- **影响范围**: 评估变更对系统的影响程度

### PR 创建规范
- **标题清晰**: 自动生成基于分支名的描述性标题
- **描述详细**: 包含 diff 摘要和变更概览
- **关联上下文**: 标明目标分支和生成时间
- **大小适中**: 控制 diff 内容在合理范围内

## ⚠️ 重要注意事项

### 强制要求
- **Diff 文件生成**: 必须使用 `git diff <branch>...HEAD > diff.txt` 格式
- **分页器处理**: 所有 gh 命令必须添加 `| cat` 避免交互式分页
- **分支验证**: 确保目标分支存在且可访问
- **推送确认**: 创建 PR 前必须先推送当前分支
- **PR 内容**: PR 内容请创建临时 .md 文件编写，模板参考 `.github/PULL_REQUEST_TEMPLATE.md`


💡 **提示**: 这个工具特别适用于需要基于具体分支对比创建 PR 的场景，可以自动分析代码变更并生成规范的 PR 内容！

**🚀 快速开始**:
```bash
# 1. 确保当前分支已提交所有变更
git add . && git commit -m "feat: your changes"

# 2. 运行脚本（假设目标分支是 main）

# 或者手动执行
git diff main...HEAD > .cursor/ignore/diff.txt
```
