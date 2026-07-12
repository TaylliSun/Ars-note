# Ars-note NAS 部署与更新

适用于绿联 NAS、群晖和其他支持 Docker Compose 的 NAS。NAS 不需要安装 npm，也不需要在容器内构建。

## 目录结构

```text
/volume1/docker/arsnote/
  docker-compose.nas.yml
  .env
  server/dist/
  sync-data/
```

不同 NAS 的根目录可能不是 `/volume1`，请以容器管理器实际挂载路径为准。

## 首次部署

1. 上传发布包里的 `docker-compose.nas.yml`、`.env.example` 和 `server` 文件夹。
2. 将 `.env.example` 复制为 `.env`。
3. 在 `.env` 中填写独立的随机密钥，至少 16 个字符，建议 32 个以上：

   ```dotenv
   ARS_NOTE_SERVER_API_KEY=请替换为随机强密钥
   ARS_NOTE_REQUIRE_API_KEY=true
   ARS_NOTE_STORAGE_BACKEND=local
   ```

4. 在 NAS 主机或 NAS 容器管理器中启动：

   ```bash
   docker compose -f docker-compose.nas.yml up -d
   ```

5. 浏览器验证：

   ```text
   http://NAS_IP:8787/health
   http://NAS_IP:8787/admin
   ```

客户端服务器地址只填写 `http://NAS_IP:8787`，不要追加 `/admin`。

## 更新服务器

1. 让团队暂时停止编辑。
2. 备份或快照 NAS 上的 `sync-data`。
3. 只覆盖发布包中的 `server/dist` 到 NAS 对应目录。
4. 不要覆盖或删除 `.env` 和 `sync-data`。
5. 在 NAS 容器管理器中重建或重启 `ars-note-sync`。
6. 确认 `/health` 显示服务器版本 `1.5.64`，然后再让全部客户端继续同步。

## 网络建议

- 优先使用 Tailscale 或可信 VPN，不要把 8787 端口直接暴露到公网。
- 使用反向代理时必须启用 HTTPS，并允许 `/ws/live-sync` 的 WebSocket Upgrade。
- 客户端、服务器应使用同一主版本；旧客户端默认不能向新协议服务器写入。
- 早于 v1.5.64 使用过的服务器密钥建议更换，并同步更新全部授权电脑。

`docker compose` 命令应在 NAS 主机执行。进入 `ars-note-sync` 容器后看不到 `/volume1/docker/arsnote`、`docker` 或 `unzip` 是正常现象。
