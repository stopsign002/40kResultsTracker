# `api/db/` — schema + seed

Two `.sql` files run on every container start by `lib/db.js#initSchema()`:

1. `schema.sql` — table definitions, indexes, the `v_game_player_stats` view
2. `seed.sql` — reference data (factions, detachments, mission packs, cards), Season 1 bootstrap, idempotent guest→user backfill

Both **must stay idempotent** so they're safe to re-run on every boot. There is no migration tool. There is no "schema version" tracker.

## Idempotency rules

- New tables: `CREATE TABLE IF NOT EXISTS …`
- New indexes: `CREATE INDEX IF NOT EXISTS …`
- New views: `CREATE OR REPLACE VIEW …`
- New seed data: `INSERT INTO … ON CONFLICT … DO NOTHING` (or `DO UPDATE` if you want updates to flow on re-run)
- New columns on existing tables: **wrap in a guarded `DO $$ … END $$` block** (see "Migrating an existing table" below) — `CREATE TABLE IF NOT EXISTS` will NOT add columns to a table that already exists
- Backfill UPDATEs at the end of `seed.sql`: write so they affect zero rows on the second run (idempotent by predicate, not by a flag column)

## Migrating an existing table

Append to `schema.sql`:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='X' AND column_name='Y'
  ) THEN
    ALTER TABLE X ADD COLUMN Y …;
  END IF;
END $$;
```

Canonical examples already in the file: `player_challengers.round_number`, `users.army_name`, `games.season_id`. Always add the index in a separate `CREATE INDEX IF NOT EXISTS` after the guard.

## Seeding new reference data

For new mission packs / cards / factions, use the cross-join pattern that's already in `seed.sql` — never `SELECT id … then INSERT id`, because parallel runs / first-boots break that. Example:

```sql
INSERT INTO primary_missions (mission_pack_id, name)
SELECT mp.id, n
FROM mission_packs mp,
     (VALUES ('Mission A'), ('Mission B')) AS d(n)
WHERE mp.name = 'Pack Name'
ON CONFLICT DO NOTHING;
```

## Backfill UPDATEs

End of `seed.sql` carries idempotent `UPDATE … FROM …` blocks for data-meaning changes that need to apply to historical rows. Examples:

- guest_name → user_id linkage (case-insensitive `display_name` match against active users) — re-runs safely because the predicate excludes already-linked rows.
- detachment.name → game_players.detachment_name (legacy column rename).
- Season 1 bootstrap → assigns every game with `season_id IS NULL` to the active season.

If you add a new backfill: write the predicate so it finds zero matching rows on the second run. Don't gate on a "have I run this once" flag.

## Tables you'll touch most

| Table | Notes |
|---|---|
| `users` | `army_name` is shown on the war map. Self-serve via `PATCH /auth/me`; admin override via `PATCH /admin/users/:id`. |
| `games` | `hidden_from_stats` is the soft-delete; `season_id` attaches games to seasons. |
| `game_players` | Exactly 2 per game enforced by route logic (not a DB constraint). `user_id` OR `guest_name` required (CHECK constraint). |
| `banner_first_seen` | One row per `(player_key, faction_id)`. **`first_seen_at` is set on save and never updated** — the war map's home-fortress immutability depends on this. See CLAUDE.md "Why home fortresses can't fall". |
| `seasons` | Only one `is_active = TRUE` (partial unique index). Closed seasons keep their `map_seed` so archived maps still render. |
| `audit_log` | Append-only. INSERT only — never UPDATE or DELETE. |

## Connecting

```bash
# Inside the host (postgres container is shared with other sites)
docker exec -it postgres psql -U 40k_user -d 40k_db
```

For schema dumps: `docker exec postgres pg_dump -U postgres -s 40k_db`. For full data dumps see `scripts/backup.sh`.
