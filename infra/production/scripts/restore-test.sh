#!/usr/bin/env bash
# Proves the backups work: restores the newest backup into a throw-away database and checks it.
# Runs monthly from a timer; alerts if anything fails. Does not touch the live database.
. "$(dirname "$0")/lib.sh"

repo=1; offsite_enabled && repo=2
stamp="$(date +%Y%m%d%H%M%S)"
vol="medilink_restoretest_$stamp"
name="medilink-restoretest-$stamp"
image="${MEDILINK_REGISTRY:-ghcr.io/neredumelli}/medilink-postgres:${MEDILINK_PG_VERSION:-$(current_version)}"
envs=()
for k in BACKUP_S3_BUCKET BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_S3_KEY BACKUP_S3_SECRET BACKUP_S3_PATH BACKUP_S3_URI_STYLE BACKUP_CIPHER_PASS BACKUP_OFFSITE_DAYS; do
  envs+=(-e "$k=${!k:-}")
done
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$vol" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() {
  log "FAILED: $*"
  docker logs "$name" 2>&1 | grep -v "archive-get command begin\|archive-get command end" | tail -40 | sed 's/^/  restored-db | /' || true
  alert "❌ Monthly restore test FAILED: $*"
  exit 1
}

log "Restore test: restoring the newest backup from repo $repo into a scratch database…"
docker volume create "$vol" >/dev/null
docker run --rm --network none -u postgres "${envs[@]}" -e POSTGRES_USER=medilink -e POSTGRES_DB=medilink \
  -v "$vol":/var/lib/postgresql/data -v medilink_pgbackrest:/var/lib/pgbackrest \
  --entrypoint sh "$image" -c "write-pgbackrest-conf.sh && pgbackrest --stanza=medilink --repo=$repo --archive-mode=off restore" \
  || fail "pgBackRest could not restore"

log "Starting the restored copy (it replays changes up to the newest archived one)…"
docker run -d --name "$name" --network none "${envs[@]}" -e POSTGRES_USER=medilink -e POSTGRES_PASSWORD=unused \
  -v "$vol":/var/lib/postgresql/data -v medilink_pgbackrest:/var/lib/pgbackrest:ro \
  "$image" postgres -c archive_mode=off -c listen_addresses='' >/dev/null || fail "restored database did not start"

for _ in $(seq 1 200); do
  [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = true ] || fail "restored database stopped during recovery"
  if docker exec "$name" psql -U medilink -d medilink -tAc "SELECT NOT pg_is_in_recovery()" 2>/dev/null | grep -q t; then break; fi
  sleep 3
done
docker exec "$name" psql -U medilink -d medilink -tAc "SELECT NOT pg_is_in_recovery()" 2>/dev/null | grep -q t || fail "restored database did not finish recovery"

q() { docker exec "$name" psql -U medilink -d medilink -tAc "$1" 2>/dev/null; }
live() { psql_ml -tAc "$1" 2>/dev/null; }
migrations_backup="$(q 'SELECT count(*) FROM "_prisma_migrations"')"
migrations_live="$(live 'SELECT count(*) FROM "_prisma_migrations"')"
orders_backup="$(q 'SELECT count(*) FROM "Order"')"
orders_live="$(live 'SELECT count(*) FROM "Order"')"
products_backup="$(q 'SELECT count(*) FROM "Product"')"
[ -n "$orders_backup" ] && [ -n "$products_backup" ] || fail "restored database has no MediLink tables"
[ "$migrations_backup" = "$migrations_live" ] || fail "restored schema version ($migrations_backup) differs from live ($migrations_live)"
# The copy may be a few minutes behind live, never ahead.
[ "$orders_backup" -le "$orders_live" ] || fail "restored copy has more orders than live, which should be impossible"
missing=$(( orders_live - orders_backup ))

msg="Restore test passed (repo $repo): $products_backup medicines, $orders_backup orders ($missing newer orders not yet archived)."
log "$msg"
date -u +%FT%TZ > "$ML_STATE/last-restore-test"
kuma_push "${KUMA_PUSH_RESTORE_TEST:-}" "$msg"
[ "${QUIET_SUCCESS:-}" = "1" ] || alert "✅ $msg"
