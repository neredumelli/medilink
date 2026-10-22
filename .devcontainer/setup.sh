#!/usr/bin/env bash
# Runs once when the Codespace is created: install, database, demo data.
set -e
corepack enable
pnpm install
cp -n .env.example apps/api/.env || true
cp -n .env.example apps/web/.env.local || true
# In Codespaces the browser reaches the API through a forwarded URL, not localhost.
if [ -n "$CODESPACE_NAME" ]; then
  API="https://${CODESPACE_NAME}-4000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}/api"
  WEB="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  sed -i "s#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=${API}#" apps/web/.env.local
  sed -i "s#^CORS_ORIGINS=.*#CORS_ORIGINS=${WEB}#" apps/api/.env
fi
docker compose -f infra/docker-compose.yml up -d postgres redis
until docker compose -f infra/docker-compose.yml exec -T postgres pg_isready -U medilink >/dev/null 2>&1; do sleep 2; done
pnpm --filter @medilink/api prisma:deploy
pnpm --filter @medilink/api prisma:seed
echo "Setup done. Run: pnpm dev"
