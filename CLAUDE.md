# CLAUDE.md — 40k Results Tracker

This file is auto-loaded by Claude Code into every session. It is the single source of truth for orienting in this repo. **Read it first; it'll save you re-reading half the codebase.**

---

## What this is

Multi-user Warhammer 40,000 10th-edition game-results tracker. Friends log matches (mission, factions, per-round scoring, secondaries, challenger cards), browse a filterable game list, view a stats dashboard, and stake territory on a seeded "Theatre of War" galaxy map. Hosted at **https://40k.thewheeliebois.com** as a Docker stack alongside other thewheeliebois.com sites. See `DEPLOY.md` for infra/deploy steps.

---

## Stack

- **Backend:** Node 22 (alpine) + Express 4 + Postgres 17 (shared with other sites on the box)
- **Frontend:** Vanilla HTML/CSS/JS — **no build step**, no framework. Chart.js + `chartjs-adapter-date-fns` (for the rankings time axis) loaded from CDN.
- **Auth:** `bcrypt` + `express-session` + `connect-pg-simple` (Postgres-backed sessions)
- **Reverse proxy:** Caddy 2 (handled by base infra; this repo only ships a `caddy.example` snippet)
- **Container:** single service `40k-api`; Caddy serves `app/` directly off disk

---

## Repo layout

```
40kResultsTracker/
├── CLAUDE.md               ← you are here (cross-cutting orientation)
├── DEPLOY.md               server-side install + env recipe + nightly backups cron
├── docker-compose.yml      defines the 40k-api service on the shared 'web' network
├── caddy.example           drop into ~/sites/base/conf.d/40k.caddy on the host
├── .env.example            7 vars; copy to .env on the server (incl. INCLUDE_DIGITAL_IN_STATS)
├── scripts/
│   ├── README.md           per-script doc
│   └── backup.sh           nightly pg_dump → ~/sites/backups/, 30-day retention
├── api/
│   ├── README.md           service overview + npm scripts (start, test, typecheck)
│   ├── Dockerfile          node:22-alpine; npm install --omit=dev; runs server.js
│   ├── package.json        ESM module ("type": "module"); deps: express, pg, bcrypt,
│   │                       express-session, connect-pg-simple, express-rate-limit
│   ├── tsconfig.json       editor / `npm run typecheck` only — noEmit, allowJs+checkJs
│   ├── types.js            shared JSDoc typedefs (PlayerPayload, GamePayload, BannerUnit)
│   ├── server.js           ENTRY: initSchema → ensureBootstrapAdmin → app.listen
│   ├── lib/                helpers — see api/lib/README.md
│   │   ├── db.js           pg pool + withTx() generic
│   │   ├── auth.js         bcrypt helpers, requireAuth / requireAdmin middleware
│   │   ├── audit.js        fire-and-forget audit log writer
│   │   ├── events.js       in-process SSE broadcaster (subs Set + broadcast())
│   │   ├── game-scoring.js computeFinalScores + validateGameInput (pure, tested)
│   │   ├── glicko2.js      pure Glicko-2 rating math (ratePeriod/expectedScore), tested vs Glickman example
│   │   ├── whr.js          whole-history rating: global Bradley-Terry fit (retroactive), tested
│   │   ├── ratings.js      games → all-time ratings (glicko OR whr, margin-of-victory) + balanced matchmaker
│   │   ├── adopt-guest.js  promote guests → inactive accounts (preview + promote, war-map-safe)
│   │   └── game-filter.js  COUNTED_GAMES — the shared "counts toward stats" gate (digital on/off)
│   ├── routes/             each file: `export default Router()` mounted in server.js
│   │   ├── auth.js         /auth/*  — login, logout, me, PATCH me, change-password
│   │   ├── admin.js        /admin/* — user CRUD, game visibility, game delete, audit log
│   │   ├── games.js        /games/* — list/get/create/update (HEAVY: insertPlayerChildren)
│   │   ├── stats.js        /stats/* — overview + 12 stat endpoints (incl. trends, calendar)
│   │   ├── warmap.js       /stats/warmap — banners feed for the Theatre of War
│   │   ├── reference.js    /reference/* — factions, detachments, mission packs, names
│   │   ├── events.js       /events — SSE long-poll for live updates
│   │   ├── seasons.js      /seasons — list + start-new (admin)
│   │   └── ratings.js      /ratings — ADMIN-ONLY Glicko-2 leaderboard + balanced matchmaker
│   ├── db/
│   │   ├── README.md       schema/seed conventions, idempotency rules, ALTER pattern
│   │   ├── schema.sql      tables, indexes, view; idempotent (CREATE IF NOT EXISTS + DO $$..ALTER guard)
│   │   └── seed.sql        28 factions + detachments + Pariah Nexus + Leviathan packs +
│   │                       Season 1 + guest→user backfill (all idempotent)
│   └── test/
│       ├── README.md       how to run + what's covered
│       ├── game-scoring.test.js  11 cases pinning the camelCase payload contract
│       ├── glicko2.test.js       pins Glicko-2 math to Glickman's worked example
│       ├── ratings.test.js       margin-of-victory + display mapping + balanced pairing
│       └── whr.test.js           whole-history fit: transitivity, bounded undefeated, uncertainty
└── app/                    SERVED BY CADDY at /srv/40kResultsTracker/app
    ├── README.md           frontend overview
    ├── index.html          script tags for every JS module (no bundler)
    ├── css/style.css       YAAB-matched dark Warhammer theme — see "Critical invariants"
    └── js/
        ├── README.md       module roles
        ├── app.js          hash router, shell renderer, route table, nav links, error boundary
        ├── api.js          fetch wrapper; exports: api, auth, reference, games, stats, admin, seasons, ratings
        ├── components.js   el(), clear(), toast(), pill(), fmtDate(), selectOptions(),
        │                   confirmModal(), promptModal() — USE THESE
        ├── live.js         singleton EventSource → 'live:game.saved' CustomEvent on document
        └── views/
            ├── README.md          view convention + how-to recipes
            ├── login.js           public login screen
            ├── games-list.js      filter panel + paginated game table + SSE auto-refresh
            ├── game-detail.js     single game view + admin Hide/Delete buttons
            ├── game-form.js       ⚠ HEAVIEST file; new game + edit; draft persistence + undo
            ├── stats.js           KPIs + Chart.js charts; matchup heatmap; calendar; trends
            ├── warmap.js          ⚠ Theatre of War canvas — DO NOT TOUCH constants (see invariants)
            ├── admin.js           user management, audit log, seasons, guest-account promotion, change-own-password
            ├── ratings.js         ⚠ ADMIN-ONLY /rankings — Glicko-2 leaderboard + balanced matchmaker
            ├── player.js          per-player profile (overview + per-faction + streaks)
            └── profile.js         self-serve "My Profile" — army_name + change password
```

