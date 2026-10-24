#!/usr/bin/env bash
# One-command install of MediLink on a fresh Ubuntu 22.04 / 24.04 server.
#
#   sudo infra/production/scripts/install.sh            asks a few questions, then does everything
#   sudo infra/production/scripts/install.sh --build    builds the images here instead of downloading them
#
# What it does: installs Docker, opens only ports 22/80/443, writes .env with strong random secrets,
# starts PostgreSQL with continuous backup, applies the database, starts the app behind HTTPS,
# takes the first backups, schedules backups / health checks / monthly restore tests, and creates
# the first super admin. Safe to run again: it keeps existing secrets and data.
#
# For automated installs set ML_NONINTERACTIVE=1 and provide the answers as environment variables
# (DOMAIN, ACME_EMAIL, MSG91_AUTH_KEY, …). ML_SKIP_SYSTEM=1 skips Docker/firewall/timer setup.
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ML_ENV="$ML_DIR/.env"
MODE="${1:-pull}"
NONINTERACTIVE="${ML_NONINTERACTIVE:-0}"
SKIP_SYSTEM="${ML_SKIP_SYSTEM:-0}"

say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
ask() { # ask VAR "Question" "default"
  local var="$1" q="$2" def="${3:-}" cur="${!1:-}"
  [ -n "$cur" ] && def="$cur"
  if [ "$NONINTERACTIVE" = "1" ]; then printf -v "$var" '%s' "$def"; return; fi
  local ans; read -r -p "$q${def:+ [$def]}: " ans
  printf -v "$var" '%s' "${ans:-$def}"
}
secret() { openssl rand -hex 32; }

# ------------------------------------------------------------------ 1. the machine
if [ "$SKIP_SYSTEM" != "1" ]; then
  [ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
  say "Preparing the server"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg openssl ufw unattended-upgrades python3 >/dev/null
  if ! command -v docker >/dev/null; then
    say "Installing Docker Engine"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  fi
  # Container logs rotate so they can never fill the disk.
  if [ ! -f /etc/docker/daemon.json ]; then
    printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "20m", "max-file": "5" },\n  "live-restore": true\n}\n' > /etc/docker/daemon.json
    systemctl restart docker
  fi
  systemctl enable --now docker >/dev/null
  # Firewall: only SSH and the web.
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  # Security updates for the operating system install themselves.
  dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true
fi

# ------------------------------------------------------------------ 2. settings (.env)
say "Settings"
if [ -f "$ML_ENV" ]; then
  set -a; . "$ML_ENV"; set +a
  echo "Using existing $ML_ENV (secrets are kept)."
fi
ask DOMAIN "Web address for MediLink (DNS must point to this server), e.g. app.example.in"
ask ACME_EMAIL "Email for HTTPS certificate notices"
ask SUPPORT_PHONE "Support phone number shown to users" ""
ask MSG91_AUTH_KEY "MSG91 auth key (for login OTP SMS)"
ask MSG91_TEMPLATE_ID "MSG91 DLT template id for the OTP"
ask STATUS_PAGE_URL "Public status page address (Uptime Kuma, on another machine)" "https://status.${DOMAIN#*.}"
ask TELEGRAM_BOT_TOKEN "Telegram bot token for alerts (optional)" ""
ask TELEGRAM_CHAT_ID "Telegram chat id for alerts (optional)" ""
ask ALERT_WEBHOOK_URL "Other alert webhook URL, e.g. Slack/Google Chat (optional)" ""
ask BACKUP_S3_BUCKET "Off-site backup bucket (S3, Cloudflare R2, Backblaze B2, Wasabi…) (optional but strongly advised)" ""
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  ask BACKUP_S3_ENDPOINT "Off-site storage endpoint host, e.g. s3.ap-south-1.amazonaws.com"
  ask BACKUP_S3_REGION "Off-site storage region" "ap-south-1"
  ask BACKUP_S3_KEY "Off-site storage access key"
  ask BACKUP_S3_SECRET "Off-site storage secret key"
fi
ask MEDILINK_REGISTRY "Image registry" "ghcr.io/neredumelli"
ask MEDILINK_VERSION "MediLink version to install" "$(git -C "$ML_DIR" describe --tags --always 2>/dev/null || echo latest)"

