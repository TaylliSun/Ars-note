# Ars-note self-hosted sync server

Version: 1.5.64

The server provides authenticated backup, real-time WebSocket sync, deletion tombstones, stale-write protection, server snapshots, live history, restore, and the administration page. Local filesystem storage is the recommended NAS setup. S3-compatible storage is optional.

## NAS quick start

Place these files in one directory:

```text
docker-compose.nas.yml
.env
server/dist/
sync-data/
```

Create the environment file and generate a unique key:

```powershell
Copy-Item .env.example .env
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToHexString($bytes)
```

Paste the generated value into `.env`:

```dotenv
ARS_NOTE_SERVER_API_KEY=replace-with-your-random-key
ARS_NOTE_REQUIRE_API_KEY=true
ARS_NOTE_STORAGE_BACKEND=local
```

Start from the NAS host or NAS container manager, not from inside the container:

```bash
docker compose -f docker-compose.nas.yml up -d
```

Open:

```text
http://NAS_IP:8787/health
http://NAS_IP:8787/admin
```

In Ars-note, enter only `http://NAS_IP:8787` as the server URL. Do not append `/admin`.

## Updating

1. Stop edits on all clients for the short maintenance window.
2. Back up or snapshot `sync-data`.
3. Replace only the mounted `server/dist` directory.
4. Keep `sync-data` and `.env` unchanged.
5. Recreate the container and verify `/health` reports version `1.5.64`.
6. Update all desktop clients to the matching release before resuming work.

Never initialize an empty `sync-data` directory as an update to a server that already contains the authoritative Vault.

## Required environment variables

| Variable | Recommended value | Purpose |
| --- | --- | --- |
| `ARSNOTE_PORT` | `8787` | Container listening port |
| `ARSNOTE_HOST` | `0.0.0.0` | Container bind address |
| `ARS_NOTE_SERVER_API_KEY` | Random 32+ characters | Shared client authentication key |
| `ARS_NOTE_REQUIRE_API_KEY` | `true` | Refuse insecure startup |
| `ARS_NOTE_STORAGE_BACKEND` | `local` | NAS filesystem storage |
| `ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES` | `false` | Block obsolete clients from writing |

The server refuses to start when `ARS_NOTE_REQUIRE_API_KEY=true` and the key is missing or shorter than 16 characters.

## Network security

- Do not expose port 8787 directly to the public Internet.
- Prefer Tailscale or another trusted VPN.
- If a reverse proxy is required, use HTTPS and preserve WebSocket Upgrade/Connection headers for `/ws/live-sync`.
- Restrict access to `/admin` and do not share the API key in screenshots or diagnostics.
- Rotate keys used by releases earlier than v1.5.64.

## Data and backup

With local storage, all server state is under the mounted `sync-data` directory. Back up this entire directory while writes are paused or use the administration page to create a server snapshot. Test restore procedures periodically.

The server blocks `.ai-config.json` and internal Ars-note credential paths. On startup, local storage also prunes those forbidden paths from active live storage and history. Offline archives made by older versions are not modified automatically.

## Health checks

`GET /health` is public and returns server version, protocol, build ID, storage status, and safety capabilities. Authenticated diagnostics are available through `/admin`.

When HTTP works but real-time sync does not, verify that the URL contains only scheme, host, and port, and that VPN/proxy/firewall rules allow WebSocket upgrades on `/ws/live-sync`.

See `SECURITY.md` and `PRIVACY.md` before operating the server for a team.
