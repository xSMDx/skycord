#!/usr/bin/env bash
# Skycord installer.
#
#   curl -fsSL https://skycord.xyz/install.sh | sudo bash
#
# Reads well before it is run, which is the point: it checks the machine, asks
# two questions, generates every secret, and hands the running install over to
# the `skycord` command. Nothing here is clever, and nothing is irreversible
# until the last step.
set -euo pipefail

SKYCORD_DIR="${SKYCORD_DIR:-/opt/skycord}"
SKYCORD_REPO="${SKYCORD_REPO:-xSMDx/skycord}"

VERSION=""
DOMAIN=""
ACME_EMAIL=""
PROXY="bundled"      # bundled | external
MONGO="bundled"      # bundled | external
VOICE="bundled"      # bundled | external | off
MONGO_URI_EXT=""
LIVEKIT_URL_EXT=""
LIVEKIT_KEY_EXT=""
LIVEKIT_SECRET_EXT=""
HOST_NETWORK=""
FROM_ENV=""
ASSUME_YES=""
CLOUDFLARE=""
TLS_CERT=""
TLS_KEY=""

die()  { echo "install: $*" >&2; exit 1; }
say()  { echo "$*"; }
warn() { echo "install: $*" >&2; }
ask()  { local prompt="$1" default="${2:-}" answer; printf '%s' "$prompt" > /dev/tty; read -r answer < /dev/tty; printf '%s' "${answer:-$default}"; }

usage() {
  cat <<'USAGE'
Skycord installer

  --domain chat.example.com    the address people will use
  --email you@example.com      for certificate expiry notices
  --version vX.Y.Z             a specific release (default: the newest)
  --proxy external             you already run a web server; skip Caddy
  --mongo-uri URI              you already run MongoDB
  --mongo-external             the same, reading the address from --from-env
  --livekit-url/-key/-secret   you already run LiveKit
  --voice-external             the same, reading the details from --from-env
  --no-voice                   install without voice
  --from-env FILE              take secrets from an existing .env (moving a server)
  --dir PATH                   install somewhere other than /opt/skycord
  --host-network               join this machine's own network, to reach a
                               database, LiveKit or proxy on loopback
  --yes                        no questions; every answer must come from a flag
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)         DOMAIN="$2"; shift 2 ;;
    --email)          ACME_EMAIL="$2"; shift 2 ;;
    --version)        VERSION="$2"; shift 2 ;;
    --proxy)          PROXY="$2"; shift 2 ;;
    --mongo-uri)      MONGO="external"; MONGO_URI_EXT="$2"; shift 2 ;;
    --mongo-external) MONGO="external"; shift ;;
    --voice-external) VOICE="external"; shift ;;
    --livekit-url)    VOICE="external"; LIVEKIT_URL_EXT="$2"; shift 2 ;;
    --livekit-key)    LIVEKIT_KEY_EXT="$2"; shift 2 ;;
    --livekit-secret) LIVEKIT_SECRET_EXT="$2"; shift 2 ;;
    --no-voice)       VOICE="off"; shift ;;
    --from-env)       FROM_ENV="$2"; shift 2 ;;
    --dir)            SKYCORD_DIR="$2"; shift 2 ;;
    --host-network)   HOST_NETWORK=1; shift ;;
    --yes|-y)         ASSUME_YES=1; shift ;;
    --help|-h)        usage; exit 0 ;;
    *)                die "unknown option: $1" ;;
  esac
done

# ── Checks, before anything on this machine changes ──────────────────────────
[ "$(id -u)" = "0" ] || die "needs root: run it with sudo"
[ "$(uname -s)" = "Linux" ] || die "Linux only — this installs Docker containers and systemd timers"

case "$(uname -m)" in
  x86_64|amd64|aarch64|arm64) ;;
  *) die "unsupported processor: $(uname -m). Images are built for x86-64 and ARM64" ;;
esac

mem_mb=$(( $(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0) / 1024 ))
[ "$mem_mb" -ge 900 ] 2>/dev/null || warn "only ${mem_mb}MB of memory — Skycord and MongoDB want about 1GB"
disk_mb=$(df -Pm / | awk 'NR==2 {print $4}')
[ "$disk_mb" -ge 5000 ] 2>/dev/null || warn "only ${disk_mb}MB of disk free — 5GB is a comfortable start"

[ -f "$SKYCORD_DIR/.env" ] && die "there is already an install in $SKYCORD_DIR. To move it forward: sudo skycord update"

