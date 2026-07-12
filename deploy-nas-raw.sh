#!/usr/bin/env bash
# Run compiled Ars-note server files without Docker. Docker Compose is preferred.
set -euo pipefail

PORT="${ARSNOTE_PORT:-8787}"
INSTALL_DIR="${ARS_NOTE_INSTALL_DIR:-/volume1/ars-note-sync}"
API_KEY="${ARS_NOTE_SERVER_API_KEY:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${#API_KEY}" -lt 16 ]; then
  echo "ARS_NOTE_SERVER_API_KEY is required and must contain at least 16 characters." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 is required." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required; found $(node -v)." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/dist" "$INSTALL_DIR/server-data"
if [ ! -d "$SCRIPT_DIR/server/dist" ]; then
  echo "Missing $SCRIPT_DIR/server/dist. Use the compiled NAS release package." >&2
  exit 1
fi
cp -R "$SCRIPT_DIR/server/dist/." "$INSTALL_DIR/dist/"

if [ -f "$INSTALL_DIR/sync-server.pid" ]; then
  OLD_PID="$(cat "$INSTALL_DIR/sync-server.pid" 2>/dev/null || true)"
  if [ -n "$OLD_PID" ]; then
    kill "$OLD_PID" >/dev/null 2>&1 || true
  fi
fi

export ARSNOTE_PORT="$PORT"
export ARSNOTE_HOST=0.0.0.0
export ARS_NOTE_SERVER_API_KEY="$API_KEY"
export ARS_NOTE_REQUIRE_API_KEY=true
export ARS_NOTE_STORAGE_BACKEND=local
export ARS_NOTE_ALLOW_LEGACY_LIVE_WRITES=false

cd "$INSTALL_DIR"
nohup node "$INSTALL_DIR/dist/index.js" >"$INSTALL_DIR/sync-server.log" 2>&1 &
PID=$!
echo "$PID" >"$INSTALL_DIR/sync-server.pid"

sleep 3
if ! curl --fail --silent "http://127.0.0.1:${PORT}/health" >/dev/null; then
  cat "$INSTALL_DIR/sync-server.log"
  exit 1
fi

echo "Ars-note sync server is ready at http://NAS_IP:${PORT} (PID $PID)."
