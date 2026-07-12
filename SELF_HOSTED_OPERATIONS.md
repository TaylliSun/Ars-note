# Self-hosted Server Operations Guide

Operations scripts for managing your Ars-note Sync Server in production.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `npm run ops:summary` | Print server config (never shows secrets) |
| `npm run ops:health` | Test health endpoint + API key validity |
| `npm run ops:backup` | Back up server-data/ to tar.gz |
| `npm run ops:restore` | Restore server-data/ from a backup archive |

---

## 1. Server Summary

```bash
cd server
npm run ops:summary
```

Prints the current configuration: listen address, storage backend, API key mode, S3 env status, and vault registry (local backend only).

**Safety**: Secrets are never printed. Sensitive env vars show `SET` or `(not set)`.

---

## 2. Health Check

```bash
cd server
npm run ops:health
```

Checks:

1. `/health` endpoint is responding
2. API key is accepted (if configured)
3. Unauthenticated requests are rejected (if API key is set)
4. `/api/backups/list` responds correctly

**Safety**: This script does NOT upload any test files. It only reads existing data.

### Environment Variables

The health check reads these from your `.env` or environment:

| Variable | Required | Description |
|----------|----------|-------------|
| `ARSNOTE_PORT` | No | Server port (default: 3141) |
| `ARSNOTE_HOST` | No | Server host (default: 127.0.0.1) |
| `ARS_NOTE_SERVER_API_KEY` | No | API key to test auth with |

---

## 3. Backup

```bash
cd server
npm run ops:backup
```

Creates a compressed tar.gz archive of `server-data/`:

- Output: `server-backups/ars-note-server-backup_YYYYMMDD_HHmmss.tar.gz`
- Excludes: `.env`, `node_modules`, `*.log`

### Backup with Custom Path

```bash
node scripts/ops/backup-server-data.mjs /path/to/server-data /path/to/backups
```

### Automated Backups (cron)

```bash
# Daily at 3 AM
0 3 * * * cd /opt/ars-note/server && npm run ops:backup >> /var/log/arsnote-backup.log 2>&1
```

---

## 4. Restore

```bash
cd server
npm run ops:restore
```

Interactive restore process:

1. Lists available backups in `server-backups/`
2. You select which backup to restore
3. Creates a safety backup of current `server-data/` before overwriting
4. Restores from the selected archive

**Safety features**:

- Always backs up current data before restoring
- Never overwrites `.env` files
- Validates archive exists and is readable
- Path traversal protection on archive names

### Restore from Specific File

```bash
node scripts/ops/restore-server-data.mjs /path/to/server-data /path/to/backup.tar.gz
```

---

## 5. Docker Operations

### View Logs

```bash
# From project root
docker compose -f docker-compose.selfhosted.yml logs -f ars-note-sync

# MinIO logs
docker compose -f docker-compose.selfhosted.yml logs -f minio
```

### Restart Services

```bash
docker compose -f docker-compose.selfhosted.yml restart ars-note-sync
```

### Update Server

```bash
# Pull latest code, rebuild, restart
docker compose -f docker-compose.selfhosted.yml up -d --build --force-recreate ars-note-sync
```

### Backup Docker Volumes

```bash
# Back up MinIO data volume
docker run --rm -v ars-note_minio-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/minio-backup-$(date +%Y%m%d).tar.gz -C /data .
```

---

## 6. API Key Rotation

1. Generate a new API key:
   ```bash
   openssl rand -hex 32
   ```

2. Update `.env`:
   ```
   ARS_NOTE_SERVER_API_KEY=new-key-here
   ```

3. Restart the server:
   ```bash
   # Direct
   npm run start

   # Docker
   docker compose -f docker-compose.selfhosted.yml restart ars-note-sync
   ```

4. Update the API key in all Ars-note clients (Settings → Sync → Self-hosted → API Key).

---

## 7. Incident Response

### Server Won't Start

1. Run `npm run ops:summary` to check configuration
2. Check logs for error messages
3. Verify `.env` file has correct values
4. For S3 backend: verify S3 endpoint is reachable and credentials are valid

### Data Recovery

1. Stop the server
2. Run `npm run ops:restore` to restore from latest backup
3. If no local backup: check Docker volumes or S3 bucket directly
4. Restart the server

### Corrupted Backup

1. Check archive integrity: `tar tzf <backup-file.tar.gz>`
2. If corrupted, try an older backup from `server-backups/`
3. For S3 backend: objects are individually addressable — restore specific files from the S3 console

---

## 8. Monitoring

### Basic Uptime Check

```bash
curl -s http://localhost:3141/health | jq .
```

### With API Key

```bash
curl -s -H "Authorization: Bearer YOUR_KEY" \
  http://localhost:3141/api/backups/list?vaultId=YOUR_VAULT | jq .
```

### Recommended Monitoring

- **Uptime**: Monitor `/health` endpoint with your preferred uptime checker
- **Disk space**: Alert when `server-data/` exceeds threshold (local backend)
- **S3 usage**: Monitor bucket size via S3/MinIO console (S3 backend)
- **Logs**: Stream logs to your log aggregation system

---

*Last updated: v0.8.6*