if ! command -v docker >/dev/null 2>&1; then
  say "Docker is not installed."
  if [ -n "$ASSUME_YES" ] || [ "$(ask "Install it with Docker's official script? [Y/n] " y)" != "n" ]; then
    curl -fsSL https://get.docker.com | sh || die "Docker would not install — install it yourself and run this again"
    systemctl enable --now docker
  else
    die "Docker is required"
  fi
fi
docker compose version >/dev/null 2>&1 || die "this Docker has no 'compose' — update Docker, or install the compose plugin"

port_busy() { ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN; }
if [ "$PROXY" = "bundled" ] && { port_busy 80 || port_busy 443; }; then
  say "Something already serves ports 80/443 on this machine."
  say "Installing in front-end-less mode instead: Skycord will listen on 127.0.0.1:3001."
  PROXY="external"
fi

# ── Questions ────────────────────────────────────────────────────────────────
if [ -z "$DOMAIN" ]; then
  [ -z "$ASSUME_YES" ] || die "--domain is required with --yes"
  DOMAIN="$(ask 'Address people will use (e.g. chat.example.com): ')"
fi
[ -n "$DOMAIN" ] || die "an address is required"

if [ "$PROXY" = "bundled" ] && [ -z "$ACME_EMAIL" ]; then
  [ -z "$ASSUME_YES" ] || die "--email is required with --yes"
  ACME_EMAIL="$(ask 'Email for certificate expiry notices: ')"
fi

if [ "$PROXY" = "bundled" ] && [ -z "$ASSUME_YES" ]; then
  if [ "$(ask "Is this address behind Cloudflare's proxy (orange cloud)? [y/N] " n)" = "y" ]; then
    CLOUDFLARE=1
    say ""
    say "Then set SSL/TLS to Full (strict) in Cloudflare, and paste an Origin Certificate."
    say "Let's Encrypt cannot verify through Cloudflare's forced-HTTPS redirect."
    TLS_CERT="$(ask 'Path to the certificate .pem: ')"
    TLS_KEY="$(ask 'Path to the private .key: ')"
    { [ -f "$TLS_CERT" ] && [ -f "$TLS_KEY" ]; } || die "could not read those certificate files"
  fi
fi

KLIPY_API_KEY=""
RESEND_API_KEY=""
EMAIL_FROM=""
if [ -z "$ASSUME_YES" ]; then
  say ""
  say "Both of these are optional and can be added later with: sudo skycord config"
  KLIPY_API_KEY="$(ask 'KLIPY key for the GIF picker (enter to skip): ')"
  RESEND_API_KEY="$(ask 'Resend key for password reset (enter to skip): ')"
  [ -n "$RESEND_API_KEY" ] && EMAIL_FROM="$(ask 'Sender address, e.g. Skycord <noreply@example.com>: ')"
fi

# ── Secrets ──────────────────────────────────────────────────────────────────
rand() { openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

from_env() {
  [ -n "$FROM_ENV" ] || return 0
  # head closes the pipe, which can leave sed killed by SIGPIPE; under
  # pipefail that would fail the caller, so the value is all we report.
  sed -n "s/^$1=//p" "$FROM_ENV" | head -1 || true
}

if [ -n "$FROM_ENV" ]; then
  [ -f "$FROM_ENV" ] || die "cannot read $FROM_ENV"
  say "Taking secrets from $FROM_ENV — sessions and stored voice-server secrets keep working."
fi

JWT_ACCESS_SECRET="$(from_env JWT_ACCESS_SECRET)";  JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(rand 48)}"
JWT_REFRESH_SECRET="$(from_env JWT_REFRESH_SECRET)"; JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(rand 48)}"
ENCRYPTION_KEY="$(from_env ENCRYPTION_KEY)";         ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(rand 32)}"
KLIPY_API_KEY="${KLIPY_API_KEY:-$(from_env KLIPY_API_KEY)}"
RESEND_API_KEY="${RESEND_API_KEY:-$(from_env RESEND_API_KEY)}"
EMAIL_FROM="${EMAIL_FROM:-$(from_env EMAIL_FROM)}"

MONGO_ROOT_USER="skycord-root"
MONGO_ROOT_PASSWORD="$(rand 24)"
MONGO_APP_USER="skycord"
MONGO_APP_PASSWORD="$(rand 24)"

if [ "$MONGO" = "external" ]; then
  MONGO_URI="${MONGO_URI_EXT:-$(from_env MONGO_URI)}"
else
  MONGO_URI="mongodb://$MONGO_APP_USER:$MONGO_APP_PASSWORD@mongo:27017/skycord?authSource=skycord"
fi

