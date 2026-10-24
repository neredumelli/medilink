#!/usr/bin/env bash
# Restore the database to a moment in time, or restore uploaded files.
#   restore.sh db latest                         newest data available
#   restore.sh db "2026-10-24 10:41:00+05:30"    just before a bad import or mistake
#   restore.sh db latest --from-offsite          on a new server, from the off-site copy
#   restore.sh files [snapshot-id|latest]        uploaded documents
# The app is stopped while the database is restored, then started and checked.
. "$(dirname "$0")/lib.sh"

what="${1:-}"; target="${2:-}"; shift 2 || true
repo=1
for a in "$@"; do [ "$a" = "--from-offsite" ] && repo=2; done

case "$what" in
  db)
    [ -n "$target" ] || { sed -n '2,7p' "$0"; exit 2; }
    [ "$repo" = 2 ] && ! offsite_enabled && die "Off-site backup is not set up in .env"
    echo "This replaces the live database with the backup ($target)."
    echo "Everything after that moment will be lost. The current database is kept aside first."
    if [ "${ML_YES:-}" != "1" ]; then read -r -p "Type RESTORE to continue: " ok; [ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }; fi
    alert "⚠️ Database restore started (target: $target)"
    dc stop caddy web api
    # Keep a safety copy of the current state in the backup repository (if the database still runs).
    pgbr --type=incr --repo=1 backup >/dev/null 2>&1 || log "Could not back up the current database (it may be damaged); continuing."
    dc stop postgres
    opts=(--stanza=medilink --repo="$repo" --delta)
    if [ "$target" != "latest" ]; then opts+=(--type=time "--target=$target" --target-action=promote); fi
    log "Restoring…"
    dc run --rm -T --no-deps -u postgres --entrypoint sh postgres -c "write-pgbackrest-conf.sh && pgbackrest ${opts[*]@Q} restore" \
      || die "Restore FAILED. The old database files may be partly replaced; run this script again with an earlier target."
    dc up -d postgres
    dc up -d api web caddy
    wait_healthy 180 internal || die "MediLink did not come back after the restore"
    # A restore starts a new timeline: take a fresh full backup so later restores have a clean base.
    "$(dirname "$0")/backup.sh" db full >/dev/null || true
    alert "✅ Database restored to $target. MediLink is running."
    log "Done."
    ;;
  files)
    snap="${target:-latest}"
    [ -n "${RESTIC_PASSWORD:-}" ] || die "RESTIC_PASSWORD is not set"
    log "Restoring uploaded documents from snapshot $snap…"
    # Files come back into the live uploads volume; files that exist now but not in the snapshot are kept.
    dc run --rm -T -v medilink_uploads:/restore --entrypoint sh restic -c \
      'restic restore "$1" --host medilink --include /data/uploads --target /restore/.restore-tmp && cp -a /restore/.restore-tmp/data/uploads/. /restore/ && rm -rf /restore/.restore-tmp' \
      _ "$snap" || die "File restore FAILED"
    log "Files restored into the uploads volume."
    ;;
  *)
    sed -n '2,7p' "$0"; exit 2 ;;
esac
