# ─────────────────────────────────────────────────────────────────────────────
# Cynapx — Multi-stage Docker image
#
# Stage 1 (builder): installs all deps (incl. native toolchain) and compiles
#                    TypeScript → dist/, then prunes node_modules to production.
# Stage 2 (runtime): dist/ + pruned production node_modules + schema/.
#
# Usage:
#   docker build -t cynapx:latest .
#   docker run -p 3000:3000 \
#     -e KNOWLEDGE_TOOL_TOKEN=<token> \
#     -v /path/to/project:/workspace \
#     cynapx:latest --api --bind 0.0.0.0 --path /workspace
#
# Health check: GET /healthz  (no auth required; 200 when engine ready,
#               503 while still pending — see api-server.ts)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────────────────────
# C-1/P13-1: Node 20 is EOL (2026-04-30) — use Node 22 LTS.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build toolchain needed for native modules (better-sqlite3, tree-sitter)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching
COPY package.json package-lock.json ./
COPY tsconfig.json ./

# Install ALL deps (including devDependencies for tsc).
# C-1(2): the project build hook is `prepack` (not `prepare`), so `npm ci`
# no longer tries to run tsc before src/ is copied. Dependency install
# scripts (native module builds) still run here, as required.
RUN npm ci

# Copy source + build assets and compile
COPY src/ ./src/
COPY scripts/build-copy.js ./scripts/build-copy.js
RUN npm run build

# Drop devDependencies — the runtime stage copies this pruned tree wholesale,
# so native modules compiled above are reused without re-running install scripts.
RUN npm prune --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

# Runtime system deps: git (for git-service), python3 (for optional embedding sidecar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 \
    && rm -rf /var/lib/apt/lists/*

# C-1(1): copy compiled output, production node_modules, and runtime assets.
# schema/schema.sql is resolved at runtime as <dist>/db/../../schema/schema.sql
# → /app/schema/schema.sql (see src/db/database.ts).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY schema/ ./schema/
# NOTE: the optional Python embedding sidecar script (scripts/cynapx_embedder.py)
# is not part of this repository; without it the engine degrades gracefully to
# FTS5 fallback mode (NullEmbeddingProvider).

# v9 A-8: run as the unprivileged `node` user (provided by the base image).
# Central storage (DBs, locks, registry, api-token) lives at ~/.cynapx —
# i.e. /home/node/.cynapx — mount a volume there to persist the index.
# (The previous ENV CYNAPX_HOME was never read by the code and was removed.)
RUN mkdir -p /home/node/.cynapx && chown -R node:node /home/node/.cynapx /app
USER node

# Expose REST API port (default 3000)
EXPOSE 3000

# Health check using the /healthz endpoint (returns 503 until the engine is ready)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default entrypoint: MCP over stdio (Claude Desktop compatible)
# Override with --api flag for REST API mode
ENTRYPOINT ["node", "dist/bootstrap.js"]
CMD []
