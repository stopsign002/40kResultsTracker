# `api/db/` — schema + seed

Two `.sql` files run on every container start by `lib/db.js#initSchema()`:

1. `schema.sql` — 23 tables, indexes, the `v_game_player_stats` view, and 17 guarded `ALTER` migrations
2. `seed.sql` — reference data (factions, detachments, mission packs, cards), Season 1 bootstrap, idempotent guest→user, detachment, `last_login_at` and `submitted_at` backfills

`seed.sql` also carries a **guarded rename** for secondary-card casing, which
runs *before* the deck insert so an existing `card_id` survives and the
denormalised `player_secondaries.card_name` on already-recorded games is dragged
along. Follow that pattern if reference names ever need correcting — inserting a
correctly-spelled second row instead would orphan the games pointing at the old one.

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

**Put the guarded block BELOW that table's own `CREATE TABLE`.** The guard only
asks whether the *column* exists — on a **fresh** database the *table* doesn't
exist either, so an `ALTER TABLE` (or a `CREATE INDEX`) sitting earlier in the
file throws, `initSchema()` aborts, and **not a single table gets created**. An
existing install never notices, because its table is already there; only a new
install or a restore-from-backup breaks. This shipped once, with
`game_images.is_map` migrating ~50 lines above its own `CREATE TABLE`.

**So: always smoke-test a schema change against an empty database**, not just
the live one:

```bash
docker exec -i postgres psql -U postgres -c 'CREATE DATABASE scratch_db'
# point a throwaway container at it, then check every table arrived:
docker exec postgres psql -U postgres -d scratch_db -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
docker exec -i postgres psql -U postgres -c 'DROP DATABASE scratch_db'
```

Canonical examples already in the file: `player_challengers.round_number`,
`users.army_name`, `games.season_id`, and the two newest —
`game_drafts.submitted_at` and `game_drafts.started_notified_at`, which are the
cleanest single-column instances of the pattern. `game_images.is_map` is the one
that carries the footgun comment, because it's the one that shipped broken.
`game_draft_images.is_map` is the newest, and was written by copying that
comment rather than rediscovering it.
Always add the index in a separate `CREATE INDEX IF NOT EXISTS` after the guard.

**Two things the guard does not do**, both live in the file today:

- **A multi-column block only checks its first column.** `banner_first_seen.anchor_x
  / anchor_y` adds two columns under one `IF NOT EXISTS` on the first. A
  half-applied migration won't self-heal. Prefer one guard per column — or, as
  the `deployment_maps` picture columns do on the way back out, a bare
  `DROP COLUMN IF EXISTS` per column, which needs no guard at all.
- **`CREATE INDEX IF NOT EXISTS` will not change an existing index's predicate.**
  When `game_drafts`'s partial indexes moved from `WHERE submitted_game_id IS NULL`
  to `WHERE submitted_at IS NULL`, the statements kept their names — so a
  database provisioned before that edit still has the **old** predicate; only a
  fresh one gets the new. Changing a predicate needs an explicit
  `DROP INDEX IF EXISTS` first. Worth knowing before you trust an index name to
  mean what the current file says.

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
- **`users.last_login_at`** ← `MAX(created_at)` of that user's `audit_log`
  `'auth.login'` rows. The audit log has recorded logins since day one, so the
  column ships with real history instead of starting empty. Gated on
  `u.last_login_at IS NULL`, so a genuine login always outranks the backfill.
- **`game_drafts.submitted_at`** ← two statements, in order. First
  `MIN(created_at)` of the `'draft.submit'` audit rows, keyed on
  `(payload->>'draftId')::int`; then `submitted_at = updated_at` for any draft
  that still points at a live game. The audit-log leg is not belt-and-braces:
  `submitted_game_id` is `ON DELETE SET NULL`, so a draft whose game was later
  hard-deleted has had that pointer nulled and **the audit row is the only
  surviving evidence it was ever submitted**. Backfilling from the pointer alone
  would resurrect those drafts into the live list. Both legs are gated on
  `submitted_at IS NULL`.

If you add a new backfill: write the predicate so it finds zero matching rows on the second run. Don't gate on a "have I run this once" flag. And check whether the column you're reading from can be nulled by a FK before you trust it as your source.

## Tables you'll touch most

