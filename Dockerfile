# syntax=docker/dockerfile:1
# Multi-stage build for LazyMapHUD: a single container runs the Fastify
# server, which also serves the built web static files (SERVE_STATIC=true)
# and the WebSocket hub — see docs/deployment.md for the full topology
# (this image sits behind Caddy for TLS/wss in production, D2).

# ---------------------------------------------------------------------------
# Stage 1: install all workspace deps once (cached across the build/runtime
# stages by pnpm's content-addressable store).
# ---------------------------------------------------------------------------
FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
# better-sqlite3 needs a C++ toolchain + python to build its native addon.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: build the web static bundle (Vite). Needs `shared` source (Vite
# bundles it directly, no separate shared build step) + web source.
# ---------------------------------------------------------------------------
FROM deps AS web-build
COPY tsconfig.base.json ./
COPY shared shared
COPY web web
RUN pnpm --filter web build

# ---------------------------------------------------------------------------
# Stage 3: runtime image. Ships the server source (run via `tsx`, matching
# the workspace's TS-source-first convention — see server/package.json
# `start`), its production+runtime deps, the shared workspace package, and
# the built web static files. No devDependencies, no secrets baked in
# (WEBHOOK_SECRET etc. are supplied at `docker run`/compose time via env).
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile --prod --filter server...

COPY tsconfig.base.json ./
COPY shared shared
COPY server/src server/src
COPY server/tsconfig.json server/tsconfig.json
COPY --from=web-build /app/web/dist web/dist

ENV PORT=3000 \
    SQLITE_PATH=/data/lazymap.db \
    SERVE_STATIC=true \
    STATIC_ROOT=/app/web/dist \
    WS_PATH=/ws

# Named volume mount point for the durable SQLite file (D1) — see
# docker-compose.yml for the actual named volume binding.
VOLUME ["/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["pnpm", "start"]
