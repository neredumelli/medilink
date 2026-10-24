#!/bin/sh
# Prepares pgBackRest (config + folders) and then starts PostgreSQL through the official entrypoint.
set -eu
write-pgbackrest-conf.sh
chown -R postgres:postgres /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest 2>/dev/null || true
exec docker-entrypoint.sh "$@"
