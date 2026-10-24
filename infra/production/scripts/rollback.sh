#!/usr/bin/env bash
# Switches back to the previous version (or the one given) in about a minute.
#   rollback.sh            previous version
#   rollback.sh <version>  a specific earlier version (its images must still be on this server or in the registry)
. "$(dirname "$0")/lib.sh"

exec 9>"$ML_STATE/deploy.lock"
flock -n 9 || die "A deploy or rollback is already running"

now="$(current_version)"
to="${1:-$(cat "$ML_STATE/previous-version" 2>/dev/null || true)}"
[ -n "$to" ] || die "No previous version recorded. Give one: rollback.sh <version>"
log "Rolling back from $now to $to…"
if ! docker image inspect "${MEDILINK_REGISTRY:-ghcr.io/neredumelli}/medilink-api:$to" >/dev/null 2>&1; then
  MEDILINK_VERSION="$to" dc pull api web caddy || die "Images for $to are not available"
fi
echo "$now" > "$ML_STATE/previous-version"
set_version "$to"
dc up -d --no-deps api web caddy
wait_healthy 120 || die "Version $to is not healthy after rollback. Check: docker compose logs api"
echo "$to $(date -u +%FT%TZ) rollback" >> "$ML_STATE/deploy-history"
alert "↩️ Rolled back from $now to $to"
log "✅ Running $to."
