# Running MediLink in production

Everything needed to run MediLink on your own server: HTTPS, backups, restore, monitoring, deploys
and rollbacks. Open-source parts only (Caddy, PostgreSQL, pgBackRest, restic, Uptime Kuma, Docker Engine).

```
Internet ──► Caddy (HTTPS, rate limits, "back soon" page)
               ├─ /api/* ──► API (NestJS) ──► PostgreSQL ──► pgBackRest ──► this server + off-site storage
               └─ /*     ──► Website (Next.js)
           Uploaded files + settings ──► restic ──► off-site storage
Second machine: Uptime Kuma (outside checks, alerts, public status page)
```

## What you need

| Item | Notes |
|---|---|
| Main server | Ubuntu 22.04 or 24.04, 4 vCPU / 8 GB RAM / 80 GB SSD for launch (50k shops). Mumbai region for data residency. |
| Second small machine | 1 vCPU / 1 GB for Uptime Kuma (different provider or region). |
| Domain | e.g. `app.<brand>.in` → main server, `status.<brand>.in` → second machine. |
| Off-site storage | Any S3-compatible bucket (AWS S3 Mumbai, Cloudflare R2, Backblaze B2, Wasabi). |
| SMS | MSG91 account with a DLT-registered OTP template. |
| Alerts | A Telegram bot + group chat, and/or a Slack / Google Chat webhook. |

## Install (about 20 minutes)

```bash
# on the main server, as a sudo user
# private repository: use a read-only deploy key or a token with read access
git clone https://github.com/neredumelli/medilink.git /opt/medilink
cd /opt/medilink
# images are published to GitHub Packages by the "Release images" workflow; for a private repo:
docker login ghcr.io -u <github-user>      # password = a token with read:packages
sudo infra/production/scripts/install.sh   # or: install.sh --build  to build the images here
```

The installer asks for the domain, SMS keys, alert channels and off-site storage, generates every
password, starts everything, takes the first backups, schedules the jobs below and creates the first
super admin. Then:

1. Log in at `https://<domain>/login` as the super admin and set up 2-step login (required).
2. **Copy `BACKUP_CIPHER_PASS` and `RESTIC_PASSWORD` from `infra/production/.env` into your password
   manager.** Without them the off-site backups cannot be opened on a new server.
3. Set up the status machine: [status/README.md](status/README.md).

## Scheduled jobs (systemd timers, times in IST)

| Job | When | What |
|---|---|---|
| `medilink-healthcheck` | every 5 min | disk (alert at 70% / 85%), containers, HTTPS certificate, database archiving, backup age |
| `medilink-backup-db-diff` | Mon–Sat 01:30 | database differential backup, here and off-site |
| `medilink-backup-db-full` | Sun 01:30 | database full backup, here and off-site |
| `medilink-backup-files` | daily 03:15 | uploaded documents, settings and certificates (restic) |
| `medilink-restore-test` | 1st of month 04:00 | restores the newest backup into a scratch database and checks it |

Database changes are also archived continuously (at most 5 minutes behind), so the database can be
restored to **any minute**. See them with `systemctl list-timers 'medilink-*'`.

## Daily operations

| Task | Command (from `/opt/medilink/infra/production`) |
|---|---|
| Release a version | on GitHub: `git tag v0.3.0 && git push --tags` (builds images) |
| Deploy it | `scripts/deploy.sh v0.3.0` — backup → database changes → switch → health check → auto-rollback if unhealthy |
| Roll back | `scripts/rollback.sh` (previous) or `scripts/rollback.sh v0.2.0` |
| See backups | `scripts/backup.sh list` |
| Back up now | `scripts/backup.sh db full` · `scripts/backup.sh files` |
| Undo a mistake | `scripts/restore.sh db "2026-10-24 10:41:00+05:30"` |
| Prove backups | `scripts/restore-test.sh` |
| Add a super admin | `scripts/create-admin.sh 98xxxxxxxx "Name"` |
| Logs | `docker compose logs -f api` (each error has the reference code users quote, e.g. ML-7F3K2) |
| Maintenance mode | Admin › Settings › Maintenance mode (shops see a friendly message; carts are kept) |

Never run `docker compose down -v`: `-v` deletes the database volume.

## Targets

| | Target | How |
|---|---|---|
| Data loss (RPO) | ≤ 5 minutes | continuous archiving with `archive_timeout=300` |
| Back online (RTO) | ≤ 1 hour | `install.sh` on a new server + `restore.sh db latest --from-offsite` |
| Bad release | ~1 minute | automatic rollback on failed health check; `rollback.sh` |
| Backups proven | monthly | automatic restore test with alert |

Every one of these is exercised on each pull request by the **Production package** workflow, which
installs the whole stack on a fresh machine and runs the drills (app down page, backup, restore test,
point-in-time restore, deploy, broken release auto-rollback, manual rollback).

## Security notes

- Only ports 22, 80 and 443 are open. Use SSH keys and turn off password login (`PasswordAuthentication no`).
- Operating-system security updates install automatically (unattended-upgrades).
- Admins must use 2-step login; the super admin can limit admin screens to office IPs (Admin › Settings).
- Shops and distributors are isolated by PostgreSQL row-level security as well as by the app.
- `.env` is readable only by root. Rotate a leaked secret with runbook "Key leaked".

See **[docs/runbooks.md](../../docs/runbooks.md)** for step-by-step incident procedures.
