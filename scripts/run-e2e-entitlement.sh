#!/usr/bin/env bash
# run-e2e-entitlement.sh — reliable lifecycle for the HTTP entitlement e2e.
#
#   build → seed (idempotent) → start production server → wait for /api/health
#   → run e2e-dashboard-entitlement.ts → shut the server down (always)
#
# Usage:
#   npm run e2e:entitlement        # full lifecycle (build, seed, server, e2e, cleanup)
#   PORT=3101 npm run e2e:entitlement   # override port
#   SMOKE_BASE_URL=http://localhost:4100 ...   # must match PORT
#
# To run against an already-running server, use:
#   npm run e2e:entitlement:direct
#
# Env overrides:
#   MONGODB_URI   default mongodb://localhost:27017/nfc-crm
#   PORT          default 3101
#   SMOKE_BASE_URL default http://localhost:${PORT}

set -euo pipefail

MONGODB_URI="${MONGODB_URI:-mongodb://localhost:27017/nfc-crm}"
PORT="${PORT:-3101}"
BASE="${SMOKE_BASE_URL:-http://localhost:${PORT}}"
LOG_FILE="${TMPDIR:-/tmp}/taprevia-e2e-server-$$.log"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "→ stopping server (pid ${SERVER_PID})"
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "→ MONGODB_URI=${MONGODB_URI}"
echo "→ BASE_URL=${BASE}"

echo "→ seeding baseline data (idempotent)..."
MONGODB_URI="${MONGODB_URI}" npx tsx scripts/seed.ts

echo "→ building production bundle..."
MONGODB_URI="${MONGODB_URI}" npm run build

echo "→ starting server on :${PORT}..."
MONGODB_URI="${MONGODB_URI}" npx next start -p "${PORT}" >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!
echo "  server pid ${SERVER_PID}, log ${LOG_FILE}"

# Wait up to 60s for /api/health to report the DB up.
ready=0
for i in $(seq 1 60); do
  if curl -fsS "${BASE}/api/health" 2>/dev/null | grep -q '"db":"up"'; then
    ready=1
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "✗ server exited early; log:"
    cat "${LOG_FILE}"
    exit 1
  fi
  sleep 1
done

if [[ "${ready}" -ne 1 ]]; then
  echo "✗ server did not become healthy within 60s; log tail:"
  tail -n 40 "${LOG_FILE}"
  exit 1
fi
echo "→ server healthy"

echo "→ running HTTP entitlement e2e..."
SMOKE_BASE_URL="${BASE}" MONGODB_URI="${MONGODB_URI}" npx tsx scripts/e2e-dashboard-entitlement.ts