for k in DOMAIN ACME_EMAIL; do [ -n "${!k:-}" ] || { echo "$k is required." >&2; exit 1; }; done
[ -n "${MSG91_AUTH_KEY:-}" ] && [ -n "${MSG91_TEMPLATE_ID:-}" ] || warn "Without MSG91 keys nobody can receive login OTPs. Add them to $ML_ENV later and run: docker compose up -d api"

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(secret)}"
JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(secret)}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(secret)}"
DATA_ENCRYPTION_KEY="${DATA_ENCRYPTION_KEY:-$(secret)}"
BACKUP_CIPHER_PASS="${BACKUP_CIPHER_PASS:-$(secret)}"
RESTIC_PASSWORD="${RESTIC_PASSWORD:-$(secret)}"
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-s3:https://${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/restic}"
else
  RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-/backup/restic}"
fi
MEDILINK_PG_VERSION="${MEDILINK_PG_VERSION:-$MEDILINK_VERSION}"

umask 077
cat > "$ML_ENV" <<ENV
# MediLink production settings. Keep this file secret: it holds every password.
# A copy is included (encrypted) in the file backups; ALSO keep the two backup passwords below
# somewhere safe off this server (password manager). Without them the off-site backups cannot be read.

DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
SUPPORT_PHONE=${SUPPORT_PHONE:-}
STATUS_PAGE_URL=${STATUS_PAGE_URL:-}

MEDILINK_REGISTRY=$MEDILINK_REGISTRY
MEDILINK_VERSION=$MEDILINK_VERSION
MEDILINK_PG_VERSION=$MEDILINK_PG_VERSION

POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
DATA_ENCRYPTION_KEY=$DATA_ENCRYPTION_KEY

OTP_PROVIDER=${OTP_PROVIDER:-msg91}
MSG91_AUTH_KEY=${MSG91_AUTH_KEY:-}
MSG91_TEMPLATE_ID=${MSG91_TEMPLATE_ID:-}

# Alerts
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID:-}
ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL:-}
# Uptime Kuma "push" monitor URLs: each job pings its URL when it succeeds
KUMA_PUSH_DB_BACKUP=${KUMA_PUSH_DB_BACKUP:-}
KUMA_PUSH_FILE_BACKUP=${KUMA_PUSH_FILE_BACKUP:-}
KUMA_PUSH_RESTORE_TEST=${KUMA_PUSH_RESTORE_TEST:-}
KUMA_PUSH_HEALTH=${KUMA_PUSH_HEALTH:-}

# Backups
BACKUP_S3_BUCKET=${BACKUP_S3_BUCKET:-}
BACKUP_S3_ENDPOINT=${BACKUP_S3_ENDPOINT:-}
BACKUP_S3_REGION=${BACKUP_S3_REGION:-auto}
BACKUP_S3_KEY=${BACKUP_S3_KEY:-}
BACKUP_S3_SECRET=${BACKUP_S3_SECRET:-}
BACKUP_S3_PATH=${BACKUP_S3_PATH:-/medilink}
BACKUP_OFFSITE_DAYS=${BACKUP_OFFSITE_DAYS:-90}
BACKUP_CIPHER_PASS=$BACKUP_CIPHER_PASS
RESTIC_REPOSITORY=$RESTIC_REPOSITORY
RESTIC_PASSWORD=$RESTIC_PASSWORD

# Tuning
DB_POOL_SIZE=${DB_POOL_SIZE:-30}
PG_SHARED_BUFFERS=${PG_SHARED_BUFFERS:-512MB}
ENV
umask 022
chmod 600 "$ML_ENV"

. "$ML_DIR/scripts/lib.sh"

# ------------------------------------------------------------------ 3. images
say "Getting MediLink $MEDILINK_VERSION"
case "$MODE" in
  --build) dc build ;;
  --local) ;;
  *) dc pull postgres api web caddy || { warn "Could not download images. If the registry is private run: docker login ghcr.io  (or use --build)"; exit 1; } ;;
esac

# ------------------------------------------------------------------ 4. database + backups
say "Starting the database"
dc up -d postgres
for _ in $(seq 1 60); do dc exec -T postgres pg_isready -U medilink -d medilink >/dev/null 2>&1 && break; sleep 2; done
pgbr stanza-create >/dev/null 2>&1 || pgbr stanza-upgrade >/dev/null 2>&1 || true
pgbr check || die "Database backup setup failed (pgBackRest check)"

