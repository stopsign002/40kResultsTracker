# 40k Results Tracker

A multi-user Warhammer 40,000 10th-edition game-results tracker. Friends log matches, browse a filterable game list, view a stats dashboard, and stake territory on a seeded "Theatre of War" planetary map called **Boimaggedon**.

**Live:** https://40k.thewheeliebois.com

---

## What's inside

- **Game log** — date, mission pack + primary + deployment + mission rule, two players (faction, detachment, army-list paste), per-round primary scoring, per-round tactical secondaries (two slots) and challenger / Secret Mission card, manual winner override, end condition (played-to-time / concession / tabled), tournament metadata, free-form notes
- **Filtering** — by player, faction, opponent faction, mission, deployment, format, date range, visibility
- **Stats dashboard** — KPIs, faction win rates (animated bars), per-player W/L/D, going-first impact, faction drilldown by mission and deployment, secondary card averages
- **Theatre of War map** — Boimaggedon: a procedurally generated continent of ~50 territories. Each `(player, faction)` combo holds its own cluster of land with a fortress that **never falls**. Territory share = 70% games-played (log-scaled) + 30% win-rate, so frequent players dominate without win-rate becoming irrelevant. Same seed → identical map on every device, forever.
- **Admin tab** — only visible to admins; create users, set army names, promote/demote, deactivate, reset passwords, hide games from stats

---

## For users (you and your friends)

### Getting an account

There is **no public sign-up**. The admin (the keeper of the records) creates accounts from the Admin tab and shares the username + password.

Once you have credentials, log in at https://40k.thewheeliebois.com.

### Adding a game

1. Click **New Game** in the top nav.
2. Fill in **Date**, **Format** (matched / crusade / narrative / open / tournament), **Points** (free integer), **Turns played**.
3. Pick a **Mission Pack** (Pariah Nexus has primaries + secondaries + Secret Missions; Leviathan has the older deck for historical games).
4. Pick a **Primary Mission**, **Deployment Map**, and (optionally) a **Mission Rule** — defaults to "None".
5. Optionally fill in **End Condition**, tournament metadata, location, and notes.
6. For each player:
   - Type the **Name** — it autocompletes from past games. If your typed name matches a registered user's display name, the system links the game to that account automatically (so the army name shows up correctly on the war map).
   - Pick **Faction** and **Detachment**.
   - Tick **Went First** (one player only) and **Winner** (one player wins; tick both for a draw; leave both unticked to auto-compute from scores).
   - Paste an army-list code or text (optional).
7. **Primary Scoring** table — enter primary objective points for each of 5 rounds.
8. **Secondary & Challenger Scoring** table — for each round, pick up to two secondary cards from dropdowns and enter the points scored on them. If the mission pack has Secret Missions / challenger cards, a third dropdown lets you score on one per round.
9. Hit **Save Game**.

The final score is auto-calculated from primary + secondary + challenger totals, capped at 100. You can override the result with the Winner checkbox if you concede or score weirdly.

### Editing a game

Open any game from the **Games** list and click **Edit** in the header. Any logged-in user can edit any game.

### Hiding a game from stats

Admin only. Open the game and click **Hide from stats**. The game stays in the list (with a "Hidden" pill) but is excluded from every stats endpoint and from the war map. Click again to unhide.

### Setting your army name

Ask the admin to fill in your **Army Name** in the Admin tab. That name then shows on every territory you hold on the Theatre of War map (e.g. "House Vosk" for your Necron territories). Without an army name, the map falls back to your display name.

### Reading the war map

- **Continent silhouette in cyan** — the world of Boimaggedon
- **Coloured territories** — each cluster is one `(player, faction)` banner; the colour is the faction's lore-matched palette (Necrons green, Blood Angels red, etc.)
- **Glowing diamond markers** — fortresses, one per banner. These are immutable once placed.
- **Thin cyan borders** — between two of your own territories
- **Bold amber borders** — the war front: the line between two different banners (whether different factions, or the same faction held by two different players)
- **Fortress label** — your army name (or display name fallback) on top, faction abbreviation below
- **HUD chrome** — corner brackets, compass, scan-line texture, bottom-right tactical readout (`> WORLD: BOIMAGGEDON / > THEATRES: 50 / …`)

### Stats dashboard

Charts auto-update from the database. KPIs at the top, then:

- **Faction Win Rates** — horizontal bars, animated
- **Player Win Rates** — stacked bars (wins / losses / draws)
- **Going First vs Second** — win % + average score by turn order
- **Faction Drilldown** — pick a faction, see its performance across primaries and deployments
- **Secondary Averages** — per-card pick count + average score + best ever

---

## For human developers and maintainers

### Stack

- **Backend:** Node 22 (alpine) + Express 4 + Postgres 17, all in Docker
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework, no bundler. Chart.js loaded from CDN.
- **Auth:** `bcrypt` + `express-session` + `connect-pg-simple` (Postgres-backed sessions)
- **Reverse proxy:** Caddy 2 (handled by base infra; this repo only ships a `caddy.example` snippet)

### Design philosophy

