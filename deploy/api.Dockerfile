# The API image. Node runs the TypeScript sources directly through its type stripping, which works
# because pnpm links workspace packages by symlink: Node resolves them to /app/packages/*, outside
# node_modules, where stripping is allowed. `pnpm deploy` would copy them into node_modules and
# break that. The same image runs the one-shot database init (deploy/db/init.ts).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

FROM ${NODE_IMAGE} AS build
ARG PNPM_VERSION=12.8.1
ARG API_PACKAGE=@lims/api
ARG API_ENTRY=apps/api/src/server.ts
ENV CI=true
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=lims-pnpm-store,target=/pnpm-store pnpm fetch --prod --store-dir /pnpm-store
COPY . .
RUN test -f "${API_ENTRY}" || { echo "API entry ${API_ENTRY} does not exist; build once apps/api has it" >&2; exit 1; }
RUN --mount=type=cache,id=lims-pnpm-store,target=/pnpm-store \
    pnpm install --offline --frozen-lockfile --prod --store-dir /pnpm-store \
      --filter "${API_PACKAGE}..." --filter "@lims/db..."

FROM ${NODE_IMAGE} AS runtime
ARG API_ENTRY=apps/api/src/server.ts
ENV NODE_ENV=production API_ENTRY=${API_ENTRY}
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/deploy/api ./deploy/api
COPY --from=build /app/deploy/db ./deploy/db
USER node
ENTRYPOINT ["/app/deploy/api/entrypoint.sh"]
