#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# TeaRoom (Private Chatroom) - Safe Uninstall Script
# Options:
#   --yes     Skip interactive confirmation prompt (does NOT imply --purge)
#   --purge   Also delete /etc/private-chatroom, /var/lib/private-chatroom, and service user
#   --dry-run Print actions without modifying the system
# ==============================================================================

ASSUME_YES=false
PURGE=false
DRY_RUN=false

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)
      ASSUME_YES=true
      shift
      ;;
    --purge)
      PURGE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      echo "Usage: sudo bash deploy/uninstall.sh [--yes] [--purge] [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [ "$DRY_RUN" = false ] && [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Please run this script as root (sudo bash deploy/uninstall.sh)" >&2
  exit 1
fi

APP_DIR="${APP_DIR:-/opt/private-chatroom}"
CONFIG_DIR="${CONFIG_DIR:-/etc/private-chatroom}"
DATA_DIR="${DATA_DIR:-/var/lib/private-chatroom}"
SERVICE_NAME="${SERVICE_NAME:-private-chatroom}"
SERVICE_USER="${SERVICE_USER:-tearoom}"

safe_remove_dir() {
  local target="$1"
  local allowed_prefix="$2"
  if [ -z "$target" ] || [ ! -e "$target" ]; then
    return 0
  fi
  local canon
  canon="$(realpath -m "$target")"
  if [ "$canon" = "/" ] || [ "$canon" = "/opt" ] || [ "$canon" = "/etc" ] || [ "$canon" = "/var" ] || [ "$canon" = "/var/lib" ]; then
    echo "FATAL: Refusing to delete protected system directory: $canon" >&2
    exit 1
  fi
  case "$canon" in
    "${allowed_prefix}"/*)
      if [ "$DRY_RUN" = true ]; then
        echo "[DRY-RUN] rm -rf $canon"
      else
        rm -rf "$canon"
      fi
      ;;
    *)
      echo "FATAL: Path $canon is outside allowed prefix $allowed_prefix" >&2
      exit 1
      ;;
  esac
}

if [ "$PURGE" = true ]; then
  echo "WARNING: --purge requested! This will permanently delete:"
  echo "  - Application binaries (${APP_DIR})"
  echo "  - Environment configuration & secrets (${CONFIG_DIR})"
  echo "  - Persistent state (${DATA_DIR})"
  echo "  - System user (${SERVICE_USER})"
else
  echo "Standard uninstall selected: Application & service will be removed."
  echo "Configuration (${CONFIG_DIR}) and data (${DATA_DIR}) will be PRESERVED (use --purge to remove)."
fi

if [ "$ASSUME_YES" = false ] && [ "$DRY_RUN" = false ]; then
  read -rp "Proceed with uninstall? (y/N): " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
  fi
fi

echo "==> Stopping and removing systemd service (${SERVICE_NAME})..."
if [ "$DRY_RUN" = false ]; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload || true
else
  echo "[DRY-RUN] Stop & remove /etc/systemd/system/${SERVICE_NAME}.service"
fi

echo "==> Removing Nginx configuration..."
if [ "$DRY_RUN" = false ]; then
  rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  rm -f "/etc/nginx/sites-available/${SERVICE_NAME}"
  if command -v nginx >/dev/null 2>&1 && nginx -t >/dev/null 2>&1; then
    systemctl reload nginx || true
  fi
else
  echo "[DRY-RUN] Remove Nginx site ${SERVICE_NAME}"
fi

echo "==> Removing application directory (${APP_DIR})..."
safe_remove_dir "$APP_DIR" "/opt"

if [ "$PURGE" = true ]; then
  echo "==> Purging configuration (${CONFIG_DIR}), data (${DATA_DIR}), and user (${SERVICE_USER})..."
  safe_remove_dir "$CONFIG_DIR" "/etc"
  safe_remove_dir "$DATA_DIR" "/var/lib"
  if [ "$DRY_RUN" = false ]; then
    if id -u "$SERVICE_USER" >/dev/null 2>&1; then
      userdel "$SERVICE_USER" 2>/dev/null || true
    fi
  else
    echo "[DRY-RUN] userdel $SERVICE_USER"
  fi
fi

echo "==> Uninstall complete."