LIVEKIT_UDP_PORT="${LIVEKIT_UDP_PORT:-7882}"
case "$VOICE" in
  bundled)
    LIVEKIT_API_KEY="API$(rand 6)"
    LIVEKIT_API_SECRET="$(rand 32)"
    LIVEKIT_URL="wss://$DOMAIN"
    LIVEKIT_ADMIN_URL="http://livekit:7880"
    ;;
  external)
    LIVEKIT_API_KEY="${LIVEKIT_KEY_EXT:-$(from_env LIVEKIT_API_KEY)}"
    LIVEKIT_API_SECRET="${LIVEKIT_SECRET_EXT:-$(from_env LIVEKIT_API_SECRET)}"
    LIVEKIT_URL="${LIVEKIT_URL_EXT:-$(from_env LIVEKIT_URL)}"
    LIVEKIT_ADMIN_URL="$(from_env LIVEKIT_ADMIN_URL)"
    ;;
  off) LIVEKIT_API_KEY=""; LIVEKIT_API_SECRET=""; LIVEKIT_URL=""; LIVEKIT_ADMIN_URL="" ;;
esac

# On the host's own network, this machine's LiveKit is a loopback address away.
# Going out to the public name and back is wasted work at best, and fails on a
# router without NAT loopback.
if [ -n "$HOST_NETWORK" ] && [ "$VOICE" = "external" ] && [ -z "$LIVEKIT_ADMIN_URL" ]; then
  LIVEKIT_ADMIN_URL="http://127.0.0.1:7880"
fi

# Caught here, rather than as a container that starts and cannot find a database.
[ "$MONGO" != "external" ] || [ -n "$MONGO_URI" ] ||
  die "--mongo-external needs the address: pass --from-env with a file that has MONGO_URI, or --mongo-uri"
[ "$VOICE" != "external" ] || [ -n "$LIVEKIT_URL" ] ||
  die "--voice-external needs LIVEKIT_URL and its key pair: pass --from-env, or the --livekit-* flags"

# ── Which pieces run here ────────────────────────────────────────────────────
COMPOSE_FILE="compose.yaml"
[ "$MONGO" = "bundled" ] && COMPOSE_FILE="$COMPOSE_FILE:compose.mongo.yaml"
[ "$VOICE" = "bundled" ] && COMPOSE_FILE="$COMPOSE_FILE:compose.livekit.yaml"
if [ -n "$HOST_NETWORK" ]; then
  COMPOSE_FILE="$COMPOSE_FILE:compose.host.yaml"
elif [ "$PROXY" = "bundled" ]; then
  COMPOSE_FILE="$COMPOSE_FILE:compose.caddy.yaml"
else
  COMPOSE_FILE="$COMPOSE_FILE:compose.external-proxy.yaml"
fi

# ── Write it down ────────────────────────────────────────────────────────────
mkdir -p "$SKYCORD_DIR/backups" "$SKYCORD_DIR/tls" "$SKYCORD_DIR/templates"
chmod 700 "$SKYCORD_DIR"

if [ -n "$TLS_CERT" ]; then
  install -m 0644 "$TLS_CERT" "$SKYCORD_DIR/tls/origin.pem"
  install -m 0600 "$TLS_KEY"  "$SKYCORD_DIR/tls/origin.key"
fi

umask 077
cat > "$SKYCORD_DIR/.env" <<ENVEOF
# Skycord — written by the installer. Secrets live here; keep it to yourself.
# Change things with: sudo skycord config
SKYCORD_VERSION=$VERSION
COMPOSE_FILE=$COMPOSE_FILE

DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
CLIENT_ORIGIN=https://$DOMAIN
APP_URL=https://$DOMAIN
PORT=3001

MONGO_URI=$MONGO_URI
MONGO_ROOT_USER=$MONGO_ROOT_USER
MONGO_ROOT_PASSWORD=$MONGO_ROOT_PASSWORD
MONGO_APP_USER=$MONGO_APP_USER
MONGO_APP_PASSWORD=$MONGO_APP_PASSWORD

JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

LIVEKIT_URL=$LIVEKIT_URL
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
LIVEKIT_ADMIN_URL=$LIVEKIT_ADMIN_URL
LIVEKIT_UDP_PORT=$LIVEKIT_UDP_PORT
LIVEKIT_TCP_PORT=7881

KLIPY_API_KEY=$KLIPY_API_KEY
RESEND_API_KEY=$RESEND_API_KEY
EMAIL_FROM=$EMAIL_FROM

# true only behind Cloudflare with the origin firewalled to its addresses.
# Anywhere else this header can be forged, and a session would show a made-up
# address in Settings -> Devices.
TRUST_CF_IP=${CLOUDFLARE:+true}
TLS_CERT_FILE=${TLS_CERT:+/etc/skycord-tls/origin.pem}
ENVEOF
chmod 600 "$SKYCORD_DIR/.env"
umask 022

# ── The release ──────────────────────────────────────────────────────────────
say ""
say "Fetching the release..."
if [ -z "$VERSION" ]; then
  VERSION="$(curl -fsSL "https://api.github.com/repos/$SKYCORD_REPO/releases/latest" \
    | grep -o '"tag_name"[ ]*:[ ]*"[^"]*"' | head -1 | cut -d'"' -f4)"
  [ -n "$VERSION" ] || die "could not reach GitHub to find the newest release — try again, or pass --version"
  sed -i "s|^SKYCORD_VERSION=.*|SKYCORD_VERSION=$VERSION|" "$SKYCORD_DIR/.env"
