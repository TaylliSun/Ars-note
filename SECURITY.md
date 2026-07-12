# Ars-note 安全说明

更新日期：2026-07-12

## 支持版本

公开发布后仅维护最新稳定版本。发现问题时，请先升级到发布页面标记的最新版本再复现。

## 安全默认值

- Electron 启用 `contextIsolation`、禁用 `nodeIntegration` 并启用渲染器沙箱。
- 外部链接仅允许 `http`、`https` 和 `mailto`。
- AI 与同步密钥使用操作系统安全存储加密，不写入 Vault。
- `.ai-config.json` 被客户端和服务器实时同步协议拒绝。
- 公开 Docker Compose 缺少强 API Key 时拒绝启动。
- 旧版实时同步写入会被服务器默认阻止。
- 文件上传执行路径约束、大小限制和 SHA256 校验。

## 自托管部署建议

1. 使用随机生成的 32 字符以上 API Key。
2. 不要直接把 `8787` 暴露到公网；优先使用 Tailscale、可信 VPN 或带 HTTPS 的反向代理。
3. 限制 NAS 管理端口和管理页面的访问来源。
4. 定期复制 `sync-data` 并验证服务器快照可恢复。
5. 每台设备保持相同主版本和实时同步协议版本。
6. 不要把 `.env`、API Key 或诊断文件发到公开问题页面。

## 从旧版本升级

`v1.5.64` 会迁移并删除本机 Vault 中旧的明文 `.ai-config.json`。服务器也会清理被禁止同步的内部凭据文件。

如果旧版本曾启用实时同步，仍建议执行以下操作：

1. 更换 AI API Key。
2. 更换同步服务器 API Key。
3. 更新所有客户端和服务器。
4. 检查服务器快照、旧压缩包和外部备份中是否存在 `.ai-config.json`。

历史离线备份不会被应用自动修改。

## 报告漏洞

请使用 GitHub 仓库 Security 页的[私密漏洞报告](https://github.com/TaylliSun/Ars-note/security/advisories/new)，附上版本、复现步骤和影响范围。不要在公开 Issue 中粘贴密钥、Vault 内容或未脱敏诊断文件。
