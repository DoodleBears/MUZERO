# 快速 Commit 生成器 (Quick Commit Generator)

## 🎯 概述

快速生成符合项目规范的 commit message。基于 gitmoji 和 conventional commits 规范，支持自动验证和格式化。

## ⚠️ 重要提醒

**🔴 强制要求：所有代码变更必须通过完整的 linting 检查**（包括 isort、black、ruff、mypy、biome 等）后才能提交

**优先使用 `--no-pager` / `core.pager` / `GIT_PAGER`**：禁用分页器且不影响退出码或后续管道。例如：
- ✅ `git --no-pager status -s`
- ✅ `git --no-pager diff file.ts`
- ✅ `git -c core.pager=cat log --oneline`
- ✅ `GIT_PAGER=cat git diff --stat`
## 📝 快速使用指南

### 1. 查看变更
```bash
# 查看当前变更（强制使用 | cat 避免分页器）
git status -s | cat
git diff --cached --stat | cat

# 查看特定文件的详细变更（强制使用 | cat）
git diff frontend/src/stores/audioPlaylistStore.ts | cat

# 查看暂存区的变更（强制使用 | cat 避免分页器）
git diff --cached | cat
```

### 2. 选择 Commit 类型


### 3. 常用作用域 (scope)

| 前端 | 后端 | 通用 |
|------|------|------|
| `components` | `api` | `config` |
| `stores` | `models` | `utils` |
| `services` | `routes` | `types` |
| `hooks` | `middleware` | `tests` |
| `styles` | `database` | `docs` |
| `pages` | `auth` | `deps` |

### 4. 生成 Commit 消息

#### 模板格式
```
[emoji] type(scope): description

详细说明 (可选)
```

#### Emoji 使用规范

**🔴 强制要求：每个 commit 类型必须使用对应的 emoji 图标**

| Commit 类型 | 必须使用的 Emoji | 示例 |
|------------|-----------------|------|
| `feat` | ✨ | `✨ feat(auth): add user login` |
| `fix` | 🐛 | `🐛 fix(api): resolve authentication issue` |
| `refactor` | ♻️ | `♻️ refactor(utils): simplify functions` |
| `chore` | 🔧 | `🔧 chore(deps): update dependencies` |
| `build` | 📦️ | `📦️ build(webpack): update config` |
| `style` | 💄 | `💄 style(components): format code` |
| `perf` | ⚡️ | `⚡️ perf(database): optimize query` |
| `test` | ✅ | `✅ test(auth): add unit tests` |
| `docs` | 📝 | `📝 docs(api): update endpoints` |
| `revert` | ⏪️ | `⏪️ revert(auth): revert changes` |
| `ci` | 👷 | `👷 ci(pipeline): update config` |

**❌ 错误示例**（缺少 emoji 或使用错误的 emoji）:
```bash
feat(auth): add user login                    # ❌ 缺少 emoji
🐛 feat(auth): add user login                # ❌ emoji 与类型不匹配
✨ fix(api): resolve issue                    # ❌ emoji 与类型不匹配
```

**✅ 正确示例**（emoji 与类型匹配）:
```bash
✨ feat(auth): add user login                # ✅ 正确
🐛 fix(api): resolve authentication issue    # ✅ 正确
♻️ refactor(utils): simplify functions       # ✅ 正确
🔧 chore(deps): update dependencies          # ✅ 正确
📦️ build(webpack): update config            # ✅ 正确
💄 style(components): format code           # ✅ 正确
```

#### 快速模板

**新功能**
```bash
✨ feat(auth): add user login functionality
✨ feat(ui): implement responsive dashboard layout
✨ feat(api): create user profile management endpoint
```

**修复问题**
```bash
🐛 fix(auth): resolve login session timeout issue
🐛 fix(ui): fix mobile navigation menu display
🐛 fix(api): handle null pointer exception in user service
```

**代码重构**
```bash
♻️ refactor(auth): extract authentication logic to separate service
♻️ refactor(ui): optimize component rendering performance
♻️ refactor(api): simplify database query logic
```

