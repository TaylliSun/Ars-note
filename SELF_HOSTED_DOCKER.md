# Ars-note Self-hosted Docker Deployment Guide

Deploy the Ars-note Sync Server and MinIO to your personal server with Docker Compose.

## Prerequisites

- Docker Engine 20+
- Docker Compose V2 (included with Docker Desktop and modern Docker Engine)
- A server with ports 8787, 9000, 9001 available (or change in .env)

## Quick Start

### 1. Clone and configure

```bash
cd ars-note

# Copy the example env file
cp .env.example .env
```

### 2. Edit .env

Open `.env` and set these values:

```bash
# Required — choose a strong API key (your Ars-note client will use this)
ARS_NOTE_SERVER_API_KEY=your-strong-random-secret-here

# MinIO credentials — set strong values for production
MINIO_ROOT_USER=your-minio-user
MINIO_ROOT_PASSWORD=your-minio-password

# These must match MinIO credentials
ARS_NOTE_S3_ACCESS_KEY_ID=your-minio-user
ARS_NOTE_S3_SECRET_ACCESS_KEY=your-minio-password
```

### 3. Start services

```bash
docker compose -f docker-compose.selfhosted.yml up -d --build
```

Or using npm:

```bash
npm run server:docker:up
```

### 4. Create the MinIO bucket

Open the MinIO Console at `http://your-server:9001` and log in with the credentials you set. Create a bucket named `ars-note-sync`.

Alternatively, use the MinIO client (mc):

```bash
# Install mc if needed
docker exec ars-note-minio mc alias set local http://localhost:9000 your-minio-user your-minio-password
docker exec ars-note-minio mc mb local/ars-note-sync
```

### 5. Verify

```bash
curl http://your-server:8787/health
```

Expected response:

```json
{"ok":true,"app":"Ars-note Sync Server","version":"0.8.4"}
```

### 6. Configure Ars-note client

1. Open Ars-note → Settings tab
2. Set sync provider to **Self-hosted Server**
3. Enter:
   - **Server Endpoint**: `http://your-server:8787`
   - **API Key**: the value you set for `ARS_NOTE_SERVER_API_KEY`
4. Click **Save Credentials**
5. Use the Sync Wizard to test connection and upload your first backup

## Service Architecture

```
┌─────────────────────────────────────────────┐
│  Ars-note Client (your desktop)             │
│  knows: endpoint + API key only             │
└──────────────┬──────────────────────────────┘
               │ HTTP (port 8787)
               │ Authorization: Bearer <apiKey>
               ▼
┌──────────────────────────────────────────────┐
│  ars-note-sync container                     │
│  Receives API requests                       │
│  Validates API key                           │
│  Reads/writes via S3StorageBackend           │
└──────────────┬───────────────────────────────┘
               │ S3 API (internal Docker network)
               │ NOT exposed to public
               ▼
┌──────────────────────────────────────────────┐
│  minio container                             │
│  S3-compatible object storage                │
│  Port 9000: S3 API (internal)                │
│  Port 9001: MinIO Console (optional public)  │
│  Data: minio-data Docker volume              │
└──────────────────────────────────────────────┘
```

The client never has direct access to MinIO. All S3 operations happen server-side.

## Port Reference

| Port | Service | Purpose | Public? |
|------|---------|---------|---------|
| 8787 | ars-note-sync | Sync API | **Yes** (or via reverse proxy) |
| 9000 | MinIO | S3 API | **No** (internal only) |
| 9001 | MinIO | Web Console | Optional (for bucket management) |

## Useful Commands

```bash
# Start services
npm run server:docker:up

# View sync server logs
npm run server:docker:logs

# Stop services
npm run server:docker:down

# Rebuild after code changes
npm run server:docker:rebuild

# Check service health
docker compose -f docker-compose.selfhosted.yml ps

# View MinIO logs
docker compose -f docker-compose.selfhosted.yml logs minio
```

## Reverse Proxy (Production)

For production with HTTPS, put the sync server behind nginx or Caddy:

### nginx example

```nginx
server {
    listen 443 ssl;
    server_name sync.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Allow large uploads (backup files)
        client_max_body_size 100m;
    }
}
```

Then in the Ars-note client, use `https://sync.yourdomain.com` as the endpoint.

### Caddy example

```
sync.yourdomain.com {
    reverse_proxy localhost:8787
}
```

Caddy handles HTTPS automatically via Let's Encrypt.

## Security Notes

**Do not upload `.env` to GitHub.** Add it to `.gitignore` (it should already be there).

**API key requirements:**
- Must be strong and random (e.g., 32+ characters)
- Never share it publicly
- The client stores it in memory only — it is not written to any file

**MinIO credentials:**
- Only exist as server environment variables
- Never sent to the Ars-note client
- Never appear in API responses or logs
- The sync server connects to MinIO via internal Docker network — not the internet

**Network security:**
- Only expose port 8787 (sync server) to the public internet
- MinIO ports (9000, 9001) should not be publicly accessible
- In production, use HTTPS via a reverse proxy
- Consider firewall rules to restrict access to port 8787

**Not a multi-user system:**
- One API key shared by all clients
- Any authenticated client can access any vault
- Suitable for personal or small team use

## Troubleshooting

### Port won't open

Check if something else is using the port:

```bash
ss -tlnp | grep 8787
```

Change the port in `.env`:

```bash
ARSNOTE_PORT=9787
```

Then restart: `npm run server:docker:up`

### API key 401 errors

- Make sure the client's API key exactly matches `ARS_NOTE_SERVER_API_KEY` in `.env`
- Check for extra whitespace or newlines in the .env file
- Restart the server after changing `.env`: `npm run server:docker:rebuild`

### Bucket does not exist

The S3StorageBackend attempts to create the bucket on startup, but this may fail depending on MinIO permissions. Create it manually:

1. Open MinIO Console at `http://your-server:9001`
2. Log in with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
3. Click "Create Bucket" → name it `ars-note-sync`

### MinIO connection failed

Check that MinIO is healthy:

```bash
docker compose -f docker-compose.selfhosted.yml ps
docker compose -f docker-compose.selfhosted.yml logs minio
```

Common issues:
- MinIO not started yet — wait a few seconds and restart the sync server
- Wrong endpoint in `.env` — must be `http://minio:9000` (Docker internal hostname), not `http://localhost:9000`
- Credentials mismatch — `ARS_NOTE_S3_ACCESS_KEY_ID` must equal `MINIO_ROOT_USER`

### Cloudflare / reverse proxy

If using Cloudflare Tunnel or a reverse proxy:
- Make sure the proxy forwards the `Authorization` header
- Increase upload size limits (backup files can be large)
- For Cloudflare, you may need to increase the upload timeout

### Server won't start

Check logs:

```bash
npm run server:docker:logs
```

Common errors:
- Missing env vars → the server prints which variables are missing
- MinIO not ready → the server retries, but may need a restart after MinIO is up

## Updating

```bash
git pull
npm run server:docker:rebuild
```

This rebuilds the Docker image with the latest code and restarts the container. Data in MinIO is preserved in the `minio-data` Docker volume.
