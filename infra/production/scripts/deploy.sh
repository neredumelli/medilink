#!/usr/bin/env bash
# Deploys a new version with a safety net.
#   deploy.sh <version>            pull images <registry>/medilink-*:<version> and switch to them
#   deploy.sh <version> --build    build the images on this server from the source checkout
#   deploy.sh <version> --local    images are already on this server (tests, air-gapped installs)
# Steps: backup → database changes → switch → health check. If the new version is not healthy within
# 2 minutes it switches back to the previous version by itself and alerts the team.
# Database changes must be "expand only" (add, never drop or rename in the same release), so the
# previous version keeps working after a rollback. See docs/runbooks.md › Database changes.
. "$(dirname "$0")/lib.sh"

new="${1:-}"; mode="${2:-pull}"
[ -n "$new" ] || { sed -n '2,9p' "$0"; exit 2; }
prev="$(current_version)"
[ "$new" = "$prev" ] && log "Version $new is already running; re-deploying it."

exec 9>"$ML_STATE/deploy.lock"
flock -n 9 || die "Another deploy or rollback is running"

log "Deploying $new (now: $prev)…"
case "$mode" in
  --build)
    MEDILINK_VERSION="$new" dc build api web caddy || die "Build of $new failed; nothing was changed" ;;
  --local) ;;
  *)
    MEDILINK_VERSION="$new" dc pull api web caddy || die "Could not download $new; nothing was changed" ;;
esac

"$(dirname "$0")/backup.sh" quick

log "Applying database changes…"
MEDILINK_VERSION="$new" dc run --rm --no-deps -T api npx prisma migrate deploy \
  || die "Database changes for $new failed. Still running $prev. The database is as it was (each change runs in a transaction); see runbooks if not."

echo "$prev" > "$ML_STATE/previous-version"
set_version "$new"
dc up -d --no-deps api web caddy

if wait_healthy 120; then
  echo "$new $(date -u +%FT%TZ)" >> "$ML_STATE/deploy-history"
  docker image prune -f >/dev/null 2>&1 || true
  log "✅ $new is live."
  alert "✅ Deployed $new (was $prev)"
  exit 0
fi

log "Version $new is not healthy. Rolling back to $prev…"
dc logs --no-color --tail 80 api web > "$ML_STATE/failed-deploy-$new.log" 2>&1 || true
set_version "$prev"
dc up -d --no-deps api web caddy
if wait_healthy 120; then
  alert "⚠️ Deploy of $new failed its health check and was rolled back to $prev automatically. Logs: $ML_STATE/failed-deploy-$new.log"
else
  alert "🚨 Deploy of $new failed AND rollback to $prev is not healthy. Follow runbook 'Bad release'."
fi
exit 1
