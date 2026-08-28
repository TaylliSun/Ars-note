# Ars-note Public Sync Deployment

Public synchronization must use HTTPS/WSS. An API key sent over plain HTTP can
be read or modified by anyone who can observe the connection, so opening port
8787 directly on a router is not a secure deployment.

## Recommended topology

```text
Ars-note desktop
  -> https://sync.example.com (TCP 443)
  -> trusted HTTPS reverse proxy
  -> http://127.0.0.1:8787
  -> Ars-note sync container
```

Use a domain or DDNS name with a valid TLS certificate. Tailscale or another
trusted VPN remains preferable when public administration is unnecessary.

## First deployment

1. Generate a new random key. Do not reuse the example key from documentation,
   chat messages, screenshots, or an older Compose file.

   PowerShell:

   ```powershell
   [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
   ```

   Linux or NAS shell:

   ```bash
   openssl rand -hex 32
   ```

2. Put the result in `.env`:

   ```dotenv
   ARS_NOTE_SERVER_API_KEY=replace-with-the-random-64-hex-character-value
   ARS_NOTE_ALLOWED_ORIGINS=null
   ARS_NOTE_UID=1000
   ARS_NOTE_GID=1000
   ```

3. Make `sync-data` writable by the configured UID/GID. Keep ownership as
   narrow as the NAS permits; do not make the directory world-writable.

4. Start the hardened public Compose file:

   ```bash
   docker compose -f docker-compose.public.yml up -d --force-recreate
   ```

5. Configure the reverse proxy to forward HTTPS requests and WebSocket Upgrade
   headers to `http://127.0.0.1:8787`. It must set `X-Forwarded-Proto: https`
   and preserve the external `Host` value.

6. Expose only TCP 443. Do not forward public TCP 8787 to the NAS.

7. Configure Ars-note with `https://sync.example.com`. Successful Live Sync
   will use `wss://sync.example.com/ws/live-sync` automatically.

## Public-mode protections

- Startup fails unless the API key is at least 32 characters.
- HTTP API and WebSocket requests fail unless the trusted proxy reports HTTPS.
- API keys in WebSocket query strings are rejected to keep secrets out of logs.
- Failed authentication is rate-limited and temporarily blocked per address.
- Browser origins, HTTP headers, request timeouts, payload sizes, WebSocket
  connections, message rates, frame masking, and frame types are validated.
- The public container runs without Linux capabilities, with a read-only root
  filesystem and a non-root UID/GID.

## Remaining responsibilities

- Restrict `/admin` and `/api/admin/*` at the reverse proxy to a VPN or trusted
  IP allowlist whenever possible.
- Enable NAS volume encryption and encrypted backups if data-at-rest exposure
  is in scope. Ars-note server files are not application-level encrypted yet.
- Back up `sync-data` before upgrades and test restore procedures regularly.
- Rotate the API key immediately if it appears in logs, screenshots, chat, or a
  leaked Compose file, then update every authorized desktop client.
