# MediLink runbooks

Step-by-step procedures for incidents. Commands run on the main server from
`/opt/medilink/infra/production` unless stated. Every runbook ends with: update the status page,
then write a short root-cause note within 48 hours.

**First 5 minutes of any incident**
1. Post on the status page: "We are looking into a problem with …".
2. Check: `docker compose ps` · `docker compose logs --tail 100 api` · `df -h` · `scripts/backup.sh list`.
3. If a release went out in the last hour, roll it back first (`scripts/rollback.sh`), investigate after.

---

## 1. Bad release

*Signs:* errors right after a deploy, health alert, users quoting new reference codes.

1. `scripts/rollback.sh` — goes back to the previous version in about a minute.
   (A deploy that fails its health check has already rolled back by itself; you get an alert.)
2. Confirm: `curl -fsS https://<domain>/api/health` and open the website.
3. Logs of the failed version: `.state/failed-deploy-<version>.log` or `docker compose logs api`.
4. Database changes from the failed release stay in place. This is safe because every database change
   is **expand-only** (see "Database changes" below). If a change itself is the problem, restore to
   the minute before the deploy (runbook 3).

## 2. API crashes or keeps restarting

*Signs:* users see "Technical problem: back in a few minutes"; health alert for `api`.

1. Docker restarts it by itself. Check `docker compose ps` and `docker compose logs --tail 200 api`.
2. Database unreachable? `docker compose exec postgres pg_isready` → if not ready, see runbook 4.
3. Out of memory? `dmesg | grep -i kill` → add RAM or lower `DB_POOL_SIZE`.
4. Caused by a recent release → runbook 1.

## 3. Undo a mistake in the data (bad import, wrong bulk change)

1. Find the exact time just before the mistake (activity log in Admin, or `RowHistory`).
2. Turn on maintenance mode (Admin › Settings) so no new orders are lost during the restore.
3. `scripts/restore.sh db "2026-10-24 10:41:00+05:30"` (type RESTORE to confirm).
   Everything after that minute is lost, so for a small mistake prefer fixing the rows by hand
   from `RowHistory` (it stores old and new values).
4. Turn maintenance mode off. Tell affected shops/distributors.

## 4. Database corrupted or will not start

1. `docker compose logs --tail 200 postgres`.
2. Disk full? → runbook 6 first.
3. `scripts/restore.sh db latest` restores the newest backup plus all archived changes
   (at most 5 minutes lost). If the local backups are damaged too, add `--from-offsite`.
4. After restore the script takes a fresh full backup by itself.

## 5. Server lost (hardware failure, provider outage, deleted machine)

Target: back online within 1 hour, at most 5 minutes of data lost.

1. Create a new Ubuntu server; point the DNS A record to it (TTL 300).
2. Copy back `infra/production/.env` from your password manager / secure notes
   (at minimum: all passwords and the off-site storage settings).
3. `git clone` the repo to `/opt/medilink`, then `sudo infra/production/scripts/install.sh`
   (it keeps the values from `.env`). It starts with an empty database.
4. `scripts/restore.sh db latest --from-offsite`
5. `scripts/restore.sh files latest`
6. Check the website, log in as admin, check the latest orders. Update the status page.
7. Distributors' sync agents reconnect by themselves (same address, same keys).

## 6. Disk full

*Signs:* alert at 70% (warning) and 85% (act now).

1. `df -h` and `docker system df`.
2. Old images: `docker image prune -a --filter "until=720h"` (keeps the ones in use).
3. Old local backups are expired automatically; force it: `docker compose exec -u postgres postgres pgbackrest --stanza=medilink expire`.
4. Container logs are capped (5 × 20 MB each). Journal: `journalctl --vacuum-size=200M`.
5. Still full → resize the disk at the provider (no downtime on most clouds), then `resize2fs`.

## 7. Key or password leaked

| Leaked | Do this |
|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Put new values in `.env`, `docker compose up -d api`. Everyone logs in again. |
| `DATA_ENCRYPTION_KEY` | Admins' authenticator secrets become unreadable: change the key, then the super admin resets every admin's 2-step login (Users & access) and each sets it up again. |
| `POSTGRES_PASSWORD` | `docker compose exec postgres psql -U medilink -c "ALTER USER medilink PASSWORD '<new>'"`, put it in `.env`, `docker compose up -d api`. |
| A distributor's sync-agent key | Admin › Distributors › new agent key (old one is revoked at once); install it on their PC. |
| MSG91 / storage / Telegram keys | Rotate at the provider, update `.env`, `docker compose up -d`. |
| Admin account | Suspend it (Users & access) → logged out everywhere at once; review the activity log. |

Afterwards, review the activity log (Admin) and `RowHistory` for anything done with the key.

## 8. HTTPS certificate not renewing

1. `docker compose logs caddy | grep -i -E "acme|certificate"`.
2. Usual causes: DNS no longer points here; port 80 blocked; rate limit after many failed tries.
3. Fix the cause and `docker compose restart caddy`.

## 9. A distributor's sync agent is offline

Shops see "stock updated N hours ago" and can still order (with a warning).
1. Admin › Overview › Sync offline lists them.
2. Call the distributor: PC on? internet? agent service running? Clock correct?
3. Their orders still arrive in the console; they can accept and bill there meanwhile.

## 10. SMS (OTP) not arriving

1. MSG91 dashboard: balance, DLT template status.
2. `docker compose logs api | grep -i msg91`.
3. Logged-in users keep working (sessions last 30 days); only new logins are affected.

---

## Database changes (rule for every release)

Releases must be **expand-only** so a rollback never breaks:
- Add tables and columns (nullable or with a default). Never drop or rename in the same release.
- To rename or remove: release 1 adds the new column and writes both; release 2 reads the new one;
  release 3 (weeks later) removes the old one.
- `deploy.sh` takes a backup before applying changes, and each change runs in a transaction.
