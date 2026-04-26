#!/usr/bin/env bash
#
# setup-local-db.sh — one-shot Postgres install + dev-db creation for Token Duel.
#
# Idempotent: safe to run multiple times. Detects existing installs/DBs and
# skips. Outputs the local DATABASE_URL line to paste into backend/.env.
#
# Usage:
#   bash scripts/setup-local-db.sh
#
# Requirements: macOS with Homebrew. Linux/WSL: install postgresql-16 manually
# then run `createdb token_duel_dev` + `cd backend && npm run migrate`.

set -euo pipefail

DB_NAME="${DB_NAME:-token_duel_dev}"
PG_VERSION="${PG_VERSION:-16}"
PG_FORMULA="postgresql@${PG_VERSION}"
TAG="[setup-local-db]"

log() { echo "${TAG} $*"; }

if [[ "$OSTYPE" != "darwin"* ]]; then
    log "this script is macOS-only. For Linux/WSL, install postgresql-${PG_VERSION} via your package manager, then run:"
    log "  createdb ${DB_NAME}"
    log "  cd backend && npm run migrate"
    exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
    log "Homebrew not installed. Install from https://brew.sh first."
    exit 1
fi

# Step 1 — install postgres if missing.
if brew list "${PG_FORMULA}" >/dev/null 2>&1; then
    log "${PG_FORMULA} already installed"
else
    log "installing ${PG_FORMULA}…"
    brew install "${PG_FORMULA}"
fi

# Step 2 — start the service.
if brew services list | grep -q "${PG_FORMULA}.*started"; then
    log "${PG_FORMULA} service already running"
else
    log "starting ${PG_FORMULA} service…"
    brew services start "${PG_FORMULA}"
    # Give it a few seconds to bind.
    sleep 2
fi

# Step 3 — ensure psql binaries are on PATH for this script.
PG_BIN="$(brew --prefix "${PG_FORMULA}")/bin"
export PATH="${PG_BIN}:${PATH}"

# Step 4 — create the dev DB if it doesn't exist.
if psql -lqt | cut -d \| -f 1 | grep -qw "${DB_NAME}"; then
    log "DB '${DB_NAME}' already exists"
else
    log "creating DB '${DB_NAME}'…"
    createdb "${DB_NAME}"
fi

# Step 5 — apply migrations via the backend's runner.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}/backend"

if [[ ! -d node_modules ]]; then
    log "installing backend dependencies…"
    npm install --silent
fi

LOCAL_URL="postgresql://${USER}@localhost:5432/${DB_NAME}"

log "applying migrations against ${LOCAL_URL}…"
DATABASE_URL="${LOCAL_URL}" DB_SSL=false npm run migrate --silent

cat <<EOF

${TAG} ✅ DONE — local Postgres ready.

Add these lines to backend/.env (create the file if it doesn't exist):

  DATABASE_URL=${LOCAL_URL}
  DB_SSL=false
  DB_POOL_MAX=5

Then restart the backend:

  cd backend && npm run dev

Verify:

  curl http://localhost:3000/health/db
  → { "ok": true, "latencyMs": 5 }

EOF
