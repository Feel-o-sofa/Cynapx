#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Cynapx Docker smoke test (P13-1 / C-1)
#
# 1. Builds the Docker image from the repo root.
# 2. Creates a minimal throwaway project (git repo + .cynapx-config anchor +
#    one TypeScript file) and starts the container in REST API mode.
# 3. Polls GET /healthz until it returns HTTP 200 (engine ready) — this
#    exercises the full deployment path: npm ci ordering (prepack), schema/
#    presence in the image, non-root user, and engine initialization.
# 4. Tears everything down.
#
# Exits 0 with "SKIP" when no usable Docker daemon is available, so it can be
# wired into CI/integration runs unconditionally (P13-9).
#
# Usage:   bash scripts/docker-smoke.sh
# Env:     CYNAPX_SMOKE_IMAGE  image tag       (default: cynapx-smoke:latest)
#          CYNAPX_SMOKE_PORT   host API port   (default: 3199)
#          CYNAPX_SMOKE_TIMEOUT  seconds to wait for healthz 200 (default: 180)
#          CYNAPX_SMOKE_NO_BUILD=1  skip `docker build` and use an existing
#                               $CYNAPX_SMOKE_IMAGE (e.g. built by a CI step)
#          CYNAPX_SMOKE_BUILD_ARGS  extra args for `docker build`
#                               (e.g. "--network=host" on bridgeless daemons)
#
# NOTE: the container is run with --network=host so the test works on daemons
# without a bridge network (e.g. sandboxes started with --bridge=none).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_TAG="${CYNAPX_SMOKE_IMAGE:-cynapx-smoke:latest}"
PORT="${CYNAPX_SMOKE_PORT:-3199}"
TIMEOUT="${CYNAPX_SMOKE_TIMEOUT:-180}"
CONTAINER="cynapx-smoke-$$"
WORKDIR=""
# Ephemeral API token for the throwaway container — generated per run so no
# literal token value is committed to source. Only consumed inside this
# container (the smoke test itself only polls the unauthenticated /healthz).
SMOKE_TOKEN="${KNOWLEDGE_TOOL_TOKEN:-$(openssl rand -hex 16 2>/dev/null || echo "smoke-$$-$RANDOM$RANDOM")}"

log()  { echo "[docker-smoke] $*"; }

if ! command -v docker >/dev/null 2>&1; then
    log "SKIP: docker CLI not found"
    exit 0
fi
if ! docker info >/dev/null 2>&1; then
    log "SKIP: docker daemon not reachable"
    exit 0
fi

cleanup() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    [ -n "$WORKDIR" ] && rm -rf "$WORKDIR"
}
trap cleanup EXIT

# ── 1. Build ──────────────────────────────────────────────────────────────────
if [ "${CYNAPX_SMOKE_NO_BUILD:-0}" = "1" ]; then
    log "CYNAPX_SMOKE_NO_BUILD=1 — using existing image $IMAGE_TAG"
else
    log "building image $IMAGE_TAG ..."
    # shellcheck disable=SC2086
    docker build ${CYNAPX_SMOKE_BUILD_ARGS:-} -t "$IMAGE_TAG" "$ROOT"
fi

# ── 2. Minimal sample project ─────────────────────────────────────────────────
WORKDIR="$(mktemp -d /tmp/cynapx-smoke.XXXXXX)"
cat > "$WORKDIR/sample.ts" << 'TS'
export function greet(name: string): string {
    if (!name) {
        return 'hello, world';
    }
    return `hello, ${name}`;
}

export function main(): void {
    console.log(greet('cynapx'));
}
TS
echo '{"created_at":"1970-01-01T00:00:00.000Z"}' > "$WORKDIR/.cynapx-config"
git -C "$WORKDIR" init -q
git -C "$WORKDIR" -c user.email=smoke@test -c user.name=smoke add -A
git -C "$WORKDIR" -c user.email=smoke@test -c user.name=smoke \
    -c commit.gpgsign=false -c tag.gpgsign=false commit -qm "smoke fixture"
# Container runs as the unprivileged `node` user (uid 1000)
chmod -R a+rwX "$WORKDIR"

# ── 3. Run + poll /healthz ────────────────────────────────────────────────────
log "starting container $CONTAINER (API on port $PORT) ..."
docker run -d --name "$CONTAINER" \
    --network=host \
    -e KNOWLEDGE_TOOL_TOKEN="$SMOKE_TOKEN" \
    -v "$WORKDIR:/workspace" \
    "$IMAGE_TAG" --api --api-port "$PORT" --path /workspace

log "waiting up to ${TIMEOUT}s for GET /healthz to return 200 ..."
deadline=$(( $(date +%s) + TIMEOUT ))
status=""
while [ "$(date +%s)" -lt "$deadline" ]; do
    if ! docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true; then
        log "FAIL: container exited prematurely. Logs:"
        docker logs "$CONTAINER" 2>&1 | tail -50
        exit 1
    fi
    status="$(curl -s -o /tmp/cynapx-smoke-healthz.json -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" || true)"
    if [ "$status" = "200" ]; then
        log "healthz 200 OK: $(cat /tmp/cynapx-smoke-healthz.json)"
        log "PASS: Docker build + boot + /healthz smoke test succeeded"
        exit 0
    fi
    sleep 2
done

log "FAIL: /healthz did not return 200 within ${TIMEOUT}s (last status: ${status:-none}). Logs:"
docker logs "$CONTAINER" 2>&1 | tail -50
exit 1
