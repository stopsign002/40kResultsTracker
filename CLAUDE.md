# CLAUDE.md — 40k Results Tracker

This file is auto-loaded by Claude Code into every session. It is the single source of truth for orienting in this repo. **Read it first; it'll save you re-reading half the codebase.**

---

## What this is

Multi-user Warhammer 40,000 game-results tracker (10th and 11th edition — each game carries an `edition` flag; new games default to 11e). Friends log matches (mission, factions, per-round scoring, secondaries, challenger cards), browse a filterable game list, view a stats dashboard, and stake territory on a seeded "Theatre of War" galaxy map. Hosted at **https://40k.thewheeliebois.com** as a Docker stack alongside other thewheeliebois.com sites. See `DEPLOY.md` for infra/deploy steps.

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
├── .env.example            9 vars; copy to .env on the server (incl. INCLUDE_DIGITAL_IN_STATS
│                           and the optional MAILER_URL / MAILER_TOKEN pair)
├── scripts/
│   ├── README.md           per-script doc
│   └── backup.sh           nightly pg_dump → ~/sites/backups/, 30-day retention
├── api/
│   ├── README.md           service overview + npm scripts (start, test, typecheck)
│   ├── Dockerfile          node:22-alpine; npm install --omit=dev; runs server.js
│   ├── package.json        ESM module ("type": "module"); deps: express, pg, bcrypt,
│   │                       express-session, connect-pg-simple, express-rate-limit.
│   │                       devDeps: typescript, @types/node — typecheck only, and the
│   │                       Dockerfile's --omit=dev keeps both out of the runtime image
│   ├── tsconfig.json       editor / `npm run typecheck` only — noEmit, allowJs+checkJs.
│   │                       tsc is a devDependency, so `npm install` in api/ is all a
│   │                       clean clone needs. It exits non-zero today on pre-existing
│   │                       JSDoc drift (timeSeconds, faction-anchors tuple) — read it,
│   │                       don't gate on it
│   ├── types.js            shared JSDoc typedefs (PlayerPayload, GamePayload, BannerUnit)
│   ├── server.js           ENTRY: initSchema → ensureBootstrapAdmin → app.listen
│   ├── lib/                helpers — see api/lib/README.md
│   │   ├── db.js           pg pool + withTx() generic
│   │   ├── auth.js         bcrypt helpers, requireAuth / requireAdmin middleware
│   │   ├── audit.js        fire-and-forget audit log writer
│   │   ├── events.js       in-process SSE broadcaster (subs Set + broadcast())
│   │   ├── game-scoring.js computeFinalScores + resolvePlayerTimes + validateGameInput (pure, tested)
│   │   ├── glicko2.js      pure Glicko-2 rating math (ratePeriod/expectedScore), tested vs Glickman example
│   │   ├── whr.js          whole-history rating: global Bradley-Terry fit (retroactive), tested
│   │   ├── ratings.js      games → all-time ratings (glicko OR whr, margin-of-victory) + balanced matchmaker
│   │   ├── adopt-guest.js  promote guests → inactive accounts (preview + promote, war-map-safe)
│   │   ├── game-filter.js  COUNTED_GAMES — the shared "counts toward stats" gate (digital on/off)
│   │   ├── faction-anchors.js  server-side mirror of FACTION_HOMES + SPARE_ANCHORS /
│   │   │                   chooseSpareAnchor() for the 2nd+ player of a faction
│   │   └── mail.js         notify(subject, text) → the shared mailer container;
│   │                       no-ops unless MAILER_URL + MAILER_TOKEN are set
│   ├── routes/             each file: `export default Router()` mounted in server.js
│   │   ├── auth.js         /auth/*  — login, logout, me, PATCH me, change-password
│   │   ├── admin.js        /admin/* — user CRUD, game visibility, game delete, audit log
│   │   ├── games.js        /games/* — list/get (PUBLIC) + create/update (auth)
│   │   │                   (HEAVY: insertPlayerChildren, resolvePlayerIdentities)
│   │   ├── images.js       /games/:id/images — photo upload/cover/delete (bytes on disk);
│   │   │                   also exports mapRouter, mounted separately at /maps
│   │   ├── stats.js        /stats/* — overview + 12 stat endpoints (incl. trends, calendar)
│   │   ├── warmap.js       /stats/warmap + /stats/warmap-timeline — banners feed for the
│   │   │                   Theatre of War, and the game list its time slider scrubs
│   │   ├── reference.js    /reference/* — factions, detachments, mission packs, users,
│   │   │                   unified player picker, name autocomplete
│   │   ├── events.js       /events — SSE long-poll for live updates
│   │   ├── seasons.js      /seasons — list + start-new (admin)
│   │   └── ratings.js      /ratings — ADMIN-ONLY Glicko-2 leaderboard + balanced matchmaker
│   ├── db/
│   │   ├── README.md       schema/seed conventions, idempotency rules, ALTER pattern
│   │   ├── schema.sql      tables, indexes, view; idempotent (CREATE IF NOT EXISTS + DO $$..ALTER guard)
│   │   └── seed.sql        29 factions + detachments + Pariah Nexus + Leviathan packs +
│   │                       the 11e "2026 - 2027 Chapter Approved" pack +
│   │                       Season 1 + guest→user backfill (all idempotent)
│   └── test/
│       ├── README.md       how to run + what's covered
│       ├── game-scoring.test.js  11 cases pinning the camelCase payload contract
│       ├── glicko2.test.js       pins Glicko-2 math to Glickman's worked example
│       ├── ratings.test.js       margin-of-victory + display mapping + balanced pairing
│       ├── whr.test.js           whole-history fit: transitivity, bounded undefeated, uncertainty
│       └── game-filter.test.js   COUNTED_GAMES SQL shape with digital on/off
└── app/                    SERVED BY CADDY at /srv/40kResultsTracker/app
    ├── README.md           frontend overview
    ├── index.html          script tags for every JS module (no bundler)
    ├── css/style.css       YAAB-matched dark Warhammer theme — see "Critical invariants"
    └── js/
        ├── README.md       module roles
        ├── app.js          hash router, shell renderer, route table, nav links, error boundary
        ├── api.js          fetch wrapper; 10 exports: api, auth, reference, games, gameImages,
        │                   mapImages, stats, admin, seasons, ratings
        ├── components.js   el(), clear(), toast(), pill(), fmtDate(), fmtDuration(), fmtScore(),
        │                   selectOptions(), confirmModal(), promptModal() — USE THESE
        ├── live.js         singleton EventSource on /api/events → 'live:game.saved' CustomEvent
        │                   on document (only game.saved is re-dispatched client-side)
        ├── lightbox.js     full-screen photo viewer; FLIP zoom + cycle + swipe
        ├── zip.js          dependency-free ZIP reader (Google Photos multi-download)
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
| 5 battle rounds | everywhere | `ROUNDS = [1,2,3,4,5]` in `game-form.js`; `CHECK (round_number BETWEEN 1 AND 5)` in `schema.sql` (twice). Both 10e and 11e are 5-round games. |
| Existing games are 10e | `schema.sql` edition migration | Every game logged before the `edition` column existed was 10th edition. The migration adds the column with `DEFAULT '10'` **and then** flips the default to `'11'` — so the backfill lands on 10e and only new rows get 11e. Don't "simplify" that to a single `DEFAULT '11'`; it would silently re-label the entire back catalogue. |
| No public signup | `routes/auth.js` (no register endpoint) | Admin creates all accounts via `POST /admin/users`. Login page must not have a "Sign up" link. |
| No game deletion **from `/games`** | `routes/games.js` (no DELETE) | Hiding is the normal move — `PATCH /admin/games/:id/visibility { hidden: true }` — because results are meant to be permanent. A hard delete does exist, but only as an admin escape hatch on the *admin* router (`DELETE /admin/games/:id`, which also unlinks the photo files). Don't add a DELETE to `games.js`. |
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

**Put the block BELOW that table's `CREATE TABLE`, not wherever the other
migrations happen to live.** The guard only checks whether the *column* exists —
on a fresh database the *table* doesn't either, so an ALTER (or a
`CREATE INDEX`) placed earlier in the file throws, `initSchema()` aborts, and
**nothing at all gets created**. An existing install won't notice, because the
table is already there; only a new install or a restore-from-backup breaks.
This shipped once with the `game_images.is_map` migration sitting ~50 lines
above its own `CREATE TABLE`. Always smoke-test schema changes against an
empty database, not just the live one.

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
- **`ctx.measureText`** — font metrics differ by platform and installed fonts, so the label *wrapping* is not byte-identical everywhere. That's tolerated: it only moves glyphs. Keep it that way — never let a text measurement feed back into ownership, geometry or the RNG.
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

1. Construct the Express app + session middleware (Postgres-backed via `connect-pg-simple`, table `session`, cookie **`tg40k.sid`**, `httpOnly` + `sameSite: 'lax'`, `secure` only when `NODE_ENV === 'production'`, 30-day `maxAge`). `app.set('trust proxy', 1)` — Caddy is in front.
2. Apply `express-rate-limit` to `/auth/login` (20 attempts / IP / 15 min)
3. `initSchema()` — runs `schema.sql` then `seed.sql` (both idempotent)
4. `ensureBootstrapAdmin()` — if `users` is empty AND `ADMIN_PASSWORD` is set, insert the admin
5. Mount `/health`, `/auth`, `/admin`, `/maps` (images.js's `mapRouter`), `/games` (twice — `images.js` **before** `games.js`), `/stats` (twice — once for `stats.js`, once for `warmap.js`), `/reference`, `/events`, `/seasons`, `/ratings`
6. Top-level error handler emits the uniform `{ error, code? }` body with status from `err.status`. It special-cases 413 / `entity.too.large` into a human "that file is too large to upload" with `code: 'too_large'`
7. `app.listen(PORT)`

Steps 1–2 also install the split body parser: `express.json({ limit: '256kb' })`
runs app-wide **except** on paths matching `IMAGE_UPLOAD_PATH`
(`POST /games/:id/images`, `POST /maps/:id/image`), which parse themselves at
12mb inside `routes/images.js`. Add any new upload route to that regex or it
will 413 before the handler is reached.

### Route module convention

**Reads are public.** Only `admin.js` and `ratings.js` carry a top-level
`router.use(requireAdmin)`. `games.js`, `stats.js`, `warmap.js`,
`reference.js`, `events.js` and `GET /seasons` have **no** auth gate at all — an
anonymous visitor can browse the whole site — and `images.js`, `auth.js` and
`seasons.js` apply `requireAuth` / `requireAdmin` per route. Don't add a
blanket `router.use(requireAuth)` to a read module: it would silently take the
site private. The template below is for a module that *should* be gated.

A gated `routes/*.js` looks like:

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
  { match: /^\/games\/new$/,         handler: () => renderGameForm(state, null),                requireAuth: true },
  { match: /^\/games\/(\d+)\/edit$/, handler: (m) => renderGameForm(state, parseInt(m[1], 10)), requireAuth: true },
  { match: /^\/games\/(\d+)$/,       handler: (m) => renderGameDetail(state, parseInt(m[1], 10)) },
  { match: /^\/stats$/,              handler: () => renderStats(state) },
  { match: /^\/players\/(.+)$/,      handler: (m) => renderPlayer(state, decodeURIComponent(m[1])) },
  { match: /^\/profile$/,            handler: () => renderProfile(state), requireAuth: true },
  { match: /^\/rankings$/,           handler: () => renderRatings(state), requireAdmin: true },
  { match: /^\/admin$/,              handler: () => renderAdmin(state),   requireAdmin: true },
  { match: /^\/login$/,              handler: () => renderLogin(state, () => navigate('/')) },
];
```

`route()` runs on `hashchange` and `load`. It tries `auth.me()` once and
tolerates failure — **no session is not an error**, it just means `state.user`
stays null and the shell renders a "Sign In" button instead of the user chip.
Only routes flagged `requireAuth` / `requireAdmin` redirect to `/login`; every
other view renders for anonymous visitors. Unmatched paths fall back to
`/games` when logged in and `/` (the war map) when not. Navigate from anywhere
with `window.__nav('/games')` — a global set in `app.js`. Handler throws are
caught into an error-boundary panel rather than a blank page.

### View module convention

Every file in `app/js/views/` exports one async function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. Async `await reference.…()` calls happen up-front. Local helpers and a `rerender()` closure mutate a `draft` object and rebuild as needed.

### DOM helpers — use them, do not template-string

`components.js`:

- `el(tag, attrs?, children?)` — the workhorse. `attrs.class`, `attrs.style` (object), `attrs.onClick` etc. Children can be string, node, array, or null/false (skipped).
- `clear(node)` — empty children
- `toast(msg, kind?)` — bottom-right ephemeral toast (3s); kind `'error'` styles red
- `pill(text, kind?)` — a styled badge; kind `'win'`, `'loss'`, `'draw'`, `'first'`, `'hidden'`
- `fmtDate(d)` — YYYY-MM-DD
- `fmtDuration(seconds)` — `m:ss` / `h:mm:ss`; the inverse of `parseDuration()` in `game-form.js`
- `fmtScore(n)` — score display helper
- `selectOptions(items, valueKey?, labelKey?, includeBlank?, blankLabel?)` — quick `<option>` array
- `confirmModal(...)` / `promptModal(...)` — always these, never native `confirm()` / `prompt()`

**Don't introduce React, Vue, lit-html, htm, or template-literal HTML.** This codebase is consciously framework-free; the `el()` pattern is consistent across every view. New code should match.

### `api.js` shape

Always extend the right export object — never call `fetch` directly from a view:

```js
export const auth      = { me, login, logout, changePassword, updateMe };
export const reference = { factions, detachments, missionPacks, missionDetails, users,
                            players, playerNames };   // players = unified user+guest picker
export const games     = { list, get, create, update };
export const gameImages = { list, upload, update, remove, url };   // url() → /uploads/<gameId>/<file>
export const mapImages  = { upload, remove, url };                 // url() → /uploads/maps/<file>
export const stats     = { overview, factionWinRates, playerWinRates, factionMissionBreakdown,
                            factionDeploymentBreakdown, factionMatchups, headToHead,
                            firstTurnImpact, secondaryAverages, warmap, warmapTimeline,
                            detachmentWinRates, trends, player, calendar };
export const admin     = { users, createUser, updateUser, setVisibility, deleteGame, audit,
                            guestsPreview, promoteGuests };
export const seasons   = { list, start };
export const ratings   = { leaderboard, suggest, history };   // admin-only
```

All requests `credentials: 'same-origin'`. Errors throw with `.status`, `.code` (server's `error.code`), and `.data` on the Error. Network failures throw with `status: 0` and `code: 'network'`.

---

## HTTP API reference

**Reads are public; writes need a session.** The `Auth` column below is the
truth — `public` means no session at all, `auth` means `requireAuth`, `admin`
means `requireAdmin`. Responses are JSON. Errors return the uniform shape
`{ error: '<message>', code?: '<string>' }` with status from `err.status`
(default 500); 413s are rewritten to a friendly message with `code: 'too_large'`.
Login is rate-limited to 20 attempts / IP / 15 min.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | public | `{ ok: true }` |
| POST | `/auth/login` | public | `{ username, password }` → user object; sets session |
| POST | `/auth/logout` | public | destroys session; no guard, so it returns `{ ok: true }` even when nobody is logged in |
| GET | `/auth/me` | auth | current user `{ id, username, displayName, role, armyName }` |
| PATCH | `/auth/me` | auth | self-serve update; currently only `{ armyName }` |
| POST | `/auth/change-password` | auth | `{ currentPassword, newPassword }` |
| GET | `/reference/factions` | public | `[{ id, name }]` |
| GET | `/reference/factions/:id/detachments` | public | `[{ id, name }]` — UNION of seeded + free-text from past games |
| GET | `/reference/mission-packs` | public | `[{ id, name }]` |
| GET | `/reference/mission-packs/:id/details` | public | `{ primaryMissions, deploymentMaps, missionRules, secondaryCards, challengerCards }` |
| GET | `/reference/users` | public | active users `[{ id, username, display_name }]` |
| GET | `/reference/player-names` | public | distinct names from past games (for autocomplete) |
| GET | `/reference/players` | public | unified player picker — every entity that has appeared in a game, registered or guest: `[{ key, label }]` where `key` is the canonical `user:<id>` / `guest:<name>` accepted by `/games?playerKey=` |
| GET | `/games` | public | filtered list (q params: `playerUserId`, `playerKey` (`user:<id>`\|`guest:<name>`), `playerFaction`, `opponentFaction`, `missionPack`, `primaryMission`, `deploymentMap`, `format`, `playMedium` (`physical`\|`digital`), `edition` (`10`\|`11`), `dateFrom`, `dateTo`, `includeHidden`, `q` (free-text search over notes / tournament / location / player names / army-list paste), `limit` (default 100), `offset`). `opponentFaction` is only applied when `playerFaction` is also set |
| GET | `/games/:id` | public | full game with `players[]`, each with `rounds[]`, `secondaries[]`, `challengers[]` |
| POST | `/games` | auth | create game; payload is the camelCase draft shape — see `serializeDraft()` in `game-form.js`; auto-attached to active season |
| PUT | `/games/:id` | auth | replace game; same payload as POST |
| GET | `/games/:id/images` | public | `[{ id, file_name, thumb_name, caption, is_thumbnail, is_map, width, height, uploaded_by_name }]` |
| POST | `/games/:id/images` | auth | `{ dataUrl, thumbDataUrl?, width?, height?, caption? }` — base64 data URLs, already downscaled in the browser. 12mb body limit on this route only. Responds **201**. Server-side caps: `MAX_IMAGE_BYTES` 8MB **decoded** (413), `MAX_PER_GAME` 40 photos (409), MIME must be jpeg/png/webp (415) |
| PATCH | `/games/:id/images/:imageId` | auth | `{ isThumbnail?: true, caption?: string, isMap?: boolean }` — each flag is clear-then-set, because the partial unique index rejects a second winner while the old one is still flagged |
| DELETE | `/games/:id/images/:imageId` | auth | uploader or admin only; unlinks both files |
| POST | `/maps/:id/image` | auth | `{ dataUrl, thumbDataUrl? }` — picture of a terrain layout (a `deployment_maps` row), shown on every game played on it. Replacing unlinks the previous pair |
| DELETE | `/maps/:id/image` | auth | clears the row and unlinks both files |
| GET | `/stats/overview` | public | totals + recent activity |
| GET | `/stats/faction-winrates` | public | per-faction W/L/D + win% + avg score |
| GET | `/stats/player-winrates` | public | per-player W/L/D + win% (groups by user_id OR guest_name) |
| GET | `/stats/faction-mission-breakdown?factionId=N` | public | how a faction performs across primary missions |
| GET | `/stats/faction-deployment-breakdown?factionId=N` | public | by deployment map |
| GET | `/stats/faction-matchups` | public | full A-vs-B matrix (every faction pair with games) |
| GET | `/stats/head-to-head?userA=N&userB=M` | public | every game between two users |
| GET | `/stats/first-turn-impact` | public | win% comparison going first vs second |
| GET | `/stats/secondary-averages` | public | per-card pick count + avg score |
| GET | `/stats/detachment-winrates[?factionId=N]` | public | per-`(faction, detachment_name)` W/L/D + win% |
| GET | `/stats/trends` | public | `{ monthlyGames, monthlyAvgScore, factionPopularity }` |
| GET | `/stats/calendar[?days=365]` | public | `[{ date, games }]` — fuels the heatmap. `days` is capped at 730 |
| GET | `/stats/player/:playerKey` | public | profile + per-faction + streaks for `'user:<id>'` or `'guest:<name>'` |
| GET | `/stats/warmap[?season=N][&through_game_id=N]` | public | array of (player, faction) banners: `player_key`, `player_name`, `army_name`, `faction_id`, `faction`, `games`, `wins`, `losses`, `draws`, `avg_score`, `adjusted_points`, `win_rate`, `territory_score`, `first_seen_at`, `anchor_x`, `anchor_y`. Defaults to the active season. `through_game_id` truncates the aggregation at that game in `(played_at, id)` order — that's what the time-travel slider scrubs. Also lazily back-fills any missing `banner_first_seen` row. |
| GET | `/stats/warmap-timeline[?season=N]` | public | the season's games in chronological order with enough metadata to label a slider tick: `id`, `played_at`, `p1_name`/`p2_name`, `p1_faction`/`p2_faction`, `p1_result` |
| GET | `/seasons` | public | every season + games count |
| POST | `/seasons` | admin | `{ name, mapSeed? }` — closes current, opens new (broadcasts `season.changed`) |
| GET | `/admin/users` | admin | all users including inactive |
| POST | `/admin/users` | admin | `{ username, displayName, password, role, armyName? }` |
| PATCH | `/admin/users/:id` | admin | `{ displayName?, role?, isActive?, password?, armyName? }` |
| PATCH | `/admin/games/:id/visibility` | admin | `{ hidden: bool }` (broadcasts `game.saved`) |
| DELETE | `/admin/games/:id` | admin | hard delete; cascades to rounds/secondaries/challengers (broadcasts `game.saved`) |
| GET | `/admin/audit[?limit=100]` | admin | recent audit_log rows DESC by created_at; `limit` is capped at 500 |
| GET | `/admin/guests/preview` | admin | read-only: which guests a promotion run would `create` vs `link` |
| POST | `/admin/promote-guests` | admin | promote all unlinked guests to inactive accounts (idempotent, war-map-safe) |
| GET | `/ratings/leaderboard[?marginOfVictory=true&model=glicko\|whr]` | admin | ranked players: `displayFloor` (confidence-adjusted, the rank/headline value), `displayRating` (raw "est"), `rd`, `confidence`, W/L/D, `provisional`, `inMainPool`. **`model` defaults to `whr`** (whole-history). |
| GET | `/ratings/suggest?present=1,2,3[&marginOfVictory=true&model=…]` | admin | up to 4 balanced pairing configs with predicted win-% + last-met; `bye` if odd. `present` is a comma-separated user-id list and needs **at least two** ids (400 otherwise) |
| GET | `/ratings/history[?marginOfVictory=true&model=…]` | admin | every player's day-by-day series for the compare chart `[{ userId, displayName, series:[{x,y}] }]` (y = confidence floor; carried forward to today) |
| GET | `/events` | public | Server-Sent Events stream; emits `game.saved`, `season.changed`. Comment heartbeat every 25s. The subscriber records `req.session?.userId` when there is one, but a session is **not** required — anonymous viewers get live updates too |

**Total: 51 endpoints** in `routes/*.js`, plus `/health` defined inline in `server.js`. Cross-check — note the second pattern, `images.js` also exports the separately-mounted `mapRouter`:

```bash
grep -hE "(router|mapRouter)\.(get|post|put|patch|delete)\(" api/routes/*.js | wc -l
```
 `/ratings/*` and the two guest endpoints are admin-only; ratings are computed on the fly (no tables).

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
| `deployment_maps` | e.g. Hammer and Anvil; also the 11e `Layout A/B/C` rows | id, mission_pack_id, name, image_name + image_thumb_name (optional picture of the layout, shared by every game played on it; files under `UPLOAD_DIR/maps/`) |
| `mission_rules` | e.g. Chilling Rain | id, mission_pack_id, name |
| `secondary_cards` | tactical or fixed | id, mission_pack_id, name, card_type ('tactical'\|'fixed') |
| `challenger_cards` | Pariah Nexus Secret Missions (formerly "Gambits"); 4 cards: Command Insertion, War of Attrition, Unbroken Wall, Shatter Cohesion | id, mission_pack_id, name |
| `games` | the match record | id, created_by_user_id, played_at (DATE), game_format, points_limit, mission_pack_id, primary_mission_id, deployment_map_id, mission_rule_id, turn_count, end_condition ('normal'\|'concession'\|'tabled'), tournament_*, location, notes, hidden_from_stats, play_medium ('physical'\|'digital' — digital = Tabletop Simulator), edition ('10'\|'11' — DB default '11'; pre-existing rows backfilled to '10'), season_id (FK seasons.id), created_at, updated_at |
| `game_players` | exactly 2 per game | id, game_id, seat (1\|2), user_id (nullable), guest_name (nullable — at least one required), faction_id, detachment_id (legacy), detachment_name (**DERIVED** — `player_detachments` joined with ', '), force_disposition (**11e only**, 5-value CHECK), primary_mission_id + primary_mission_name (**11e only** — each player picks their own primary; NULL on 10e games, which use the game-level column), time_seconds (chess clock — **derived** as the sum whenever any round is clocked), army_list_code, went_first, is_attacker, final_score, result ('win'\|'loss'\|'draw') |
| `game_rounds` | per-round score per player | id, game_player_id, round_number (1-5), primary_score, secondary_score, cp_remaining, time_seconds (optional chess-clock split); UNIQUE (game_player_id, round_number) |
| `player_secondaries` | per-round secondary scoring | id, game_player_id, round_number (10e: the round scored; **11e: the round the card SCORED, NULL if it never did**), drawn_round (**11e only** — the round it entered hand; NULL on 10e where draw and score coincide), card_id, card_name, score, was_discarded |
| `player_challengers` | per-round challenger scoring | id, game_player_id, card_id, card_name, round_number (nullable), completed, score |
| `game_images` | photos attached to a game; **bytes live on disk**, not in Postgres | id, game_id (CASCADE), uploaded_by_user_id, file_name, thumb_name, caption, is_thumbnail, is_map, width, height, bytes, created_at. Two partial unique indexes — `(game_id) WHERE is_thumbnail` (cover) and `(game_id) WHERE is_map` (terrain layout). The flags are independent, so one photo can be both |
| `player_detachments` | a player's detachments; 11e allows more than one. **Source of truth** — `game_players.detachment_name` is the derived display string | id, game_player_id (CASCADE), detachment_id (nullable), detachment_name, sort_order |
| `banner_first_seen` | one row per (player_key, faction_id); `first_seen_at` is set on save and **never updated** — the war map's seed-claim order (and thus its cross-regen geographic stability) depends on this | player_key, faction_id, first_seen_at, anchor_x + anchor_y (REAL, nullable — the banner's own map anchor; NULL falls back to `FACTION_HOMES`); PK (player_key, faction_id) |
| `seasons` | one row per Theatre-of-War season; only one `is_active = TRUE` (enforced by partial unique index). `map_seed` drives the canvas geometry for that season — archived seasons render with their own continent. | id, name, map_seed (BIGINT), started_at, ended_at, is_active, created_at |
| `audit_log` | append-only audit trail of every write action (game create/update/delete/visibility, user create/update, login, password change, season start). `payload` is JSONB. | id, actor_user_id (FK ON DELETE SET NULL), actor_username, action, target_type, target_id, payload (jsonb), created_at |

### View

`v_game_player_stats` — denormalised one-row-per-`game_player` view with columns from `games` joined and the opposite seat's player joined as `opponent_*`. Use it for stats queries that need "this player's row + their opponent in one shot".

**It predates 11e and seasons.** It exposes only the *game-level* `primary_mission_id` (not the 11e per-player one) and omits `season_id`, `play_medium` and `edition` — so it cannot express the `COUNTED_GAMES` digital filter. Anything season-aware, edition-aware or digital-gated has to query the base tables instead; extend the view (it's a `CREATE OR REPLACE`) rather than working around it.

### Seed-data totals (current)

- **29 factions** (Adepta Sororitas through World Eaters). `FACTION_HOMES` and
  `FACTION_COLOURS` in `warmap.js` — and the server mirror in
  `api/lib/faction-anchors.js` — carry the **same 29 keys**, and all three must
  stay in step. The map tables are append-only, so it's fine for them to run
  ahead of the seed; a seeded faction with **no** map entry is the failure case
  (it falls back to the centre of the canvas). `FACTION_GLYPH` is the exception:
  it's allowed to be partial and only feeds the legend. It currently covers 28
  of the 29 — every faction except Salamanders, which falls back to `•`.
- All current 10e detachments per codex
- 2 **10e** mission packs with full primaries / deployments / rules / secondaries / challengers (Pariah Nexus, Leviathan), plus stub names for Tempest of War / Crusade / Open Play / Other
- 1 **11e** pack, `2026 - 2027 Chapter Approved`: 18 secondaries, 25 primary
  missions (the 5x5 Force Disposition matrix) and the 3 matched-play terrain
  layouts. No challenger cards — 11e dropped them.

When the user adds a new faction or mission pack, see "How to add things" below.

---

## Permission model

| Action | Anon | User | Admin | Enforced where |
|---|---|---|---|---|
| Log in | ✓ | ✓ | ✓ | `POST /auth/login` (rate-limited) |
| View games / stats / war map / player profiles / photos | ✓ | ✓ | ✓ | **Nothing** — `games.js`, `stats.js`, `warmap.js`, `reference.js`, `events.js`, `GET /seasons` and `GET /games/:id/images` have no auth gate. Reads are public by design; `app.js` renders every non-flagged route for `state.user === null` |
| Create / edit games | – | ✓ | ✓ | `requireAuth` inline on `POST /games` + `PUT /games/:id`; client-side, the `/games/new` and `/games/:id/edit` routes carry `requireAuth: true` and the "New Game" nav link only renders with a session |
| Edit own profile (army_name, password) | – | ✓ | ✓ | `PATCH /auth/me` + `POST /auth/change-password`; the "My Profile" link in the header session row routes to `/profile` |
| Hide game from stats | – | – | ✓ | `requireAdmin` on `PATCH /admin/games/:id/visibility`; the **Hide** button in `game-detail.js` is conditionally rendered for admins only |
| Delete a game | – | – | ✓ | `requireAdmin` on `DELETE /admin/games/:id`; admin-only red **Delete** button on game-detail with `confirmModal` confirmation |
| Manage users | – | – | ✓ | `requireAdmin` on `/admin/users*`; the **Admin** nav link in `app.js` only renders if `state.user.role === 'admin'` |
| Manage seasons (start new) | – | – | ✓ | `requireAdmin` on `POST /seasons`; lives in the Admin → Seasons panel |
| Promote guests to accounts | – | – | ✓ | `requireAdmin` on `/admin/guests/preview` + `POST /admin/promote-guests`; Admin → Guest Accounts panel |
| View rankings / matchmaker | – | – | ✓ | `requireAdmin` on all `/ratings/*`; the **Rankings** nav link + `/rankings` route render only for admins. **Private by spec** — players can't see their own rating |
| View audit log | – | – | ✓ | `requireAdmin` on `GET /admin/audit`; rendered in the Admin → Audit Log panel |
| Subscribe to live updates | ✓ | ✓ | ✓ | **Nothing** — `GET /events` imports no guard. The subscriber records `req.session?.userId` when there is one, but anonymous viewers get the stream too |
| Change own password | – | ✓ | ✓ | `POST /auth/change-password` |
| Upload a game photo | – | ✓ | ✓ | `requireAuth` on `POST /games/:id/images`; set Cover / Map via `PATCH` |
| Delete a game photo | – | own only | ✓ | `DELETE /games/:id/images/:imageId` — uploader **or** admin; unlike games, a photo is just an attachment |
| Upload / clear a terrain-layout picture | – | ✓ | ✓ | `requireAuth` on `POST`/`DELETE /maps/:id/image`. It belongs to the layout, so it changes what **every** game on that layout shows |

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

The map is a deterministic procedural continent ("Boimaggedon") tiled into ~120 evenly-sized **named provinces** via Voronoi + Lloyd's relaxation, each of which is then sliced into **10 sub-cells**. Ownership is decided at sub-cell granularity (1200 of them), so a war front can cut through the middle of a province — which then reads as *contested* — instead of snapping to province edges. Every owned cell belongs to a **(player, faction) banner** — Joe's Necrons and Jane's Necrons are separate units with separate regions but share the Necron green colour. Each banner's label (army_name → display_name → guest name) sits on the *densest* sub-cell of its region — not the centroid, which can land outside a concave or split region — and is wrapped (and shrunk, if need be) to stay inside that region's own borders; no fortress markers are drawn. Rendered as a 40k war-room tactical display: dark navy backdrop, glowing cyan coastline, amber war-front borders, monospace HUD chrome. Same seed → identical output on every device, every browser, forever.

### Constants (immutable)

- `MAP_SEED = 0xDEAD40` — drives the continent silhouette, the province sites, the sub-cell mesh and the procedural province names. **Never change.** (It is the *default*: `renderWarmap` uses the selected season's `seasons.map_seed` when there is one. Starting a new season is the supported way to get a new continent — editing this constant would reshape every past season too.)
- `SUB_PER_PARENT = 10` — sub-cells per province, so 1200 in total. Also frozen: changing it re-partitions ownership for everyone.
- `VIRTUAL_W = 1280`, `VIRTUAL_H = 794` — fixed compute resolution. Map is generated at this size and CSS-scaled for display. Critical for cross-device consistency: same canvas dimensions on every device → byte-identical territory geometry and faction allocation. **Never change.**
- `FACTION_HOMES` — `{ 'Faction Name': [x, y] }` in 0..1 canvas-space. **29 entries**, the same key set as the 29 factions in `seed.sql`. **Append-only.** It is only the *fallback*: a banner uses `banner_first_seen.anchor_x/anchor_y` from the server when set, and falls back to this table (then to `[0.5, 0.5]`) when it isn't. Drives the seed sub-cell each new banner claims (closest unclaimed sub-site to the anchor). Seeds are invisible — they're the stability root, not a drawn fortress. `api/lib/faction-anchors.js` holds a server-side mirror of this table (plus 12 `SPARE_ANCHORS` for the 2nd+ player of a faction); **both copies must be edited together.**
- `FACTION_COLOURS` — `{ 'Faction Name': '#hex' }` lore-matched palette. Same key set as `FACTION_HOMES` (29). `FACTION_GLYPH` is the optional legend emblem and does not need full coverage — it currently has 28 entries, missing only Salamanders, which the legend renders with the `•` fallback.
- `N_TERRITORIES = 120` — total territories on the continent. Changing this changes everyone's map. The Poisson-disc `minDist` scales as `1/sqrt(N)` so spacing stays sane at any N (the formula evaluates to the original 0.07 of canvas at N=50).
- `LLOYD_ITERATIONS = 8` — relaxation passes; more = more even cell sizes.
- `CELL = 4` — Voronoi/raster sample step in pixels.

### Render pipeline (`drawTacticalMap`)

1. **Continent silhouette.** `generateContinent` builds a closed polygon by sampling 96 angles around the canvas centre with multi-octave sine noise and a slight horizontal squash. Result: an organic, asymmetric coastline.
2. **Parent province sites.** `generateTerritories` Poisson-disc-samples `N_TERRITORIES` points inside the polygon with `minDist` scaled as `1/sqrt(N)` so spacing stays sane at any N. These 120 cells are the **named provinces** — `territoryName(parentIndex, seed)` derives `"<Prefix> <Suffix> <NN><L>"` from the seed, so the names are stable for a given map.
3. **Voronoi via grid sampling.** For each grid cell at step `CELL`, find the nearest site (-1 for ocean cells outside the polygon). Land mask is precomputed once.
4. **Lloyd's relaxation.** For 8 iterations: rasterize Voronoi → compute centroid of each cell → move site to its centroid → rasterize again. Result: cells become roughly equal area and similar shape.
5. **Adjacency graph.** `buildAdjacency` walks the grid; cells differing in ownership across an edge are marked as neighbours. This is the **parent** adjacency.
6. **Sub-cell subdivision.** `generateSubTerritories` slices every parent province into `SUB_PER_PARENT = 10` sub-cells via a mini-Voronoi seeded `seed ^ ((parentId + 1) * 2654435761)`, reservoir-sampled from the parent's own grid cells (collected in deterministic `gy,gx` scan order) and relaxed twice *within* the parent, so a sub-cell never crosses a province boundary. That gives **1200 sub-cells** and a second (`subAdj`) adjacency graph. **Ownership is decided at sub-cell granularity, not province granularity** — that's what lets a war front cut through the middle of a province instead of snapping to its edge. The named parent geometry is untouched, so provinces stay lore-stable while the fronts stay fluid.
7. **Per-(player, faction) territory assignment.** `assignTerritories` receives an array of "units" — one row per `(player_key, faction_id)` returned by `/stats/warmap` — and operates entirely on sub-cells. Sort by `first_seen_at`, tiebreak by `unitKey` (`player_key::faction_id`) via codepoint comparison. Five phases:
   - **Seed claim** — each banner claims the closest unclaimed **sub-site** to its anchor (`banner_first_seen.anchor_x/y`, else `FACTION_HOMES`, else `[0.5, 0.5]`), in `first_seen_at` order. The parent of that sub-cell becomes the banner's home province. Seeds are invisible roots; they don't get drawn as fortresses.
   - **Targets** — `target[k] = max(1, round(territory_score / totalScore * NSub))`, i.e. proportional over the 1200 sub-cells.
   - **Parent-priority round-robin expansion** — not a plain multi-source BFS. Each banner claims **one sub-cell per turn**, and prefers to finish the province it is currently filling before opening a new one; a claim must touch a sub-cell it already owns, so growth stays contiguous. When a banner's pending-province list is exhausted it discovers newly-adjacent provinces via `parentAdj` and retries next turn. The result is clusters of *fully owned* provinces (organic shapes inherited from the parent Voronoi) plus a partial conquest along the front, rather than disks.
   - **Pocket adoption** — any sub-cell still unowned adopts a neighbour's banner, repeating until nothing is left. Rare, but a province isolated from every frontier needs it.
   - **Pressure equalization** — repeatedly applies the single best boundary flip, where gain = `deficit[dest] - deficit[donor]`, requiring `gain >= 2` (which makes Σ deficit² strictly decrease, so cascades converge). Two guards: an **anti-tendril** rule (the flipped cell needs ≥2 neighbours already owned by the destination, so flips thicken a border rather than extruding a one-cell string) and `flipKeepsContiguous`, which refuses any flip that would split the donor into islands. Determinism: sub-cells in tid order, neighbours in adjacency-list order, ties to first-found.
   - **Same faction, two players** → two separate territory clusters in the same general region of the continent, distinguished by a bold amber war-front border between them.
8. **Province tallies.** Sub-cell ownership is tallied per parent to get a **majority owner** per province (the "territories" count in the HUD and tooltip) and the full owner set (`provinceOwners`), which is what makes a province read as **contested** when more than one banner holds part of it.
9. **Paint.** `paintTerritories` blends the faction colour into the pixel buffer directly (`getImageData`/`putImageData`) at α 0.72 over the navy backdrop; ocean is left as backdrop. It keeps a neutral-steel branch for unowned land as a safety net, but the adoption fill above means you should never see it — if steel shows up on the live map, assignment failed, not the painter.
10. **Coastline + borders.** Continent edge in glowing cyan (shadowBlur). `drawBorders` takes **both** ownership arrays and draws four tiers: same province + same banner → nothing; different province + same banner → faint cyan province grid line; **same province + different banner → medium amber (a contested province, the front running through its interior)**; different province + different banner → bold amber war front.
11. **Labels.** Each banner's label is drawn on its **densest owned sub-cell** — the one maximising Σ 1/(1+hop) over other same-owner sub-cells reachable through same-owner sub-cells only. A plain centroid would drift outside a concave or two-lobed region; the density measure keeps the label on solid ground. Primary line = army_name (or display_name fallback) in amber monospace; faction abbreviation in cyan below.

   The name is then **fitted to the territory** rather than drawn as one line: `layoutLabel()` wraps it to the owned horizontal run at the anchor, trying line counts 1..`LABEL_MAX_LINES` (each at two widths — balanced `full/n` and the region's own width) and font sizes 12 → 9, plus a handful of placements (anchor x, midpoint of the owned run, ±one line vertically) and up to 6 anchor candidates (top-scoring, then spatially separated ones that can reach a second lobe). The first layout whose sample points all land on owned ground wins; failing that, the highest-scoring near-miss is drawn. Nothing is ever truncated and **words are never broken** — no hyphenation, by explicit preference: a name too long for its region spills over the border as a compact block wrapped at `LABEL_SPILL_WIDTH`, and a single unbreakable word just overflows on its own line. Don't "improve" this by adding mid-word breaks. Measured on a synthetic 22-banner board, label sample points on their own territory went 68% → 97%, widest line 264px → 168px.
12. **HUD chrome.** Scan lines (3px stride), corner brackets, compass with N marker, bottom-right tactical readout (`> WORLD: BOIMAGGEDON`, `> THEATRES:`, `> BANNERS:`, `> FACTIONS:`, `> PLAYERS:`, `> STATUS: ● ENGAGED`).

`drawTacticalMap` returns the `mapState` the interactive chrome reads back:
`{ parentOwnership, subOwnership, owner, parentOfSub, provinceOwners, unitMeta, territoryCount, GW, GH, CELL, subSites }`.

### The view shell around the canvas

`renderWarmap()` wraps the canvas in four controls. None of them touch the geometry — they only change *which* banner data is fed to `drawTacticalMap`, or read back `mapState`.

- **Season picker** — `seasons.list()` up front (failures swallowed, so a server without `/seasons` still renders the map). Shown **only when more than one season exists**. Selecting one rewrites the hash to `#/war` (active) or `#/war?season=<id>` and re-routes the whole view.
- **Per-season map seed** — `renderSeed = seasonObj?.map_seed ? Number(seasonObj.map_seed) : MAP_SEED`. `MAP_SEED` is still the frozen default and the seed Season 1 was created with, but an archived season renders **its own continent** from its `seasons.map_seed`. Everything geometric threads this seed through: `generateContinent`, `generateTerritories`, the per-parent sub-Voronoi (`seed ^ ((p+1) * 2654435761)`) and `territoryName`. So "never change `MAP_SEED`" still holds — starting a *new season* is the supported way to get a new continent.
- **Time-travel slider + ▶** — appended only when the timeline has more than one game. `stats.warmapTimeline(season)` supplies the ticks; `renderAt(idx)` re-fetches `stats.warmap(season, timeline[idx].id)` (i.e. `through_game_id`) and redraws. A `renderToken` counter discards a superseded fetch, so dragging fast can't paint an out-of-order frame. Play auto-advances one checkpoint per **600ms**, rewinding to 0 if already at the end. Same seed + same banner data → historical snapshots are deterministic too.
- **Hover tooltip** — `mousemove` maps client coords through the canvas scale to a grid cell, reads `subOwnership` → `parentOfSub` → province, and shows `territoryName`, the banner (`army_name || player_name`), faction, `W · L · D · win%`, the banner's province count, and `· contested (N banners)` when `provinceOwners[pid].size > 1`. It builds an HTML string, so every interpolated value goes through `escapeHtml()` — keep it that way.
- **Legend** — a `?` button bottom-left toggles a panel listing every faction present with its colour, `FACTION_GLYPH` (fallback `•`), abbreviation and full name. `populateLegend` sorts with codepoint comparison, **not** `localeCompare` (see pitfall #7).

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

**Seed-claim determinism (client-side).** `assignTerritories` claims seeds in `first_seen_at` order. Each banner's seed is the closest unclaimed **sub-site** to its anchor at claim time — `banner_first_seen.anchor_x/anchor_y` when the server has one, else `FACTION_HOMES[faction]`, else `[0.5, 0.5]`. Because earlier banners always claim first and the candidate site set is unchanged between regens, every existing banner ends up with the exact same seed site as the previous render. New banners always sort later, so they pick from whatever is left — never displacing an existing seed.

The pressure-equalization phase that runs after the initial fill is also deterministic (banners iterated in `sorted` order, cells in tid order, neighbours in adjacency-list order), so the same scores + same anchors produce a byte-identical map on every device, every session.

What CAN shift between regens: borders move when scores change or banners join/leave, because `totalScore` changes and `target[k]` is recomputed. Same-region behavior holds — a banner's territory grows or shrinks around its seed rather than teleporting elsewhere.

### When the map CAN reshape (edge cases worth knowing)

- The continent itself moves if `MAP_SEED`, `VIRTUAL_W/H`, `N_TERRITORIES`, `SUB_PER_PARENT` or `LLOYD_ITERATIONS` change — every region goes with it.
- A different season renders a different continent **on purpose**, from `seasons.map_seed`. That's the supported way to reshape the world; it leaves past seasons intact.
- Adding a new entry to `FACTION_HOMES` between two existing entries (rather than appending) shifts every later faction's seed anchor. Remember `api/lib/faction-anchors.js` mirrors this table.
- Truncating `banner_first_seen` makes every banner re-claim from scratch in the seeded backfill order, and also drops the per-banner `anchor_x/anchor_y`. Don't do this unless you mean it.

### Recipe: changing what shows on a banner's label

`drawLabels()` resolves the primary label as `u.army_name || u.player_name` inline. To change the displayed text, edit that fallback chain — never derive from `u.faction` (the faction abbreviation is already drawn as a secondary line below the army name). To set/edit a user's army name: Admin tab → user row → "Army" button.

The knobs for how a label is *fitted* are the constants above `drawLabels()`: `LABEL_SIZES` (font step-down), `LABEL_MAX_LINES`, `LABEL_SPILL_WIDTH` (wrap width for names that can't fit anywhere), `LABEL_ANCHOR_CANDIDATES` + `ANCHOR_MIN_SEPARATION`. Raising the line count buys fit at the cost of a taller stack of small text; it was tuned to 4 (5 gained ~0.6pp and looked noisy).

---

## 10th vs 11th edition

`games.edition` ('10'|'11') switches both the entry form and the scoring rules.
New games default to **11**; every game recorded before the column existed was
backfilled to **10** (see the invariant table).

| | 10e | 11e |
|---|---|---|
| Primary mission | one per game (`games.primary_mission_id`) | **one per player**, decided by the Force Disposition pairing (`game_players.primary_mission_id` / `_name`). The games list renders it as `"A vs B"` (`missionLabel()`), since there's no single game-level mission to put in that column |
| Force Disposition | n/a | one per player (`game_players.force_disposition`), 5 values |
| Detachments | one per player | **many** per player (`player_detachments`) |
| Secondaries | 2 slots per round; drawn and scored in the same round | cards persist in hand — `drawn_round` is when it entered hand, `round_number` is when it **scored** (NULL = never scored) |
| Challenger cards | yes | **none** — `serializeDraft()` drops them and `computeFinalScores` ignores them |
| Score ceiling | `min(100, primary + secondary + challengers)` | `min(45, primary) + min(45, secondary)` — two independent halves, no cross-subsidy |
| Deployment map / mission rule | game-level | game-level (unchanged) |

- **Scoring** lives in `lib/game-scoring.js`: `computeFinalScores(players, edition)`.
  `edition` defaults to `'10'` so old callers keep their behaviour;
  `routes/games.js` passes the real value. `game-form.js` mirrors the same maths
  in `calcTotal()` purely for the live readout — the server value is
  authoritative. Pinned by tests, including the reference game (primary rounds
  4/8/11/8/15 = 46 raw → clipped to 45, secondaries 32, **final 77**).
- **Editing safety** — `PUT /games/:id` uses `edition = COALESCE($17, edition)`,
  so a payload that omits `edition` can't silently re-stamp a 10e game as 11e.
  `POST` defaults to 11.
- **The 11e form** lays out the pack's **entire** secondary deck as rows (card
  name fixed, you fill Drawn / Scored / VP), mirroring the War Journal app.
  Those three are **number inputs, not dropdowns**, so a row is type-tab-type-
  tab-type. Round fields are lenient while typing and clamped to 1-5 on blur,
  so a stray "7" visibly becomes 5 rather than being dropped at save; blank
  means "not drawn" / "never scored".
  **How much detail was recorded** varies wildly by game, so the per-player
  "Score detail" toggle has three rungs, and `computeFinalScores` keys off the
  **data**, not a stored flag — in strict priority order:

  1. **cards** — `player_secondaries` present → they are the source of truth and
     each round's secondary figure is derived from them.
  2. **rounds** — no cards (and, in 10e, no challengers), but some round carries
     a primary/secondary figure → the typed per-round totals are taken as given.
  3. **final** — nothing broken down at all → the submitted `finalScore` is the
     record, clamped to the edition ceiling (90 / 100).

  Each rung outranks the one below, so adding detail always wins over a coarser
  figure. The critical property is that **an edit round-trip can't silently
  zero a game** — the old unconditional recompute did exactly that to anything
  without cards. Switching the toggle carries the numbers across and confirms
  first if detail would be lost. `scoreMode` is client-only draft state,
  stripped from the payload; `calcTotal()` mirrors the same ladder for the live
  readout. Game detail hides the rounds grid entirely for a final-only game —
  an all-zero grid reads as "they scored nothing" rather than "nobody wrote it
  down".
  The deck is sorted **alphabetically** for entry (you're hunting for the card
  that came up); the game-detail view re-sorts the saved cards **by round
  drawn** so the game reads back chronologically.
  A row only becomes a stored `player_secondaries` entry once it has a drawn
  round, a scored round or a score — untouched rows never reach the payload,
  and a row that's cleared back to empty is pruned. Cards the seed list is
  missing can still be added via "+ Card not listed".
- **Force Dispositions** are the 11e mission generator. There are five — Take
  and Hold, Purge the Foe, Disruption, Reconnaissance, Priority Assets — and
  every detachment is associated with one. Cross-referencing your pick against
  your opponent's yields the named primary mission **each** of you plays, which
  is the whole reason the primary is per-player. 5 x 5 = the 25 named missions
  seeded for the pack. `PRIMARY_MATRIX` in `game-form.js` mirrors that table
  (keyed `[yours][theirs]`) and auto-fills both players' primaries once both
  dispositions are set; the field stays editable, so it's a shortcut not a lock.
  The matrix is duplicated in the client only — the server just stores whatever
  primary it's sent, and validates `force_disposition` against the 5-value
  whitelist (anything else is stored as NULL).
- **Mission pack `2026 - 2027 Chapter Approved`** carries the full 11e deck:
  **18 secondaries** and **25 primary missions**, sourced from the GDM 2026
  mission database (game-datamissions.com / gdmissions.app) and cross-checked
  against Warhammer Community + Spikey Bits for the disposition list. Four
  secondaries (A Grievous Blow, Assassination, Bring it Down, Engage on All
  Fronts) are additionally the **Fixed** options; all 18 are seeded `tactical`
  because they're all drawable in a Tactical game and `card_type` only drives
  sort order in `reference.js` — it gates nothing.
- **Card name casing** — the first 10 secondaries were transcribed from a
  screenshot of an app that title-cases every word, giving `Bring It Down` /
  `Burden Of Trust`. `seed.sql` carries a guarded rename to GW's casing that
  runs **before** the deck insert, so the existing `card_id` survives and the
  denormalised `player_secondaries.card_name` on already-recorded games is
  dragged along. If you ever re-source card names, follow that pattern rather
  than inserting a second row.

---

## Chess-clock timing

Optional, and granular only if you want it. `game_players.time_seconds` is the
player total; `game_rounds.time_seconds` is the optional per-round breakdown.

- **`resolvePlayerTimes()`** in `lib/game-scoring.js` (called from both write
  paths) applies the same rule as the secondary card/round-total split: **if any
  round carries a time, the player total is their sum**; otherwise the typed
  total stands alone. The headline and the breakdown therefore can never
  disagree. Junk, negatives and blanks resolve to `null` — an unclocked game is
  *untimed*, not a 0-second game, so don't let it become 0 or averages will lie.
- The form's Total Time box goes **read-only and derived** as soon as one round
  is clocked, mirroring the server rule in the UI.
- **Entry format** (`parseDuration()` in `game-form.js`): `m:ss`, `h:mm:ss`, or
  a bare number meaning **minutes** (`90` → 1:30:00, `7.5` → 7:30). Rejects
  `12:99` and other nonsense rather than coercing. `fmtDuration()` in
  `components.js` renders it back as `m:ss` / `h:mm:ss`.

---

## Detachments (multi-valued since 11e)

11e lets a player field more than one detachment, so `player_detachments` is the
source of truth — one row per (game_player, detachment), `sort_order` preserving
entry order.

- **`game_players.detachment_name` is now DERIVED**: the names joined with
  `', '`. It's kept so the game list, detail view and any older query keep
  working unchanged. Never write it directly — `joinDetachments()` in
  `routes/games.js` computes it from the same list that populates the child
  table, and `detachmentList()` trims, drops blanks and de-duplicates
  case-insensitively first.
- **Anything analytical reads the child table, not the joined string.** Both
  `/reference/factions/:id/detachments` (autocomplete) and
  `/stats/detachment-winrates` were repointed — otherwise a player who fielded
  two detachments would suggest `"A, B"` as if it were a single detachment, and
  would form its own bogus win-rate bucket. Post-change, a two-detachment player
  counts once under **each**, so that stat's `games` column can exceed the
  faction's game count. That's inherent to a multi-valued dimension.
- **Back-compat**: a payload with no `detachments` array falls back to the
  legacy `detachmentName` string, so an old client still saves correctly.
  `seed.sql` backfills one child row per historical `detachment_name`.

---

## Terrain layouts

GW publishes **three recommended terrain layouts per 11e matched-play mission**,
so the 11e map field is a two-part control: **Matched Play Maps** (Layout A / B
/ C) or **Custom** (free text for your own table).

- **Stored in the existing `deployment_map` slot**, not a new column — `Layout
  A` is just a `deployment_maps` row for the pack. That's why the games-list
  Deployment filter, `/stats/faction-deployment-breakdown` and the detail view
  all kept working without changes. 10e still shows the plain combo box.
- Which mode is selected is remembered on the draft (`draft.mapMode`) rather
  than re-derived from the stored name each render — otherwise picking Custom
  and not yet typing would snap straight back to Matched Play.
- **Layout pictures** live on the `deployment_maps` row (`image_name` /
  `image_thumb_name`, files under `UPLOAD_DIR/maps/`), so one upload shows on
  **every** game played on that layout. Uploaded via `POST /maps/:id/image`,
  same browser-downscale + base64 contract as game photos; a replace unlinks the
  previous pair only after the row points at the new one.
- **These are deliberately user-supplied.** GW's own layout diagrams are
  copyrighted, so the app neither ships nor fetches them — you photograph your
  table or draw your own. Don't "helpfully" scrape them in later.

---

## Photo viewer + hover preview

- **`app/js/lightbox.js`** — `openLightbox({ items, startIndex, thumbFor })`.
  Opens with a **FLIP** zoom out of the clicked thumbnail: the image is laid out
  at its final size, then transformed back onto the thumbnail's rect and
  released. Only `transform`/`opacity` are animated — they're the two properties
  the compositor handles without re-running layout, which is the difference
  between smooth and janky on a phone. `thumbFor(index)` is re-queried on close
  so it zooms back into whichever photo you cycled to, not the one you opened.
  The thumbnail is `object-fit: cover` and the full image `contain`, so a
  uniform scale can't match both edges — it scales to cover and fades over the
  difference rather than attempting a true crop morph.
- Cycling (arrows / chevrons / horizontal swipe) uses a short directional slide,
  **not** the zoom — the zoom means "this came from that tile". Swipe-down
  closes. Esc closes, neighbours are preloaded, body scroll is locked, focus is
  restored on close, and `prefers-reduced-motion` skips the animation.
- **Hover preview** (`games-list.js`) — enlarged copy of the row thumbnail after
  a 130ms delay. It grows until it hits whichever viewport dimension runs out
  first, less a 28px cushion, so a panorama is bounded by width and a portrait
  shot by height. It sits beside the row when there's room and **centres** when
  there isn't — at near-fullscreen there is no "beside" left. It shows the cached small
  thumb immediately and swaps in the full-resolution file once that loads, so a
  large preview isn't just a blown-up 400px thumbnail and the big file is only
  fetched when someone actually lingers. Rows can carry **two** thumbnails —
  the game's cover photo and the terrain layout it was played on. It is appended to `<body>`, **not** the row: `.panel` is
  `overflow: hidden`, so anything scaled up inside the table gets clipped at the
  panel edge. It prefers to sit right of the row, then left, then centred,
  clamped into the cushion either way, and is gated behind
  `(hover: hover) and (pointer: fine)` so a tap on touch doesn't strand one
  on screen. Hidden on scroll/resize, since it's anchored to a rect.
- **Preview teardown is not just `mouseleave`.** The row can be destroyed under
  the cursor — clicking it navigates into the game and tears the table down, and
  a live SSE update rebuilds it — and no `mouseleave` fires when that happens,
  which left the preview stranded over the next screen with no way to dismiss it
  (it's `pointer-events: none`). `hidePreview()` is therefore also wired to
  `pointerdown` (capture), `hashchange`, and the top of `refresh()`. Add new
  teardown paths there rather than assuming the pointer will leave politely.
- **Clicking a row thumbnail opens the photo viewer, not the game.** The tiles
  are `<button class="list-thumb-wrap">` that `stopPropagation()` on the row's
  navigate handler. The list row only carries the cover + layout thumbs, so
  `openRowGallery()` fetches `GET /games/:id/images` on click and opens the
  lightbox at the photo you clicked, with the rest cyclable. The terrain-layout
  tile is a special case: when it's the picture attached to the `deployment_maps`
  row (rather than a game photo tagged MAP) it isn't part of the game's set, so
  it opens on its own with no cycling chrome.

---

## Game photos

Bytes on disk, metadata in Postgres. Deliberately **not** bytea: a nightly
`pg_dumpall` shouldn't carry multi-MB blobs.

- **Where** — `UPLOAD_DIR` (`/data/uploads` in the container) is bind-mounted
  from `~/sites/sites/40kResultsTracker/uploads`. That path is the project root,
  **not** `app/`, so uploads stay out of git and out of the SPA's `try_files`
  fallback. Caddy serves them read-only at `/uploads/<game_id>/<file>` with a
  1-year immutable cache header (filenames are UUIDs, so they never collide).
  The Node process is not in the read path.
- **Body limits — the sharp edge.** `server.js` applies
  `express.json({ limit: '256kb' })` app-wide, and it runs **before** the
  routers, so a route-level parser with a bigger limit is dead code: the global
  one 413s the request first. The upload path is therefore explicitly skipped by
  the global parser (`IMAGE_UPLOAD_PATH`) and parses itself at 12mb in
  `routes/images.js`. This shipped broken once — every real photo failed with
  "request entity too large" while the tests passed, because the test fixture
  was a 352-byte JPEG. **Any size-limit test needs a realistically-sized
  payload.** Every other route stays at 256kb.
- **Zip uploads** — Google Photos hands you a `.zip` when you download more than
  one picture, so `app/js/zip.js` unpacks it client-side and feeds each image
  into the same `shrink()` pipeline. **No library**: the browser's
  `DecompressionStream('deflate-raw')` does the inflating. It handles STORED and
  DEFLATE entries in a classic (non-Zip64) archive, finds the end-of-central-
  directory by scanning backwards (it moves when the archive has a trailing
  comment), reads the data offset from the **local** header rather than the
  central directory (their name/extra lengths can differ), and skips
  directories, `__MACOSX/`, dot-files and non-images. An unsupported entry is
  skipped rather than failing the batch. Zips are expanded before the upload
  loop starts so progress reads "3 of 12", not "1 of 1".
- **Resizing happens in the browser** (`shrink()` in `game-detail.js`): a
  ~2048px full and a ~400px thumb, both JPEG q0.82, posted as base64 data URLs.
  That keeps `sharp`/imagemagick out of the image and means a 12MP phone photo
  never crosses the wire at full size. `createImageBitmap(file, {
  imageOrientation: 'from-image' })` is load-bearing — without it, portrait
  phone photos come out sideways once re-encoded through a canvas.
- **Cover photo** — `is_thumbnail` picks the one shown in the games list, with a
  partial unique index enforcing at most one per game. The first upload becomes
  the cover automatically; deleting the cover promotes the oldest survivor.
- **Map photo** — `is_map` works the same way (own partial unique index, toggled
  from the same panel) and marks the shot of the terrain layout. The two flags
  are independent, so one photo can be both. The games list's second thumbnail
  prefers this per-game photo and falls back to the picture attached to the
  `deployment_maps` row, which is shared by every game on that layout.
- **Deleting a game** cascades `game_images` rows, but files need an explicit
  unlink — `routes/admin.js` calls `removeGameImageFiles(id)` from
  `routes/images.js`. If you add another game-deletion path, call it there too.
- **Backups** — the nightly config tarball already archives `sites/sites`
  excluding `*/app`, so `uploads/` is captured. It's a *full* tarball every
  night, so if the photo library ever gets large, split it out into an
  incremental `rclone sync` instead.

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
