#!/bin/sh
# Writes /etc/pgbackrest/pgbackrest.conf from environment variables.
#   repo1 = on this server (fast restores)                 kept: 2 full weeks + 7 daily differentials
#   repo2 = off-site object storage (S3, R2, B2, Wasabi…)   kept: BACKUP_OFFSITE_DAYS (default 90), encrypted
set -eu
CONF=/etc/pgbackrest/pgbackrest.conf
{
  echo "[global]"
  echo "repo1-path=/var/lib/pgbackrest"
  echo "repo1-retention-full=2"
  echo "repo1-retention-diff=7"
  if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
    echo "repo2-type=s3"
    echo "repo2-path=${BACKUP_S3_PATH:-/medilink}"
    echo "repo2-s3-bucket=${BACKUP_S3_BUCKET}"
    echo "repo2-s3-endpoint=${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is needed with BACKUP_S3_BUCKET}"
    echo "repo2-s3-region=${BACKUP_S3_REGION:-auto}"
    echo "repo2-s3-key=${BACKUP_S3_KEY:?BACKUP_S3_KEY is needed}"
    echo "repo2-s3-key-secret=${BACKUP_S3_SECRET:?BACKUP_S3_SECRET is needed}"
    echo "repo2-s3-uri-style=${BACKUP_S3_URI_STYLE:-path}"
    echo "repo2-cipher-type=aes-256-cbc"
    echo "repo2-cipher-pass=${BACKUP_CIPHER_PASS:?BACKUP_CIPHER_PASS is needed to encrypt off-site backups}"
    echo "repo2-retention-full-type=time"
    echo "repo2-retention-full=${BACKUP_OFFSITE_DAYS:-90}"
    echo "repo2-bundle=y"
  fi
  echo "compress-type=zst"
  echo "process-max=2"
  echo "start-fast=y"
  echo "archive-async=y"
  echo "spool-path=/var/spool/pgbackrest"
  echo "log-level-console=info"
  echo "log-level-file=detail"
  echo ""
  echo "[medilink]"
  echo "pg1-path=/var/lib/postgresql/data"
  echo "pg1-socket-path=/var/run/postgresql"
  echo "pg1-user=${POSTGRES_USER:-medilink}"
  echo "pg1-database=${POSTGRES_DB:-medilink}"
} > "$CONF.tmp"
chmod 600 "$CONF.tmp"
if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$CONF.tmp"; fi
mv "$CONF.tmp" "$CONF"
