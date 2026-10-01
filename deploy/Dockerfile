# syntax=docker/dockerfile:1.7
# One Dockerfile, three targets: `api` (also runs migrations and the seed), `web` (Caddy with the built SPA), `db`.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @lims/web build

FROM build AS api
USER node
CMD ["node", "apps/api/src/app.ts"]

FROM caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

FROM postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873 AS db
# Runs once, on an empty volume: gives lims_app its password so the migrations find the role already made.
COPY <<'INIT' /docker-entrypoint-initdb.d/lims_app.sh
psql -v ON_ERROR_STOP=1 -U postgres -v pw="$(cat /run/secrets/lims_app)" <<'SQL'
create role lims_app login password :'pw';
SQL
INIT
