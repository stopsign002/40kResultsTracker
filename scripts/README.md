# `scripts/` — host-side scripts

Small bash utilities run on the production host, not inside the container. Two
kinds live here: the backup snapshot, and the two test runners (which shell out
to `docker run`, which is why they're host-side rather than `npm` scripts).

## `test-unit.sh` — pure unit tests

```bash
bash ~/sites/sites/40kResultsTracker/scripts/test-unit.sh
```

No network, no database, no running containers needed — it starts a throwaway
`node:22-alpine` on `--network none` and runs `node --test test/*.test.js`.

Two mounts are load-bearing:

- **`app/` read-only at `/app`.** Several suites test *frontend* modules —
  `game-rules.test.js` (whose `calcTotal` must not drift from the server's
  `computeFinalScores`), `army-list.test.js` and `nav-stack.test.js`. They're
  dependency-free ES modules with no DOM access, so they're imported by relative
  path from `api/test/` rather than standing up a second runner for `app/`.
- **The sister yaab repo read-only at `/yaab`**, when it's present on the host,
  exposed as `YAAB_SOURCE_DIR`. That's what lets the **YAAB format-drift canary**
  actually run: it reads yaab's `storage.js` and asserts it still declares
  `EXPORT_PREFIX = 'YAAB1:'` and writes `v: 2`, so we find out from a test run
  rather than from a user pasting a share code that no longer expands. It
  **skips** rather than fails when the mount is absent.

This is the same command as `npm test` inside `api/`; the script exists to give
it the mounts and a clean container. See `api/test/README.md` for what's covered.

## `test-live.sh [file]` — integration tests

```bash
bash ~/sites/sites/40kResultsTracker/scripts/test-live.sh                    # whole suite
bash ~/sites/sites/40kResultsTracker/scripts/test-live.sh drafts-lifecycle   # one file
```

Runs `api/test/integration/*.test.js` in a container joined to the shared `web`
network, so it reaches the API at `40k-api:3000` and Postgres at `postgres:5432`
directly — no Caddy, no NAT loopback (which doesn't work on this host anyway).
It needs the repo's `.env` and refuses to start without one, so it only runs on
the server. Run with `--test-concurrency=1`: the files share one database, and a
parallel run would have them asserting against each other's rows.

**It talks to the real database.** Say it plainly rather than let someone find
out: these tests create real users, games, drafts and photos in `40k_db`
alongside your actual data. The safety property is naming, not isolation —

- every row the suite creates belongs to a user whose username starts with
  `zz_test_`, and free-text reference rows it invents are prefixed `ZZ `;
- `cleanup()` in `api/test/integration/_harness.js` only ever deletes rows
  reachable from those users (plus the `ZZ ` reference rows);
- `zz-residue.test.js` runs last — the suite is globbed alphabetically and runs
  serially — and asserts the database was left as it was found, including that
  the 11e mission pack still holds exactly its 18 seeded secondaries.

That last check exists because it already went wrong once: `resolveGameLookups`
auto-inserts a reference row for any free-text card/mission name a submitted game
carries (it's what powers "+ Card not listed"), so a test that submitted an
invented secondary permanently added that card to the real pack and it showed up
in every user's draw picker. If you add a table, add it to `cleanup()` in FK-safe
order.

### Note for both runners

`node --test <dir>/` resolves the path as a **module** and dies with
`MODULE_NOT_FOUND` instead of scanning the directory. Both scripts therefore pass
a `*.test.js` glob expanded by the container's shell. Don't "tidy" either into a
bare directory argument.

Both also fall back to `sg docker -c` when plain `docker ps` fails, for a shell
that hasn't picked up the `docker` group yet (see `~/sites/CLAUDE.md`).

## `backup.sh`

Postgres dump of `40k_db`. Writes `~/sites/backups/40k_db_<YYYY-MM-DD>.sql.gz`
and prunes its own files older than 30 days. Verifies the gzip is non-empty and
intact (`gzip -t`) before pruning; exits non-zero on dump failure so cron emails
the operator.

**This is an optional extra, not the thing protecting the database.** That's
`~/sites/base/backup.sh`, which `pg_dumpall`s the whole instance nightly and
ships it to Backblaze B2 — `40k_db` is already in there. This script is for a
40k-only dump before a risky migration. See `DEPLOY.md` "Backups".

### Tunables (env vars)

| Var | Default | Purpose |
|---|---|---|
| `BACKUP_DIR` | `~/sites/backups` | where snapshots land |
| `RETAIN_DAYS` | `30` | keep this many days of snapshots |
| `DB_NAME` | `40k_db` | database to dump |
| `PG_CONTAINER` | `postgres` | name of the running Postgres container |

### Known warts (flagged by a security audit; script deliberately unchanged)

- **No `umask` / `chmod`.** The host's `~/sites/base/backup.sh` sets `umask 077`
  and `chmod 600`s its output; this one doesn't, so its dumps land at the default
  `0664` in the *same shared directory* as the 0600 ones. A full-database dump is
  as sensitive as the database.
- **The cron time this file used to suggest collides.** Both this README and
  `DEPLOY.md` recommended `15 3 * * *` — exactly when `~/sites/base/backup.sh`
  runs. Two concurrent `pg_dump`s against one Postgres, every night. Both now say
  03:45; check `crontab -l` if you installed it from an older copy.
- **The host pruner never sees these files.** `~/sites/base/backup.sh` prunes
  `pg_all_*.sql.gz` and `config_*.tar.gz` only, so a `40k_db_*.sql.gz` is cleaned
  up **only** by a later run of this script. Run it once by hand and that file
  sits in `~/sites/backups` forever.

### Install (if you want it on a schedule anyway)

```bash
chmod +x ~/sites/sites/40kResultsTracker/scripts/backup.sh
mkdir -p ~/sites/backups

# NOT 03:15 — that's ~/sites/base/backup.sh. 03:45 keeps them apart.
( crontab -l 2>/dev/null
  echo "45 3 * * * bash ~/sites/sites/40kResultsTracker/scripts/backup.sh >> ~/sites/backups/40k.log 2>&1"
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

Most of this also lives in `DEPLOY.md` "Backups"; this README is the
nearer-to-the-script pointer.

## Adding a new maintenance script

- Drop the `.sh` file here, `chmod +x`.
- Document tunables and install steps in this README.
- If it should run automatically, add a cron line — and check it doesn't land on
  an existing job's minute (`crontab -l`). If only on-demand, document the
  invocation.
- Keep them idempotent and exit non-zero on failure so cron surfaces the error.
