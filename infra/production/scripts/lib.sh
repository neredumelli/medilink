#!/usr/bin/env bash
# Shared helpers for the MediLink operations scripts. Sourced, not run.
set -euo pipefail

ML_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ML_ENV="$ML_DIR/.env"
ML_STATE="$ML_DIR/.state"
mkdir -p "$ML_STATE"

[ -f "$ML_ENV" ] || { echo "Missing $ML_ENV. Run scripts/install.sh first." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ML_ENV"
set +a

dc() { docker compose --project-directory "$ML_DIR" -f "$ML_DIR/compose.yml" --env-file "$ML_ENV" "$@"; }

log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; alert "❌ $*"; exit 1; }

# Sends a message to the team: Telegram and/or any webhook (Slack, Google Chat, Discord, n8n…).
alert() {
  local msg="MediLink ${DOMAIN:-}: $*"
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS -m 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${msg}" >/dev/null 2>&1 || true
  fi
  if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
    curl -fsS -m 10 -H 'content-type: application/json' \
      -d "$(printf '{"text":%s}' "$(printf '%s' "$msg" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" \
      "$ALERT_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
  logger -t medilink "$msg" 2>/dev/null || true
}

# Tells Uptime Kuma a job succeeded ("push" monitor). If the ping stops, Kuma raises the alarm.
kuma_push() {
  local url="${1:-}"; shift || true
  [ -n "$url" ] || return 0
  curl -fsS -m 10 -G "$url" --data-urlencode "status=up" --data-urlencode "msg=${*:-ok}" >/dev/null 2>&1 || true
}

# Waits until users can really reach MediLink: the API (and so the database) and the website answer
# inside the stack, and both answer through Caddy over HTTPS.
#   wait_healthy [seconds] [edge|internal]   internal = skip the HTTPS check (certificate or DNS not ready yet)
wait_healthy() {
  local timeout="${1:-120}" mode="${2:-edge}" waited=0
  local edge=(curl -kfsS -m 5 --resolve "${DOMAIN}:443:127.0.0.1" -o /dev/null)
  while [ "$waited" -lt "$timeout" ]; do
    if dc exec -T api wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1 \
      && dc exec -T web wget -q --spider http://127.0.0.1:3000/login >/dev/null 2>&1 \
      && { [ "$mode" = internal ] || { "${edge[@]}" "https://${DOMAIN}/api/health" 2>/dev/null && "${edge[@]}" "https://${DOMAIN}/login" 2>/dev/null; }; }; then
      return 0
    fi
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

current_version() { grep -E '^MEDILINK_VERSION=' "$ML_ENV" | tail -1 | cut -d= -f2-; }

set_version() {
  local v="$1"
  if grep -qE '^MEDILINK_VERSION=' "$ML_ENV"; then
    sed -i.bak -E "s|^MEDILINK_VERSION=.*|MEDILINK_VERSION=${v}|" "$ML_ENV" && rm -f "$ML_ENV.bak"
  else
    echo "MEDILINK_VERSION=${v}" >> "$ML_ENV"
  fi
  export MEDILINK_VERSION="$v"
}

pgbr() { dc exec -T -u postgres postgres pgbackrest --stanza=medilink "$@"; }
psql_ml() { dc exec -T postgres psql -U medilink -d medilink -v ON_ERROR_STOP=1 "$@"; }
offsite_enabled() { [ -n "${BACKUP_S3_BUCKET:-}" ]; }
