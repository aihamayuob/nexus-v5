#!/usr/bin/env bash
# NEXUS — single-VPS setup (Ubuntu 22.04/24.04, run as root ON THE SERVER). Prepared 2026-11-21. STATUS: written + syntax-checked only; NOT yet executed on a real VPS (UNVERIFIED).
#
#   git clone --branch review/r4-backend-html https://github.com/aihamayuob/nexus-v5 /opt/nexus
#   sudo DOMAIN=nexus.example.com EMAIL=you@example.com ACCEPT_LETSENCRYPT_TOS=yes BUDGET_USD=5 bash /opt/nexus/deploy/vps/setup.sh
#
# What it builds:  Internet --HTTPS (Let's Encrypt, nginx)--> nginx --127.0.0.1--> NEXUS backend (systemd, unprivileged user, loopback only)
#   * nginx serves the standalone page and proxies ONLY /api /v2 /health (NOT /mcp); edge rate limit; client X-Forwarded-For is replaced by the real peer;
#   * backend: NEXUS_HOST=127.0.0.1, NEXUS_TRUST_PROXY=127.0.0.1, generated shared gateway key, daily budget cap, CORS = https://DOMAIN, MQTT/sandbox NOT enabled;
#   * ufw: SSH + 80 + 443 only. Provider keys are NOT created or asked for here: you add them yourself in /etc/nexus/env.
# Consent: Let's Encrypt's Subscriber Agreement is YOURS to accept — the script refuses to run without ACCEPT_LETSENCRYPT_TOS=yes.
set -euo pipefail

: "${DOMAIN:?set DOMAIN=your.domain (an A record must already point at this server)}"
: "${EMAIL:?set EMAIL=you@example.com for certificate expiry notices}"
[ "${ACCEPT_LETSENCRYPT_TOS:-}" = "yes" ] || { echo "Refusing: read https://letsencrypt.org/repository/ and re-run with ACCEPT_LETSENCRYPT_TOS=yes if you agree." >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)" >&2; exit 2; }
[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || { echo "DOMAIN must be a hostname, not an IP" >&2; exit 2; }
BUDGET_USD="${BUDGET_USD:-5}"; [[ "$BUDGET_USD" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "BUDGET_USD must be a number" >&2; exit 2; }
API_PORT=8787; APP=/opt/nexus; BACKEND="$APP/src-baseline/nexus-backend"
export DEBIAN_FRONTEND=noninteractive
say() { printf '\n== %s\n' "$*"; }

say "DNS check"
getent ahostsv4 "$DOMAIN" >/dev/null || { echo "DOMAIN does not resolve yet. Create the A record first (certbot would fail), then re-run." >&2; exit 2; }

say "Packages (Ubuntu repos only)"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx git curl ca-certificates ufw openssl xz-utils

say "Node.js 22 (official tarball, SHA-256 verified)"
if ! /usr/local/bin/node -e 'process.exit(process.versions.node.split(".")[0]>=22 && +process.versions.node.split(".")[1]>=5 || process.versions.node.split(".")[0]>22 ? 0 : 1)' 2>/dev/null; then
  case "$(uname -m)" in x86_64) A=x64;; aarch64) A=arm64;; *) echo "unsupported CPU $(uname -m)" >&2; exit 2;; esac
  T=$(mktemp -d); BASE=https://nodejs.org/dist/latest-v22.x
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$T/SHASUMS256.txt"
  F=$(grep -o "node-v22[0-9.]*-linux-$A\.tar\.xz" "$T/SHASUMS256.txt" | head -1); [ -n "$F" ] || { echo "no Node 22 tarball found" >&2; exit 1; }
  curl -fsSL "$BASE/$F" -o "$T/$F"
  (cd "$T" && grep " $F\$" SHASUMS256.txt | sha256sum -c -)
  rm -rf /opt/node22 && mkdir -p /opt/node22 && tar -xJf "$T/$F" -C /opt/node22 --strip-components=1
  ln -sf /opt/node22/bin/node /usr/local/bin/node; ln -sf /opt/node22/bin/npm /usr/local/bin/npm; ln -sf /opt/node22/bin/npx /usr/local/bin/npx
  rm -rf "$T"
fi
/usr/local/bin/node -v

say "Application code"
[ -f "$BACKEND/package.json" ] || git clone --branch review/r4-backend-html https://github.com/aihamayuob/nexus-v5 "$APP"
export PATH=/usr/local/bin:$PATH
(cd "$BACKEND" && npm ci --ignore-scripts && npm run build)
[ -f "$BACKEND/dist/index.js" ] || { echo "build failed" >&2; exit 1; }