High-traffic files when iterating: **`game-form.js`**, **`games.js`**, **`warmap.js`**, **`stats.js`**. For module-internal conventions, prefer the directory's `README.md` over scrolling this file.

---

## Critical invariants — DO NOT TOUCH WITHOUT THINKING

These are load-bearing. Changing any of them silently breaks production.

| Invariant | File | Why it's frozen |
|---|---|---|
| `MAP_SEED = 0xDEAD40` | `app/js/views/warmap.js` | The whole Theatre of War is a Voronoi computed from this seed. Change it and every faction's territory boundary jumps to a new shape for everyone, instantly invalidating the visual continuity that's the whole point. |
| `FACTION_HOMES` positions | `app/js/views/warmap.js` | Each faction's seed anchor sits at a hard-coded `[x, y]` in 0..1 space. Anchors are no longer drawn as fortresses — they're the invisible roots that drive the initial Voronoi assignment. Editing or reordering shifts every banner's seed site and reshapes the whole map. **Append new factions only; never edit or reorder.** |
| `FACTION_COLOURS` | `app/js/views/warmap.js` | Lore-matched (Blood Angels red, Salamanders green, etc). Treat as the canonical palette. |
| YAAB CSS variables | `app/css/style.css` | `--bg`, `--panel-bg`, `--accent`, `--font-display`, etc. were copied verbatim from the sister `yetanotherarmybuilder` site to keep visual consistency across the user's properties. Don't redesign — match. |
| 5 battle rounds | everywhere | `ROUNDS = [1,2,3,4,5]` in `game-form.js`; `CHECK (round_number BETWEEN 1 AND 5)` in `schema.sql` (twice). 10e is a 5-round game. |
| No public signup | `routes/auth.js` (no register endpoint) | Admin creates all accounts via `POST /admin/users`. Login page must not have a "Sign up" link. |
| No game deletion | `routes/games.js` (no DELETE) | Admin can only `PATCH /admin/games/:id/visibility { hidden: true }`. Per the user's spec: results are permanent. |
| Bootstrap admin only when users table is empty | `lib/auth.js` `ensureBootstrapAdmin()` | After first run, `ADMIN_PASSWORD` env var is ignored. To recover, INSERT directly via psql. |

---

## Common pitfalls (real bugs that have happened)

### 1. camelCase frontend ↔ snake_case database

The frontend sends and receives **camelCase** (`primaryScore`, `roundNumber`, `gameFormat`). The Postgres columns are **snake_case** (`primary_score`, `round_number`, `game_format`).

**Conversion happens at the boundary** — either when writing into the DB, or when shaping the response back to the client:

| Direction | Where the mapping lives |
|---|---|
| DB row → frontend (loading a game for edit) | `makeDraft()` in `app/js/views/game-form.js` |
| Frontend payload → DB INSERT | `insertPlayerChildren()` and the create/update handlers in `api/routes/games.js` |
| `computeFinalScores(players)` reads camelCase | `api/routes/games.js` — it operates on the request body before insert |

**The bug:** `computeFinalScores` once read `r.primary_score` instead of `r.primaryScore`, which made every game total to 0–0 → recorded as a draw forever. If you touch this function, **the keys must be camelCase** (it runs on the request payload, not on DB rows).

### 2. `rerender()` in `game-form.js` blows away input focus

The form view has a `rerender()` helper that clears the form root and rebuilds. **Don't trigger it on every keystroke** — only on structural changes (mission pack change, faction change, add/remove a card slot). For score inputs, mutate the draft state directly in the `change` listener; let the next structural rerender pick up the value.

### 3. Schema migrations aren't automatic

`initSchema()` runs `schema.sql` on every container start. `CREATE TABLE IF NOT EXISTS` won't ALTER an existing table. To add a column to an existing table, append a guarded `ALTER TABLE` block — see the `player_challengers.round_number` migration in `schema.sql` for the pattern:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='X' AND column_name='Y'
  ) THEN
    ALTER TABLE X ADD COLUMN Y ...;
  END IF;
END $$;
```

### 4. Caddy mount is read-only and roots at `app/`

`/srv/40kResultsTracker/app` is what's served. Backend code at `/srv/40kResultsTracker/api` is invisible to the public web. **Don't put anything sensitive in `app/`** assuming privacy.

### 5. NAT loopback isn't a thing on this host

`https://40k.thewheeliebois.com` from inside the host will time out. Smoke-test with:

```bash
curl --resolve 40k.thewheeliebois.com:443:127.0.0.1 https://40k.thewheeliebois.com/api/health
```

For real public-reach checks, ask the user to hit it from a phone on cellular.

### 6. Schema/seed are idempotent — extend them, don't rewrite