| Table | Notes |
|---|---|
| `users` | `army_name` is shown on the war map. Self-serve via `PATCH /auth/me`; admin override via `PATCH /admin/users/:id`. `prompt_round_photo` (NOT NULL DEFAULT TRUE) is the live tracker's between-rounds nudge — `PATCH /auth/me` `COALESCE`s it so a partial update can't reset it. `last_login_at` is NULL for "never" and stamped **only** by `POST /auth/login`, so a returning user on a live 30-day cookie doesn't refresh it. |
| `games` | `hidden_from_stats` is the soft-delete; `season_id` attaches games to seasons. |
| `game_players` | Exactly 2 per game enforced by route logic (not a DB constraint). `user_id` OR `guest_name` required (CHECK constraint). |
| `banner_first_seen` | One row per `(player_key, faction_id)`. **`first_seen_at` is set on save and never updated** — the war map's home-fortress immutability depends on this. See CLAUDE.md "Why home fortresses can't fall". |
| `seasons` | Only one `is_active = TRUE` (partial unique index). Closed seasons keep their `map_seed` so archived maps still render. |
| `audit_log` | Append-only. INSERT only — never UPDATE or DELETE. |
| `player_detachments` | Source of truth for a player's detachments (11e allows several). `game_players.detachment_name` is the **derived** `', '`-joined display string — never write it directly, and point analytics/autocomplete at this table instead. |
| `game_images` | Photo metadata; the bytes live on disk under `UPLOAD_DIR`. Two independent role flags, each with its own partial unique index: `is_thumbnail` (games-list cover) and `is_map` (terrain-layout shot). One photo may hold both. Deleting rows does **not** delete files — see `removeGameImageFiles`. |
| `deployment_maps` | Name only — `Layout A/B/C` for the 11e pack are ordinary rows here. It deliberately carries **no** picture: a terrain photo is of the table one game was played on, so it lives on `game_images.is_map`. The old `image_name` / `image_thumb_name` pair is dropped by a migration. |
| `game_drafts` | **`submitted_at` is what "finished" means**, not `submitted_game_id`. That FK is `ON DELETE SET NULL`, so deleting the resulting game used to silently un-submit the draft and put it back in the live list. The pointer is now for navigation only and may legitimately be NULL. `started_notified_at` guards the one-per-draft "a game just started" email, claimed with a conditional `UPDATE … WHERE started_notified_at IS NULL` so two phones can't double-send. Both partial indexes read `WHERE submitted_at IS NULL`. |
| `deleted_items` | The recycle bin. One row per archived game or live game: `kind` (`'game'`\|`'draft'`), `original_id`, `label`, `payload` (JSONB), `deleted_by_user_id` (`ON DELETE SET NULL`, with `deleted_by_name` as the denormalised fallback), `deleted_at`, `UNIQUE (kind, original_id)`. Written and read **only** by `lib/archive.js` — `seed.sql` never touches it, so a fresh install starts with an empty bin. See below. |

## Columns whose meaning changed with 11e

Worth knowing before writing a query against them:

| Column | 10e meaning | 11e meaning |
|---|---|---|
| `player_secondaries.round_number` | the round the card was drawn *and* scored | the round it **scored**; `NULL` if it never did |
| `player_secondaries.drawn_round` | unused (`NULL`) | the round the card entered hand |
| `games.primary_mission_id` | the game's mission | unused — the mission is per player |
| `game_players.primary_mission_id` / `_name` | unused | that player's mission, set by the Force Disposition pairing |
| `game_players.detachment_name` | the detachment | derived join of `player_detachments` |

## The recycle bin is not a soft-delete column

`deleted_items` sits at the **bottom of `schema.sql`** and is the last thing in
the file. Deleting a game or a live game serialises its whole row-set into
`payload` as `{ version, tables: [{ name, rows }] }` — captured with
`row_to_json` so a DATE renders `'2026-07-19'` and a TIMESTAMPTZ carries an
explicit offset, rather than being shifted a day by the session timezone the way
a JS `Date` round-tripped through JSON would be — and then **hard-deletes the
originals**. Restoring re-inserts every row at its original primary key and
`setval`s each touched SERIAL sequence past the table's new max.

**The obvious alternative — a `deleted_at` flag on `games` — was rejected on
purpose.** It would have to be honoured by roughly twenty queries across
`stats.js`, `warmap.js` and `ratings.js`, plus `v_game_player_stats`, and the
first one anybody forgot would quietly put a deleted game back into the
leaderboard. Hard-deleting means every existing query keeps meaning exactly what
it says. Don't "simplify" this back into a flag.

Consequences worth holding in your head when writing SQL near it:

- There is **no FK from `deleted_items` to `games` or `game_drafts`** — there
  can't be, the rows are gone. `UNIQUE (kind, original_id)` is what stops two
  archives of the same id, and it's also why an id that has since been reused
  makes an entry unrestorable (`canRestore false`, then 409).
- `payload` is opaque to SQL by design. Read it through `lib/archive.js`, which
  owns the `RESTORABLE` table allowlist and reconciles every foreign key against
  the live tables before it inserts anything.
- **Photo files stay on disk while a row is archived.** Only a permanent delete
  unlinks them, and that unlink happens after the transaction commits. A
  `deleted_items` row whose bytes are already gone is unrecoverable; a leftover
  file isn't.

## Connecting

```bash
# Inside the host (postgres container is shared with other sites)
docker exec -it postgres psql -U 40k_user -d 40k_db
```

For schema dumps: `docker exec postgres pg_dump -U postgres -s 40k_db`. For full data dumps see `scripts/backup.sh`.
