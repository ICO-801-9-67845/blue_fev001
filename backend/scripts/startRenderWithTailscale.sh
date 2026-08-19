#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$REPO_ROOT/.tailscale/bin"
RUNTIME_DIR="${TMPDIR:-/tmp}/blue-tailscale"
SOCKET="$RUNTIME_DIR/tailscaled.sock"
TAILSCALE_HOSTNAME="${TAILSCALE_HOSTNAME:-blue-render}"
tailscaled_pid=""
backend_pid=""

is_running() {
  [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if is_running "$backend_pid"; then kill -TERM "$backend_pid" 2>/dev/null || true; fi
  if is_running "$tailscaled_pid"; then kill -TERM "$tailscaled_pid" 2>/dev/null || true; fi
  if [[ -n "$backend_pid" ]]; then wait "$backend_pid" 2>/dev/null || true; fi
  if [[ -n "$tailscaled_pid" ]]; then wait "$tailscaled_pid" 2>/dev/null || true; fi
  exit "$status"
}

trap cleanup EXIT INT TERM
cd -- "$REPO_ROOT"

if [[ "${TAILSCALE_ENABLED:-false}" != "true" ]]; then
  trap - EXIT INT TERM
  exec npm run start -w backend
fi

if [[ -z "${TAILSCALE_AUTHKEY:-}" ]]; then
  echo "TAILSCALE_AUTHKEY is required when TAILSCALE_ENABLED=true" >&2
  exit 1
fi
if [[ ! "$TAILSCALE_HOSTNAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]]; then
  echo "Invalid TAILSCALE_HOSTNAME" >&2
  exit 1
fi

if [[ ! -x "$BIN_DIR/tailscale" || ! -x "$BIN_DIR/tailscaled" ]]; then
  bash "$SCRIPT_DIR/installTailscale.sh"
fi

mkdir -p "$RUNTIME_DIR"
rm -f -- "$SOCKET"
echo "Starting Tailscale userspace..."
"$BIN_DIR/tailscaled" \
  --tun=userspace-networking \
  --socks5-server=127.0.0.1:1055 \
  --outbound-http-proxy-listen=127.0.0.1:1055 \
  --state=mem: \
  --socket="$SOCKET" &
tailscaled_pid=$!

ready=false
for _ in {1..30}; do
  if ! is_running "$tailscaled_pid"; then
    echo "tailscaled stopped before becoming ready" >&2
    exit 1
  fi
  if "$BIN_DIR/tailscale" --socket="$SOCKET" status >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "tailscaled did not become ready" >&2
  exit 1
fi

connected=false
for attempt in {1..3}; do
  if "$BIN_DIR/tailscale" --socket="$SOCKET" up \
    --auth-key="$TAILSCALE_AUTHKEY" \
    --hostname="$TAILSCALE_HOSTNAME"; then
    connected=true
    break
  fi
  if (( attempt < 3 )); then sleep 2; fi
done
if [[ "$connected" != "true" ]]; then
  echo "Tailscale authentication failed after limited retries" >&2
  exit 1
fi

echo "Tailscale connected"
"$BIN_DIR/tailscale" --socket="$SOCKET" status

if [[ "${OLLAMA_SMOKE_TEST:-false}" == "true" ]]; then
  echo "Running Ollama smoke test..."
  node backend/scripts/testOllamaConnection.js
fi

echo "Starting Blue backend..."
npm run start -w backend &
backend_pid=$!

set +e
wait -n "$backend_pid" "$tailscaled_pid"
child_status=$?
set -e
if ! is_running "$tailscaled_pid" && is_running "$backend_pid"; then
  echo "tailscaled stopped unexpectedly; terminating backend" >&2
  kill -TERM "$backend_pid" 2>/dev/null || true
fi
exit "$child_status"