**性能优化**
```bash
⚡️ perf(database): optimize slow query with proper indexing
⚡️ perf(ui): reduce bundle size by code splitting
⚡️ perf(api): implement response caching for static data
```

**测试相关**
```bash
✅ test(auth): add comprehensive unit tests for login flow
✅ test(api): create integration tests for user endpoints
✅ test(ui): add accessibility tests for components
```

**文档更新**
```bash
📝 docs(api): document new authentication endpoints
📝 docs(readme): update setup instructions
📝 docs(components): add usage examples for new components
```

**构建工具**
```bash
🔧 chore(deps): update react to latest version
🔧 chore(config): configure eslint rules for better code quality
🔧 chore(scripts): add automated deployment script
```

## 🚀 快速命令

### 运行 Linting 检查

```bash
# 验证特定文件
cd backend && poetry run mypy app/services/prompt_template_service.py
cd backend && poetry run ruff check app/services/prompt_template_service.py

# 格式化代码
cd backend && poetry run black app/services/
cd backend && poetry run isort app/services/
npx biome format .
```

### 完整的提交流程示例
```bash
# 1. 查看变更状态（强制使用 | cat 避免分页器）
git status -s | cat

# 2. 查看具体文件的变更详情（强制使用 | cat）
git diff frontend/src/stores/audioPlaylistStore.ts | cat

# 3. 添加变更到暂存区
git add frontend/src/stores/audioPlaylistStore.ts

# 4. 提交变更
git commit -m "♻️ refactor(stores): format audio playlist store code"
```

### 高级用法
```bash
# 仅提交特定文件
git add frontend/src/components/Button.tsx
git commit -m "💄 style(components): format button component"

# 修补上一次提交
git commit --amend -m "✨ feat(auth): add user registration and login"
```

### 验证和修复
```bash
# 验证 commit 消息格式
npx commitlint --edit .git/COMMIT_EDITMSG


# 查看最近的 commit（强制使用 | cat 避免分页器）
git log --oneline -5 | cat

# 查看详细的变更内容（强制使用 | cat）
git diff frontend/src/stores/audioPlaylistStore.ts | cat

# 重新格式化代码并修复 linting 问题
git add <file>
npx lefthook run pre-commit
git commit -m "💄 style: format code and fix linting issues"
```

## 📋 智能提示

### 根据变更类型选择合适的 Commit

**前端组件开发**
- 新增组件: `✨ feat(components): add <ComponentName> component`
- 修改样式: `💄 style(components): update <ComponentName> styling`
- 重构组件: `♻️ refactor(components): simplify <ComponentName> logic`

**后端 API 开发**
- 新增接口: `✨ feat(api): create <endpoint> endpoint`
- 修复接口: `🐛 fix(api): resolve <issue> in <endpoint>`
- 数据库变更: `⚡️ perf(database): optimize <table> query performance`

**配置和工具**
- 依赖更新: `🔧 chore(deps): update <package> to v<x.x.x>`
- 配置修改: `🔧 chore(config): configure <tool> settings`
- 构建优化: `📦️ build: optimize webpack configuration`

### 编写优质描述

**❌ 避免的写法**（缺少 emoji、缺少作用域、描述不清晰）
```bash
feat: update user profile                    # ❌ 缺少 emoji
✨ feat: update user profile                 # ❌ 缺少作用域
✨ feat(user-profile): update                # ❌ 描述不清晰
🐛 fix: bug                                  # ❌ 缺少 emoji、作用域和清晰描述
♻️ refactor: refactor code                   # ❌ 缺少 emoji、作用域和清晰描述
```

**✅ 推荐的写法**（包含正确的 emoji、作用域和清晰的描述）
```bash
✨ feat(user-profile): add avatar upload functionality
🐛 fix(auth): resolve login session timeout issue
♻️ refactor(auth): extract authentication logic to separate service
🔧 chore(deps): update react to v18.2.0
📦️ build(webpack): optimize bundle configuration
💄 style(components): format button component code
```

### 详细说明的使用时机

