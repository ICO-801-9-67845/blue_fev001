#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
BIN_DIR="$REPO_ROOT/.tailscale/bin"
TAILSCALE_VERSION="${TAILSCALE_VERSION:-1.96.4}"

if [[ ! "$TAILSCALE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid TAILSCALE_VERSION" >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$BIN_DIR"
if [[ -x "$BIN_DIR/tailscale" && -x "$BIN_DIR/tailscaled" ]] &&
   "$BIN_DIR/tailscale" version 2>/dev/null | head -n 1 | grep -Fxq "$TAILSCALE_VERSION"; then
  "$BIN_DIR/tailscale" version
  exit 0
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
ARCHIVE="tailscale_${TAILSCALE_VERSION}_${ARCH}.tgz"
DOWNLOAD_URL="https://pkgs.tailscale.com/stable/${ARCHIVE}"

curl -f -s -S -L \
  --retry 3 --retry-delay 2 --connect-timeout 15 --max-time 120 \
  -o "$TEMP_DIR/$ARCHIVE" "$DOWNLOAD_URL"
tar -xzf "$TEMP_DIR/$ARCHIVE" -C "$TEMP_DIR"

EXTRACTED_DIR="$TEMP_DIR/tailscale_${TAILSCALE_VERSION}_${ARCH}"
if [[ ! -f "$EXTRACTED_DIR/tailscale" || ! -f "$EXTRACTED_DIR/tailscaled" ]]; then
  echo "Downloaded Tailscale archive is missing required binaries" >&2
  exit 1
fi

cp -- "$EXTRACTED_DIR/tailscale" "$BIN_DIR/tailscale"
cp -- "$EXTRACTED_DIR/tailscaled" "$BIN_DIR/tailscaled"
chmod 0755 "$BIN_DIR/tailscale" "$BIN_DIR/tailscaled"
"$BIN_DIR/tailscale" version
