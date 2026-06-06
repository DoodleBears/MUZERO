#### 1.1. 创建实现分支
```bash
# 查看相关的 Issue
gh issue view <issue-number>

# 创建功能分支 (格式: <issue-number>/<prd-name>)
git checkout -b <issue-number>/<prd-name>

# 例如：
git checkout -b 45/improve-shuffle-playback-behavior

# 推送分支到远程
git push -u origin <issue-number>/<prd-name>
```