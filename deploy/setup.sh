#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# TeaRoom (Private Chatroom) - Production Installation Script
# Supports: --domain, --email, --port, --dry-run, --allow-insecure-http, --node-tarball
# ==============================================================================

DOMAIN=""
EMAIL=""
PORT="3000"
DRY_RUN=false
ALLOW_INSECURE_HTTP=false
NODE_TARBALL=""
APP_DIR="/opt/private-chatroom"
CONFIG_DIR="/etc/private-chatroom"
DATA_DIR="/var/lib/private-chatroom"
SERVICE_NAME="private-chatroom"
SERVICE_USER="tearoom"

TMP_DIR=""
cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

usage() {
  cat <<EOF
Usage: sudo bash deploy/setup.sh [OPTIONS]

Options:
  --domain <domain>         Public domain name for Nginx & HTTPS (e.g. chat.example.com)
  --email <email>           Email address for Let's Encrypt Certbot registration
  --port <port>             Internal Node.js bind port (default: 3000)
  --node-tarball <path>     Install Node.js 22+ from local tarball instead of NodeSource
  --allow-insecure-http     Allow HTTP-only Nginx config when no TLS cert is used
  --dry-run                 Print planned actions without modifying the system
  -h, --help                Show this help message
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --node-tarball)
      NODE_TARBALL="${2:-}"
      shift 2
      ;;
    --allow-insecure-http)
      ALLOW_INSECURE_HTTP=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1024 ] || [ "$PORT" -gt 65535 ]; then
  echo "ERROR: --port must be a valid unprivileged TCP port (1024-65535)." >&2
  exit 1
fi

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] $*"
  else
    "$@"
  fi
}

if [ "$DRY_RUN" = false ] && [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: Please run this script as root (sudo bash deploy/setup.sh)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TMP_DIR="$(mktemp -d -t tearoom-setup.XXXXXXXXXX)"

echo "==> [1/7] Installing system dependencies & Node.js 22+..."
run_cmd apt-get update -y
run_cmd apt-get install -y curl ca-certificates gnupg nginx rsync openssl

if [ -n "$NODE_TARBALL" ]; then
  if [ ! -f "$NODE_TARBALL" ]; then
    echo "ERROR: Specified --node-tarball not found: $NODE_TARBALL" >&2
    exit 1
  fi
  run_cmd tar -xJf "$NODE_TARBALL" -C /usr/local --strip-components=1
elif ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]; then
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Install Node.js 22.x via NodeSource"
  else
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi

echo "==> [2/7] Creating dedicated non-root service user (${SERVICE_USER})..."
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  run_cmd useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

RELEASE_ID="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_DIR}/releases/${RELEASE_ID}"
CURRENT_LINK="${APP_DIR}/current"

echo "==> [3/7] Staging application in ${RELEASE_DIR}..."
run_cmd mkdir -p "$RELEASE_DIR" "$CONFIG_DIR" "$DATA_DIR"
run_cmd rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude '.env' \
  "$PROJECT_ROOT/" "$RELEASE_DIR/"

if [ "$DRY_RUN" = false ]; then
  cd "$RELEASE_DIR"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
  npm run build
  ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
else
  echo "[DRY-RUN] cd $RELEASE_DIR && npm install && npm run build && ln -sfn $RELEASE_DIR $CURRENT_LINK"
fi

echo "==> [4/7] Configuring environment in ${CONFIG_DIR}/tearoom.env..."
ENV_FILE="${CONFIG_DIR}/tearoom.env"
if [ -n "$DOMAIN" ]; then
  SCHEME="https"
  if [ "$ALLOW_INSECURE_HTTP" = true ] && [ -z "$EMAIL" ]; then
    SCHEME="http"
  fi
  ORIGIN_VALUE="${SCHEME}://${DOMAIN}"
else
  ORIGIN_VALUE="http://127.0.0.1:${PORT}"
fi

if [ "$DRY_RUN" = false ]; then
  if [ ! -f "$ENV_FILE" ]; then
    GENERATED_SECRET="$(openssl rand -hex 32)"
    cat <<EOF > "$ENV_FILE"
NODE_ENV=production
HOST=127.0.0.1
PORT=${PORT}
CLIENT_ORIGIN=${ORIGIN_VALUE}
TRUST_PROXY=true
INVITE_ONLY=true
STATE_FILE_PATH=${DATA_DIR}/state.json
MAX_CONNECTIONS=200
MAX_CONNECTIONS_PER_IP=10
MAX_ROOM_SIZE=20
MAX_MESSAGE_BYTES=1048576
RATE_LIMIT_WINDOW_MS=10000
RATE_LIMIT_MESSAGES=15
RATE_LIMIT_JOINS=5
VITE_PBKDF2_ITERATIONS=600000
ADMIN_SECRET=${GENERATED_SECRET}
EOF
  fi
  chmod 640 "$ENV_FILE"
  chown root:"$SERVICE_USER" "$ENV_FILE"
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR" "$DATA_DIR"
else
  echo "[DRY-RUN] Generate $ENV_FILE with PORT=$PORT and CLIENT_ORIGIN=$ORIGIN_VALUE"
fi

echo "==> [5/7] Generating systemd unit (/etc/systemd/system/${SERVICE_NAME}.service)..."
SERVICE_FILE="${TMP_DIR}/${SERVICE_NAME}.service"
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=Private Chatroom (TeaRoom) Zero-Persistence Encrypted Relay
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${CURRENT_LINK}
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node ${CURRENT_LINK}/backend/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictRealtime=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

if [ "$DRY_RUN" = false ]; then
  install -m 0644 "$SERVICE_FILE" "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
else
  echo "[DRY-RUN] Install /etc/systemd/system/${SERVICE_NAME}.service and start service"
fi

echo "==> [6/7] Configuring Nginx & Firewall..."
if command -v ufw >/dev/null 2>&1; then
  # Always preserve SSH before any firewall rule changes
  run_cmd ufw allow OpenSSH || true
fi

if [ -n "$DOMAIN" ]; then
  NGINX_CONF="${TMP_DIR}/${SERVICE_NAME}.nginx"
  cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 2M;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Host \$host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

  if [ "$DRY_RUN" = false ]; then
    install -m 0644 "$NGINX_CONF" "/etc/nginx/sites-available/${SERVICE_NAME}"
    ln -sf "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
    rm -f /etc/nginx/sites-enabled/default
    nginx -t
    systemctl reload nginx
  else
    echo "[DRY-RUN] Configure Nginx reverse proxy for ${DOMAIN} -> 127.0.0.1:${PORT}"
  fi

  echo "==> [7/7] Configuring HTTPS..."
  if [ -n "$EMAIL" ]; then
    run_cmd apt-get install -y certbot python3-certbot-nginx
    run_cmd certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || {
      echo "WARNING: Certbot failed. Verify DNS A/AAAA records for ${DOMAIN}."
    }
  elif [ "$ALLOW_INSECURE_HTTP" = false ]; then
    echo "NOTE: No --email supplied for Certbot. Run: sudo certbot --nginx -d ${DOMAIN}"
  fi
else
  echo "==> [7/7] Domainless localhost mode configured."
  echo "Access securely via SSH local port forwarding (preserves Web Crypto secure context):"
  echo "  ssh -L ${PORT}:127.0.0.1:${PORT} user@your-server-ip"
  echo "Then open: http://localhost:${PORT}"
fi