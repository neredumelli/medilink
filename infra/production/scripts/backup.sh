#!/usr/bin/env bash
# Backups.
#   backup.sh db [full|diff|incr]   database (pgBackRest) to this server and, if set up, off-site
#   backup.sh files                 uploaded documents + settings (restic): 7 daily, 4 weekly, 12 monthly
#   backup.sh quick                 fast database backup taken before every deploy (this server only)
#   backup.sh list                  what backups exist
# Run on a schedule by the systemd timers that install.sh sets up.
. "$(dirname "$0")/lib.sh"

what="${1:-}"
case "$what" in
  db)
    type="${2:-diff}"
    log "Database backup ($type) to this server…"
    pgbr --type="$type" --repo=1 backup || die "Database backup ($type) to this server FAILED"
    if offsite_enabled; then
      log "Database backup ($type) off-site…"
      pgbr --type="$type" --repo=2 backup || die "Off-site database backup ($type) FAILED"
    fi
    pgbr --repo=1 expire >/dev/null 2>&1 || true
    date -u +%FT%TZ > "$ML_STATE/last-db-backup"
    kuma_push "${KUMA_PUSH_DB_BACKUP:-}" "db $type"
    log "Database backup done."
    ;;
  quick)
    log "Quick database backup before the change…"
    pgbr --type=incr --repo=1 backup || die "Pre-deploy database backup FAILED; nothing was changed"
    ;;
  files)
    [ -n "${RESTIC_PASSWORD:-}" ] || die "RESTIC_PASSWORD is not set in .env"
    if ! dc run --rm -T restic cat config >/dev/null 2>&1; then
      log "Creating the file backup repository…"
      dc run --rm -T restic init || die "Could not create the restic repository"
    fi
    log "Backing up uploaded documents and settings…"
    dc run --rm -T restic backup --host medilink --tag medilink /data/uploads /data/config /data/caddy || die "File backup FAILED"
    dc run --rm -T restic forget --host medilink --tag medilink --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune || die "File backup clean-up FAILED"
    # A light integrity check every run; a full data read on the 1st of the month.
    if [ "$(date +%d)" = "01" ]; then dc run --rm -T restic check --read-data-subset=10% || die "File backup check FAILED"; else dc run --rm -T restic check || die "File backup check FAILED"; fi
    date -u +%FT%TZ > "$ML_STATE/last-file-backup"
    kuma_push "${KUMA_PUSH_FILE_BACKUP:-}" "files"
    log "File backup done."
    ;;
  list)
    pgbr info
    [ -n "${RESTIC_PASSWORD:-}" ] && dc run --rm -T restic snapshots --compact || true
    ;;
  *)
    sed -n '2,8p' "$0"; exit 2 ;;
esac
