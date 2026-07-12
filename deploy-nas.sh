#!/usr/bin/env bash
# Build and run the Ars-note sync server on a Docker-capable NAS.
set -euo pipefail

PORT="${ARSNOTE_PORT:-8787}"
DATA_DIR="${ARS_NOTE_DATA_DIR:-/volume1/docker/ars-note-sync}"
API_KEY="${ARS_NOTE_SERVER_API_KEY:-}"

if [ "${#API_KEY}" -lt 16 ]; then
  echo "ARS_NOTE_SERVER_API_KEY is required and must contain at least 16 characters." >&2
  echo "Example: ARS_NOTE_SERVER_API_KEY='<random-32+-character-key>' bash deploy-nas.sh" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not available. Run this script on the NAS host, not inside the container." >&2
  exit 1
fi

mkdir -p "$DATA_DIR/server-data"
docker build -t ars-note-sync:1.5.64 ./server
docker rm -f ars-note-sync >/dev/null 2>&1 || true

docker run -d \
  --name ars-note-sync \
  --restart unless-stopped \
  -p "${PORT}:8787" \
  -v "${DATA_DIR}/server-data:/app/server-data" \
  -e ARSNOTE_PORT=8787 \
  -e ARSNOTE_HOST=0.0.0.0 \
  -e ARS_NOTE_SERVER_API_KEY="$API_KEY" \
  -e ARS_NOTE_REQUIRE_API_KEY=true \
  -e ARS_NOTE_STORAGE_BACKEND=local \
  -e ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES=false \
  ars-note-sync:1.5.64

sleep 3
if ! curl --fail --silent "http://127.0.0.1:${PORT}/health" >/dev/null; then
  docker logs ars-note-sync
  exit 1
fi

echo "Ars-note sync server is ready at http://NAS_IP:${PORT}"
echo "Keep ${DATA_DIR}/server-data when upgrading."
