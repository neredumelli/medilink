#!/usr/bin/env bash
# One-time setup: libraries, database, demo data. Safe to run again.
set -e
cd "$(dirname "$0")/.."
echo "== MediLink setup =="
corepack enable >/dev/null 2>&1 || npm install -g pnpm@9
pnpm install
[ -f apps/api/.env ] || cp .env.example apps/api/.env
[ -f apps/web/.env.local ] || cp .env.example apps/web/.env.local
docker compose -f infra/docker-compose.yml up -d postgres
echo "Waiting for the database..."
until docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U medilink >/dev/null 2>&1; do sleep 2; done
pnpm --filter @medilink/api prisma:deploy
if [ ! -f .seeded ]; then
  pnpm --filter @medilink/api prisma:seed
  touch .seeded
fi
echo
echo "== Setup done. Starting MediLink. =="
echo "When a box says 'Your application running on port 3000 is available', click 'Open in Browser'."
echo "Logins: shop 9848012345 · distributor 9876500001 · admin 9000000001"
echo "The 6-digit OTP appears in this terminal: look for 'OTP for 98...'"
echo
