#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# TeaRoom (Private Chatroom) - Atomic Release Update & Rollback Script
# ==============================================================================

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

if [ "$DRY_RUN" = false ] && [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Please run this script as root (sudo bash deploy/update.sh)" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/private-chatroom}"
CONFIG_DIR="${CONFIG_DIR:-/etc/private-chatroom}"
ENV_FILE="${CONFIG_DIR}/tearoom.env"
SERVICE_NAME="${SERVICE_NAME:-private-chatroom}"
SERVICE_USER="${SERVICE_USER:-tearoom}"
RELEASES_DIR="${APP_DIR}/releases"
CURRENT_LINK="${APP_DIR}/current"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ "$DRY_RUN" = true ]; then
  echo "[DRY-RUN] Would stage new release in ${RELEASES_DIR}, run tests & build, switch ${CURRENT_LINK}, and verify /health"
  exit 0
fi

mkdir -p "$RELEASES_DIR"

PREVIOUS_RELEASE=""
if [ -L "$CURRENT_LINK" ] && [ -d "$CURRENT_LINK" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK")"
  echo "==> Detected active release: ${PREVIOUS_RELEASE}"
elif [ -d "${APP_DIR}/backend" ] && [ ! -L "$CURRENT_LINK" ]; then
  # Migrate legacy flat installation into releases/legacy
  LEGACY_REL="${RELEASES_DIR}/legacy-$(date +%s)"
  mkdir -p "$LEGACY_REL"
  rsync -a --exclude 'releases' --exclude 'current' "$APP_DIR/" "$LEGACY_REL/"
  ln -sfn "$LEGACY_REL" "$CURRENT_LINK"
  PREVIOUS_RELEASE="$LEGACY_REL"
fi

NEW_RELEASE_ID="$(date +%Y%m%d%H%M%S)-$$"
STAGE_DIR="${RELEASES_DIR}/${NEW_RELEASE_ID}"

cleanup_failed_stage() {
  if [ -d "$STAGE_DIR" ] && [ "$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)" != "$STAGE_DIR" ]; then
    rm -rf "$STAGE_DIR"
  fi
}
trap cleanup_failed_stage EXIT INT TERM

echo "==> [1/6] Staging new release in ${STAGE_DIR}..."
mkdir -p "$STAGE_DIR"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'releases' \
  --exclude 'current' \
  "$PROJECT_ROOT/" "$STAGE_DIR/"

cd "$STAGE_DIR"

echo "==> [2/6] Installing dependencies..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "==> [3/6] Running test suite & building frontend..."
npm test
npm run build

if [ ! -f "${STAGE_DIR}/dist/index.html" ] || [ ! -f "${STAGE_DIR}/backend/server.js" ]; then
  echo "ERROR: Build verification failed (missing dist/index.html or backend/server.js)." >&2
  exit 1
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$STAGE_DIR"

echo "==> [4/6] Activating release ${NEW_RELEASE_ID}..."
ln -sfn "$STAGE_DIR" "$CURRENT_LINK"

PORT=3000
if [ -f "$ENV_FILE" ]; then
  PORT_FROM_ENV="$(grep -E '^PORT=' "$ENV_FILE" | tail -n 1 | cut -d= -f2 | tr -d '[:space:]' || true)"
  if [ -n "$PORT_FROM_ENV" ]; then
    PORT="$PORT_FROM_ENV"
  fi
fi

rollback() {
  echo "ERROR: New release failed verification! Rolling back to ${PREVIOUS_RELEASE:-none}..." >&2
  if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
    systemctl restart "$SERVICE_NAME" || true
    echo "==> Rollback to ${PREVIOUS_RELEASE} complete." >&2
  fi
  exit 1
}

echo "==> [5/6] Restarting ${SERVICE_NAME}..."
if ! systemctl restart "$SERVICE_NAME"; then
  rollback
fi

echo "==> [6/6] Polling http://127.0.0.1:${PORT}/health..."
HEALTH_OK=false
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" | grep -q '"status":"ok"'; then
    HEALTH_OK=true
    break
  fi
  sleep 1
done

if [ "$HEALTH_OK" != true ]; then
  rollback
fi

echo "==> Health check passed! Pruning old releases (keeping latest 3)..."
ls -1dt "${RELEASES_DIR}"/* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo "==> Update to ${NEW_RELEASE_ID} succeeded."