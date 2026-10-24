# Status page and outside monitoring (Uptime Kuma)

Runs on a **second, small machine** (1 vCPU / 1 GB is enough) at a different provider or region from
the main server. If the main server goes down, this machine still shows the status page and raises
the alarm.

## Install (10 minutes)

1. Point `status.<your-domain>` (DNS A record) to this machine.
2. Install Docker, copy this folder to the machine, then:
   ```
   cp .env.example .env      # set STATUS_DOMAIN and ACME_EMAIL
   docker compose up -d
   ```
3. Open `https://status.<your-domain>`, create the Uptime Kuma admin account (use a strong password
   and turn on its 2FA under Settings › Security).

## Monitors to add

| Monitor | Type | Target | Interval |
|---|---|---|---|
| Website | HTTP(s) – keyword | `https://<domain>/login`, keyword `MediLink` | 60 s |
| API + database | HTTP(s) – keyword | `https://<domain>/api/health`, keyword `"ok":true` | 60 s |
| Maintenance switch | HTTP(s) – JSON query | `https://<domain>/api/public/status`, `maintenance.on` = `false` | 60 s |
| HTTPS certificate | (tick “Certificate expiry notification” on the Website monitor) | alert 14 days before | — |
| Server reachable | Ping | the main server's IP | 60 s |
| Database backup | Push | copy its URL into `KUMA_PUSH_DB_BACKUP` in the server's `.env` | heartbeat 26 h |
| File backup | Push | `KUMA_PUSH_FILE_BACKUP` | heartbeat 26 h |
| Monthly restore test | Push | `KUMA_PUSH_RESTORE_TEST` | heartbeat 32 days |
| Server health checks | Push | `KUMA_PUSH_HEALTH` | heartbeat 15 min |

A **push** monitor turns red when the job stops reporting, so a backup that silently stops running is
noticed within a day.

## Notifications

Settings › Notifications: add Telegram (bot token + chat id), WhatsApp (via a provider such as
Twilio / WhatsApp Cloud API webhook), and email (SMTP). Attach them to every monitor.

## Public status page

Status Pages › New: slug `medilink`, add the Website, API and Maintenance monitors, set it as the
home page (Settings › General › Entry Page). Put its address in the main server's `.env` as
`STATUS_PAGE_URL`; the "we'll be back" page links to it.

During an incident, post an update on the status page (Status Page › Edit › Incident) so shops and
distributors know what is happening.
