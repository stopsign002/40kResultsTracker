#!/usr/bin/env bash
# Nightly backup of the 40k_db Postgres database.
# Drop into ~/sites/sites/40kResultsTracker/scripts/backup.sh on the host
# and add a cron line like:
#   15 3 * * * bash ~/sites/sites/40kResultsTracker/scripts/backup.sh >> ~/sites/backups/40k.log 2>&1
#
# Writes:   ~/sites/backups/40k_db_<YYYY-MM-DD>.sql.gz
# Retains:  the last 30 daily snapshots (older ones deleted).
# Exits non-zero on dump failure so cron emails the error.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/sites/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
DB_NAME="${DB_NAME:-40k_db}"
PG_CONTAINER="${PG_CONTAINER:-postgres}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F)"
OUT="$BACKUP_DIR/40k_db_${STAMP}.sql.gz"

echo "[$(date -Iseconds)] backing up $DB_NAME → $OUT"

docker exec "$PG_CONTAINER" pg_dump -U postgres "$DB_NAME" \
  | gzip -9 > "$OUT"

# Verify the file is non-empty and looks like a real dump
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "[$(date -Iseconds)] BACKUP FAILED: dump empty or corrupted" >&2
  rm -f "$OUT"
  exit 1
fi

echo "[$(date -Iseconds)] wrote $(du -h "$OUT" | cut -f1)"

# Prune anything older than RETAIN_DAYS
find "$BACKUP_DIR" -maxdepth 1 -name '40k_db_*.sql.gz' -mtime "+$RETAIN_DAYS" -print -delete

echo "[$(date -Iseconds)] backup complete"
