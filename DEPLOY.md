# 40k Results Tracker — Deploy Notes

Site lives at: **https://40k.thewheeliebois.com**

Stack: Node.js + Express API, vanilla JS frontend, Postgres. Follows the
`yetanotherarmybuilder` site recipe.

## One-time setup on the server

```bash
# 1) Clone into the sites folder
cd ~/sites/sites
git clone https://github.com/stopsign002/40kResultsTracker.git
cd 40kResultsTracker

# 2) Create the per-site DB & user (replace pw with a real random string)
DB_PW="$(openssl rand -hex 24)"
docker exec -i postgres psql -U postgres <<SQL
CREATE USER "40k_user" WITH PASSWORD '${DB_PW}';
CREATE DATABASE "40k_db" OWNER "40k_user";
SQL

# 3) Create .env (replace CHANGEME values)
cat > .env <<EOF
DATABASE_URL=postgresql://40k_user:${DB_PW}@postgres:5432/40k_db
SESSION_SECRET=$(openssl rand -hex 32)
PORT=3000
NODE_ENV=production
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$(openssl rand -hex 16)
EOF

# Save the ADMIN_PASSWORD somewhere safe — it bootstraps the first admin.
grep ADMIN_PASSWORD .env

# 4) Install Caddy snippet
cp caddy.example ~/sites/base/conf.d/40k.caddy
docker exec caddy caddy reload --config /etc/caddy/Caddyfile

# 5) Bring up the API
docker compose up -d --build

# 6) Smoke-test (NAT loopback won't work — use --resolve)
curl --resolve 40k.thewheeliebois.com:443:127.0.0.1 https://40k.thewheeliebois.com/api/health
```

The schema and seed data run automatically on every container start (idempotent
`CREATE TABLE IF NOT EXISTS` / `ON CONFLICT DO NOTHING`). The bootstrap admin
is only created if the `users` table is empty.

## Updating

```bash
cd ~/sites/sites/40kResultsTracker
git pull
docker compose up -d --build
```

## Adding new mission packs / cards

Append `INSERT INTO ... ON CONFLICT DO NOTHING` rows to `api/db/seed.sql` and
restart. Or run them manually in psql.

## File layout

```
40kResultsTracker/
├── api/                  Node + Express backend
│   ├── server.js         entry point
│   ├── lib/db.js         pg pool + schema bootstrap
│   ├── lib/auth.js       bcrypt + role middleware
│   ├── routes/
│   │   ├── auth.js       login/logout/me/change-password
│   │   ├── admin.js      user CRUD, hide-from-stats
│   │   ├── games.js      list/get/create/update (no delete)
│   │   ├── stats.js      win rates, breakdowns, head-to-head
│   │   └── reference.js  factions, missions, secondaries lookups
│   └── db/
│       ├── schema.sql    tables, indexes, view
│       └── seed.sql      factions, mission packs, cards
├── app/                  Static frontend (served by Caddy from /srv)
│   ├── index.html
│   ├── css/style.css     YAAB-matched dark Warhammer theme
│   └── js/
│       ├── app.js        hash router + shell
│       ├── api.js        fetch wrapper
│       ├── components.js DOM helpers, toast, pill
│       └── views/        login, games-list, game-detail, game-form, stats, admin
├── docker-compose.yml
├── caddy.example         drop into ~/sites/base/conf.d/ as 40k.caddy
└── .env.example
```

## Permissions model

| Action | User | Admin |
|---|---|---|
| View games & stats | ✓ | ✓ |
| Create / edit games | ✓ (any logged-in user) | ✓ |
| Hide game from stats | – | ✓ |
| Delete games | – (not yet) | – (not yet) |
| Manage users | – | ✓ |

There is no public signup. The admin creates accounts from the **Admin** tab.

## Known limitations / future work

- Mobile UX is minimal — desktop-first by request
- No CSV/JSON export yet
- No photo uploads
- Game deletion not implemented (admin "hide from stats" only)
- Faction matchup matrix endpoint exists but no UI yet
- Head-to-head endpoint exists but no UI yet (good v2 expansion)