say "Service user, state dir, env file"
id nexus >/dev/null 2>&1 || useradd --system --home /var/lib/nexus --shell /usr/sbin/nologin nexus
mkdir -p /var/lib/nexus /etc/nexus && chown nexus:nexus /var/lib/nexus && chmod 700 /var/lib/nexus
NEW_KEY=""
if [ ! -f /etc/nexus/env ]; then
  NEW_KEY=$(openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')
  cat > /etc/nexus/env <<ENV_EOF
NODE_ENV=production
NEXUS_HOST=127.0.0.1
NEXUS_PORT=$API_PORT
NEXUS_TRUST_PROXY=127.0.0.1
NEXUS_GATEWAY_KEYS=$NEW_KEY
NEXUS_CORS_ORIGINS=https://$DOMAIN
NEXUS_DB_PATH=/var/lib/nexus/nexus.db
NEXUS_DAILY_BUDGET_USD=$BUDGET_USD
# --- Provider keys: add yours here YOURSELF (sudo nano /etc/nexus/env), then: sudo systemctl restart nexus. Never paste them into chat or the page. ---
# NEXUS_ANTHROPIC_API_KEY=
# NEXUS_OPENAI_API_KEY=
# NEXUS_DEEPSEEK_API_KEY=
# NEXUS_GEMINI_API_KEY=
ENV_EOF
fi
chown root:nexus /etc/nexus/env && chmod 640 /etc/nexus/env

say "systemd unit"
cat > /etc/systemd/system/nexus.service <<UNIT_EOF
[Unit]
Description=NEXUS backend
After=network-online.target
Wants=network-online.target

[Service]
User=nexus
Group=nexus
WorkingDirectory=$BACKEND
EnvironmentFile=/etc/nexus/env
ExecStart=/usr/local/bin/node --experimental-sqlite --enable-source-maps dist/index.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/var/lib/nexus

[Install]
WantedBy=multi-user.target
UNIT_EOF
systemctl daemon-reload && systemctl enable --now nexus
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$API_PORT/v2/health" >/dev/null 2>&1 && break; sleep 1; [ "$i" = 30 ] && { journalctl -u nexus -n 40 --no-pager; echo "backend did not become healthy" >&2; exit 1; }; done

say "nginx (page + restricted proxy + edge rate limit)"
cat > /etc/nginx/conf.d/nexus-ratelimit.conf <<'RL_EOF'
limit_req_zone $binary_remote_addr zone=nexus_api:10m rate=10r/s;
RL_EOF
cat > /etc/nginx/sites-available/nexus <<'NGX_EOF'
server {
  listen 80;
  server_name @DOMAIN@;
  server_tokens off;
  root /opt/nexus/standalone;
  client_max_body_size 25m;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;
  add_header X-Frame-Options DENY always;
  add_header Cache-Control "no-store" always;
  # client X-Forwarded-For is DISCARDED and replaced by the real peer (backend trusts only 127.0.0.1)
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $host;
  proxy_http_version 1.1;
  proxy_read_timeout 300s;
  proxy_buffering off;
  location = / { try_files /NEXUS-Standalone.html =404; }
  location = /NEXUS-Standalone.html { }
  location ~ ^/(api|v2|health)(/|$) {
    limit_req zone=nexus_api burst=40 nodelay;
    limit_req_status 429;
    proxy_pass http://127.0.0.1:@API_PORT@;
  }
  location / { return 404; }
}
NGX_EOF
sed -i "s/@DOMAIN@/$DOMAIN/g; s/@API_PORT@/$API_PORT/g" /etc/nginx/sites-available/nexus
ln -sf /etc/nginx/sites-available/nexus /etc/nginx/sites-enabled/nexus; rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

say "TLS certificate (Let's Encrypt) + HTTPS redirect"
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --non-interactive --redirect
grep -q 'Strict-Transport-Security' /etc/nginx/sites-available/nexus || sed -i '0,/add_header X-Frame-Options DENY always;/s//add_header X-Frame-Options DENY always;\n  add_header Strict-Transport-Security "max-age=15552000" always;/' /etc/nginx/sites-available/nexus
nginx -t && systemctl reload nginx

say "Firewall (SSH + 80 + 443)"
SSHP=$( (sshd -T 2>/dev/null | awk '/^port /{print $2}' | sort -u) || true ); SSHP=${SSHP:-22}
for p in $SSHP; do ufw allow "$p/tcp"; done
ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable

say "Smoke test"
curl -fsS "https://$DOMAIN/v2/health" >/dev/null && echo "HTTPS health: OK" || echo "HTTPS health: FAILED (check: journalctl -u nexus; nginx -t)"
echo "no-key request (expect 401): $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/v2/models")"
echo "/mcp must NOT be public (expect 404): $(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/mcp")"

cat <<DONE_EOF

========================================================
NEXUS is up:   https://$DOMAIN/NEXUS-Standalone.html
In the page's Connect tab:  API address = https://$DOMAIN
$( [ -n "$NEW_KEY" ] && echo "Gateway key (shown ONCE, also in /etc/nexus/env): $NEW_KEY" || echo "Gateway key: unchanged (see /etc/nexus/env)" )
Daily budget cap: \$$BUDGET_USD  (NEXUS_DAILY_BUDGET_USD). ALSO set a spend limit inside each provider's own console.
Add provider keys:  sudo nano /etc/nexus/env   then   sudo systemctl restart nexus
Real-provider validation (on this server, with your keys exported in the shell):
  cd $APP && NEXUS_ANTHROPIC_API_KEY=... node e2e/real-provider-validation.mjs
This is a single shared key, single-tenant deployment — anyone holding the key can spend your budget. Keep it secret.
========================================================
DONE_EOF
