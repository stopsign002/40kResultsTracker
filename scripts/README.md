# `scripts/` — host-side maintenance scripts

Small bash utilities run on the production host, not inside the container.

## `backup.sh`

Nightly Postgres dump of `40k_db`. Writes `~/sites/backups/40k_db_<YYYY-MM-DD>.sql.gz` and prunes anything older than 30 days. Verifies the gzip is non-empty and intact (`gzip -t`) before pruning; exits non-zero on dump failure so cron emails the operator.

### Tunables (env vars)

| Var | Default | Purpose |
|---|---|---|
| `BACKUP_DIR` | `~/sites/backups` | where snapshots land |
| `RETAIN_DAYS` | `30` | keep this many days of snapshots |
| `DB_NAME` | `40k_db` | database to dump |
| `PG_CONTAINER` | `postgres` | name of the running Postgres container |

### Install

```bash
chmod +x ~/sites/sites/40kResultsTracker/scripts/backup.sh
mkdir -p ~/sites/backups

# Nightly at 03:15 — adjust as preferred
( crontab -l 2>/dev/null
  echo "15 3 * * * bash ~/sites/sites/40kResultsTracker/scripts/backup.sh >> ~/sites/backups/40k.log 2>&1"
) | crontab -
```

### Manual one-off

```bash
bash ~/sites/sites/40kResultsTracker/scripts/backup.sh
```

### Restore

```bash
gunzip -c ~/sites/backups/40k_db_<date>.sql.gz \
  | docker exec -i postgres psql -U postgres -d 40k_db
```

Most of this also lives in `DEPLOY.md` "Backups"; this README is the nearer-to-the-script pointer.

## Adding a new maintenance script

- Drop the `.sh` file here, `chmod +x`.
- Document tunables and install steps in this README.
- If it should run automatically, add a cron line. If only on-demand, document the invocation.
- Keep them idempotent and exit non-zero on failure so cron surfaces the error.
