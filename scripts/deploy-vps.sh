#!/usr/bin/env bash
# One-shot BARE-METAL VPS deploy for LazyMapHUD (no Docker).
#
# On a fresh Ubuntu/Debian VPS it: installs Node 20 + pnpm + Caddy (if
# missing), builds the web bundle, writes .env (generating a strong
# WEBHOOK_SECRET), installs a systemd service that runs the Fastify server
# (which also serves the built web + WebSocket hub), and points native Caddy
# at it for automatic Let's Encrypt TLS. Idempotent: re-run to redeploy.
#
# Prerequisites: run as root/sudo, DNS A/AAAA for your domain -> this VPS,
# ports 80/443 open. Use ':80' as the domain for a local, no-TLS smoke test.
#
# Usage (from the repo root):
#   sudo ./scripts/deploy-vps.sh hud.example.com
#   sudo LAZYMAPHUD_DOMAIN=hud.example.com ./scripts/deploy-vps.sh
#   sudo ./scripts/deploy-vps.sh :80        # local no-TLS test
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

DOMAIN="${1:-${LAZYMAPHUD_DOMAIN:-}}"
[ -n "$DOMAIN" ] || { echo "Usage: $0 <domain>   (e.g. hud.example.com, or ':80')" >&2; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Run with sudo (installs packages + a systemd service)." >&2; exit 1; }

RUN_USER="${SUDO_USER:-root}"
PORT=3000
APT_UPDATED=0
apt_get() { [ "$APT_UPDATED" = "1" ] || { apt-get update -y; APT_UPDATED=1; }; DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"; }

# --- 1) Node 20 + pnpm ------------------------------------------------------
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Installing Node 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt_get nodejs
fi
command -v curl >/dev/null 2>&1 || apt_get curl
corepack enable >/dev/null 2>&1 || npm install -g corepack >/dev/null 2>&1
corepack prepare pnpm@10.28.2 --activate

# --- 2) Caddy (skip for the :80 no-TLS test if you prefer) -------------------
if ! command -v caddy >/dev/null 2>&1; then
  echo "==> Installing Caddy…"
  apt_get debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  APT_UPDATED=0; apt_get caddy
fi

# --- 3) Build ---------------------------------------------------------------
echo "==> Installing deps + building web…"
sudo -u "$RUN_USER" env "PATH=$PATH" pnpm install --frozen-lockfile
sudo -u "$RUN_USER" env "PATH=$PATH" pnpm --filter web build

# --- 4) .env ----------------------------------------------------------------
[ -f .env ] || { echo "==> Creating .env"; sudo -u "$RUN_USER" cp .env.example .env; }
set_env() {
  local k="$1" v="$2"
  if grep -qE "^${k}=" .env; then sed -i "s|^${k}=.*|${k}=${v}|" .env; else printf '%s=%s\n' "$k" "$v" >> .env; fi
}
sec="$(grep -E '^WEBHOOK_SECRET=' .env | head -1 | cut -d= -f2- || true)"
if [ -z "$sec" ] || printf '%s' "$sec" | grep -q 'change-me'; then
  echo "==> Generating WEBHOOK_SECRET"; set_env WEBHOOK_SECRET "$(openssl rand -hex 32)"
fi
set_env PORT "$PORT"
set_env HOST "127.0.0.1"             # localhost-only: reachable via Caddy, not the internet
set_env SERVE_STATIC "true"          # server serves the built web/dist itself
chown "$RUN_USER" .env; chmod 600 .env

# --- 5) systemd service -----------------------------------------------------
NODE_DIR="$(dirname "$(command -v node)")"
PNPM_BIN="$(sudo -u "$RUN_USER" bash -lc 'command -v pnpm' || command -v pnpm)"
echo "==> Writing /etc/systemd/system/lazymaphud.service"
cat > /etc/systemd/system/lazymaphud.service <<UNIT
[Unit]
Description=LazyMapHUD tracking server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$REPO
EnvironmentFile=$REPO/.env
Environment=NODE_ENV=production
Environment=SERVE_STATIC=true
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$PNPM_BIN --filter server start
Restart=always
RestartSec=3
# hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$REPO

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now lazymaphud

# --- 6) Caddy reverse proxy -------------------------------------------------
echo "==> Configuring Caddy for $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	reverse_proxy localhost:$PORT
	encode gzip
}
CADDY
systemctl reload caddy || systemctl restart caddy

# --- 7) Health check --------------------------------------------------------
echo "==> Waiting for the app to become healthy…"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "==> Healthy ✓  LazyMapHUD is live at: $DOMAIN"
    echo "    Logs:   journalctl -u lazymaphud -f"
    echo "    Feed:   WEBHOOK_SECRET is in $REPO/.env  (see scripts/replay-sondes.mjs)"
    exit 0
  fi
  sleep 2
done
echo "WARN: health check timed out — inspect with: journalctl -u lazymaphud -e" >&2
exit 1
