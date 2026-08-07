#!/usr/bin/env bash
# Pure unit tests — no network, no database, no running containers needed.
#
# app/ is mounted because several suites test frontend modules that are
# dependency-free ES modules (game-rules.js mirrors the server's scoring and
# must not drift from it; army-list.js decodes YAAB share codes).
#
# The sister site is mounted read-only when present so the YAAB format-drift
# canary can actually run: it asserts yaab still declares `YAAB1:` and `v: 2`,
# so we learn from a test run rather than from a user pasting a code that no
# longer expands. It self-skips when the mount is absent.
set -euo pipefail

cd "$(dirname "$0")/.."

YAAB=/home/stopsign002/sites/sites/yetanotherarmybuilder
MOUNT_YAAB=""
[ -d "$YAAB/app" ] && MOUNT_YAAB="-v $YAAB/app:/yaab/app:ro"

RUN="docker run --rm --network none \
  -v $PWD/api:/api -v $PWD/app:/app:ro $MOUNT_YAAB -w /api \
  -e YAAB_SOURCE_DIR=/yaab/app \
  node:22-alpine sh -c 'node --test test/*.test.js'"

docker ps >/dev/null 2>&1 && eval "$RUN" || sg docker -c "$RUN"
