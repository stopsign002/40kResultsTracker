# 40k Results Tracker — Deploy Notes

Site lives at: **https://40k.thewheeliebois.com**

Stack: Node 22 / Express + Postgres 17 + vanilla JS (no build step) +
Chart.js. Follows the `yetanotherarmybuilder` site recipe — slots into
the shared `web` Docker network with Caddy as the reverse proxy.

**Exposure:** this site is on the public internet and its **reads are
unauthenticated by design** — anyone with the URL can browse games, photos,
stats and the war map. Only writes require a session, and `/admin/*` +
`/ratings/*` require an admin. Nothing here is LAN-gated, and don't try to make
it so with Caddy's `remote_ip private_ranges` — on this host that matcher does
**not** block WAN traffic (see `~/sites/CLAUDE.md`). If this site ever needs to
be private, do it with the session check, not the proxy.

For a full feature tour and developer overview see [`README.md`](./README.md).
For Claude session orientation see [`CLAUDE.md`](./CLAUDE.md).

## One-time setup on the server

```bash
# 1) Clone into the sites folder
cd ~/sites/sites
git clone https://github.com/stopsign002/40kResultsTracker.git
cd 40kResultsTracker

# 2) Create the per-site DB & user (random password)
DB_PW="$(openssl rand -hex 24)"
docker exec -i postgres psql -U postgres <<SQL
CREATE USER "40k_user" WITH PASSWORD '${DB_PW}';
CREATE DATABASE "40k_db" OWNER "40k_user";
SQL

# 3) Create .env (replace CHANGEME if any survive the heredoc)
#    See .env.example for the full variable list and what each one does.
cat > .env <<EOF
DATABASE_URL=postgresql://40k_user:${DB_PW}@postgres:5432/40k_db
SESSION_SECRET=$(openssl rand -hex 32)
PORT=3000
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -hex 16)
INCLUDE_DIGITAL_IN_STATS=true
EOF
chmod 600 .env

# Optional but wired in production: new-game notification emails go through
# the shared mailer container on the `web` network. Append the two vars if
# you want them; with either missing, notifications are silently skipped.
#   MAILER_URL=http://mailer:3000/send
#   MAILER_TOKEN=<the MAILER_TOKEN from ~/sites/sites/mailer/.env>

# Save the ADMIN_PASSWORD somewhere safe — it bootstraps the first admin.
# Once a user exists in the DB, this env var is ignored on future restarts.
grep ADMIN_PASSWORD .env

# 4) Install Caddy snippet
#    NOTE: this includes a /uploads/* file_server block for photos (an older
#    40k.caddy without it will 404 every image) AND a dedicated /api/events
#    handler with `flush_interval -1` and no `encode`, without which the SSE
#    live-update stream is buffered and never reaches the browser.
cp caddy.example ~/sites/base/conf.d/40k.caddy
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# 5) Bring up the API
#    docker-compose.yml bind-mounts ./uploads -> /data/uploads (UPLOAD_DIR).
#    The directory is created on first upload; it is gitignored.
docker compose up -d --build

# 6) Smoke-test (NAT loopback won't work from the host — use --resolve)
curl --resolve 40k.thewheeliebois.com:443:127.0.0.1 https://40k.thewheeliebois.com/api/health
```

