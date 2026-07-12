# Ars-note Self-hosted Smoke Test Guide

End-to-end verification that the self-hosted sync server + MinIO deployment works correctly.

## Prerequisites

- Docker Engine 20+ and Docker Compose V2
- `curl` or a similar HTTP client
- Ars-note desktop app (for client-side tests)
- 5–10 minutes

## Step 1: Environment Checks

```bash
# Docker version
docker --version
# Docker Compose version
docker compose version
```

Both should report version numbers without errors.

## Step 2: Configure Environment

```bash
cd ars-note

cp .env.example .env
```

Edit `.env` and fill in:

```bash
# Required — any strong random string
ARS_NOTE_SERVER_API_KEY=smoke-test-key-change-me

# MinIO credentials
MINIO_ROOT_USER=smokeadmin
MINIO_ROOT_PASSWORD=smokepassword123

# Must match MinIO credentials
ARS_NOTE_S3_ACCESS_KEY_ID=smokeadmin
ARS_NOTE_S3_SECRET_ACCESS_KEY=smokepassword123
```

## Step 3: Start Services

```bash
docker compose -f docker-compose.selfhosted.yml up -d --build
```

Wait 15–30 seconds for both containers to become healthy:

```bash
docker compose -f docker-compose.selfhosted.yml ps
```

Both `ars-note-sync` and `ars-note-minio` should show status `healthy`.

## Step 4: Check Health Endpoint

```bash
curl http://localhost:8787/health
```

Expected:

```json
{"ok":true,"app":"Ars-note Sync Server","version":"0.8.5"}
```

If you get a connection refused error, wait a few more seconds and retry.

## Step 5: Run Automated Smoke Test

```bash
cd server
node scripts/smoke-test-selfhosted.mjs http://localhost:8787 smoke-test-key-change-me
```

This script tests all 7 API endpoints plus auth rejection, path traversal blocking, and round-trip content verification. Expected output:

```
═══════════════════════════════════════
  Ars-note Self-hosted Smoke Test
  Endpoint: http://localhost:8787
═══════════════════════════════════════
  1. GET /health .................. PASS
  2. No key → 401 ................. PASS
  3. Wrong key → 401 .............. PASS
  4. Register vault ................ PASS
  5. Upload metadata ............... PASS
  6. Upload file ................... PASS
  7. List backups .................. PASS
  8. Get manifest .................. PASS
  9. Download file ................. PASS
  10. Round-trip verify ............ PASS
  11. Path traversal blocked ....... PASS
  12. Duplicate rejected ........... PASS
═══════════════════════════════════════
  12/12 PASSED ✓
═══════════════════════════════════════
```

## Step 6: Create MinIO Bucket

Open MinIO Console at `http://localhost:9001`:
1. Log in with the credentials from `.env` (`smokeadmin` / `smokepassword123`)
2. Click **Buckets** → **Create Bucket**
3. Name: `ars-note-sync` → **Create**

Skip this step if the automated smoke test passed (the S3 backend auto-creates the bucket).

## Step 7: Client-Side Test

In the Ars-note desktop app:

1. Open **Settings** tab
2. Enable sync, set provider to **Self-hosted Server**
3. Enter **Server Endpoint**: `http://localhost:8787`
4. Enter **API Key**: the value of `ARS_NOTE_SERVER_API_KEY` from `.env`
5. Click **Save Credentials**
6. Open **Sync Wizard**:
   - Step 1: Choose **Self-hosted Server**
   - Step 2: Enter endpoint + API key
   - Step 3: Test Connection → should show "Self-hosted server is reachable"
   - Step 4: Create Local Backup
   - Step 5: Upload Backup → should succeed
   - Step 6: Confirm Remote History → should show the backup you just uploaded
   - Step 7: Safety Summary

## Step 8: Download and Verify

In the **Backup** tab:

1. Click **List Remote Backups** → should show your uploaded backup
2. Click **Download** on the remote backup
3. After download completes, click **Verify** on the downloaded backup
4. Verification should pass with all file hashes matching

## Step 9: Restore (Optional)

1. Click **Restore** on the downloaded backup
2. Choose a restore location (not your current vault)
3. Verify restored files match originals

## Step 10: Cleanup

```bash
# Stop and remove containers (data preserved in volumes)
docker compose -f docker-compose.selfhosted.yml down

# To also remove MinIO data
docker compose -f docker-compose.selfhosted.yml down -v
```

## Troubleshooting

### Containers not healthy

```bash
docker compose -f docker-compose.selfhosted.yml logs ars-note-sync
docker compose -f docker-compose.selfhosted.yml logs minio
```

Common issues:
- **Missing env vars**: Server prints which variables are missing on startup
- **MinIO not ready**: Server retries, but may need `docker compose restart ars-note-sync`
- **Port conflicts**: Change `ARSNOTE_PORT` in `.env`

### Smoke test script fails

- Check that `ARS_NOTE_SERVER_API_KEY` in `.env` matches the argument passed to the script
- Check that the endpoint URL is correct (default: `http://localhost:8787`)
- Check that containers are healthy: `docker compose -f docker-compose.selfhosted.yml ps`

### Client can't connect

- Check firewall rules allow port 8787
- If using a remote server, use the server's public IP or domain
- If behind a reverse proxy, check that `Authorization` headers are forwarded