- Match `yetanotherarmybuilder` styling exactly (same CSS variables copied verbatim — see `app/css/style.css` and the "Critical invariants" section of `CLAUDE.md`)
- Server enforcement is the source of truth for permissions; client-side gating is UX only
- Schema and seed data are idempotent and run on every container start (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded `ALTER TABLE`)
- No frameworks: views build DOM via the `el(tag, attrs, children)` helper in `app/js/components.js`. New code should match this pattern.
- No public signup; no game deletion (admin can hide instead). These are deliberate per-spec.

### File map (top level)

```
40kResultsTracker/
├── README.md             ← you are here
├── CLAUDE.md             auto-loaded reference for Claude Code sessions; also the
│                         most thorough developer doc (architecture, API surface,
│                         schema, recipes, invariants, pitfalls)
├── DEPLOY.md             server install + ongoing maintenance (read this if you're
│                         setting up a new deploy or recovering after an outage)
├── docker-compose.yml    defines the 40k-api service on the shared 'web' network
├── caddy.example         drop into ~/sites/base/conf.d/40k.caddy on the host
├── .env.example          6 vars; copy to .env on the server
├── api/                  Node + Express backend (see CLAUDE.md "Backend architecture")
└── app/                  Static frontend served by Caddy from /srv (no build step)
```

For the full file-by-file breakdown, see [`CLAUDE.md`](./CLAUDE.md#repo-layout).

### Day-to-day deploy

```bash
cd ~/sites/sites/40kResultsTracker
git pull
docker compose up -d --build
```

Logs:

```bash
docker logs -f 40k-api
```

Container-internal psql:

```bash
docker exec -it postgres psql -U 40k_user -d 40k_db
```

Smoke test from the host (NAT loopback doesn't work — use `--resolve`):

```bash
curl --resolve 40k.thewheeliebois.com:443:127.0.0.1 https://40k.thewheeliebois.com/api/health
```

### First-time install on a new server

See [`DEPLOY.md`](./DEPLOY.md). Roughly: clone, create the per-site Postgres user + DB, fill in `.env`, copy the Caddy snippet, `docker compose up -d --build`, smoke test.

### Local development

This codebase is consciously framework-free, so local dev mostly means:
- Run a Postgres instance and set `DATABASE_URL` in `.env`
- `cd api && npm install && node server.js`
- Open `app/index.html` directly via a static server pointed at `app/`, OR run a one-shot Caddy locally with the same proxy config as `caddy.example`

There are no automated tests at the moment — the project has been bug-fixed reactively. If you're adding tests, plain `node:test` is preferred over a framework, to match the no-bundler aesthetic.

### Adding things

The recipes in [`CLAUDE.md`](./CLAUDE.md#how-to-add-things-recipes) cover:
- A new mission pack (and its primaries / deployments / mission rules / secondaries / Secret Missions)
- A new secondary or challenger card
- A new faction (and its detachments + war-map home + lore colour)
- A new stats chart
- A new view / page
- A new permission rule
- A schema change to an existing table
- A new user-profile field
- Backfilling existing DB rows after a behaviour change

### Critical invariants

These will silently break production if changed:

- `MAP_SEED = 0xDEAD40` and the `VIRTUAL_W/VIRTUAL_H` canvas dimensions in `app/js/views/warmap.js`
- `FACTION_HOMES` positions — append-only, never reorder
- `FACTION_COLOURS` — lore-matched palette
- YAAB CSS variables in `app/css/style.css`
- `ROUNDS = [1,2,3,4,5]` and `CHECK round_number BETWEEN 1 AND 5` in schema (10e is a 5-round game)
- Bootstrap admin only on first run when the users table is empty
- camelCase frontend payload ↔ snake_case DB columns (conversion at the boundary)

Full rationale for each is in [`CLAUDE.md`](./CLAUDE.md#critical-invariants--do-not-touch-without-thinking).

### Permissions

| Action | User | Admin |
|---|---|---|
| View games / stats / war map | ✓ | ✓ |
| Create / edit games | ✓ | ✓ |
| Hide game from stats | – | ✓ |
| Manage users (create / set army name / reset password / promote / deactivate) | – | ✓ |
| Change own password | ✓ | ✓ |
| Delete a game | – | – (out of scope) |

Server enforcement lives in `api/lib/auth.js` middleware (`requireAuth` / `requireAdmin`); client-side gating is UX only.

### Where to learn more

- **`CLAUDE.md`** — the densest and most current reference for everything: architecture, API surface (28 endpoints), DB schema, common pitfalls, recipes
- **`DEPLOY.md`** — infra and bring-up
- **Git log** — `git log --oneline -- path/to/file` answers "when did this change and why?"
- **Live YAAB CSS** — https://github.com/stopsign002/yetanotherarmybuilder for styling reference; this repo deliberately mirrors it

### Reporting bugs

Open a GitHub issue at https://github.com/stopsign002/40kResultsTracker. Include:
- What you did
- What you expected
- What actually happened
- Browser / device if it's a UI bug
- A game ID if it's a data bug

---

## Acknowledgements

- **Battlescribe community** ([BSData/wh40k-10e](https://github.com/BSData/wh40k-10e)) for the authoritative detachment lists used in the seed data
- **YAAB** ([yetanotherarmybuilder](https://github.com/stopsign002/yetanotherarmybuilder)) for the visual language and CSS variable palette
- **Goonhammer / Wahapedia** for cross-referencing Pariah Nexus mission data
- **Games Workshop** for 10th edition
