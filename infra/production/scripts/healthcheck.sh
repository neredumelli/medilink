#!/usr/bin/env bash
# Every 5 minutes (timer): disk space, containers, HTTPS certificate, database archiving and backup age.
# Alerts once per problem every 6 hours, and says when a problem is fixed.
. "$(dirname "$0")/lib.sh"

problems=()
add() { problems+=("$1|$2"); }   # key|message

# Disk: warn at 70%, critical at 85%.
for mount in / /var/lib/docker; do
  [ -d "$mount" ] || continue
  use=$(df -P "$mount" | awk 'NR==2 {gsub("%","",$5); print $5}')
  if [ "$use" -ge 85 ]; then add "disk-crit-$mount" "🚨 Disk $mount is ${use}% full. Free space now (see runbook 'Disk full')."
  elif [ "$use" -ge 70 ]; then add "disk-warn-$mount" "⚠️ Disk $mount is ${use}% full."
  fi
done

# Containers: all four must be running (and healthy where they have a health check).
for svc in postgres api web caddy; do
  state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "medilink-$svc-1" 2>/dev/null || echo "missing")
  case "$state" in
    "running healthy"|"running "|"running") ;;
    *) add "svc-$svc" "🚨 $svc is not healthy ($state). Docker restarts it by itself; if this repeats, see runbook 'API crashes'." ;;
  esac
done

# HTTPS certificate (Caddy renews by itself ~30 days before expiry; this catches renewals that fail).
if command -v openssl >/dev/null; then
  end=$(echo | timeout 10 openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$end" ]; then
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    [ "$days" -lt 14 ] && add "cert" "⚠️ HTTPS certificate for $DOMAIN expires in $days days and has not renewed."
  else
    add "cert-read" "⚠️ Could not read the HTTPS certificate on this server."
  fi
fi

# Continuous database archiving (point-in-time restore depends on it).
arch=$(psql_ml -tAc "SELECT coalesce(failed_count,0), coalesce(extract(epoch FROM last_failed_time)::bigint,0), coalesce(extract(epoch FROM last_archived_time)::bigint,0) FROM pg_stat_archiver" 2>/dev/null | tr '|' ' ')
if [ -n "$arch" ]; then
  read -r _failed lastfail lastok <<<"$arch"
  if [ "$lastfail" -gt "$lastok" ]; then add "archive" "🚨 Database change archiving is failing: point-in-time restore is at risk. Run: scripts/backup.sh list"; fi
fi

# Backup age.
older_than() { local f="$ML_STATE/$1"; [ ! -f "$f" ] && return 0; [ $(( $(date +%s) - $(date -d "$(cat "$f")" +%s) )) -gt "$2" ]; }
older_than last-db-backup $((26 * 3600)) && add "db-backup-age" "⚠️ No database backup in the last 26 hours."
[ -n "${RESTIC_PASSWORD:-}" ] && older_than last-file-backup $((26 * 3600)) && add "file-backup-age" "⚠️ No file backup in the last 26 hours."
older_than last-restore-test $((35 * 86400)) && add "restore-test-age" "⚠️ The monthly restore test has not passed in 35 days."

# Alert once per problem per 6 hours; tell when it clears.
seen="$ML_STATE/alerts"; mkdir -p "$seen"
now=$(date +%s)
active=()
for p in "${problems[@]+"${problems[@]}"}"; do
  key="${p%%|*}"; msg="${p#*|}"; safe="${key//\//_}"; active+=("$safe")
  last=$(cat "$seen/$safe" 2>/dev/null || echo 0)
  if [ $(( now - last )) -ge 21600 ]; then alert "$msg"; echo "$now" > "$seen/$safe"; fi
  log "$msg"
done
for f in "$seen"/*; do
  [ -e "$f" ] || continue
  k="$(basename "$f")"
  if [[ ! " ${active[*]+"${active[*]}"} " =~ " $k " ]]; then alert "✅ Fixed: $k"; rm -f "$f"; fi
done

[ ${#problems[@]} -eq 0 ] && kuma_push "${KUMA_PUSH_HEALTH:-}" "all good"
exit 0
