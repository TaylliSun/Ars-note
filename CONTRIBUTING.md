# Contributing to Ars-note

感谢你帮助改进 Ars-note。提交代码前，请先搜索现有 Issue，较大的功能建议先创建 Issue 说明使用场景和设计范围。

## 本地开发

需要 Node.js 22 和 npm。

```powershell
npm install
npm --prefix server install
npm run typecheck
npm test
npm --prefix server test
```

## Pull Request

- 每个 PR 只处理一个清晰问题。
- 不提交 Vault、同步数据、API Key、日志、构建目录或安装包。
- 修复缺陷时补充回归测试；改变用户行为时更新 README 或 CHANGELOG。
- PR 描述需要说明改动、原因、影响范围和验证方式。

## 安全问题

安全漏洞不要提交公开 Issue。请使用仓库 Security 页的私密漏洞报告入口，并先阅读 [SECURITY.md](SECURITY.md)。