**何时使用详细说明**
- 复杂的功能变更
- 影响多个模块的修改
- 需要解释设计决策的变更
- 重要的架构调整

**详细说明示例**
```bash
✨ feat(auth): implement OAuth2 authentication flow

- Add OAuth2 client configuration for Google and GitHub providers
- Implement token refresh mechanism with automatic retry
- Add user session management with secure cookie storage
- Update API endpoints to support OAuth2 authentication

Resolves #123, relates to #456
```

## 🔧 故障排除

### Linting 问题解决

**常见 Linting 错误及解决方案**:

```bash
# mypy 类型错误
# 解决方案：添加正确的类型注解或使用 Any 类型
def function_name(param: str) -> str:  # 添加返回类型
    return param

# ruff 代码质量问题
# 解决方案：运行自动修复
cd backend && poetry run ruff check --fix .

# black/isort 格式问题
# 解决方案：自动格式化
cd backend && poetry run black . && poetry run isort .

# biome 前端 linting 问题
# 解决方案：自动修复
npx biome check --write --no-errors-on-unmatched --files-ignore-unknown=true .
```

**Linting 检查失败时的处理流程**:
1. 查看具体的错误信息
2. 运行相应的修复命令
3. 如果无法自动修复，手动修改代码
4. 添加变更到暂存区
5. 重新运行 `npx lefthook run pre-commit` 验证
6. 确保所有检查都通过后再提交

参照 `.cursor/commands/review-commit.md` 文档


## 📈 最佳实践

### 提交频率
- **小步快走**: 每个 commit 只做一件事
- **逻辑分组**: 相关变更放在一起
- **及时提交**: 不要积累太多未提交的变更

### 质量保证
- **测试先行**: 重要变更要有测试覆盖
- **自查代码**: 使用 `/review-commit` 检查代码质量
- **格式规范**: 严格遵循 commit 消息格式
- **Linting 检查**: **⚠️ 强制要求** - 所有代码变更必须通过完整的 linting 检查（包括 isort、black、ruff、mypy、biome 等）

### 协作规范
- **清晰描述**: 让其他开发者容易理解变更
- **关联上下文**: 关联相关的 Issue 或 PR
- **保持一致**: 遵循团队的提交规范

---

**⚠️ 重要命令技巧**:
- **强制使用 `| cat` 避免分页器**：所有可能产生大量输出的 git 命令都必须使用 `| cat`
  - `git status -s | cat` - 查看状态
  - `git diff file.ts | cat` - 查看变更详情
  - `git log --oneline | cat` - 查看提交历史
- **优先使用 `--no-pager` / `core.pager` / `GIT_PAGER`**：禁用分页器且不影响退出码或后续管道。例如：
  - `git --no-pager status -s` - 查看状态
  - `git --no-pager diff file.ts` - 查看变更详情
  - `git -c core.pager=cat log --oneline` - 查看提交历史
  - `GIT_PAGER=cat git diff --stat` - 查看变更详情
- **提交前必须通过 linting**：添加变更到暂存区后，运行 `npx lefthook run pre-commit` 确保所有检查通过
- **记住最终要提交**：查看变更后，记得执行 `git commit` 完成提交
- **批量添加文件**：`git add .` 添加所有变更，准备提交

**❗ 强制要求**:
- 任何 git diff、git log、git status 等可能分页的命令都必须添加 `| cat`
- 不要使用不带 `| cat` 的 git 命令，这会导致分页器问题
- **🔴 所有代码变更必须通过完整的 linting 检查后才能提交**（isort、black、ruff、mypy、biome 等）
- **🔴 所有 commit message 必须使用英文**（包括类型、作用域和描述）
- **🔴 每个 commit 类型必须使用对应的 emoji 图标**：
  - `feat` → ✨
  - `fix` → 🐛
  - `refactor` → ♻️
  - `chore` → 🔧
  - `build` → 📦️
  - `style` → 💄
  - `perf` → ⚡️
  - `test` → ✅
  - `docs` → 📝
  - `revert` → ⏪️
  - `ci` → 👷
