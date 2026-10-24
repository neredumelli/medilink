# MediLink website (shops, distributors, admin). Next.js standalone server.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
# The browser calls /api on the same address; Caddy sends it to the API.
ARG NEXT_PUBLIC_API_URL=/api
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_SUPPORT_PHONE=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_SUPPORT_PHONE=$NEXT_PUBLIC_SUPPORT_PHONE NEXT_TELEMETRY_DISABLED=1
RUN pnpm install --frozen-lockfile=false && pnpm --filter @medilink/core build && pnpm --filter @medilink/web build

FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 CMD wget -q --spider http://127.0.0.1:3000/login || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/web/server.js"]