fi

if [ -n "${SKYCORD_LOCAL_FILES:-}" ]; then
  install -m 0755 "$SKYCORD_LOCAL_FILES/skycord" /usr/local/bin/skycord
else
  curl -fsSL "https://github.com/$SKYCORD_REPO/releases/download/$VERSION/skycord" -o /usr/local/bin/skycord \
    || die "could not download the skycord command for $VERSION"
  chmod 0755 /usr/local/bin/skycord
fi

# The command owns downloading, checksums and rendering, so there is one copy
# of each of those, used by the install and by every update after it.
export SKYCORD_DIR SKYCORD_REPO
# shellcheck source=/dev/null
source /usr/local/bin/skycord
fetch_release "$VERSION" "$SKYCORD_DIR/templates"

install -m 0644 "$SKYCORD_DIR/templates/skycord-backup.service" /etc/systemd/system/ 2>/dev/null || true
for unit in skycord-backup.service skycord-backup.timer skycord-update.service skycord-update.timer; do
  [ -f "$SKYCORD_DIR/templates/$unit" ] && install -m 0644 "$SKYCORD_DIR/templates/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload 2>/dev/null || true
systemctl enable --now skycord-backup.timer 2>/dev/null || warn "could not enable the nightly backup timer"

# ── Start ────────────────────────────────────────────────────────────────────
say "Starting..."
apply_templates
(
  cd "$SKYCORD_DIR" || die "cannot enter $SKYCORD_DIR"
  # Quietly first; if that fails, again loudly, so the reason is on screen.
  docker compose pull -q 2>/dev/null || docker compose pull
  docker compose up -d
)

if wait_healthy "$VERSION"; then
  say "Skycord is running."
else
  warn "the app has not reported healthy yet — check: sudo skycord logs skycord"
fi

if [ "$PROXY" = "bundled" ]; then
  say "Waiting for the certificate..."
  for _ in $(seq 1 30); do
    curl -fsSk "https://$DOMAIN/health" >/dev/null 2>&1 && break
    sleep 4
  done
  if curl -fsS "https://$DOMAIN/health" >/dev/null 2>&1; then
    say ""
    say "  https://$DOMAIN is up."
  elif curl -fsSk "https://$DOMAIN/health" >/dev/null 2>&1; then
    # Expected for a Cloudflare origin certificate, and for localhost, where
    # Caddy signs with its own authority. Neither is a fault.
    say ""
    say "  https://$DOMAIN is up, behind a certificate this machine does not"
    say "  trust itself. A browser is the thing to believe here."
  else
    say ""
    warn "https://$DOMAIN did not answer yet. The usual causes, in order:"
    warn "  1. the address does not point at this machine yet (DNS)"
    warn "  2. port 80 is blocked, so the certificate check cannot arrive"
    warn "  3. Cloudflare's proxy is on without an origin certificate"
    warn "Fix it and run: sudo skycord apply"
  fi
else
  cat <<'NGINX'

Skycord is listening on 127.0.0.1:3001. Point your web server at it — one
block, forwarding everything, because the app serves its own files now:

  server {
      listen 443 ssl;
      server_name YOUR-DOMAIN;
      # your ssl_certificate lines here

      location / {
          proxy_pass http://127.0.0.1:3001;
          proxy_http_version 1.1;
          proxy_set_header Host              $host;
          proxy_set_header X-Real-IP         $remote_addr;
          proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_set_header Upgrade           $http_upgrade;
          proxy_set_header Connection        "upgrade";
          proxy_read_timeout 7d;
      }
  }
NGINX
fi

if [ "$VOICE" = "bundled" ]; then
  say ""
  say "Voice needs two ports open to this machine: ${LIVEKIT_UDP_PORT}/udp and 7881/tcp."
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    if [ -n "$ASSUME_YES" ] || [ "$(ask 'ufw is active. Open 80, 443, 7881/tcp and the UDP port? [Y/n] ' y)" != "n" ]; then
      ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
      ufw allow 7881/tcp >/dev/null && ufw allow "${LIVEKIT_UDP_PORT}/udp" >/dev/null
      say "Opened. SSH rules were not touched."
    fi
  fi
fi

cat <<SUMMARY

Installed $VERSION in $SKYCORD_DIR

  sudo skycord status      version, health, backups, updates
  sudo skycord update      update, with a backup and automatic rollback
  sudo skycord config      change settings
  sudo skycord logs -f     watch what it is doing

Open https://$DOMAIN and register. The first account is an ordinary account:
there is no admin tier yet.
SUMMARY
