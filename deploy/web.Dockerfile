# The web image: the Vite production build of apps/web, served by Caddy. The Caddyfile is baked in,
# so the image digest recorded in the Release Log covers the proxy configuration too.
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
ARG CADDY_IMAGE=caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=12.8.1
ENV CI=true
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=lims-pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store
COPY . .
RUN --mount=type=cache,id=lims-pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm-store --filter "@lims/web..."
RUN NODE_ENV=production pnpm --filter @lims/web exec vite build --outDir /out --emptyOutDir

FROM ${CADDY_IMAGE} AS runtime
ARG CADDYFILE=Caddyfile.tunnel
COPY deploy/caddy/site.caddy /etc/caddy/site.caddy
COPY deploy/caddy/${CADDYFILE} /etc/caddy/Caddyfile
COPY --from=build /out /srv
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
