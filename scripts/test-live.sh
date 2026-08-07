#!/usr/bin/env bash
# Integration suite for the live game tracker.
#
# Runs node:test inside a throwaway container joined to the `web` network, so it
# reaches the API at 40k-api:3000 and Postgres at postgres:5432 directly —
# no Caddy, no NAT loopback (which doesn't work on this host anyway).
#
# It talks to the REAL database. Every row it creates belongs to a user whose
# username starts with `zz_test_`, and the harness only ever deletes rows
# reachable from those users. See api/test/integration/_harness.js.
#
#   scripts/test-live.sh                    # whole suite
#   scripts/test-live.sh drafts-lifecycle   # one file
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "no .env — run this on the server" >&2; exit 1; }

# Globbed by the container's shell, not passed as a directory: `node --test
# test/integration/` resolves the path as a MODULE and dies with
# MODULE_NOT_FOUND rather than scanning it.
TARGET="test/integration/*.test.js"
if [ $# -gt 0 ]; then TARGET="test/integration/$1.test.js"; fi

DOCKER="docker"
docker ps >/dev/null 2>&1 || DOCKER="sg docker -c"

RUN="docker run --rm --network web \
  -v $PWD/api:/api -v $PWD/uploads:/uploads -w /api \
  --env-file .env \
  -e TEST_API_URL=http://40k-api:3000 \
  -e TEST_UPLOAD_DIR=/uploads \
  node:22-alpine sh -c \"node --test --test-concurrency=1 $TARGET\""

# Serial by design: these share one database, and a parallel run would have
# files asserting against each other's rows.
if [ "$DOCKER" = "docker" ]; then eval "$RUN"; else sg docker -c "$RUN"; fi
