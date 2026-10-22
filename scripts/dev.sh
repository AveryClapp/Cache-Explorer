#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_TYPE="${BUILD_TYPE:-Debug}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
HOST="${HOST:-127.0.0.1}"

BACKEND_PID=""
FRONTEND_PID=""

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

first_available_port() {
  local port="$1"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

ensure_build() {
  local missing=0
  [[ -x "$ROOT_DIR/build/backend/cache-simulator/cache-sim" ]] || missing=1
  [[ -f "$ROOT_DIR/build/backend/llvm-pass/CacheProfiler.so" ]] || missing=1
  [[ -f "$ROOT_DIR/build/backend/runtime/libcache-explorer-rt.a" ]] || missing=1

  if [[ "$missing" == "1" ]]; then
    echo "Build artifacts missing; running ./scripts/build.sh $BUILD_TYPE"
    "$ROOT_DIR/scripts/build.sh" "$BUILD_TYPE"
  fi
}

ensure_node_modules() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "Installing npm dependencies in ${dir#$ROOT_DIR/}"
    (cd "$dir" && npm install)
  fi
}

wait_for_backend() {
  local url="http://$HOST:$BACKEND_PORT/health"
  for _ in {1..60}; do
    if command -v curl >/dev/null 2>&1 && curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  echo "Warning: backend health check did not respond at $url" >&2
}

cleanup() {
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

BACKEND_PORT="$(first_available_port "$BACKEND_PORT")"
FRONTEND_PORT="$(first_available_port "$FRONTEND_PORT")"

ensure_build
ensure_node_modules "$ROOT_DIR/backend/server"
ensure_node_modules "$ROOT_DIR/frontend"

echo "Starting Hardware Explorer Preview"
echo "  Backend:  http://$HOST:$BACKEND_PORT"
echo "  Frontend: http://$HOST:$FRONTEND_PORT"
echo "  Health:   http://$HOST:$BACKEND_PORT/health"
echo ""

(cd "$ROOT_DIR/backend/server" && HOST="$HOST" PORT="$BACKEND_PORT" npm start) &
BACKEND_PID="$!"

wait_for_backend

(
  cd "$ROOT_DIR/frontend"
  VITE_API_BASE="http://$HOST:$BACKEND_PORT" \
  VITE_WS_URL="ws://$HOST:$BACKEND_PORT/ws" \
  npm run dev -- --host "$HOST" --port "$FRONTEND_PORT"
) &
FRONTEND_PID="$!"

echo ""
echo "Hardware Explorer Preview is running at http://$HOST:$FRONTEND_PORT"
echo "Press Ctrl-C to stop both processes."

while true; do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    wait "$BACKEND_PID"
    exit $?
  fi
  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    wait "$FRONTEND_PID"
    exit $?
  fi
  sleep 1
done
