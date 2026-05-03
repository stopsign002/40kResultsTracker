# 40k Results Tracker — Deploy Notes

Site lives at: **https://40k.thewheeliebois.com**

Stack: Node 22 / Express + Postgres 17 + vanilla JS (no build step) +
Chart.js. Follows the `yetanotherarmybuilder` site recipe — slots into
the shared `web` Docker network with Caddy as the reverse proxy.

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
cat > .env <<EOF
DATABASE_URL=postgresql://40k_user:${DB_PW}@postgres:5432/40k_db
SESSION_SECRET=$(openssl rand -hex 32)
PORT=3000
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF

# Save the ADMIN_PASSWORD somewhere safe — it bootstraps the first admin.
# Once a user exists in the DB, this env var is ignored on future restarts.
grep ADMIN_PASSWORD .env

# 4) Install Caddy snippet
cp caddy.example ~/sites/base/conf.d/40k.caddy
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# 5) Bring up the API
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

Migrations included in this update path so far:

- `player_challengers.round_number` (nullable INTEGER, 1-5) — added when
  challenger card scoring became per-round
- `users.army_name` (nullable TEXT) — added so admins can give friends
  banner names that show on the Theatre of War map
- Idempotent `UPDATE game_players SET user_id = u.id, guest_name = NULL
  …` — links old games where a typed guest_name matches a registered
  user's display_name

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
├── api/                  Node + Express backend
│   ├── server.js         entry: initSchema → ensureBootstrapAdmin → listen
│   ├── lib/
│   │   ├── db.js         pg Pool, withTx() helper, schema/seed bootstrap
│   │   └── auth.js       bcrypt + requireAuth / requireAdmin middleware
│   ├── routes/
│   │   ├── auth.js       /auth/* — login, logout, me, change-password
│   │   ├── admin.js      /admin/* — user CRUD, hide-from-stats (admin-only)
│   │   ├── games.js      /games/* — list/get/create/update (HEAVY: contains
│   │   │                 computeFinalScores + insertPlayerChildren +
│   │   │                 resolvePlayerIdentities)
│   │   ├── stats.js      /stats/* — overview + 8 stat endpoints
│   │   ├── warmap.js     /stats/warmap — per-(player, faction) banners for the
│   │   │                 Theatre of War map
│   │   └── reference.js  /reference/* — factions, detachments, mission packs,
│   │                     player names (autocomplete)
│   └── db/
│       ├── schema.sql    tables, indexes, view, idempotent migrations
│       └── seed.sql      28 factions + detachments + Pariah Nexus + Leviathan
│                         + the guest-name → user_id backfill UPDATE
└── app/                  Static frontend served by Caddy from /srv (no build)
    ├── index.html        script tags for every JS module
    ├── css/style.css     YAAB-matched dark Warhammer theme
    └── js/
        ├── app.js        hash router, shell renderer, route table, nav links
        ├── api.js        fetch wrapper; api / auth / reference / games / stats
        │                 / admin export objects
        ├── components.js el(), clear(), toast(), pill(), fmtDate(),
        │                 selectOptions() — USE THESE
        └── views/
            ├── login.js          public login screen
            ├── games-list.js     filter panel + paginated game table
            ├── game-detail.js    single game view
            ├── game-form.js      ⚠ heaviest file: new + edit, per-round grid
            ├── stats.js          KPIs + Chart.js charts
            ├── warmap.js         ⚠ Theatre of War — frozen invariants (MAP_SEED,
            │                     FACTION_HOMES, VIRTUAL_W/H)
            └── admin.js          user management + change-own-password
```

## Permissions model

| Action | User | Admin |
|---|---|---|
| View games & stats | ✓ | ✓ |
| Create / edit games | ✓ (any logged-in user) | ✓ |
| Hide game from stats | – | ✓ |
| Set / change a user's army name | – | ✓ |
| Manage users (create / promote / deactivate / reset password) | – | ✓ |
| Delete games | – (not yet) | – (not yet) |

There is no public signup. Admin creates accounts from the **Admin** tab.

## Backups (rough sketch — not automated yet)

Manual snapshot of just this site's database:

```bash
docker exec postgres pg_dump -U postgres 40k_db > 40k_db_$(date +%F).sql
```

To restore into a fresh DB:

```bash
docker exec -i postgres psql -U postgres -d 40k_db < 40k_db_<date>.sql
```

Adding cron-driven nightly backups is a reasonable future improvement.

## Known limitations / future work

- Mobile UX is minimal — desktop-first by request
- No CSV/JSON export yet
- No photo uploads (intentionally skipped from v1; would need object storage)
- Game deletion not implemented (admin "hide from stats" only — by spec)
- Faction matchup matrix endpoint exists (`/stats/faction-matchups`) but no UI yet
- Head-to-head endpoint exists (`/stats/head-to-head`) but no UI yet — good v2 expansion
- Same display name across two registered users would cause `resolvePlayerIdentities`
  to ambiguously link typed names to one of them — current users have unique names so
  this hasn't been a problem yet
- No automated tests; everything has been bug-fixed reactively
