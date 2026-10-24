# MediLink API. Built by the release workflow (ghcr.io/<owner>/medilink-api:<version>) or on the server.
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl && corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm --filter @medilink/core build && pnpm --filter @medilink/api build

FROM node:22-alpine
RUN apk add --no-cache openssl tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
# Uploaded files (KYC documents) live on a volume that is backed up by restic.
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
# Database changes are applied by the deploy script after a backup ("npx prisma migrate deploy"), not on start.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
