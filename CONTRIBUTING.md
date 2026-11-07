# 参与贡献

欢迎通过 Issue 反馈问题或提出建议。请描述使用场景、版本、系统和复现步骤，截图及日志先脱敏。

代码变更请从 `main` 创建独立分支，提交 Pull Request，说明问题、变更、验证结果和未验证项。先运行 `npm ci`、`npm run electron:install`、`npm run check`、`npm run lint -- --max-warnings=0` 和相关测试。

避免提交真实存档、备份、令牌、日志和构建缓存。涉及存档迁移时，使用隔离数据测试并验证备份恢复。完整版本与发布约定见 [MAINTAINING.md](MAINTAINING.md)。