`schema.sql` uses `CREATE TABLE IF NOT EXISTS` everywhere; `seed.sql` uses `ON CONFLICT DO NOTHING`. Both run on every startup. Adding new INSERTs is safe; do not write seed entries that depend on previous seed runs having committed (no SELECT-then-INSERT-by-id patterns; use the `SELECT id, n FROM factions, (VALUES …) AS d(n) WHERE factions.name = '…'` cross-join pattern that's already in there).

### 7. Determinism in `warmap.js` — no `localeCompare`, no Object iteration on numeric-looking keys

The Theatre of War map MUST render byte-identically on every browser, OS and locale. This is the only "feature" the user has explicitly demanded for cross-device consistency. Things that quietly break determinism:

- **`String.prototype.localeCompare`** — uses the user's default locale. `'Bob::5'.localeCompare('alice::5')` can return different signs in `tr-TR` vs `en-US`. We hit this exact bug when two banners shared `first_seen_at` and the tiebreaker decided who claimed the closer seed site. **Always use codepoint comparison** (`a < b ? -1 : a > b ? 1 : 0`) in any sort that affects rendering.
- **Object property iteration** when keys could be integer-like. V8 reorders integer-string keys (`'42'`, `'7'`) before non-integer keys, regardless of insertion order. Our `unitKey` is `${player_key}::${faction_id}` so the `::` makes keys non-integer; iteration is insertion-order. If you ever change `unitKey` to a bare integer, switch to iterating an explicit array (the existing `sorted` array is the canonical order).
- **`Math.sin/cos`** — implementation-defined per ECMAScript spec. In practice modern V8/SpiderMonkey/JSC produce identical results, but a last-bit difference at a polygon vertex *could* flip a single grid cell's land-mask result. Hasn't bitten us yet; if it does, replace trig with a polynomial approximation.

When adding any new code that affects map output, run through this checklist mentally. The first symptom of a determinism break is "the map looks the same but territories are slightly differently shaped on Sarah's machine."

### 8. Player names are free-text but linked at save time

The new-game form has a single text input for each player's name (no registered/guest toggle). Internally we still store either `game_players.user_id` or `game_players.guest_name` — never both. **The save handlers run `resolvePlayerIdentities()` first** (see `routes/games.js`): for each player whose `userId` is null, it looks up `users.display_name` (case-insensitive, active users only) and rewrites the row to `userId = <found>, guestName = null`. If no match, the row stays a guest.

Why it matters: on the war map, `army_name` only flows through when `gp.user_id` is set — a guest_name string never joins to `users`. Same for head-to-head and player-winrate stats: they group by `(user_id, guest_name)` together, so an unlinked guest_name="Alec" and a real user "Alec" would split into two leaderboard rows.

`seed.sql` ends with an idempotent `UPDATE game_players SET user_id = u.id, guest_name = NULL FROM users u WHERE …` that backfills historical rows the same way. Re-runs find no work once linked.

If you ever want a typed name to **stay** a guest even when it matches a registered user (e.g. a friend-of-a-friend with the same name as a member), you need to bypass `resolvePlayerIdentities` for that player — easiest path: prepend a marker like `"~Bob"` and strip it on display.

**The "I created the user account AFTER they already played as a guest" case.** This actually happens (Sarah played her first game while still a guest, you registered her account a week later). The historical games stay orphaned because `resolvePlayerIdentities` only fires at game-save time. Two fixes, neither involves a code change:

- **Per-user fix:** open each affected game in the form and click Save again. `resolvePlayerIdentities` runs against the now-existing user, rewrites `game_players.user_id`, and `recordBannerFirstSeen` writes the proper `user:<id>` row. This is what one-off cases want.
- **Bulk fix:** `docker compose restart 40k-api` re-runs `seed.sql` on boot, which contains an idempotent `UPDATE game_players SET user_id = u.id, guest_name = NULL FROM users u WHERE LOWER(u.display_name) = LOWER(gp.guest_name) AND u.is_active = TRUE`. One restart catches every newly-registerable guest at once.

After either fix the orphaned `banner_first_seen` row keyed `'guest:Sarah'` is left behind but is **harmless** — `routes/warmap.js`'s `active` CTE only emits player_keys derived from current `game_players` rows, so the orphan never appears in the rendered map. If clutter ever bothers you:

```sql
DELETE FROM banner_first_seen b
WHERE b.player_key LIKE 'guest:%'
  AND NOT EXISTS (
    SELECT 1 FROM game_players gp
    WHERE gp.guest_name IS NOT NULL
      AND b.player_key = 'guest:' || gp.guest_name
      AND gp.faction_id = b.faction_id
  );
```

**This helper now exists.** `api/lib/adopt-guest.js` (`previewGuests` + `promoteAllGuests`) is wired to **Admin → Guest Accounts → Promote guests** (`POST /admin/promote-guests`). It goes one step further than the old backfill: guests with **no** matching account get a brand-new **inactive** account (can't log in) so every player is a first-class entity for rankings etc. It migrates `banner_first_seen` (preserving `first_seen_at` + anchors) so the war map stays put — verified by a transaction-rollback dry run. Idempotent. Relatedly, `resolvePlayerIdentities` now matches **active or inactive** accounts (active preferred), so a future game typed with a promoted guest's name re-links to their account instead of re-fragmenting. The per-game / restart workarounds above still work for one-offs.

---

## Backend architecture

### Boot sequence (`api/server.js`)

1. Construct the Express app + session middleware (Postgres-backed via `connect-pg-simple`)
2. Apply `express-rate-limit` to `/auth/login` (20 attempts / IP / 15 min)
3. `initSchema()` — runs `schema.sql` then `seed.sql` (both idempotent)
4. `ensureBootstrapAdmin()` — if `users` is empty AND `ADMIN_PASSWORD` is set, insert the admin
5. Mount `/health`, `/auth`, `/admin`, `/games`, `/stats` (twice — once for `stats.js`, once for `warmap.js`), `/reference`, `/events`, `/seasons`, `/ratings`
6. Top-level error handler emits the uniform `{ error, code? }` body with status from `err.status`
7. `app.listen(PORT)`

### Route module convention

Every `routes/*.js` looks like:

```js
import { Router } from 'express';
import { requireAuth /* or requireAdmin */ } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);   // or requireAdmin for admin.js

router.get('/foo', async (req, res) => { … });

export default router;
```

`auth.js` is special — it does NOT call `router.use(requireAuth)` at the top because login/logout must be reachable while logged out. Auth requirement is per-route via the `requireAuth` middleware passed inline.

### The two heavy helpers in `routes/games.js`

- **`computeFinalScores(players)`** — sums `primaryScore` from rounds + `score` from secondaries + `score` from challengers. Recomputes `secondaryScore` per round from the cards. Sets `result` to `'win'/'loss'/'draw'`. **Manual winner override:** if `players[0].manualWinner` is true → P1 wins; both true → draw; else falls back to score comparison. Read camelCase, not snake_case.
- **`insertPlayerChildren(client, gamePlayerId, p)`** — writes `game_rounds`, `player_secondaries`, `player_challengers` rows for one player. Always called inside `withTx()`.

For game updates, the pattern is **delete-then-reinsert all children** (rounds, secondaries, challengers) — there's no diff/patch. The transaction makes that safe.

### `lib/db.js` exports

- `pool` — pg `Pool` (use `pool.query` for one-offs)
- `withTx(async (client) => {...})` — wraps in BEGIN/COMMIT/ROLLBACK; pass `client` to inner queries
- `initSchema()` — boot-time only

### `lib/auth.js` exports

- `hashPassword(plain)` — bcrypt cost 12
- `verifyPassword(plain, hash)`
- `ensureBootstrapAdmin()` — boot-time only
- `requireAuth(req, res, next)` — 401 if no session
- `requireAdmin(req, res, next)` — 401 if no session, 403 if `role !== 'admin'`

---

## Frontend architecture

### Routing

Hash-based router in `app/js/app.js`:

```js
const routes = [
  { match: /^\/$/,                   handler: () => renderWarmap(state) },
  { match: /^\/war$/,                handler: () => renderWarmap(state) },
  { match: /^\/games$/,              handler: () => renderGamesList(state) },
  { match: /^\/games\/new$/,         handler: () => renderGameForm(state, null) },
  { match: /^\/games\/(\d+)\/edit$/, handler: (m) => renderGameForm(state, parseInt(m[1], 10)) },
  { match: /^\/games\/(\d+)$/,       handler: (m) => renderGameDetail(state, parseInt(m[1], 10)) },
  { match: /^\/stats$/,              handler: () => renderStats(state) },
  { match: /^\/rankings$/,           handler: () => renderRatings(state), requireAdmin: true },
  { match: /^\/admin$/,              handler: () => renderAdmin(state) },
];
```

`route()` runs on `hashchange` and `load`. If no session, `renderShell` short-circuits to the login view. Navigate from anywhere with `window.__nav('/games')` — a global set in `app.js`.

### View module convention

Every file in `app/js/views/` exports one async function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. Async `await reference.…()` calls happen up-front. Local helpers and a `rerender()` closure mutate a `draft` object and rebuild as needed.

### DOM helpers — use them, do not template-string

`components.js`:

- `el(tag, attrs?, children?)` — the workhorse. `attrs.class`, `attrs.style` (object), `attrs.onClick` etc. Children can be string, node, array, or null/false (skipped).
- `clear(node)` — empty children
- `toast(msg, kind?)` — bottom-right ephemeral toast (3s); kind `'error'` styles red
- `pill(text, kind?)` — a styled badge; kind `'win'`, `'loss'`, `'draw'`, `'first'`, `'hidden'`
- `fmtDate(d)` — YYYY-MM-DD
- `selectOptions(items, valueKey?, labelKey?, includeBlank?, blankLabel?)` — quick `<option>` array

**Don't introduce React, Vue, lit-html, htm, or template-literal HTML.** This codebase is consciously framework-free; the `el()` pattern is consistent across every view. New code should match.

### `api.js` shape

Always extend the right export object — never call `fetch` directly from a view:

```js
export const auth      = { me, login, logout, changePassword, updateMe };
export const reference = { factions, detachments, missionPacks, missionDetails, users, playerNames };
export const games     = { list, get, create, update };
export const stats     = { overview, factionWinRates, playerWinRates, factionMissionBreakdown,
                            factionDeploymentBreakdown, factionMatchups, headToHead,
                            firstTurnImpact, secondaryAverages, warmap,
                            detachmentWinRates, trends, player, calendar };
export const admin     = { users, createUser, updateUser, setVisibility, deleteGame, audit,
                            guestsPreview, promoteGuests };
export const seasons   = { list, start };
export const ratings   = { leaderboard, suggest, history };   // admin-only
```

All requests `credentials: 'same-origin'`. Errors throw with `.status`, `.code` (server's `error.code`), and `.data` on the Error. Network failures throw with `status: 0` and `code: 'network'`.

---

## HTTP API reference

All routes require an authenticated session unless noted. Responses are JSON. Errors return the uniform shape `{ error: '<message>', code?: '<string>' }` with status from `err.status` (default 500). Login is rate-limited to 20 attempts / IP / 15 min.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | `{ ok: true }` |
| POST | `/auth/login` | public | `{ username, password }` → user object; sets session |
| POST | `/auth/logout` | session | destroys session |
| GET | `/auth/me` | auth | current user `{ id, username, displayName, role, armyName }` |
| PATCH | `/auth/me` | auth | self-serve update; currently only `{ armyName }` |
| POST | `/auth/change-password` | auth | `{ currentPassword, newPassword }` |
| GET | `/reference/factions` | auth | `[{ id, name }]` |
| GET | `/reference/factions/:id/detachments` | auth | `[{ id, name }]` — UNION of seeded + free-text from past games |
| GET | `/reference/mission-packs` | auth | `[{ id, name }]` |
| GET | `/reference/mission-packs/:id/details` | auth | `{ primaryMissions, deploymentMaps, missionRules, secondaryCards, challengerCards }` |
| GET | `/reference/users` | auth | active users `[{ id, username, display_name }]` |
| GET | `/reference/player-names` | auth | distinct names from past games (for autocomplete) |
| GET | `/games` | auth | filtered list (q params: `playerUserId`, `playerFaction`, `opponentFaction`, `missionPack`, `primaryMission`, `deploymentMap`, `format`, `playMedium` (`physical`\|`digital`), `dateFrom`, `dateTo`, `includeHidden`, `q` (free-text search), `limit`, `offset`) |
| GET | `/games/:id` | auth | full game with `players[]`, each with `rounds[]`, `secondaries[]`, `challengers[]` |
| POST | `/games` | auth | create game; payload is the camelCase draft shape — see `serializeDraft()` in `game-form.js`; auto-attached to active season |
| PUT | `/games/:id` | auth | replace game; same payload as POST |
| GET | `/stats/overview` | auth | totals + recent activity |
| GET | `/stats/faction-winrates` | auth | per-faction W/L/D + win% + avg score |
| GET | `/stats/player-winrates` | auth | per-player W/L/D + win% (groups by user_id OR guest_name) |
| GET | `/stats/faction-mission-breakdown?factionId=N` | auth | how a faction performs across primary missions |
| GET | `/stats/faction-deployment-breakdown?factionId=N` | auth | by deployment map |
| GET | `/stats/faction-matchups` | auth | full A-vs-B matrix (every faction pair with games) |
| GET | `/stats/head-to-head?userA=N&userB=M` | auth | every game between two users |
| GET | `/stats/first-turn-impact` | auth | win% comparison going first vs second |
| GET | `/stats/secondary-averages` | auth | per-card pick count + avg score |
| GET | `/stats/detachment-winrates[?factionId=N]` | auth | per-`(faction, detachment_name)` W/L/D + win% |
| GET | `/stats/trends` | auth | `{ monthlyGames, monthlyAvgScore, factionPopularity }` |
| GET | `/stats/calendar[?days=365]` | auth | `[{ date, games }]` — fuels the heatmap |
| GET | `/stats/player/:playerKey` | auth | profile + per-faction + streaks for `'user:<id>'` or `'guest:<name>'` |
| GET | `/stats/warmap[?season=N]` | auth | array of (player, faction) banners: `player_key`, `player_name`, `army_name`, `faction_id`, `faction`, `games`, `wins`, `losses`, `draws`, `win_rate`, `territory_score`, `first_seen_at`. Defaults to active season. |
| GET | `/seasons` | auth | every season + games count |
| POST | `/seasons` | admin | `{ name, mapSeed? }` — closes current, opens new (broadcasts `season.changed`) |
| GET | `/admin/users` | admin | all users including inactive |
| POST | `/admin/users` | admin | `{ username, displayName, password, role, armyName? }` |
| PATCH | `/admin/users/:id` | admin | `{ displayName?, role?, isActive?, password?, armyName? }` |
| PATCH | `/admin/games/:id/visibility` | admin | `{ hidden: bool }` (broadcasts `game.saved`) |
| DELETE | `/admin/games/:id` | admin | hard delete; cascades to rounds/secondaries/challengers (broadcasts `game.saved`) |
| GET | `/admin/audit[?limit=100]` | admin | recent audit_log rows DESC by created_at |
| GET | `/admin/guests/preview` | admin | read-only: which guests a promotion run would `create` vs `link` |
| POST | `/admin/promote-guests` | admin | promote all unlinked guests to inactive accounts (idempotent, war-map-safe) |
| GET | `/ratings/leaderboard[?marginOfVictory=true&model=glicko\|whr]` | admin | ranked players: `displayFloor` (confidence-adjusted, the rank/headline value), `displayRating` (raw "est"), `rd`, `confidence`, W/L/D, `provisional`, `inMainPool`. **`model` defaults to `whr`** (whole-history). |
| GET | `/ratings/suggest?present=1,2,3[&marginOfVictory=true&model=…]` | admin | up to 4 balanced pairing configs with predicted win-% + last-met; `bye` if odd |
| GET | `/ratings/history[?marginOfVictory=true&model=…]` | admin | every player's day-by-day series for the compare chart `[{ userId, displayName, series:[{x,y}] }]` (y = confidence floor; carried forward to today) |
| GET | `/events` | auth | Server-Sent Events stream; emits `game.saved`, `season.changed` |

**Total: 45 endpoints** in `routes/*.js` (cross-check: `grep -E "router\.(get|post|put|patch|delete)" api/routes/*.js \| wc -l`), plus `/health` defined inline in `server.js`. `/ratings/*` and the two guest endpoints are admin-only; ratings are computed on the fly (no tables).

---

## DB schema reference

Tables (snake_case throughout):

| Table | Purpose | Key columns |
|---|---|---|
| `users` | account holders | id, username (unique), display_name, password_hash, role ('user'\|'admin'), is_active, army_name (optional, shown on the war map) |
| `session` | express-session storage | sid, sess (json), expire — auto-managed by `connect-pg-simple` |
| `factions` | parent codex factions | id, name (unique), parent_id (nullable, currently unused) |
| `detachments` | seeded per-faction detachments — autocomplete only; UNIONed with free-text `game_players.detachment_name` from past games. Consumed by `/stats/detachment-winrates`. | id, faction_id, name; UNIQUE (faction_id, name) |
| `mission_packs` | e.g. Pariah Nexus, Leviathan | id, name (unique) |
| `primary_missions` | e.g. Take and Hold | id, mission_pack_id, name |
| `deployment_maps` | e.g. Hammer and Anvil | id, mission_pack_id, name |
| `mission_rules` | e.g. Chilling Rain | id, mission_pack_id, name |
| `secondary_cards` | tactical or fixed | id, mission_pack_id, name, card_type ('tactical'\|'fixed') |
| `challenger_cards` | Pariah Nexus Secret Missions (formerly "Gambits"); 4 cards: Command Insertion, War of Attrition, Unbroken Wall, Shatter Cohesion | id, mission_pack_id, name |
| `games` | the match record | id, created_by_user_id, played_at (DATE), game_format, points_limit, mission_pack_id, primary_mission_id, deployment_map_id, mission_rule_id, turn_count, end_condition ('normal'\|'concession'\|'tabled'), tournament_*, location, notes, hidden_from_stats, play_medium ('physical'\|'digital' — digital = Tabletop Simulator), season_id (FK seasons.id), created_at, updated_at |
| `game_players` | exactly 2 per game | id, game_id, seat (1\|2), user_id (nullable), guest_name (nullable — at least one required), faction_id, detachment_id (legacy — populated for old games only), detachment_name (free-text; how new games store the detachment), army_list_code, went_first, is_attacker, final_score, result ('win'\|'loss'\|'draw') |
| `game_rounds` | per-round score per player | id, game_player_id, round_number (1-5), primary_score, secondary_score, cp_remaining; UNIQUE (game_player_id, round_number) |
| `player_secondaries` | per-round secondary scoring | id, game_player_id, round_number (nullable for fixed), card_id, card_name, score, was_discarded |
| `player_challengers` | per-round challenger scoring | id, game_player_id, card_id, card_name, round_number (nullable), completed, score |
| `banner_first_seen` | one row per (player_key, faction_id); `first_seen_at` is set on save and **never updated** — the war map's seed-claim order (and thus its cross-regen geographic stability) depends on this | player_key, faction_id, first_seen_at; PK (player_key, faction_id) |
| `seasons` | one row per Theatre-of-War season; only one `is_active = TRUE` (enforced by partial unique index). `map_seed` drives the canvas geometry for that season — archived seasons render with their own continent. | id, name, map_seed (BIGINT), started_at, ended_at, is_active, created_at |
| `audit_log` | append-only audit trail of every write action (game create/update/delete/visibility, user create/update, login, password change, season start). `payload` is JSONB. | id, actor_user_id (FK ON DELETE SET NULL), actor_username, action, target_type, target_id, payload (jsonb), created_at |

### View

`v_game_player_stats` — denormalised one-row-per-`game_player` view with columns from `games` joined and the opposite seat's player joined as `opponent_*`. Use it for stats queries that need "this player's row + their opponent in one shot".

### Seed-data totals (current)

- **28 factions** (Adepta Sororitas through World Eaters)
- All current 10e detachments per codex
- 2 mission packs with full primaries / deployments / rules / secondaries / challengers (Pariah Nexus, Leviathan), plus stub names for Tempest of War / Crusade / Open Play / Other

When the user adds a new faction or mission pack, see "How to add things" below.

---

## Permission model

| Action | User | Admin | Enforced where |
|---|---|---|---|
| Log in | ✓ | ✓ | `POST /auth/login` |
| View games / stats / war map | ✓ | ✓ | `requireAuth` middleware on all `/games`, `/stats`, `/reference`, `/seasons`, `/events` routes |
| Create / edit games | ✓ | ✓ | `POST/PUT /games` (auth only) |
| Edit own profile (army_name, password) | ✓ | ✓ | `PATCH /auth/me` + `POST /auth/change-password`; the "My Profile" link in the header session row routes to `/profile` |
| Hide game from stats | – | ✓ | `requireAdmin` on `PATCH /admin/games/:id/visibility`; the **Hide** button in `game-detail.js` is conditionally rendered for admins only |
| Delete a game | – | ✓ | `requireAdmin` on `DELETE /admin/games/:id`; admin-only red **Delete** button on game-detail with `confirmModal` confirmation |
| Manage users | – | ✓ | `requireAdmin` on `/admin/users*`; the **Admin** nav link in `app.js` only renders if `state.user.role === 'admin'` |
| Manage seasons (start new) | – | ✓ | `requireAdmin` on `POST /seasons`; lives in the Admin → Seasons panel |
| Promote guests to accounts | – | ✓ | `requireAdmin` on `/admin/guests/preview` + `POST /admin/promote-guests`; Admin → Guest Accounts panel |
| View rankings / matchmaker | – | ✓ | `requireAdmin` on all `/ratings/*`; the **Rankings** nav link + `/rankings` route render only for admins. **Private by spec** — players can't see their own rating |
| View audit log | – | ✓ | `requireAdmin` on `GET /admin/audit`; rendered in the Admin → Audit Log panel |
| Subscribe to live updates | ✓ | ✓ | `requireAuth` on `GET /events`; `app.js` calls `startLiveFeed()` once a session is established |
| Change own password | ✓ | ✓ | `POST /auth/change-password` |

Server enforcement is the source of truth; client gating is a UX convenience only.

---

## How to add things (recipes)

### A new mission pack

1. `api/db/seed.sql` — append:
   - `INSERT INTO mission_packs (name) VALUES ('Pack Name') ON CONFLICT (name) DO NOTHING;`
   - Then 5 `INSERT INTO ... SELECT id, n FROM mission_packs, (VALUES ...) AS d(n) WHERE mission_packs.name = 'Pack Name' ON CONFLICT DO NOTHING;` blocks for `primary_missions`, `deployment_maps`, `mission_rules`, `secondary_cards` (with `card_type`), `challenger_cards` (optional)
2. Restart the container (`docker compose up -d --build` or just `docker restart 40k-api`). The new pack appears in the New Game form's mission-pack dropdown automatically.

### A new secondary or challenger card to an existing pack

Just append to the right `INSERT INTO secondary_cards / challenger_cards` block in `seed.sql`. `ON CONFLICT DO NOTHING` makes it safe to re-run.

### A new faction

1. `api/db/seed.sql` — append to the `INSERT INTO factions (name) VALUES …` block, then add a `INSERT INTO detachments` cross-join for that faction's detachments
2. `app/js/views/warmap.js` — append to `FACTION_HOMES` (lore-accurate `[x, y]` in 0..1 space — drives the seed site, no longer drawn as a fortress) and `FACTION_COLOURS` (canonical hex). Optionally extend `FACTION_GLYPH` if you want a legend emblem. **Append, never reorder existing entries.**
3. Restart container

### A new stats chart

1. Backend: add a new handler in `api/routes/stats.js` (or a new route file mounted under `/stats`)
2. Client: add a method on the `stats` export in `app/js/api.js`
3. View: render the chart inside `app/js/views/stats.js` via Chart.js (already loaded globally in `index.html`)

### A new view / page

1. Create `app/js/views/foo.js` exporting `renderFoo(state, ...)`
2. Add a `<script type="module" src="/js/views/foo.js"></script>` line to `app/index.html` (script order doesn't matter — they're modules)
3. Import in `app/js/app.js`: `import { renderFoo } from './views/foo.js';`
4. Add an entry to the `routes` array
5. Add a `navLink('/foo', 'Foo')` to `navItems` (and gate by role if needed: `if (state.user.role === 'admin')`)

### A new permission rule

1. New middleware in `api/lib/auth.js` (e.g. `requireOwner`)
2. Apply in the relevant route module
3. Mirror the gating in `app.js` `navItems` (hide nav link) AND in any view that should refuse the action (e.g. early-return with a "permission denied" panel)

### A schema change to an existing table

Append a guarded `ALTER TABLE` block to `api/db/schema.sql` — see the `player_challengers.round_number` and `users.army_name` migrations for the pattern. Plain `CREATE TABLE IF NOT EXISTS` does NOT alter existing tables.

### A new user-profile field (e.g. preferred general's name, banner colour…)

1. `api/db/schema.sql` — add the column to `CREATE TABLE users` AND a guarded `ALTER TABLE` block (so existing installs migrate)
2. `api/routes/admin.js` — accept the field in `POST /admin/users` and `PATCH /admin/users/:id`; include it in the `RETURNING` clauses
3. `api/routes/auth.js` — if the user should see their own value, add it to the `/auth/me` response
4. `app/js/views/admin.js` — wire input into the create form + a per-row edit button
5. Anywhere the field affects display (war map, stats labels) — pull it through the relevant `routes/*.js` SELECT and use it client-side

The `users.army_name` column added 2026-05 follows this exact pattern end to end.

### Backfilling DB rows after a schema/behaviour change

If the meaning of an existing column changes (e.g. "guests typed by name should now be linked to user accounts"), append an idempotent `UPDATE … FROM …` block at the bottom of `api/db/seed.sql`. Idempotent means: write it so it finds zero rows on the second run. Example pattern from the guest-name → user_id linkage:

```sql
UPDATE game_players gp
SET user_id = u.id, guest_name = NULL
FROM users u
WHERE gp.user_id IS NULL
  AND gp.guest_name IS NOT NULL
  AND u.is_active = TRUE
  AND LOWER(u.display_name) = LOWER(gp.guest_name);
```

Don't gate it on a "have I run this once" flag — let it run every container start. PG handles "no matching rows" instantly.

### Linking a guest to a registered user (manual)

Comes up when an admin creates a user account *after* they've already played as a guest. Pure data fix, no code change. See pitfall #8 for the full reasoning. Two paths:

- **One user, surgical:** open each affected game, click Save. `resolvePlayerIdentities` rewrites `game_players.user_id` and `recordBannerFirstSeen` writes the matching `user:<id>` row.
- **Bulk:** `docker compose restart 40k-api`. The seed.sql backfill `UPDATE` runs and links every guest whose name case-insensitively matches an active user.

Orphan `banner_first_seen` rows keyed `'guest:Name'` are harmless after either fix — they don't render. Cleanup query in pitfall #8 if you want them gone.

### Per-module READMEs

When in doubt, the module's own README is the closer source of truth than this file. They cover module-internal conventions; this file covers cross-cutting orientation.

| Module | README |
|---|---|
| Backend service overview | `api/README.md` |
| Backend helpers (`db`, `auth`, `audit`, `events`, `game-scoring`) | `api/lib/README.md` |
| Route modules + mount prefixes + auth | `api/routes/README.md` |
| Schema/seed conventions, idempotency rules, ALTER pattern | `api/db/README.md` |
| Smoke tests | `api/test/README.md` |
| Frontend overview, no-build philosophy | `app/README.md` |
| `app.js` / `api.js` / `components.js` / `live.js` roles | `app/js/README.md` |
| View module convention + recipes | `app/js/views/README.md` |
| Backup script + cron | `scripts/README.md` |

---

## Theatre of War internals (`app/js/views/warmap.js`)

The map is a deterministic procedural continent ("Boimaggedon") tiled into ~120 evenly-sized territories via Voronoi + Lloyd's relaxation. Each territory is owned by a **(player, faction) banner** — Joe's Necrons and Jane's Necrons are separate units with separate regions but share the Necron green colour. Each banner's label (army_name → display_name → guest name) floats at the centroid of its owned cells; no fortress markers are drawn. Rendered as a 40k war-room tactical display: dark navy backdrop, glowing cyan coastline, amber war-front borders, monospace HUD chrome. Same seed → identical output on every device, every browser, forever.

### Constants (immutable)

- `MAP_SEED = 0xDEAD40` — drives both the continent silhouette and the territory site placement. **Never change.**
- `VIRTUAL_W = 1280`, `VIRTUAL_H = 794` — fixed compute resolution. Map is generated at this size and CSS-scaled for display. Critical for cross-device consistency: same canvas dimensions on every device → byte-identical territory geometry and faction allocation. **Never change.**
- `FACTION_HOMES` — `{ 'Faction Name': [x, y] }` in 0..1 canvas-space. 28 entries; matches faction count in `seed.sql`. **Append-only.** Drives the seed site each new banner claims (closest unclaimed Voronoi site to the anchor). Seeds are invisible — they're the stability root, not a drawn fortress.
- `FACTION_COLOURS` — `{ 'Faction Name': '#hex' }` lore-matched palette. Same key set as `FACTION_HOMES`.
- `N_TERRITORIES = 120` — total territories on the continent. Changing this changes everyone's map. The Poisson-disc `minDist` scales as `1/sqrt(N)` so spacing stays sane at any N (the formula evaluates to the original 0.07 of canvas at N=50).
- `LLOYD_ITERATIONS = 8` — relaxation passes; more = more even cell sizes.
- `CELL = 4` — Voronoi/raster sample step in pixels.

### Render pipeline (`drawTacticalMap`)

1. **Continent silhouette.** `generateContinent` builds a closed polygon by sampling 96 angles around the canvas centre with multi-octave sine noise and a slight horizontal squash. Result: an organic, asymmetric coastline.
2. **Territory sites.** `generateTerritories` Poisson-disc-samples `N_TERRITORIES` points inside the polygon with `minDist` scaled as `1/sqrt(N)` so spacing stays sane at any N.
3. **Voronoi via grid sampling.** For each grid cell at step `CELL`, find the nearest site (-1 for ocean cells outside the polygon). Land mask is precomputed once.
4. **Lloyd's relaxation.** For 8 iterations: rasterize Voronoi → compute centroid of each cell → move site to its centroid → rasterize again. Result: cells become roughly equal area and similar shape.
5. **Adjacency graph.** `buildAdjacency` walks the grid; cells differing in ownership across an edge are marked as neighbours.
6. **Per-(player, faction) territory assignment.** `assignTerritories` receives an array of "units" — one row per `(player_key, faction_id)` returned by `/stats/warmap`. Sort by `first_seen_at`, tiebreak by `(player_key, faction_id)` via codepoint comparison. Four phases:
   - **Seed claim** — each banner claims the closest unclaimed Voronoi site to its `FACTION_HOMES` anchor. Seeds are invisible roots; they don't get drawn as fortresses.
   - **Initial fill** — multi-source BFS from all seeds simultaneously. Every land cell ends up owned by the banner whose seed reached it first across the adjacency graph (graph-distance Voronoi). No unclaimed land remains.
   - **Pressure equalization** — over-target banners cede border cells to under-target neighbours, cascading outward until every banner matches `round(territory_score / total * N_TERRITORIES)` or the geography refuses. A local `flipKeepsContiguous` guard prevents flips that would split a region into islands.
   - **Same faction, two players** → two separate territory clusters in the same general region of the continent, distinguished by a bold amber war-front border between them.
7. **Paint.** Land tiles painted in faction colour blended over the navy backdrop; ocean = backdrop. (No unclaimed neutral land — the multi-source BFS in step 6 covers everything.)
8. **Coastline + borders.** Continent edge in glowing cyan (shadowBlur). Borders between same-faction territories = thin cyan; between different factions = bold amber (the "war front").
9. **Labels.** Each banner's label is drawn at the centroid of its owned cells. Primary line = army_name (or display_name fallback) in amber monospace; faction abbreviation in cyan below.
10. **HUD chrome.** Scan lines (3px stride), corner brackets, compass with N marker, bottom-right tactical readout.

### Territory score formula

Computed server-side in `api/routes/warmap.js`:

```js
const winsWeight   = Math.log1p(wins)            / Math.log1p(totalGames);
const pointsWeight = Math.log1p(adjusted_points) / Math.log1p(totalGames * 75);
const territory_score = Math.min(1, winsWeight * 0.66 + pointsWeight * 0.33);
```

Where `adjusted_points = SUM(final_score * 5 / turn_count)` — i.e., per-game scores normalised to a 5-round equivalent before summing. Saturation thresholds (`log1p(totalGames)` for wins, `log1p(totalGames * 75)` for points) scale with the season so the curve stays meaningful as the season grows.

Tuning notes: ~2:1 wins-vs-points weighting means wins dominate but high-scoring losses still earn meaningful land. Adjust those constants in `api/routes/warmap.js` if the leaderboard feels too lopsided. The log shape gives early games big returns and diminishing returns past saturation.

### Why the map stays geographically stable across regens

**Persistent first-seen timestamps (server-side).** The `banner_first_seen` table holds one row per `(player_key, faction_id)` with a `first_seen_at` set when the banner first saves a game. **That row is never updated** — adding new games, hiding old games, editing a game's `played_at`, even deleting and re-entering all games for a banner can never move it earlier in the order. New banners get `NOW()` on their first save, which is later than every existing banner's `first_seen_at`, so they slot into the back of the seed-claim order without disturbing anyone.

The earlier (broken) approach used `MIN(played_at)` from the live game data. That's NOT monotonic — backdating a game pulls the banner earlier in the order, and `assignTerritories` then re-runs from scratch giving previously-first banners a different seed site. Symptom seen in the wild: "me and the Tyranids basically just traded places, even our territories moved." Fixed.

**Seed-claim determinism (client-side).** `assignTerritories` claims seeds in `first_seen_at` order. Each banner's seed site is the closest unclaimed Voronoi site to its `FACTION_HOMES` anchor at claim time. Because earlier banners always claim first and the candidate site set is unchanged between regens, every existing banner ends up with the exact same seed site as the previous render. New banners always sort later, so they pick from whatever is left — never displacing an existing seed.

The pressure-equalization phase that runs after the initial fill is also deterministic (banners iterated in `sorted` order, cells in tid order, neighbours in adjacency-list order), so the same scores + same anchors produce a byte-identical map on every device, every session.

What CAN shift between regens: borders move when scores change or banners join/leave, because `totalScore` changes and `target[k]` is recomputed. Same-region behavior holds — a banner's territory grows or shrinks around its seed rather than teleporting elsewhere.

### When the map CAN reshape (edge cases worth knowing)

- The continent itself moves if `MAP_SEED`, `VIRTUAL_W/H`, or `LLOYD_ITERATIONS` change — every region goes with it.
- Adding a new entry to `FACTION_HOMES` between two existing entries (rather than appending) shifts every later faction's seed anchor.
- Truncating `banner_first_seen` makes every banner re-claim from scratch in the seeded backfill order. Don't do this unless you mean it.

### Recipe: changing what shows on a banner's label

`drawLabels()` resolves the primary label as `u.army_name || u.player_name` inline. To change the displayed text, edit that fallback chain — never derive from `u.faction` (the faction abbreviation is already drawn as a secondary line below the army name). To set/edit a user's army name: Admin tab → user row → "Army" button.

---

## Player ranking internals (`/rankings`, admin-only)

A private MMR-style system, `requireAdmin`; **players cannot see their own rating by design**. Two interchangeable models (UI toggle / `?model=` param):

- **Whole-History** (`lib/whr.js`, **default**) — a global Bayesian Bradley-Terry fit over **all** games at once, so evidence propagates **both directions** (beating someone who later proves weak counts for less). A N(1500, 350²) prior regularises (undefeated ≠ ∞) and pins disconnected groups to a shared scale. Uncertainty = 1/√(Fisher info) → a zero-game player lands at RD 350, same scale as Glicko. **Recency-weighted**: `fitGlobal` takes a per-game weight `w`; `runWHR` sets it via time decay (`recencyWeight`, half-life `RECENCY_HALF_LIFE_DAYS` ≈ 6 months) so old games fade smoothly (less evidence → also higher RD). Tested in `test/whr.test.js`.
- **Glicko-2** (`lib/glicko2.js`) — the chess/Lichess system; **forward/causal**. A game's effect is locked to opponents' ratings *at that moment*; later results don't flow backward. Pure math pinned to Glickman's worked example in `test/glicko2.test.js` — don't "tidy" the volatility (Illinois) iteration. `decayRd(player, periods)` inflates RD by a fractional period count (elapsed-time decay).
- **`lib/ratings.js`** — `computeRatings({ marginOfVictory, model })` does the shared parse (usable games, connectivity via union-find, W/L/D, last-met) then dispatches to `runGlicko` (per-day forward batches; idle gaps inflate RD; one history point per day *played*) or `runWHR` (re-fit the whole graph at each game-date — a player's estimate can move on a day they *didn't* play, as the fit reshapes). Leaderboard RD also inflates from the last game to *today* (freshness). **Computed on the fly each request; no tables, no schema.** Tunables at top: `MOV_FULL`, `PERIOD_DAYS`, `RANK_FLOOR_K`, `RECENCY_HALF_LIFE_DAYS` (whole-history recency decay), display mapping, provisional thresholds.
- **Confidence floor (the ranking key)** — the board ranks and headlines by `displayFloor` = `displayRating(rating − RANK_FLOOR_K·rd)` (K=1.1), *not* the raw mean. So a 1-game player who beats the best sits **low** (high RD → low floor) and climbs as they prove it, instead of leaping to #2. The raw mean shows as "est", "±" is the confidence. Applies in both models.
- **Margin of victory** — direction from `result` (respects manual-winner / concession), magnitude from the score gap via `outcomeScore()` → a score in [0,1] (sums to 1 across the pair). UI toggle, default on.
- **Matchmaker** — `balancedPairings()` sorts present players by rating and pairs adjacent (min-total-gap on a line), returns up to 4 near-optimal configs for "reshuffle", a `bye` for odd counts, per-pair predicted win-% via `expectedScore()`. Close games, not best-vs-worst.
- **History chart** — `GET /ratings/history` returns each player's series `{x: date, y: floor}` — the line is the SAME confidence floor the leaderboard ranks by (so chart and board agree; no separate uncertainty band — the floor already *is* the conservative bound). Each line is **carried forward to today** at the current freshness-adjusted value, so it doesn't stop at the last game. The view plots them on one Chart.js **time axis** (daily points, month ticks — needs the `chartjs-adapter-date-fns` CDN in `index.html`); the y-axis auto-fits to the lines. Click a player (line, chip, or leaderboard name) to highlight: their line bolds, the rest dim.
- **Identity** — ratings key on `user_id`. Run **Admin → Guest Accounts → Promote guests** first so guests become accounts and get rated (see pitfall #8).
- **Digital vs physical (TTS)** — every competitive query (rankings, war map, all of `stats.js`) gates on the shared `COUNTED_GAMES` fragment from `lib/game-filter.js` (drop-in where the games table is aliased `g`), instead of the bare `hidden_from_stats = FALSE`. It **includes** digital (Tabletop Simulator) games by default; set `INCLUDE_DIGITAL_IN_STATS=false` in `.env` + restart to exclude them from all those surfaces at once. With the flag on, `COUNTED_GAMES === 'g.hidden_from_stats = FALSE'` exactly (byte-identical SQL → zero behaviour change). The games **browser** (`/games` list) is never gated — you can still see/filter digital games (`?playMedium=`). Per-game medium lives in `games.play_medium`.

To change behaviour, the tunables in `ratings.js` are the dial; the math in `glicko2.js` / `whr.js` should stay put (both have tests).

---

## Dev / deploy loop

Full installation: see `DEPLOY.md`.

Day-to-day update on the host:

```bash
cd ~/sites/sites/40kResultsTracker
git pull
docker compose up -d --build
```

Logs: `docker logs -f 40k-api`

Container-internal psql: `docker exec -it postgres psql -U 40k_user -d 40k_db`

Smoke test from the host: `curl --resolve 40k.thewheeliebois.com:443:127.0.0.1 https://40k.thewheeliebois.com/api/health`

---

## Coding style for this project

The system prompt's general rules apply. Project-specific reminders:

- **No comments unless WHY is non-obvious.** Identifier names should carry the meaning. The only inline comment blocks in this codebase are above frozen invariants (`MAP_SEED`, `computeFinalScores` payload contract).
- **No frameworks, no bundlers.** Use `el()` from `components.js`. Use ES modules (already configured — `<script type="module">`).
- **Match existing patterns.** Every view is `export async function renderXxx(state, ...)`. Every route module is `export default Router()` with `requireAuth` at the top.
- **Idempotent SQL.** New `CREATE TABLE` → `IF NOT EXISTS`. New `INSERT INTO seed` → `ON CONFLICT DO NOTHING`. Schema changes to existing tables → guarded `ALTER TABLE` in a `DO $$ … END $$` block.
- **Server-side enforcement is the source of truth.** Client gating is UX only.

---

## When in doubt

- The directory's own `README.md` for module-internal conventions (see "Per-module READMEs" above)
- `DEPLOY.md` for infra + nightly backup setup
- `api/lib/README.md` to find the right helper before writing a new one
- `api/routes/README.md` for "where does this endpoint live"
- `api/test/README.md` to add a new smoke test
- Git log for "when did this change" (`git log --oneline -- path/to/file`)
- Live YAAB CSS for styling reference (`yetanotherarmybuilder` repo on the user's GitHub) — visit https://github.com/stopsign002/yetanotherarmybuilder
