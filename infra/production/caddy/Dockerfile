# Caddy with the rate-limit module. Caddy gets and renews HTTPS certificates by itself.
FROM caddy:2.8-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2.8
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY fallback /srv/fallback