say "Applying the database"
dc run --rm --no-deps -T api npx prisma migrate deploy

# ------------------------------------------------------------------ 5. the app
say "Starting MediLink"
dc up -d api web caddy
wait_healthy 180 internal || die "MediLink did not start. See: docker compose -f $ML_DIR/compose.yml logs api"
if ! wait_healthy 120; then
  warn "MediLink is running, but https://$DOMAIN does not answer yet. Check that DNS points to this server and ports 80/443 are open; Caddy keeps trying to get the certificate by itself."
fi

say "First backups"
[ -f "$ML_STATE/last-db-backup" ] || "$ML_DIR/scripts/backup.sh" db full
"$ML_DIR/scripts/backup.sh" files

# ------------------------------------------------------------------ 6. schedules
if [ "$SKIP_SYSTEM" != "1" ]; then
  say "Scheduling backups, health checks and restore tests"
  unit() { # unit name "description" "command" "OnCalendar"
    cat > "/etc/systemd/system/medilink-$1.service" <<UNIT
[Unit]
Description=MediLink: $2
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=$3
UNIT
    cat > "/etc/systemd/system/medilink-$1.timer" <<UNIT
[Unit]
Description=MediLink: $2 (schedule)

[Timer]
OnCalendar=$4
Persistent=true
RandomizedDelaySec=120

[Install]
WantedBy=timers.target
UNIT
  }
  unit backup-db-diff "daily database backup" "$ML_DIR/scripts/backup.sh db diff" "Mon..Sat *-*-* 01:30:00 Asia/Kolkata"
  unit backup-db-full "weekly full database backup" "$ML_DIR/scripts/backup.sh db full" "Sun *-*-* 01:30:00 Asia/Kolkata"
  unit backup-files "daily file backup" "$ML_DIR/scripts/backup.sh files" "*-*-* 03:15:00 Asia/Kolkata"
  unit restore-test "monthly restore test" "$ML_DIR/scripts/restore-test.sh" "*-*-01 04:00:00 Asia/Kolkata"
  unit healthcheck "health check" "$ML_DIR/scripts/healthcheck.sh" "*:0/5"
  systemctl daemon-reload
  for t in backup-db-diff backup-db-full backup-files restore-test healthcheck; do systemctl enable --now "medilink-$t.timer" >/dev/null; done
  # Run the first restore test now (in the background) so the backups are proven from day one.
  systemctl start --no-block medilink-restore-test.service
fi

# ------------------------------------------------------------------ 7. first admin
admins=$(psql_ml -tAc "SELECT count(*) FROM \"User\" WHERE role = 'SUPER_ADMIN'" | tr -d '[:space:]')
if [ "$admins" = "0" ]; then
  if [ "$NONINTERACTIVE" = "1" ]; then
    [ -n "${ADMIN_MOBILE:-}" ] && "$ML_DIR/scripts/create-admin.sh" "$ADMIN_MOBILE" "${ADMIN_NAME:-Platform Admin}"
  else
    say "First super admin"
    read -r -p "Mobile number (10 digits): " ADMIN_MOBILE
    read -r -p "Name: " ADMIN_NAME
    "$ML_DIR/scripts/create-admin.sh" "$ADMIN_MOBILE" "$ADMIN_NAME"
  fi
fi

say "MediLink is live at https://$DOMAIN"
cat <<DONE
  • Log in as the super admin, then set up 2-step login (required).
  • Save these two passwords in your password manager NOW (needed to read backups on a new server):
      BACKUP_CIPHER_PASS and RESTIC_PASSWORD   (in $ML_ENV)
  • Status page: set up Uptime Kuma on a second machine (infra/production/status/README.md).
  • Deploy a new version:   $ML_DIR/scripts/deploy.sh <version>
  • Roll back:              $ML_DIR/scripts/rollback.sh
  • Runbooks:               docs/runbooks.md
DONE
if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  warn "WARNING: backups are only on this server. If the server is lost, so are they. Add off-site storage in $ML_ENV and run install.sh again."
fi
