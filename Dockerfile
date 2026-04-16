# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Cynapx v1.0.6 — Multi-stage Docker image
#
# Stage 1 (builder): installs all deps and compiles TypeScript → dist/
# Stage 2 (runtime): copies only dist/ + production node_modules
#
# Usage:
#   docker build -t cynapx:latest .
#   docker run -p 3000:3000 \
#     -e KNOWLEDGE_TOOL_TOKEN=<token> \
#     -v /path/to/project:/workspace \
#     cynapx:latest --api --project /workspace
#
# Health check: GET /healthz  (no auth required)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install build toolchain needed for native modules (better-sqlite3, tree-sitter)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    && rm -rf /var/lib/apt/lists/*

# Copy manifests first for layer caching
COPY package.json package-lock.json ./
COPY tsconfig.json ./

# Install ALL deps (including devDependencies for tsc)
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

WORKDIR /app

# Runtime system deps: git (for git-service), python3 (for optional embedding sidecar)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy production manifests and install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Central storage dir at a Docker-friendly path
ENV CYNAPX_HOME=/data/cynapx

# Expose REST API port (default 3000)
EXPOSE 3000

# Health check using the /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/healthz', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Default entrypoint: MCP over stdio (Claude Desktop compatible)
# Override with --api flag for REST API mode
ENTRYPOINT ["node", "dist/bootstrap.js"]
CMD []