The schema and seed data run automatically on every container start
(`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded
`ALTER TABLE` blocks for column additions, idempotent `UPDATE`s for
data backfills). The bootstrap admin is created **only** when the
`users` table is empty.

## Updating

```bash
cd ~/sites/sites/40kResultsTracker
git pull
docker compose up -d --build
```

## Photo / layout-picture storage

Image bytes live **on disk, not in Postgres** — a nightly `pg_dumpall`
shouldn't carry multi-MB blobs.

| | |
|---|---|
| On the host | `~/sites/sites/40kResultsTracker/uploads/` |
| In the container | `/data/uploads` (`UPLOAD_DIR`, set in `docker-compose.yml`) |
| Served at | `/uploads/<game_id>/<file>` and `/uploads/maps/<file>` |
| Served by | **Caddy, off disk** — Node is not in the read path |

The path is the **project root, not `app/`**, deliberately: that keeps uploads
out of git and out of the SPA's `try_files` fallback, while Caddy can still read
them through the existing read-only `/srv` mount.

**Backups:** the host's nightly config tarball already archives `sites/sites`
excluding `*/app`, so `uploads/` is captured with no extra setup. It's a *full*
tarball every night, so if the photo library ever gets large, split it into an
incremental `rclone sync` rather than letting the nightly upload grow.

**Files vs rows:** deleting a game cascades `game_images` rows but **not** the
files — `routes/admin.js` calls `removeGameImageFiles(id)` for that. Any new
deletion path must do the same or it will leak files onto the volume.

## Migrations

All of these run automatically on container start via the guarded-`ALTER`
pattern; nothing below needs a manual step.

⚠ **Guarded ALTERs must sit below their own `CREATE TABLE` in `schema.sql`.**
The guard only tests for the column, so one placed earlier throws on a *fresh*
database, `initSchema()` aborts, and no tables are created at all. An existing
install never notices — only a new install or a **restore from backup** breaks.
Smoke-test schema changes against an empty database. See `api/db/README.md`.

Migrations included in this update path so far:

- `player_challengers.round_number` (nullable INTEGER, 1-5) — added when
  challenger card scoring became per-round
- `users.army_name` (nullable TEXT) — added so admins can give friends
  banner names that show on the Theatre of War map
- `game_players.detachment_name` (nullable TEXT) — added when the
  detachment input switched from a dropdown to a free-text box
- Idempotent `UPDATE game_players SET user_id = u.id, guest_name = NULL
  …` — links old games where a typed guest_name matches a registered
  user's display_name
- Idempotent `UPDATE game_players SET detachment_name = d.name FROM
  detachments d WHERE detachment_id IS NOT NULL AND detachment_name IS
  NULL` — copies legacy detachment_id rows into the new free-text column
- `games.play_medium` (`'physical'`|`'digital'`) — Tabletop Simulator flag;
  existing rows become `physical`
- `games.edition` (`'10'`|`'11'`) — added with `DEFAULT '10'` so the whole back
  catalogue backfills as 10th, **then** the default is flipped to `'11'` for new
  rows. Don't collapse that into a single `DEFAULT '11'`; it would re-label every
  historical game
- `game_players.primary_mission_id` + `primary_mission_name` — 11e gives each
  player their own primary mission
- `game_players.force_disposition` — 11e Force Disposition, 5-value CHECK
- `game_players.time_seconds` + `game_rounds.time_seconds` — chess-clock timings
- `player_secondaries.drawn_round` — 11e cards persist in hand, so the draw round
  is distinct from the round the card scored
- `player_detachments` table + backfill of one row per historical
  `game_players.detachment_name` — 11e allows several detachments per player
- `game_images` table (+ `is_map` flag) — photo metadata; bytes on disk
- `deployment_maps.image_name` / `image_thumb_name` — terrain-layout pictures
- `seasons` table + `games.season_id` — Theatre-of-War seasons. A partial unique
  index enforces one active season; `seed.sql` creates "Season 1" only when the
  table is empty and back-fills every existing game onto it
- `banner_first_seen` table — one row per `(player_key, faction_id)`, written on
  save and **never updated**; it is what keeps the war map geographically stable
- `banner_first_seen.anchor_x` / `anchor_y` — per-banner map anchor, so the 2nd+
  player of a faction gets a spare anchor instead of fighting for the faction
  home. NULL falls back to the `FACTION_HOMES` table
- `audit_log` table — append-only trail of every write action

All run automatically; no manual psql intervention needed.

## Adding new mission packs / cards / factions

See [`CLAUDE.md`](./CLAUDE.md#how-to-add-things-recipes) — recipes cover
mission packs, secondary / challenger cards, factions (with war-map
homes and colours), schema changes, new views, new endpoints.

## File layout

```
40kResultsTracker/
├── README.md             user + dev landing page
├── CLAUDE.md             auto-loaded Claude reference (also the
│                         densest dev doc — architecture, API
│                         surface, schema, recipes, invariants)
├── DEPLOY.md             you are here
├── docker-compose.yml
├── caddy.example
├── .env.example
├── scripts/backup.sh     optional per-site pg_dump snapshot (see Backups)
├── api/                  Node + Express backend
│   ├── server.js         entry: initSchema → ensureBootstrapAdmin → listen
│   ├── lib/
│   │   ├── db.js         pg Pool, withTx() helper, schema/seed bootstrap
│   │   ├── auth.js       bcrypt + requireAuth / requireAdmin middleware
│   │   ├── audit.js      fire-and-forget audit_log writer
│   │   ├── events.js     in-process SSE broadcaster
│   │   ├── mail.js       notify() → the shared mailer container
│   │   ├── game-scoring.js  computeFinalScores / resolvePlayerTimes (pure)
│   │   ├── game-filter.js   COUNTED_GAMES — the "counts toward stats" gate
│   │   ├── glicko2.js + whr.js + ratings.js  rating models (pure, tested)
│   │   ├── adopt-guest.js   guest → inactive-account promotion
│   │   └── faction-anchors.js  server mirror of FACTION_HOMES + spare anchors
│   ├── routes/
│   │   ├── auth.js       /auth/* — login, logout, me, PATCH me, change-password
│   │   ├── admin.js      /admin/* — user CRUD, hide-from-stats, hard delete,
│   │   │                 audit log, guest promotion (all admin-only)
│   │   ├── games.js      /games/* — list/get/create/update. Reads are PUBLIC;
│   │   │                 writes call requireAuth inline. (HEAVY: contains
│   │   │                 insertPlayerChildren + resolvePlayerIdentities +
│   │   │                 recordBannerFirstSeen)
│   │   ├── images.js     /games/:id/images + (as mapRouter) /maps/:id/image
│   │   ├── stats.js      /stats/* — overview + 12 stat endpoints
│   │   ├── warmap.js     /stats/warmap + /stats/warmap-timeline — banners feed
│   │   │                 and the time-travel slider's game list
│   │   ├── reference.js  /reference/* — factions, detachments, mission packs,
│   │   │                 users, unified player picker, name autocomplete
│   │   ├── events.js     /events — SSE stream (game.saved, season.changed)
│   │   ├── seasons.js    /seasons — list (public) + start new (admin)
│   │   └── ratings.js    /ratings/* — ADMIN-ONLY leaderboard + matchmaker
│   ├── test/             node:test suite for the pure helpers (`npm test`)
│   └── db/
│       ├── schema.sql    tables, indexes, view, idempotent migrations
│       └── seed.sql      29 factions + detachments + Pariah Nexus + Leviathan
│                         + the 11e "2026 - 2027 Chapter Approved" pack
│                         + Season 1 + the guest-name → user_id backfill UPDATE
└── app/                  Static frontend served by Caddy from /srv (no build)
    ├── index.html        script tags for every JS module
    ├── css/style.css     YAAB-matched dark Warhammer theme
    └── js/
        ├── app.js        hash router, shell renderer, route table, nav links,
        │                 error boundary; per-route requireAuth / requireAdmin
        ├── api.js        fetch wrapper; api / auth / reference / games /
        │                 gameImages / mapImages / stats / admin / seasons /
        │                 ratings export objects
        ├── components.js el(), clear(), toast(), pill(), fmtDate(),
        │                 selectOptions(), confirmModal(), promptModal()
        ├── live.js       singleton EventSource → 'live:game.saved' event
        ├── lightbox.js   full-screen photo viewer (FLIP zoom, cycle, swipe)
        ├── zip.js        dependency-free ZIP reader (Google Photos downloads)
        └── views/
            ├── login.js          login screen
            ├── games-list.js     filter panel + game table + SSE auto-refresh
            ├── game-detail.js    single game view + photo upload + admin
            │                     Hide / Delete
            ├── game-form.js      ⚠ heaviest file: new + edit, per-round grid
            ├── stats.js          KPIs + Chart.js charts, heatmaps, trends
            ├── warmap.js         ⚠ Theatre of War — frozen invariants (MAP_SEED,
            │                     FACTION_HOMES, VIRTUAL_W/H)
            ├── ratings.js        ⚠ ADMIN-ONLY /rankings
            ├── player.js         per-player profile
            ├── profile.js        self-serve army name + password
            └── admin.js          users, audit log, seasons, guest promotion
```

## Permissions model

| Action | Anonymous | User | Admin |
|---|---|---|---|
| View games, photos, stats, war map, player profiles | ✓ | ✓ | ✓ |
| Create / edit games | – | ✓ (any logged-in user) | ✓ |
| Upload photos / layout pictures | – | ✓ | ✓ |
| Delete a photo | – | own uploads only | ✓ |
| Set own army name / change own password | – | ✓ | ✓ |
| Hide game from stats | – | – | ✓ |
| Delete a game (hard, cascades + unlinks files) | – | – | ✓ |
| Set / change *another* user's army name | – | – | ✓ |
| Manage users (create / promote / deactivate / reset password) | – | – | ✓ |
| Promote guests to accounts | – | – | ✓ |
| Start a new season | – | – | ✓ |
| Rankings / matchmaker, audit log | – | – | ✓ |

There is no public signup. Admin creates accounts from the **Admin** tab.
Reads being public is deliberate — see the exposure note at the top.

## Backups

**What actually protects this database today is the host-wide job, not this
repo's script.** `~/sites/base/backup.sh` runs nightly at 03:15 from the host
crontab, `pg_dumpall`s the whole Postgres instance (so `40k_db` is included),
gzips it to `~/sites/backups/pg_all_<date>.sql.gz`, and `rclone copy`s it
off-site to Backblaze B2 along with a config tarball that captures `uploads/`
and the `.env`. A monthly restore drill (`~/sites/base/restore-test.sh`, 1st of
the month at 04:30) proves the B2 copy restores. Nothing per-site needs setting
up for that to work.

`scripts/backup.sh` in this repo is an **optional extra**, currently **not in
cron** — a single-database snapshot for when you want a 40k-only dump before a
risky migration. Each run gzip-pumps `pg_dump 40k_db` to
`~/sites/backups/40k_db_<YYYY-MM-DD>.sql.gz` and prunes anything older than 30
days. If you do want it on a schedule:

```bash
chmod +x ~/sites/sites/40kResultsTracker/scripts/backup.sh
mkdir -p ~/sites/backups

# nightly at 03:15 — adjust as preferred (don't collide with base/backup.sh)
( crontab -l 2>/dev/null; echo "15 3 * * * bash ~/sites/sites/40kResultsTracker/scripts/backup.sh >> ~/sites/backups/40k.log 2>&1" ) | crontab -
```

Tunable env vars (set inline before the script if needed):
- `BACKUP_DIR` — where snapshots land (default `~/sites/backups`)
- `RETAIN_DAYS` — keep this many days of snapshots (default 30)
- `DB_NAME` — defaults to `40k_db`
- `PG_CONTAINER` — name of the running Postgres container (default `postgres`)

Manual one-off snapshot:

```bash
bash ~/sites/sites/40kResultsTracker/scripts/backup.sh
```

To restore into a fresh DB:

```bash
gunzip -c ~/sites/backups/40k_db_<date>.sql.gz \
  | docker exec -i postgres psql -U postgres -d 40k_db
```

## Known limitations / future work

- Mobile UX is functional but desktop-first by request
- No CSV/JSON export yet
- ~~No photo uploads~~ — **added**: photos and terrain-layout pictures, stored on
  a bind-mounted volume and served by Caddy (see "Photo / layout-picture storage")
- ~~Game deletion not implemented~~ — **added**: admin-only hard delete
  (`DELETE /admin/games/:id`). "Hide from stats" is still the normal move
- ~~Faction matchup matrix / head-to-head have no UI~~ — **added**: matchup
  heatmap and a head-to-head player picker on the Stats page
- ~~No automated tests~~ — `api/test/` covers the pure helpers (scoring, glicko2,
  whr, ratings, game-filter) via `npm test`. Routes, SQL and views are still
  verified by hand
- `/games` reads are public, and so are the photo files under `/uploads/*`. Don't
  put anything in a game note or a photo you wouldn't post publicly
- Same display name across two registered users would cause `resolvePlayerIdentities`
  to ambiguously link typed names to one of them — current users have unique names so
  this hasn't been a problem yet
- The war-map time slider re-fetches `/stats/warmap` per checkpoint and recomputes
  the whole tessellation client-side, so scrubbing a long season is CPU-heavy
