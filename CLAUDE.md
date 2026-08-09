# CLAUDE.md — 40k Results Tracker

This file is auto-loaded by Claude Code into every session. It is the single source of truth for orienting in this repo. **Read it first; it'll save you re-reading half the codebase.**

---

## What this is

Multi-user Warhammer 40,000 game-results tracker (10th and 11th edition — each game carries an `edition` flag; new games default to 11e). Friends log matches (mission, factions, per-round scoring, secondaries, challenger cards), browse a filterable game list, view a stats dashboard, and stake territory on a seeded "Theatre of War" galaxy map. Hosted at **https://40k.thewheeliebois.com** as a Docker stack alongside other thewheeliebois.com sites. See `DEPLOY.md` for infra/deploy steps.

There are **two ways in**. `/games/new` is the one-page form for a game that's already over (and the only path for a 10e game). `#/play` is the **live tracker** — a mobile-first Setup → Round 1..5 → Summary wizard you drive *during* an 11e game, autosaving to a server-side draft, optionally co-edited by your opponent on their own phone, watchable by anyone else as a read-only spectator, and filed as a normal game by one Submit at the end. See "Live game tracker" below.

Deletion is **recoverable**: removing a game or a live game archives it into a recycle bin an admin can restore from. See "Restorable deletes".

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
│   ├── backup.sh           nightly pg_dump → ~/sites/backups/, 30-day retention
│   ├── test-unit.sh        the unit suite — no network, no DB, no container
│   ├── test-live.sh        the integration suite — needs the API + real Postgres up
│   └── build-mission-cards.py  rebuilds app/data/mission-cards-11e.json from the
│                           Game Datacards mission dump; --check fails on drift
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
│   │   ├── async-routes.js catchAsync(router) + installRejectionGuard() — the
│   │   │                   reason an async throw no longer kills the process
│   │   ├── params.js       idParam / intParam — id parsing that respects the pg
│   │   │                   32-bit integer ceiling
│   │   ├── archive.js      the recycle bin: archiveGame / archiveDraft /
│   │   │                   restoreItem / purgeItem / removeArchivedFiles
│   │   ├── audit.js        fire-and-forget audit log writer — NEVER hand it a
│   │   │                   raw request body; see "Security posture"
│   │   ├── events.js       in-process SSE broadcaster (subs Set + broadcast())
│   │   ├── game-scoring.js computeFinalScores + resolvePlayerTimes + validateGameInput (pure, tested)
│   │   ├── game-write.js   the ONE INSERT path into games/game_players/children —
│   │   │                   createGame(client, body, actorUserId) plus resolvePlayerIdentities,
│   │   │                   resolveGameLookups, insertPlayerChildren, recordBannerFirstSeen,
│   │   │                   detachmentList/joinDetachments, notifyGameLogged. Shared by
│   │   │                   POST /games and POST /drafts/:id/submit
│   │   ├── draft.js        pure autosave-merge + submit-validation for the live tracker
│   │   │                   (mergeDraftPatch, opponentSeatPatch, normalizeDraftRounds,
│   │   │                   validateDraftSubmit) — tested
│   │   ├── glicko2.js      pure Glicko-2 rating math (ratePeriod/expectedScore), tested vs Glickman example
│   │   ├── whr.js          whole-history rating: global Bradley-Terry fit (retroactive), tested
│   │   ├── ratings.js      games → all-time ratings (glicko OR whr, margin-of-victory) + balanced matchmaker
│   │   ├── adopt-guest.js  promote guests → inactive accounts (preview + promote, war-map-safe)
│   │   ├── game-filter.js  COUNTED_GAMES — the shared "counts toward stats" gate (digital on/off)
│   │   ├── faction-anchors.js  server-side mirror of FACTION_HOMES + SPARE_ANCHORS /
│   │   │                   chooseSpareAnchor() for the 2nd+ player of a faction
│   │   └── mail.js         notify(subject, text) + isFixtureActor() → the shared mailer;
│   │                       no-ops unless MAILER_URL + MAILER_TOKEN are set
│   ├── routes/             each file: `export default Router()` mounted in server.js
│   │   ├── auth.js         /auth/*  — login, logout, me, PATCH me, change-password
│   │   ├── admin.js        /admin/* — user CRUD, game visibility, game delete,
│   │   │                   the recycle bin (/admin/deleted*), guests, audit log
│   │   ├── games.js        /games/* — list/get (PUBLIC) + create/update (auth);
│   │   │                   the write helpers now live in lib/game-write.js
│   │   ├── drafts.js       /drafts/* — LIVE GAME TRACKER: in-progress games in their own
│   │   │                   game_drafts table. list/create/read/autosave-PATCH/invite/join/
│   │   │                   submit/discard + mid-game photos. Per-route auth, not blanket
│   │   ├── images.js       /games/:id/images — photo upload/cover/delete (bytes on disk);
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
│   └── test/                see "Testing" — 190 unit + 156 integration
│       ├── README.md       how to run + what's covered
│       ├── game-scoring.test.js  42 cases pinning the camelCase payload contract
│       ├── game-rules.test.js    34 — the client mirror, cross-checked payload-by-payload
│       │                         against the server's computeFinalScores
│       ├── army-list.test.js     24 — YAAB decoding off real round-tripped codes,
│       │                         plus a format-drift canary that reads yaab's storage.js
│       ├── draft-merge.test.js   16 — the autosave merge: arrays replace, null is a value,
│       │                         seat-keyed players patch, opponent scope rejection
│       ├── draft-submit.test.js  15 — validateDraftSubmit messages + round-number sanitising
│       │                         + the 11e 45/45 halves surviving the submit path
│       ├── nav-stack.test.js     12 — back-button layering, against a fake History
│       ├── whr.test.js           8 — whole-history fit: transitivity, bounded undefeated
│       ├── glicko2.test.js       4 — pins Glicko-2 math to Glickman's worked example
│       ├── ratings.test.js       4 — margin-of-victory + display mapping + balanced pairing
│       ├── game-filter.test.js   1 — COUNTED_GAMES SQL shape with digital on/off
│       └── integration/          ⚠ runs against the LIVE API and the REAL database
│           ├── _harness.js               login/fixtures/cleanup — read its comments first
│           ├── drafts-permissions.test.js 70 — every seat × every route
│           ├── drafts-lifecycle.test.js   33 — create → autosave → submit → photos,
│           │                             and the running score on the live-games list
│           ├── deleted-items.test.js      19 — archive / restore / purge, incl. the FK scrub
│           ├── game-images.test.js        6 — the terrain shot is a game photo:
│           │                              POST accepts isMap, re-shooting demotes
│           │                              the previous one, nothing is shared
│           ├── game-times.test.js         7 — chess-clock totals: derived from the
│           │                              rounds, and the time_is_manual override
│           ├── secondary-modes.test.js  10 — Tactical vs Fixed per seat; a Fixed
│           │                              mission holding a row per scoring round
│           ├── detachments-admin.test.js  8 — library promotion on save; rename/merge
│           │                              across the library AND recorded games; 409 in_use
│           └── zz-residue.test.js         3 — runs LAST; fails the build on leaked test data
└── app/                    SERVED BY CADDY at /srv/40kResultsTracker/app
    ├── README.md           frontend overview
    ├── index.html          script tags for every JS module (no bundler)
    ├── css/style.css       YAAB-matched dark Warhammer theme — see "Critical invariants"
    ├── data/               committed static data the app fetches at runtime
    │   └── mission-cards-11e.json  the 11e mission deck as rules text; GENERATED
    │                       by scripts/build-mission-cards.py — don't hand-edit
    └── js/
        ├── README.md       module roles
        ├── app.js          hash router, shell renderer, route table, nav links, error boundary
        ├── api.js          fetch wrapper; 11 exports: api, auth, reference, games, gameImages,
        │                   drafts, draftImages, stats, admin, seasons, ratings
        ├── components.js   el(), clear(), toast(), pill(), fmtDate(), fmtDuration(), fmtScore(),
        │                   selectOptions(), confirmModal(), promptModal() — USE THESE
        ├── game-rules.js   40k rules constants + score maths shared by game-form.js AND
        │                   live-game.js: ROUNDS, DEFAULT_EDITION, MATCHED_PLAY_LAYOUTS,
        │                   E11_PRIMARY_CAP/E11_SECONDARY_CAP, E11_FIXED_CARD_CAP, FIXED_SECONDARY_COUNT,
        │                   secondaryMode/isFixedMode/fixedCardTotal/fixedCardHeadroom, FORCE_DISPOSITIONS,
        │                   PRIMARY_MATRIX, parseDuration, sumPrimary, sumSecondaries,
        │                   sumSecondaryPoints, capLabel, calcTotal
        ├── images.js       shrink(file, maxDim, quality) → { dataUrl, width, height };
        │                   the browser-side downscale every upload path goes through
        ├── army-list.js    decodes YAAB army-list share codes (YAAB1:…) — zero deps,
        │                   DecompressionStream('deflate-raw') + atob
        ├── nav-stack.js    back-button support for overlays and wizard steps —
        │                   pushLayer(onPop) / layer.done(); see "Back-button handling"
        ├── live.js         singleton EventSource on /api/events → 'live:game.saved' and
        │                   'live:draft.updated' CustomEvents on document
        ├── lightbox.js     full-screen photo viewer; FLIP zoom + cycle + swipe
        ├── zip.js          dependency-free ZIP reader (Google Photos multi-download)
        ├── mission-cards.js  the 11e deck as readable rules text — lazy-loads
        │                   app/data/mission-cards-11e.json, matches cards by
        │                   name, and renders one card or the whole deck in a
        │                   modal. See "Mission card rules text"
        └── views/
            ├── README.md          view convention + how-to recipes
            ├── login.js           public login screen
            ├── games-list.js      filter panel + paginated game table + SSE auto-refresh
            ├── game-detail.js     single game view + admin Hide/Delete buttons
            ├── game-form.js       ⚠ HEAVIEST file; new game + edit; localStorage draft + undo
            ├── live-game.js       LIVE TRACKER wizard (/play, /play/:id) — 11e only,
            │                      mobile-first, server-side draft, SSE co-editing
            ├── stats.js           KPIs + Chart.js charts; matchup heatmap; calendar; trends
            ├── warmap.js          ⚠ Theatre of War canvas — DO NOT TOUCH constants (see invariants)
            ├── admin.js           user management, audit log, seasons, guest-account promotion,
            │                      Deleted Items (the recycle bin), change-own-password
            ├── ratings.js         ⚠ ADMIN-ONLY /rankings — Glicko-2 leaderboard + balanced matchmaker
            ├── player.js          per-player profile (overview + per-faction + streaks)
            └── profile.js         self-serve "My Profile" — army_name, change password,
                                   between-rounds photo prompt opt-out
```

High-traffic files when iterating: **`game-form.js`**, **`live-game.js`**, **`games.js`**, **`drafts.js`**, **`warmap.js`**, **`stats.js`**. For module-internal conventions, prefer the directory's `README.md` over scrolling this file.

---

## Critical invariants — DO NOT TOUCH WITHOUT THINKING

These are load-bearing. Changing any of them silently breaks production.

| Invariant | File | Why it's frozen |
|---|---|---|
| `MAP_SEED = 0xDEAD40` | `app/js/views/warmap.js` | The whole Theatre of War is a Voronoi computed from this seed. Change it and every faction's territory boundary jumps to a new shape for everyone, instantly invalidating the visual continuity that's the whole point. |
| `FACTION_HOMES` positions | `app/js/views/warmap.js` | Each faction's seed anchor sits at a hard-coded `[x, y]` in 0..1 space. Anchors are no longer drawn as fortresses — they're the invisible roots that drive the initial Voronoi assignment. Editing or reordering shifts every banner's seed site and reshapes the whole map. **Append new factions only; never edit or reorder.** |
| `FACTION_COLOURS` | `app/js/views/warmap.js` | Lore-matched (Blood Angels red, Salamanders green, etc). Treat as the canonical palette. |
| YAAB CSS variables | `app/css/style.css` | `--bg`, `--panel-bg`, `--accent`, `--font-display`, etc. were copied verbatim from the sister `yetanotherarmybuilder` site to keep visual consistency across the user's properties. Don't redesign — match. |
| 5 battle rounds | everywhere | `ROUNDS = [1,2,3,4,5]` in `app/js/game-rules.js` (imported by `game-form.js` **and** `live-game.js`); `ROUND_MIN`/`ROUND_MAX` in `api/lib/draft.js`; `CHECK (round_number BETWEEN 1 AND 5)` on every round-numbered table in `schema.sql` (`game_rounds`, `player_secondaries` — twice, incl. `drawn_round` — `player_challengers`, `game_draft_images`). Both 10e and 11e are 5-round games. |
| A draft is not a game | `api/routes/drafts.js`, `schema.sql` | In-progress games live in `game_drafts` / `game_draft_images` and **touch nothing in `games`**. This isn't politeness, it's structural: `games.points_limit` and `games.created_by_user_id` are `NOT NULL` and `game_players` has `CHECK (user_id IS NOT NULL OR guest_name IS NOT NULL)`, so a half-played game literally cannot be represented there. Nothing in the draft path touches `COUNTED_GAMES`, `v_game_player_stats`, `stats.js`, `warmap.js` or `ratings.js` — an in-progress game is therefore *incapable* of reaching the games list, the stats, the war map or the rankings. Don't "simplify" this by adding an `is_draft` flag to `games`. |
| The two localStorage draft keys are distinct | `game-form.js` vs `live-game.js` | `tg40k:newGameDraft` (the `/games/new` form's restore prompt) and `tg40k:liveDraft:<id>` (the live tracker's per-draft offline mirror) are separate namespaces on purpose. Merge or rename them and the "Restore unsaved game?" prompt on `/games/new` starts offering half-played live games. |
| Existing games are 10e | `schema.sql` edition migration | Every game logged before the `edition` column existed was 10th edition. The migration adds the column with `DEFAULT '10'` **and then** flips the default to `'11'` — so the backfill lands on 10e and only new rows get 11e. Don't "simplify" that to a single `DEFAULT '11'`; it would silently re-label the entire back catalogue. |
| No public signup | `routes/auth.js` (no register endpoint) | Admin creates all accounts via `POST /admin/users`. Login page must not have a "Sign up" link. |
| No game deletion **from `/games`** | `routes/games.js` (no DELETE) | Hiding is the normal move — `PATCH /admin/games/:id/visibility { hidden: true }` — because results are meant to be permanent. Deletion exists only as an admin escape hatch on the *admin* router (`DELETE /admin/games/:id`), and it now **archives into `deleted_items`** rather than destroying anything. Don't add a DELETE to `games.js`. |
| Deletes **archive rows out**, they don't set a flag | `lib/archive.js`, `deleted_items` | The obvious design is `games.deleted_at` + `WHERE deleted_at IS NULL`. It would need gating **~20 queries** across the 13 endpoints in `stats.js`, `warmap.js`, `ratings.js`, the games list — and `v_game_player_stats`, which (see "View") already can't express the digital filter. Miss one and a deleted game leaks back into the stats or the war map, silently and permanently. Archiving the row-set *out* of the live tables means **nothing that reads `games` has to learn about deletion at all**. Don't "simplify" it back into a soft-delete column. |
| Bootstrap admin only when users table is empty | `lib/auth.js` `ensureBootstrapAdmin()` | After first run, `ADMIN_PASSWORD` env var is ignored. To recover, INSERT directly via psql. |

---

## Common pitfalls (real bugs that have happened)

### 1. camelCase frontend ↔ snake_case database

The frontend sends and receives **camelCase** (`primaryScore`, `roundNumber`, `gameFormat`). The Postgres columns are **snake_case** (`primary_score`, `round_number`, `game_format`).

**Conversion happens at the boundary** — either when writing into the DB, or when shaping the response back to the client:

| Direction | Where the mapping lives |
|---|---|
| DB row → frontend (loading a game for edit) | `makeDraft()` in `app/js/views/game-form.js` |
| Frontend payload → DB INSERT | `createGame()` / `insertPlayerChildren()` in `api/lib/game-write.js`, plus the update handler in `api/routes/games.js` |
| `computeFinalScores(players, edition)` reads camelCase | `api/lib/game-scoring.js` — it operates on the request body before insert, never on DB rows |
| Live-tracker draft payload | `game_drafts.payload` (JSONB) is camelCase too — the same `serializeDraft()` shape — so submit needs no conversion of its own |

**The bug:** `computeFinalScores` once read `r.primary_score` instead of `r.primaryScore`, which made every game total to 0–0 → recorded as a draw forever. If you touch this function, **the keys must be camelCase** (it runs on the request payload, not on DB rows).

### 2. `rerender()` in `game-form.js` blows away input focus

The form view has a `rerender()` helper that clears the form root and rebuilds. **Don't trigger it on every keystroke** — only on structural changes (mission pack change, faction change, add/remove a card slot). For score inputs, mutate the draft state directly in the `change` listener; let the next structural rerender pick up the value.

`live-game.js` has the same closure and the same rule, with one extra wrinkle: because it persists on *every* mutation (see "Live game tracker"), a score input must still write to `localStorage` + queue a PATCH without rerendering. `game-form.js` only saves its draft on a structural rerender, which is why typing a whole game's scores there never touched storage.

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

The new-game form has a single text input for each player's name (no registered/guest toggle). Internally we still store either `game_players.user_id` or `game_players.guest_name` — never both. **The save handlers run `resolvePlayerIdentities()` first** (in `lib/game-write.js`, called by `routes/games.js` *and* by draft submit): for each player whose `userId` is null, it looks up `users.display_name` (case-insensitive, active users only) and rewrites the row to `userId = <found>, guestName = null`. If no match, the row stays a guest.

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

### 9. `live-game-mode` on `<body>` must be removed on teardown

`live-game.js` is the app's only full-bleed view: it adds `live-game-mode` to
`<body>`, and the CSS zeroes `main`'s `padding` and `max-width` so the wizard
runs edge to edge on a phone. Views in this codebase have **no unmount hook** —
`renderShell()` just replaces the DOM — so the class is dropped by a
`hashchange` listener the view installs itself, which fires as soon as the path
stops being `/play`. If you copy this pattern (or refactor the router), a leaked
class costs **every other route** its gutters and reads as "the whole site lost
its layout". Same listener also detaches `pagehide` / `visibilitychange` /
`live:draft.updated` and stops the chess-clock ticker, so removing it leaks a
timer as well.

### 10. SSE events echo back to their own sender

`/events` is a fan-out to *every* subscriber, including the client that caused
the write. In the live tracker two phones edit one draft, so an unfiltered
`draft.updated` means phone A's own PATCH comes straight back as a "remote"
change and clobbers whatever the user is typing mid-keystroke. Every PATCH
therefore carries a per-mount `clientId`, the broadcast carries it back as `by`,
and the receiver drops any event where `by === clientId` (then any event whose
`rev` isn't newer than what it already has). **Any future multi-writer event
needs the same guard.**

Related and just as load-bearing: **`GET /events` is public and unfiltered** (see
the permission table), so `draft.updated` carries only `{ id, rev, by }` — never
draft content. The receiving client re-reads through the auth-gated
`GET /drafts/:id`. Don't "optimise" by putting the payload on the wire; anyone
with the URL is subscribed.

### 11. A new upload route must be added to `IMAGE_UPLOAD_PATH`

`server.js` applies `express.json({ limit: '256kb' })` app-wide **before** the
routers, so a route-level parser with a bigger limit is dead code — the global
one 413s first. Upload routes are exempted by one regex:

```js
const IMAGE_UPLOAD_PATH = /^\/(?:games\/\d+\/images|maps\/\d+\/image|drafts\/\d+\/images)\/?$/;
```

It's POST-only and matched against `req.path`. This shipped broken once for game
photos — every real photo failed with "request entity too large" while the tests
passed, because the fixture was a 352-byte JPEG. It now has a **second
consumer** (`POST /drafts/:id/images`, which parses itself at 12mb inside
`routes/drafts.js`), so the trap is live again for whatever gets added third.
**Any size-limit test needs a realistically-sized payload.**

### 12. An async handler that throws used to kill the container

Express 4 doesn't await handlers and Node 22 exits on an unhandled rejection, so
for a while `POST /auth/login {"username":"admin","password":{}}` — no session
needed — took the whole site down. `catchAsync()` (applied to every mount) and
`installRejectionGuard()` now cover it, but the habit still matters:

- **Register routes inside the route module.** `catchAsync` walks the stack once,
  at mount time; anything added to a router afterwards is unwrapped.
- **Parse ids with `idParam` / `intParam` from `lib/params.js`**, not `parseInt`.
  `parseInt('abc')` is `NaN` (pg `22P02`) and `Number.isInteger(1e20)` is `true`
  while Postgres `integer` stops at 2147483647 (pg `22003`). `stats.js`,
  `warmap.js` and `seasons.js` haven't been converted yet.
- **Never hand a raw request body to `audit()`.** Build the payload explicitly.
  Doing otherwise put plaintext passwords in `audit_log`, on screen in the admin
  panel, and in every offsite backup.

Full write-up in "Security posture".

---

## Backend architecture

### Boot sequence (`api/server.js`)

0. **`installRejectionGuard()`** — the very first statement in the file, before
   the app object exists. See "Security posture"; without it a single async
   throw took the whole container down.
1. Construct the Express app + session middleware (Postgres-backed via `connect-pg-simple`, table `session`, cookie **`tg40k.sid`**, `httpOnly` + `sameSite: 'lax'`, `secure` only when `NODE_ENV === 'production'`, 30-day `maxAge`). `app.set('trust proxy', 1)` — Caddy is in front.
2. Register **`/health`** inline, then apply `express-rate-limit` to `/auth/login` (20 attempts / IP / 15 min). It's the only limiter on the app.
3. Mount every router, each wrapped in **`catchAsync()`**: `/auth`, `/admin`, `/games` (twice — `images.js` **before** `games.js`), `/stats`, `/reference`, `/stats` again (warmap.js), `/events`, `/seasons`, `/ratings`, `/drafts`

   **`/drafts` is a top-level mount, not `/games/drafts`.** `games.js` has a
   `router.get('/:id')`, which would swallow `/games/drafts` as a game id and
   return an opaque 404 (or worse, a NaN query). Keeping drafts off the `/games`
   prefix also mirrors the invariant: a draft is not a game.

   `catchAsync` **rewrites the router's handler stack in place, at mount time**,
   so a handler registered on a router *after* it is mounted is not wrapped.
   Register routes in the route module, never from outside it.
4. Top-level error handler emits the uniform `{ error, code? }` body with status from `err.status`. Messages are replaced with `'internal error'` for any status ≥ 500, so a pg error's text never reaches a client. It special-cases 413 / `entity.too.large` into a human "that file is too large to upload" with `code: 'too_large'`
5. Then, inside an async IIFE: `initSchema()` (runs `schema.sql` then `seed.sql`, both idempotent) → `ensureBootstrapAdmin()` (if `users` is empty AND `ADMIN_PASSWORD` is set, insert the admin) → `app.listen(PORT)`. A failure here is the one deliberate `process.exit(1)` in the codebase — a box that can't migrate its schema must not serve traffic.

Steps 1–2 also install the split body parser: `express.json({ limit: '256kb' })`
runs app-wide **except** on paths matching `IMAGE_UPLOAD_PATH`
(`POST /games/:id/images`, `POST /drafts/:id/images`),
which parse themselves at 12mb inside `routes/images.js` / `routes/drafts.js`.
Add any new upload route to that regex or it will 413 before the handler is
reached — see pitfall #11.

### Route module convention

**Reads are public.** Only `admin.js` and `ratings.js` carry a top-level
`router.use(requireAdmin)`. `games.js`, `stats.js`, `warmap.js`,
`reference.js`, `events.js` and `GET /seasons` have **no** auth gate at all — an
anonymous visitor can browse the whole site — and `images.js`, `auth.js`,
`seasons.js` and `drafts.js` apply `requireAuth` / `requireAdmin` per route.
`drafts.js` is the one module where per-route isn't enough: its three GETs
(`/`, `/:id`, `/:id/images`) are **ungated like the rest of the site's reads**,
and on the write routes a session only gets you in the door — the handler then
has to establish *which seat you are* (see "Live game tracker"). Don't add a
blanket `router.use(requireAuth)` to a read module: it would silently take the
site private. The template below is for a module that *should* be gated.

Whatever the module does about auth, `server.js` wraps it in `catchAsync()` at
mount time, so a handler may `throw` / reject freely and the top-level error
handler will shape the response — see "Security posture".

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

### `lib/game-write.js` — the single INSERT path into `games`

There are now **two** callers that create a game — `POST /games` and
`POST /drafts/:id/submit` — so the write itself was lifted out of
`routes/games.js` into `lib/game-write.js`. If you add a third, call
`createGame`; don't hand-roll another INSERT, or the next column added to
`games` will be silently missing on one path.

- **`createGame(client, body, actorUserId) → Promise<gameId>`** — inserts the
  `games` row, both `game_players` rows and every child table. `client` must
  come from `withTx()`. It assumes `body.players[0]` and `[1]` exist, and reads
  camelCase throughout.
- **`insertPlayerChildren(client, gamePlayerId, p)`** — writes `game_rounds`, `player_secondaries`, `player_challengers` rows for one player. Always called inside `withTx()`.
- Also here: `resolvePlayerIdentities`, `resolveGameLookups`,
  `recordBannerFirstSeen`, `detachmentList` / `joinDetachments`,
  `notifyGameLogged`, `FORCE_DISPOSITIONS`.
- Two card-id helpers, and the difference between them is load-bearing:
  **`findCardId`** (match-only, used for secondaries) never inserts, whereas
  **`resolveCardId`** (challengers) does. **`dropDanglingCardIds`** runs *after*
  `resolveGameLookups` and degrades an unresolvable id to name-only. All three
  are explained in "Security posture".

`createGame` deliberately does **not** own the surrounding pipeline. Each caller
keeps `validate… → resolvePlayerIdentities → computeFinalScores →
resolvePlayerTimes` before it, and `audit → broadcast('game.saved') →
notifyGameLogged` after — because the two paths validate differently (see the
live-tracker section) and submit has extra work to do afterwards.

**`computeFinalScores(players, edition)`** stays in `lib/game-scoring.js` — sums
`primaryScore` from rounds + `score` from secondaries + `score` from challengers,
recomputes `secondaryScore` per round from the cards, sets `result` to
`'win'/'loss'/'draw'`. **Manual winner override:** if `players[0].manualWinner`
is true → P1 wins; both true → draw; else falls back to score comparison. Reads
camelCase, not snake_case.

For game updates, `PUT /games/:id` keeps its own body and the pattern is **delete-then-reinsert all children** (rounds, secondaries, challengers) — there's no diff/patch. The transaction makes that safe.

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
  { match: /^\/play$/,               handler: () => renderLiveGame(state, null),                requireAuth: true },
  { match: /^\/play\/(\d+)$/,        handler: (m) => renderLiveGame(state, parseInt(m[1], 10)), requireAuth: true },
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

`currentPath()` strips the query string before matching, which is what lets a
share link like `#/play/12?token=…` hit the bare `/^\/play\/(\d+)$/` route; the
view reads the token back out of `location.hash` itself.

Nav links come from `linkDefs` in `renderShell()`. Order: **Theatre of War,
Games, Stats**, then **Live Game** (`/play`) and **New Game** (`/games/new`) when
there's a session, then **Rankings** and **Admin** for admins. Live Game sits
before New Game deliberately — during a game it's the one you want.

### View module convention

Every file in `app/js/views/` exports one async function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. Async `await reference.…()` calls happen up-front. Local helpers and a `rerender()` closure mutate a `draft` object and rebuild as needed.

### DOM helpers — use them, do not template-string

`components.js`:

- `el(tag, attrs?, children?)` — the workhorse. `attrs.class`, `attrs.style` (object), `attrs.onClick` etc. Children can be string, node, array, or null/false (skipped).
- `clear(node)` — empty children
- `toast(msg, kind?)` — bottom-right ephemeral toast (3s); kind `'error'` styles red
- `pill(text, kind?)` — a styled badge; kind `'win'`, `'loss'`, `'draw'`, `'first'`, `'hidden'`
- `fmtDate(d)` — YYYY-MM-DD
- `fmtDuration(seconds)` — `m:ss` / `h:mm:ss`; the inverse of `parseDuration()` in `game-rules.js`
- `fmtScore(n)` — score display helper
- `selectOptions(items, valueKey?, labelKey?, includeBlank?, blankLabel?)` — quick `<option>` array
- `confirmModal(...)` / `promptModal(...)` — always these, never native `confirm()` / `prompt()`

**Don't introduce React, Vue, lit-html, htm, or template-literal HTML.** This codebase is consciously framework-free; the `el()` pattern is consistent across every view. New code should match.

### Shared non-view modules

Three modules exist purely so `game-form.js` and `live-game.js` can't drift
apart. Extend these rather than re-implementing in a view:

- **`game-rules.js`** — every 40k rules constant and the score maths
  (`ROUNDS`, `DEFAULT_EDITION`, `MATCHED_PLAY_LAYOUTS`, `E11_PRIMARY_CAP`,
  `E11_SECONDARY_CAP`, `FORCE_DISPOSITIONS`, `PRIMARY_MATRIX`, `parseDuration`,
  `sumPrimary`, `sumSecondaries`, `sumSecondaryPoints`, `capLabel`,
  `calcTotal`). `calcTotal()` is a **hand-maintained mirror** of
  `computeFinalScores()` in `api/lib/game-scoring.js`, driving the live readout
  only — the server value is authoritative, but the two must agree or the number
  on screen changes when you hit Save.
- **`images.js`** — `shrink(file, maxDim, quality)`, the browser-side downscale
  every upload path goes through (game photos incl. the terrain shot, mid-game
  draft photos, zip batches).
- **`army-list.js`** — YAAB share-code decoding; see "Army lists" below.

### Back-button handling (`app/js/nav-stack.js`)

The app is hash-routed, so back moves between **routes**. Anything layered on top
of a route — the photo viewer, a modal, the live wizard's draw picker, a wizard
step — is invisible to history, so back skipped straight past it and left the
page. On a phone that reads as the app throwing you out.

```js
const layer = pushLayer((reason) => teardown());   // the BACK path
function close() { teardown(); layer.done(); }     // the own-means path
```

`teardown()` **must be idempotent** — both paths reach it. `reason` is
`'popstate'` (back) or `'route'` (a hash change tore the view down anyway).

**One sentinel, not one entry per layer.** The invariant is: *while any layer is
open, exactly one sentinel history entry sits above the route entry.* Back
consumes it, the top layer closes, and `arm()` puts it back if layers remain.

The obvious design — a history entry per layer, matched by id in `history.state` —
was tried and is worse in one specific, miserable-to-reproduce way: if a
`pushState` silently doesn't take (WebKit rate-limits them), back falls through to
the previous **route**, so a single press closes the overlay *and* navigates away
underneath it. One `pushState` per overlay session also keeps us clear of that
rate limit entirely. `arm()` swallows a failed push: the layer still works, it
just doesn't answer back that time.

`disarm()` uses `history.back()` on an entry pushed **with no url**, so it fires
`popstate` but not `hashchange` — the route is untouched.

Two more things it does:

- **A route change sweeps orphans.** Overlays are appended to `<body>`, not
  `#app`, so a route re-render doesn't remove them. On `hashchange` every layer
  is popped with reason `'route'` and `sweepOrphans()` removes any stray
  `.lb-overlay` / `.modal-overlay` and drops `lb-lock` from `<body>`. Add new
  overlay class names to that selector.
- **It is importable outside a browser** (`hasDom` guard), because the unit
  tests import `components.js`, and a bare `window.addEventListener` at module
  scope would throw before a single assertion ran.

Consumers: `components.js` (`confirmModal` / `promptModal` — back = cancel),
`lightbox.js` (the photo viewer, the only caller that reads `reason`), and
`live-game.js` twice (wizard step navigation, and the draw picker). Pinned by
`nav-stack.test.js` against a fake `History`.

### The stats dashboard on a phone

`/stats` used to scroll sideways. The cause is worth remembering because it will
recur: **a grid item's default `min-width: auto` is its min-content width**, so a
single wide table inside a `.stat-card` widened the whole grid track and gave the
*page* a horizontal scrollbar. `.stat-card` has neither of the `overflow` rules
that `.panel` / `.panel-body` carry, so nothing contained it.

- `.stats-grid > * { min-width: 0 }` breaks the propagation; anything genuinely
  wider than its card scrolls **inside its own `.stats-scroll` wrapper**
  (`tableScroll()` in `stats.js`).
- Charts are sized from CSS (`.stats-chart`, `.is-tall`) with
  `maintainAspectRatio: false` on every Chart.js instance. Without it an 18-bar
  chart is ~14px per bar on a phone — unreadable and untappable. Row-driven
  heights come from `rowChartHeight()`.
- The **29×29 matchup matrix** renders twice and CSS picks: the grid above 700px,
  a faction-picker `<select>` + tappable row list below it. 29 columns of 28px
  cells whose only affordance is a `title` tooltip is not a thing a touch device
  can read or hit.
- **Calendar days select rather than navigate.** Tapping a lit day shows a
  readout with a separate "View games" button. A 11px cell is far too easy to
  hit by accident to make it a navigation.
- The `.stat-card[style*="grid-column"]` attribute-selector hack is **gone** —
  it's a real `.stats-span` class now. The surviving
  `div[style*="grid-template-columns"]` rules reach into `game-form.js`'s inline
  grids and are the pattern *not* to propagate (see "CSS" under the live tracker).

### `api.js` shape

Always extend the right export object — never call `fetch` directly from a view:

```js
export const auth      = { me, login, logout, changePassword, updateMe };
export const reference = { factions, detachments, missionPacks, missionDetails, users,
                            players, playerNames };   // players = unified user+guest picker
export const games     = { list, get, create, update };
export const gameImages = { list, upload, update, remove, url };   // url() → /uploads/<gameId>/<file>
export const drafts    = { list, get, create, patch, join, invite, uninvite, submit, remove };
export const draftImages = { list, upload, remove, url };          // url() → /uploads/drafts/<draftId>/<file>
export const stats     = { overview, factionWinRates, playerWinRates, factionMissionBreakdown,
                            factionDeploymentBreakdown, factionMatchups, headToHead,
                            firstTurnImpact, secondaryAverages, warmap, warmapTimeline,
                            detachmentWinRates, trends, player, calendar };
export const admin     = { users, createUser, updateUser, setVisibility, deleteGame, audit,
                            guestsPreview, promoteGuests,
                            deleted, restoreDeleted, purgeDeleted,     // the recycle bin
                            detachments, addDetachment, renameDetachment, deleteDetachment };
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
| GET | `/auth/me` | auth | current user `{ id, username, displayName, role, armyName, promptRoundPhoto }` |
| PATCH | `/auth/me` | auth | self-serve update: `{ armyName?, promptRoundPhoto? }`. `armyName` is write-always (omitting it clears it); `promptRoundPhoto` is `COALESCE`d, so omitting it leaves it alone |
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
| POST | `/games/:id/images` | auth | `{ dataUrl, thumbDataUrl?, width?, height?, caption?, isMap? }` — base64 data URLs, already downscaled in the browser. 12mb body limit on this route only. Responds **201**. Server-side caps: `MAX_IMAGE_BYTES` 8MB **decoded** (413), `MAX_PER_GAME` 40 photos (409), MIME must be jpeg/png/webp (415) |
| PATCH | `/games/:id/images/:imageId` | auth | `{ isThumbnail?: true, caption?: string, isMap?: boolean }` — each flag is clear-then-set, because the partial unique index rejects a second winner while the old one is still flagged |
| DELETE | `/games/:id/images/:imageId` | auth | uploader or admin only; unlinks both files |
| GET | `/drafts` | **public** | **every** in-progress game, not just yours — `submitted_at IS NULL`, yours sorted first, then newest `updated_at`. A game nobody can find is a game nobody can watch. Each row carries enough to render a list card: `isOwner`, `viewerSeat`, `playedAt`, `pointsLimit`, `playerNames[]`, `playerFactionIds[]`, `scores[]` (the running total per seat, from the real `computeFinalScores` — `[null, null]` until both seats exist) |
| POST | `/drafts` | auth | body **is** the initial payload, stored verbatim as JSONB → `{ id, shareToken, rev }`. Responds **201** |
| GET | `/drafts/:id` | **public** | the full draft + `images[]`, plus computed `viewerSeat` (1 = owner, 2 = opponent, `null` = spectator) and `isOwner`. `share_token` is returned to the **owner only** — it is the join credential. Reads are public like games/stats/the war map; writing is what's gated |
| PATCH | `/drafts/:id` | auth, **seat-scoped** | the autosave endpoint. `{ baseRev, clientId, patch, currentStep }` → `{ rev, stale }`. Read-merge-write under `SELECT … FOR UPDATE` in `withTx`. 403 if an invited opponent tries to write anything but their own seat; 409 once submitted. Broadcasts `draft.updated`. See "Live game tracker" |
| POST | `/drafts/:id/invite` | owner | `{ userId }` → `{ ok: true, opponentUserId }`. 400 self / non-integer, 404 unknown or inactive user, 409 someone already joined |
| DELETE | `/drafts/:id/invite` | owner | clears the opponent back to null → `{ ok: true, opponentUserId: null }` |
| POST | `/drafts/:id/join` | auth + `{ token }` | claim the opponent seat via a share link → `{ id, viewerSeat: 2, isOwner: false, rev }`. Idempotent for the current opponent; 409 if someone else got there first; 400 if you own it |
| POST | `/drafts/:id/submit` | owner | file the draft as a real game → `{ gameId }`. Forces `edition: '11'`. 409 if already submitted, 400 with a player-facing message from `validateDraftSubmit` |
| DELETE | `/drafts/:id` | owner **or admin** | discard — **archived into `deleted_items`**, and the `UPLOAD_DIR/drafts/<id>/` photo folder is deliberately left on disk so a restore comes back with its pictures. The one place admin *is* a bypass, so abandoned games can be cleared out |
| GET | `/drafts/:id/images` | **public** | `[{ id, file_name, thumb_name, caption, round_number, is_map, width, height, uploaded_by_name }]` |
| POST | `/drafts/:id/images` | owner or opponent | same base64 contract as `POST /games/:id/images` (12mb body limit on this route only, same `MAX_IMAGE_BYTES` / MIME caps, 40 photos per draft). Takes an optional `roundNumber` so a shot lands on the round it was taken in, and an optional `isMap: true` for the terrain-layout shot taken on Setup — clear-then-set inside one transaction, since the partial unique index allows one per draft. Responds **201**; 409 once submitted |
| DELETE | `/drafts/:id/images/:imageId` | uploader or draft owner | unlinks both files |
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
| GET | `/admin/users` | admin | all users including inactive; includes `last_login_at` |
| POST | `/admin/users` | admin | `{ username, displayName, password, role, armyName? }` |
| PATCH | `/admin/users/:id` | admin | `{ displayName?, role?, isActive?, password?, armyName? }` |
| PATCH | `/admin/games/:id/visibility` | admin | `{ hidden: bool }` (broadcasts `game.saved`) |
| DELETE | `/admin/games/:id` | admin | **archives into `deleted_items`** and hard-deletes the originals (children cascade). Photo files are deliberately **left on disk** so a restore comes back with its pictures (broadcasts `game.saved` with `action: 'delete'`). See "Restorable deletes" |
| GET | `/admin/deleted` | admin | the recycle bin, newest first: `[{ id, kind, original_id, label, deleted_by_name, deleted_at, canRestore }]`. `canRestore` is false when the original id is occupied in the live table again — the re-insert would collide on the primary key |
| POST | `/admin/deleted/:id/restore` | admin | re-insert the archived row-set → `{ ok, kind, restoredId, repaired }`. `repaired` lists what the FK scrub had to change (see "Restorable deletes"). Broadcasts `game.saved` or `draft.updated` |
| DELETE | `/admin/deleted/:id` | admin | **permanent.** Drops the bin row and unlinks the photo bytes — the only path that touches the files |
| GET | `/admin/detachments?factionId=N` | admin | the faction's detachment library: `[{ id, name, games, inLibrary }]`. A FULL OUTER JOIN of the `detachments` rows against the names actually used in games, so a name recorded before promotion existed still shows (with `id: null`, `inLibrary: false`) |
| POST | `/admin/detachments` | admin | `{ factionId, name }` → adds to the library. 409 if it's already there (case-insensitively) |
| PATCH | `/admin/detachments` | admin | `{ factionId, from, to }` — rename across the library **and every game that used the old name**. Renaming onto a name that already exists is a **merge**; a seat that held both spellings is de-duplicated and its derived `game_players.detachment_name` recomputed. Returns `{ ok, seatsUpdated, merged }` |
| DELETE | `/admin/detachments?factionId=N&name=…` | admin | drop a library entry. **409 `in_use`** while any recorded game still uses the name — rename/merge it instead, or the autocomplete UNION would just resurrect it |
| GET | `/admin/audit[?limit=100]` | admin | recent audit_log rows DESC by created_at; `limit` is capped at 500 |
| GET | `/admin/guests/preview` | admin | read-only: which guests a promotion run would `create` vs `link` |
| POST | `/admin/promote-guests` | admin | promote all unlinked guests to inactive accounts (idempotent, war-map-safe) |
| GET | `/ratings/leaderboard[?marginOfVictory=true&model=glicko\|whr]` | admin | ranked players: `displayFloor` (confidence-adjusted, the rank/headline value), `displayRating` (raw "est"), `rd`, `confidence`, W/L/D, `provisional`, `inMainPool`. **`model` defaults to `whr`** (whole-history). |
| GET | `/ratings/suggest?present=1,2,3[&marginOfVictory=true&model=…]` | admin | up to 4 balanced pairing configs with predicted win-% + last-met; `bye` if odd. `present` is a comma-separated user-id list and needs **at least two** ids (400 otherwise) |
| GET | `/ratings/history[?marginOfVictory=true&model=…]` | admin | every player's day-by-day series for the compare chart `[{ userId, displayName, series:[{x,y}] }]` (y = confidence floor; carried forward to today) |
| GET | `/events` | public | Server-Sent Events stream; emits `game.saved`, `season.changed`, `draft.updated`. Comment heartbeat every 25s. The subscriber records `req.session?.userId` when there is one, but a session is **not** required — anonymous viewers get live updates too, which is exactly why `draft.updated` carries **no draft content**, only `{ id, rev, by }` |

**Total: 68 endpoints** in `routes/*.js`, plus `/health` defined inline in `server.js`. Cross-check:

```bash
grep -hE "router\.(get|post|put|patch|delete)\(" api/routes/*.js | wc -l
```
 `/ratings/*` and the two guest endpoints are admin-only; ratings are computed on the fly (no tables).

---

## DB schema reference

Tables (snake_case throughout):

| Table | Purpose | Key columns |
|---|---|---|
| `users` | account holders | id, username (unique), display_name, password_hash, role ('user'\|'admin'), is_active, army_name (optional, shown on the war map), prompt_round_photo (BOOLEAN NOT NULL DEFAULT TRUE — the live tracker's between-rounds "snap a photo?" nudge; opt-out from My Profile), last_login_at (TIMESTAMPTZ, NULL = never — stamped by `POST /auth/login` only, so a returning user on a live 30-day cookie does **not** refresh it; backfilled from `audit_log` `auth.login` rows by seed.sql) |
| `session` | express-session storage | sid, sess (json), expire — auto-managed by `connect-pg-simple` |
| `factions` | parent codex factions | id, name (unique), parent_id (nullable, currently unused) |
| `detachments` | seeded per-faction detachments — autocomplete only; UNIONed with free-text `game_players.detachment_name` from past games. Consumed by `/stats/detachment-winrates`. | id, faction_id, name; UNIQUE (faction_id, name) |
| `mission_packs` | e.g. Pariah Nexus, Leviathan | id, name (unique) |
| `primary_missions` | e.g. Take and Hold | id, mission_pack_id, name |
| `deployment_maps` | e.g. Hammer and Anvil; also the 11e `Layout A/B/C` rows | id, mission_pack_id, name. **Name only** — a terrain photo is of the table one game was played on, so it lives on `game_images.is_map`, never here |
| `mission_rules` | e.g. Chilling Rain | id, mission_pack_id, name |
| `secondary_cards` | tactical or fixed | id, mission_pack_id, name, card_type ('tactical'\|'fixed') |
| `challenger_cards` | Pariah Nexus Secret Missions (formerly "Gambits"); 4 cards: Command Insertion, War of Attrition, Unbroken Wall, Shatter Cohesion | id, mission_pack_id, name |
| `games` | the match record | id, created_by_user_id, played_at (DATE), game_format, points_limit, mission_pack_id, primary_mission_id, deployment_map_id, mission_rule_id, turn_count, end_condition ('normal'\|'concession'\|'tabled'), tournament_*, location, notes, hidden_from_stats, play_medium ('physical'\|'digital' — digital = Tabletop Simulator), edition ('10'\|'11' — DB default '11'; pre-existing rows backfilled to '10'), season_id (FK seasons.id), created_at, updated_at |
| `game_players` | exactly 2 per game | id, game_id, seat (1\|2), user_id (nullable), guest_name (nullable — at least one required), faction_id, detachment_id (legacy), detachment_name (**DERIVED** — `player_detachments` joined with ', '), force_disposition (**11e only**, 5-value CHECK), primary_mission_id + primary_mission_name (**11e only** — each player picks their own primary; NULL on 10e games, which use the game-level column), time_seconds (chess clock — **derived** as the sum whenever any round is clocked, unless time_is_manual), time_is_manual (BOOLEAN NOT NULL DEFAULT FALSE — the total was set by hand and outranks the rounds; the escape hatch for live-tracked games, which arrive fully clocked), secondary_mode ('tactical'|'fixed', **11e only**, NOT NULL DEFAULT 'tactical' — chosen per player and in secret, so the two seats can differ), army_list_code, went_first, is_attacker, final_score, result ('win'\|'loss'\|'draw') |
| `game_rounds` | per-round score per player | id, game_player_id, round_number (1-5), primary_score, secondary_score, cp_remaining, time_seconds (optional chess-clock split); UNIQUE (game_player_id, round_number) |
| `player_secondaries` | per-round secondary scoring | id, game_player_id, round_number (10e: the round scored; **11e: the round the card SCORED, NULL if it never did**), drawn_round (**11e only** — the round it entered hand; NULL on 10e where draw and score coincide, and always NULL for a Fixed mission, which is chosen not drawn), card_id, card_name, score, was_discarded. **A Fixed mission holds ONE ROW PER SCORING ROUND** — there is no uniqueness constraint on (game_player_id, card_id), and that is what lets a card that is never discarded score every round |
| `player_challengers` | per-round challenger scoring | id, game_player_id, card_id, card_name, round_number (nullable), completed, score |
| `game_images` | photos attached to a game; **bytes live on disk**, not in Postgres | id, game_id (CASCADE), uploaded_by_user_id, file_name, thumb_name, caption, is_thumbnail, is_map, width, height, bytes, created_at. Two partial unique indexes — `(game_id) WHERE is_thumbnail` (cover) and `(game_id) WHERE is_map` (terrain layout). The flags are independent, so one photo can be both |
| `player_detachments` | a player's detachments; 11e allows more than one. **Source of truth** — `game_players.detachment_name` is the derived display string | id, game_player_id (CASCADE), detachment_id (nullable), detachment_name, sort_order |
| `banner_first_seen` | one row per (player_key, faction_id); `first_seen_at` is set on save and **never updated** — the war map's seed-claim order (and thus its cross-regen geographic stability) depends on this | player_key, faction_id, first_seen_at, anchor_x + anchor_y (REAL, nullable — the banner's own map anchor; NULL falls back to `FACTION_HOMES`); PK (player_key, faction_id) |
| `seasons` | one row per Theatre-of-War season; only one `is_active = TRUE` (enforced by partial unique index). `map_seed` drives the canvas geometry for that season — archived seasons render with their own continent. | id, name, map_seed (BIGINT), started_at, ended_at, is_active, created_at |
| `game_drafts` | **in-progress games** for the live tracker. Deliberately NOT a row in `games` — see the invariant table. Retired, not deleted, on submit: `submitted_at` is stamped and the row stays. | id, owner_user_id (FK users CASCADE), opponent_user_id (FK users SET NULL — the invited second phone), share_token (TEXT UNIQUE, the join link), **payload (JSONB)** — exactly the camelCase shape `serializeDraft()` produces in `game-form.js`, so submit is a straight hand-off — current_step (TEXT, `'setup'` \| `'round1'`..`'round5'` \| `'summary'`; plain TEXT, no CHECK), rev (INTEGER, bumped on every accepted PATCH), **submitted_at** (TIMESTAMPTZ, NULL = still in progress — this and *not* `submitted_game_id` is what "finished" means), submitted_game_id (FK games **SET NULL** — a pointer for navigation only; it goes NULL if the resulting game is later hard-deleted, which is exactly why the lifecycle flag had to be separated from it), **started_notified_at** (TIMESTAMPTZ, NULL = not yet announced — the once-only guard for the "game started" email; see "Live game tracker"), created_at, updated_at. Two **partial** indexes on owner / opponent `WHERE submitted_at IS NULL` |
| `game_draft_images` | photos taken mid-game; same bytes-on-disk rule as `game_images`, under `UPLOAD_DIR/drafts/<draft_id>/`. On submit the files are `fs.rename`d into `UPLOAD_DIR/<game_id>/` and re-created as `game_images` rows, `is_map` included | id, draft_id (CASCADE), uploaded_by_user_id, file_name, thumb_name, caption, round_number (nullable, CHECK 1-5 — which battle round the shot belongs to; NULL = a Setup-step photo), is_map (the terrain-layout shot, partial unique index `(draft_id) WHERE is_map` — two would collide on the game's own index at relink and the second would be dropped), width, height, bytes, created_at |
| `audit_log` | append-only audit trail of every write action (game create/update/delete/visibility, user create/update, login, password change, season start). `payload` is JSONB — **never** the raw request body; see "Recycle bin and the audit log" | id, actor_user_id (FK ON DELETE SET NULL), actor_username, action, target_type, target_id, payload (jsonb), created_at |
| `deleted_items` | **the recycle bin.** One row per deleted game or draft, holding the whole row-set as JSON so it can be re-inserted verbatim. Lives at the very bottom of `schema.sql`. | id, kind (TEXT CHECK IN `'game'`/`'draft'`), original_id, label (what the admin panel shows), **payload (JSONB)** — `{version:1, tables:[{name, rows:[…]}]}` in dependency order — deleted_by_user_id (FK users SET NULL), deleted_by_name, deleted_at; **UNIQUE (kind, original_id)** so the same id can't be banked twice. Index on `deleted_at DESC` |

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
| Start a live game | – | ✓ | ✓ | `requireAuth` on `POST /drafts`; the `/play` and `/play/:id` client routes carry `requireAuth: true` and the **Live Game** nav link only renders with a session |
| List live games | ✓ | ✓ | ✓ | `GET /drafts` is public and returns **everyone's** in-progress games, yours first. Each row carries `owner_name` so you can see whose game it is |
| Watch a live game | ✓ | ✓ | ✓ | `GET /drafts/:id` is public. A viewer with no seat is a **spectator**: `viewerSeat: null`, the client renders read-only and follows the owner's round over SSE. `share_token` is echoed only to the owner — it is the credential for *claiming the second seat*, not for reading. Note the **client** routes `/play` and `/play/:id` still carry `requireAuth: true`, so in practice a spectator is a signed-in user with no seat; the API being public is what makes a share link work without one |
| Edit a live game | – | **scoped** | **scoped** | `PATCH /drafts/:id`. The **owner may patch anything**. An invited **opponent may send only** `{ patch: { players: { "1": … } } }` — any other top-level key, a `"0"` seat, or a `currentStep` is 403. So the opponent scores their own side; they can't rewrite your scores or move the game on. Seat indexes are bounded to 0–1 — see "Security posture" |
| Invite / uninvite an opponent, submit a live game | – | owner only | owner only | `POST`+`DELETE /drafts/:id/invite`, `POST /drafts/:id/submit`. Admin is **not** a bypass on these — they check `owner_user_id`, not `role` |
| Delete a live game | – | own only | **any** | `DELETE /drafts/:id` — owner, or any admin clearing out an abandoned game |
| Join a live game as the opponent | – | ✓ + token | ✓ + token | `POST /drafts/:id/join` with the share `token`. 409 once someone else has the seat |
| Upload / delete a mid-game photo | – | seat only | seat only | `POST`+`GET /drafts/:id/images` for either seat; `DELETE` for the uploader **or** the draft owner |
| Edit own profile (army_name, photo prompt, password) | – | ✓ | ✓ | `PATCH /auth/me` + `POST /auth/change-password`; the "My Profile" link in the header session row routes to `/profile` |
| Hide game from stats | – | – | ✓ | `requireAdmin` on `PATCH /admin/games/:id/visibility`; the **Hide** button in `game-detail.js` is conditionally rendered for admins only |
| Delete a game | – | – | ✓ | `requireAdmin` on `DELETE /admin/games/:id`; admin-only red **Delete** button on game-detail with `confirmModal` confirmation. **Recoverable** — it archives into `deleted_items` |
| Restore a deleted game / live game | – | – | ✓ | `requireAdmin` on `POST /admin/deleted/:id/restore`; Admin → Deleted Items panel |
| Permanently erase a deleted item | – | – | ✓ | `requireAdmin` on `DELETE /admin/deleted/:id`. **The only action in the app that destroys data** — and the only one that unlinks photo bytes |
| Manage users | – | – | ✓ | `requireAdmin` on `/admin/users*`; the **Admin** nav link in `app.js` only renders if `state.user.role === 'admin'` |
| Manage seasons (start new) | – | – | ✓ | `requireAdmin` on `POST /seasons`; lives in the Admin → Seasons panel |
| Promote guests to accounts | – | – | ✓ | `requireAdmin` on `/admin/guests/preview` + `POST /admin/promote-guests`; Admin → Guest Accounts panel |
| View rankings / matchmaker | – | – | ✓ | `requireAdmin` on all `/ratings/*`; the **Rankings** nav link + `/rankings` route render only for admins. **Private by spec** — players can't see their own rating |
| View audit log | – | – | ✓ | `requireAdmin` on `GET /admin/audit`; rendered in the Admin → Audit Log panel |
| Subscribe to live updates | ✓ | ✓ | ✓ | **Nothing** — `GET /events` imports no guard. The subscriber records `req.session?.userId` when there is one, but anonymous viewers get the stream too |
| Change own password | – | ✓ | ✓ | `POST /auth/change-password` |
| Upload a game photo | – | ✓ | ✓ | `requireAuth` on `POST /games/:id/images`; set Cover / Map via `PATCH` |
| Delete a game photo | – | own only | ✓ | `DELETE /games/:id/images/:imageId` — uploader **or** admin; unlike games, a photo is just an attachment |

Server enforcement is the source of truth; client gating is a UX convenience only.

---

## Restorable deletes — the recycle bin (`api/lib/archive.js`)

Deleting a game or a live game no longer destroys it. The whole row-set is
serialised into `deleted_items`, the originals are hard-deleted, and an admin can
put it back from **Admin → Deleted Items**. Only `DELETE /admin/deleted/:id`
actually erases anything.

### Why it archives rows out instead of setting a `deleted_at` flag

This is the design decision to understand before touching any of it. A
soft-delete column on `games` is the obvious shape and it is the wrong one here:
**~20 queries** would need a new `AND g.deleted_at IS NULL`, spread across the 13
endpoints in `stats.js`, `warmap.js` + `warmap-timeline`, `ratings.js`, the games
list and `v_game_player_stats` — the view that (see "View") already can't express
the digital filter, so it couldn't express this one either. Miss a single query
and a deleted game leaks silently back into the stats or onto the war map, where
nobody will notice for weeks.

Archiving the rows *out* means **nothing that reads `games` has to learn about
deletion at all**. The cost is moved to one file that does one job. Keep it that
way.

### The payload

`{ version: 1, tables: [{ name, rows: [...] }] }`, tables in **dependency order**
(parents first) so a restore can insert them straight down the list:

| kind | tables |
|---|---|
| `game` | `games`, `game_players`, `game_rounds`, `player_secondaries`, `player_challengers`, `player_detachments`, `game_images` |
| `draft` | `game_drafts`, `game_draft_images` |

Rows are captured with **`row_to_json(t)`, not the driver's row objects**. That
matters: `row_to_json` renders a DATE as `'2026-07-19'` and a TIMESTAMPTZ with an
explicit offset, so a round-trip through JSONB can't shift a `played_at` a day
either way depending on the session timezone. A game archived on one restart and
restored after another must come back on the same date.

A game's payload also carries `links.submittedDrafts` — the `game_drafts` rows
that pointed at it — so restore can re-point their `submitted_game_id`.

### Restore

`restoreItem` re-inserts every row **with its original primary key**, then resyncs
each SERIAL:

```sql
SELECT setval(pg_get_serial_sequence('<table>', 'id'),
               GREATEST((SELECT COALESCE(MAX(id), 1) FROM <table>), 1))
```

Preserving ids is what keeps `/games/123` links, `banner_first_seen` and audit
rows meaningful. It also means a restore can become **impossible**: if something
else has since taken that id, `GET /admin/deleted` reports `canRestore: false`
and the endpoint 409s rather than colliding.

Columns the table no longer has are dropped on the way in (so a column added by a
later migration restores at its default), and `json`/`jsonb` values are
`JSON.stringify`ed before binding — node-pg would otherwise render a plain array
as a Postgres array literal.

### The FK scrub — why a restore can come back *changed*

An item can sit in the bin while the things it referred to are deleted. The scrub
runs **before any INSERT** and reports what it had to do:

| Situation | What happens |
|---|---|
| Nullable FK whose target is gone (`mission_pack_id`, `faction_id`, `card_id`, `season_id`, `uploaded_by_user_id`, …) | set to `NULL`, counted in `repaired.droppedRefs` (card ids also in `droppedCardIds` — the name is denormalised, so the card still displays) |
| NOT-NULL owner whose account is gone (`games.created_by_user_id`, `game_drafts.owner_user_id`) | falls back to the **restoring admin**, else the lowest-id admin. `repaired.reassignedOwner`. With no users left at all it 409s rather than guess |
| A `game_players` seat whose `user_id` is gone **and** which has no `guest_name` | demoted to `guest_name = "Deleted player #<old user id>"`, counted in `repaired.orphanedPlayers` |

That last one is the subtle one. `game_players.user_id` is in the *nullable* list,
so nulling it is the natural move — but `CHECK (user_id IS NOT NULL OR guest_name
IS NOT NULL)` would then turn an FK violation into a CHECK violation, i.e. the
same failed restore with a worse error message. The demotion is what makes the
seat legal again.

`repaired` is returned by the endpoint, written to the audit log, and **surfaced
to the admin** — a game comes back behind a "Restored, with changes" dialog
listing what moved, a draft behind a toast. Restoring a subtly different game
silently would be worse than failing.

### Photo bytes

`DELETE /admin/games/:id` and `DELETE /drafts/:id` **deliberately leave the files
on disk**. Unlinking there would make a restore come back with no pictures, which
is not a restore. `removeArchivedFiles` — called by `DELETE /admin/deleted/:id`,
*after* the transaction commits and only when the id isn't occupied — is the sole
unlink path. A leftover file is recoverable; a row with no files is not.

**If you add a third deletion path, call `archiveGame`/`archiveDraft`, not `DELETE
FROM`,** and do not unlink anything.

---

## Security posture

A three-part audit ran over this codebase. What it found, what was fixed, and
what is knowingly still open — recorded here so nobody spends a day re-deriving
the same list.

### Fixed — the process-killer (CRITICAL)

Express 4 does not await async handlers, and Node 22 **exits on an unhandled
rejection**. So any async throw was a remote unauthenticated denial of service:

- `POST /auth/login {"username":"admin","password":{}}` — bcrypt throws on a
  non-string, the rejection escapes, the container dies. No session required.
- `GET /games/abc` — `parseInt` → `NaN` → pg `22P02`.
- `GET /games/<20 digits>/images` — the old guard was `Number.isInteger(id)`,
  and `Number.isInteger(1e20)` is `true`. Postgres `integer` stops at
  **2147483647**, so it's a `22003`.

Two pieces now cover this, and both matter:

- **`lib/async-routes.js`** — `catchAsync(router)` walks the router's handler
  stack at mount time and wraps every handler so a returned rejected promise (or
  a synchronous throw) goes to `next(err)`. Applied to **all 12 mounts** in
  `server.js`. It preserves each handler's `length` and `name`, because Express
  distinguishes error middleware by arity. Handlers added to a router *after* it
  is mounted are **not** wrapped — register routes inside the route module.
  `installRejectionGuard()` is the backstop and traps `uncaughtException` too, so
  it is broader than its name: nothing short of an explicit `process.exit` takes
  the process down now.
- **`lib/params.js`** — `idParam(value)` returns a positive integer ≤ 2147483647
  or **`null`**; `intParam(value, { min, max, fallback })` clamps limits/offsets/
  day-counts. Both use `Number()`, not `parseInt`, so `'12abc'` is `null` rather
  than `12`. Neither throws.

  `admin.js`, `games.js`, `images.js`, `drafts.js` and `reference.js` use them.
  **`stats.js`, `warmap.js` and `seasons.js` still parse with raw `parseInt`** —
  and `warmap.js` interpolates the result straight into its SQL string rather than
  binding it (safe from injection, not safe from `?season=1e20` → a 500). That's
  the next thing to fix here, not a thing to assume is already done.

### Fixed — the rest

| Severity | What | Fix |
|---|---|---|
| HIGH | `PATCH /admin/users/:id` audited the **raw request body**, so a password reset wrote the plaintext into `audit_log.payload` — rendered verbatim in the admin panel, and carried into every nightly `pg_dumpall` and the unencrypted offsite backup | `password` is destructured out before the `audit()` call and replaced with `passwordChanged: true`. 12 existing rows were scrubbed. **`POST /admin/users` was already fine because it builds an explicit allow-list — do that, rather than blacklisting a key** |
| HIGH | The draft seat merge accepted any integer index, so `{"players":{"1e7":{}}}` — a 40-byte authenticated PATCH — grew the players array to ten million entries: 618MB of heap and 30MB of JSONB | `mergeSeats` in `lib/draft.js` now `continue`s on `!Number.isInteger(index) \|\| index < 0 \|\| index > 1`. A game has exactly two seats |
| MED | `routes/games.js` returned raw pg text to clients in two places | Both now log server-side and return a fixed message. The global handler replaces the message for any status ≥ 500 |
| MED | An unrecognised secondary card name was **auto-inserted into the shared mission pack**, so one person's typo appeared in everyone's draw picker forever — and made pack rows referenced-but-undeletable | Secondaries are **match-only** now (`findCardId` in `game-write.js`: a scoped case-insensitive SELECT, no INSERT). Nothing is lost — `player_secondaries.card_name` is denormalised and is what every view displays. **Challengers still auto-insert** via `resolveCardId`; that asymmetry is deliberate, since the 11e secondary deck is a fixed published 18 and the challenger list isn't |
| MED | A `cardId` stored on a draft could dangle if its pack row was deleted mid-game, and `player_secondaries.card_id` is a FK — so a game played to the end became unfileable with an opaque 500 | `dropDanglingCardIds(client, players)` in `game-write.js` batch-checks both card families and degrades an unresolvable id to name-only. It runs **after** `resolveGameLookups` on purpose: earlier, and the name would be re-resolved, silently re-creating the very row that was deleted |

### Known-good — audited, found clean, don't re-audit

- **The draft PATCH merge resists prototype pollution** and every seat-scope
  escape tried against it.
- **No SQL injection.** Every `${table}` interpolation is a fixed internal
  allow-list (`archive.js`'s `RESTORABLE` set, `game-write.js`'s literal pairs).
- **No mass assignment** on any write path.
- **Upload filenames are UUID-only** — no user-controlled path component.
- **The `wb_session` strip is present in both `reverse_proxy` blocks** of
  `~/sites/base/conf.d/40k.caddy` (the SSE block and `handle_path /api/*`). This
  site is **not** an SSO member; see `~/sites/CLAUDE.md`.
- **CSRF is adequately covered** by `sameSite: 'lax'` plus JSON-only body
  parsing — a cross-site form post can't set `Content-Type: application/json`.

### Still open — accepted, not forgotten

- **`role` and `is_active` are read from the 30-day session**, not re-checked per
  request, so deactivating or demoting a user doesn't take effect until their
  cookie expires or they log out. Fixing it means a `users` lookup in
  `requireAuth`.
- **No `session.regenerate()` on login** — session fixation is possible for
  someone who can plant a cookie.
- **`ADMIN_PASSWORD` stays in `.env`** after bootstrap, where it is ignored but
  still readable.
- **No security headers on this vhost** (CSP, HSTS, `X-Content-Type-Options`).
- **Backups to B2 are unencrypted.**
- The global error handler still returns `err.code` verbatim, which for a pg
  error is the SQLSTATE — the class of DB failure leaks even though the text
  doesn't.

### Caching — an infra fix that lives outside this repo

`~/sites/base/conf.d/40k.caddy` gained:

```
@nocache path / *.html *.js *.css *.webmanifest
header @nocache Cache-Control "no-cache"
```

Without it, no-cache-header responses get **heuristic caching** in browsers, so a
deploy landed and users kept running the old JS — the symptom being a fix that
"works for you but not for them" with no service worker anywhere in sight. Every
other vhost on the box already had this; 40k was the one that didn't. `/uploads/*`
keeps its year-long immutable header, because those filenames are UUIDs.

**This repo's `caddy.example` has not been updated to match** — a fresh install
from it would reproduce the bug. Copy the two lines across if you touch that file.

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
`users.prompt_round_photo` is the second worked example — same guarded ALTER,
same `/auth/me` exposure, but it's user-owned rather than admin-owned so it wires
into `views/profile.js` and `PATCH /auth/me` instead of the admin panel. Note its
`PATCH` uses `COALESCE($2, prompt_round_photo)`: a partial update that omits the
field must not silently reset it, which is a trap on any NOT NULL column with a
meaningful default.

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
| Backend helpers (`db`, `auth`, `audit`, `events`, `game-scoring`, `game-write`, `draft`, `archive`, `async-routes`, `params`) | `api/lib/README.md` |
| Route modules + mount prefixes + auth | `api/routes/README.md` |
| Schema/seed conventions, idempotency rules, ALTER pattern | `api/db/README.md` |
| Unit + integration suites, what's covered | `api/test/README.md` |
| Frontend overview, no-build philosophy | `app/README.md` |
| `app.js` / `api.js` / `components.js` / `live.js` / `game-rules.js` / `images.js` / `army-list.js` / `nav-stack.js` roles | `app/js/README.md` |
| View module convention + recipes | `app/js/views/README.md` |
| Backup script + **both test runners** | `scripts/README.md` |

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
| Secondaries | 2 slots per round; drawn and scored in the same round | **Tactical or Fixed, chosen per player at setup.** Tactical cards persist in hand — `drawn_round` is when it entered hand, `round_number` is when it **scored** (NULL = never scored). Fixed is two cards chosen up front that never discard and score in any round — see "Fixed vs Tactical secondaries" |
| Challenger cards | yes | **none** — `serializeDraft()` drops them and `computeFinalScores` ignores them |
| Score ceiling | `min(100, primary + secondary + challengers)` | `min(45, primary) + min(45, secondary)` — two independent halves, no cross-subsidy — **plus 15 per half per battle round**, enforced as an input ceiling in the live tracker (see below), not as a clamp in the scoring maths |
| Deployment map / mission rule | game-level | game-level (unchanged) |

- **Scoring** lives in `lib/game-scoring.js`: `computeFinalScores(players, edition)`.
  `edition` defaults to `'10'` so old callers keep their behaviour;
  `routes/games.js` and `POST /drafts/:id/submit` pass the real value.
  `app/js/game-rules.js` mirrors the same maths in `calcTotal()` purely for the
  live readout in **both** `game-form.js` and `live-game.js` — the server value
  is authoritative. Pinned by tests, including the reference game (primary
  rounds 4/8/11/8/15 = 46 raw → clipped to 45, secondaries 32, **final 77**),
  and again through the draft-submit path in `draft-submit.test.js`.
- **Editing safety** — `PUT /games/:id` uses `edition = COALESCE($17, edition)`,
  so a payload that omits `edition` can't silently re-stamp a 10e game as 11e.
  `POST` defaults to 11. **Draft submit forces `'11'`** — the live tracker is
  11e-only, so a 10e game is logged through `/games/new` instead.
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
  seeded for the pack. `PRIMARY_MATRIX` in `app/js/game-rules.js` mirrors that
  table (keyed `[yours][theirs]`) and auto-fills both players' primaries once
  both dispositions are set — in the one-page form and in the live tracker's
  Setup step alike; the field stays editable, so it's a shortcut not a lock.
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

## Live game tracker (`#/play`, `app/js/views/live-game.js`, `api/routes/drafts.js`)

The wizard you drive **during** a game: Setup → Round 1..5 → Summary, on a
phone, autosaving continuously, finished by one **Submit** that files a normal
game. **11e only** — it hard-codes `edition: '11'` on submit. `/games/new` is
untouched and remains the path for a game that's already over, and the only path
for a 10e game.

Two routes: `#/play` lists in-progress games, `#/play/:id` is the wizard. Both
client routes carry `requireAuth: true`. The **API** behind them is public
(`GET /drafts`, `GET /drafts/:id`, `GET /drafts/:id/images`) — that asymmetry is
deliberate and is what makes a share link work; see "Spectating" below.

### The draft lifecycle

```
POST /drafts            → game_drafts row (payload = the posted body verbatim,
                          current_step 'setup', rev 0, a fresh share_token)
  ↕ PATCH /drafts/:id   → read-merge-write, rev++, broadcast draft.updated
                          (first move off 'setup' also fires notifyGameStarted)
  ↕ POST  /drafts/:id/images   → UPLOAD_DIR/drafts/<id>/
POST /drafts/:id/submit → createGame() → games row; photos moved; submitted_at stamped
DELETE /drafts/:id      → archived into deleted_items (photos left on disk)
```

**A draft is not a game, structurally.** It lives in `game_drafts` /
`game_draft_images` and touches nothing in `games` until submit. That's the
invariant to protect (see the invariants table): `games.points_limit` and
`created_by_user_id` are `NOT NULL` and `game_players` requires a name, so a
half-played game *cannot* be expressed as a `games` row even if you wanted it
to. Nothing in the draft path touches `COUNTED_GAMES`, `v_game_player_stats`,
`stats.js`, `warmap.js` or `ratings.js`, so an in-progress game is incapable of
leaking into the games list, the stats, the war map or the rankings. Discarding
a draft therefore costs nothing downstream.

`game_drafts.payload` is **exactly** the camelCase shape `serializeDraft()`
produces in `game-form.js`. That's deliberate: submit is a straight hand-off
into the same pipeline `POST /games` uses, with no translation layer to drift.

### `PATCH /drafts/:id` — the autosave endpoint

Body: `{ baseRev, clientId, patch, currentStep }` → `{ rev, stale }`. The whole
handler runs inside `withTx` around `SELECT … FOR UPDATE`, so two phones
serialise rather than interleaving a lost update. `stale` is advisory — it just
tells the client its `baseRev` wasn't the row's current `rev`, i.e. someone else
wrote in between.

**Merge rules** (`mergeDraftPatch` in `lib/draft.js`, pinned by
`draft-merge.test.js`):

| Shape | Behaviour |
|---|---|
| plain object | merges key by key, recursively |
| array | **replaces wholesale** — arrays are never element-merged. That covers `rounds`, `secondaries`, `detachments` inside a seat |
| `null` | is a **value**, not a delete. There is no delete verb; writing `null` is how you clear a field |
| `patch.players` | the one asymmetry: an **object keyed by seat index** (`"0"` / `"1"`) that merges into the payload's players **array** by index. So one seat can be written without touching the other |

`mergeDraftPatch` does not validate key names at all — anything in the patch
lands in the payload. The gate is ownership, not schema.

**Ownership scoping** — the whole point of the two-phone mode:

- The **owner may patch anything**, including `currentStep`.
- An invited **opponent may send only** `{ patch: { players: { "1": … } } }`.
  Any other top-level key, a `"0"` seat, or a `currentStep` → **403**
  (`opponentSeatPatch` returns null unless the patch is exactly that shape).

So the opponent scores their own side — they can't move the game on, and can't
touch your numbers. 404 for a missing draft, 403 for a non-participant, 409 once
submitted.

### Spectating, and who follows whose round

`GET /drafts`, `GET /drafts/:id` and `GET /drafts/:id/images` are **public**, and
`GET /drafts` returns *everyone's* in-progress games (yours first) with
`owner_name`. A game nobody can find is a game nobody can watch. Writing is what's
gated; reading matches games/stats/the war map.

A viewer with no seat is a **spectator**: `viewerSeat: null`, `isSpectator` gates
`canEditSeat()` so every control renders disabled, `touch()` early-returns so
nothing is ever sent, and the footer becomes a `watchFooter()` with a "Watching"
pill.

Who moves when the owner hits Next:

| Viewer | Behaviour |
|---|---|
| Owner | drives; `canNavigate` true |
| Invited opponent | **is not dragged.** They may still be entering the round they just played, and having the screen yanked out mid-number is worse than being a round behind. They get a tappable `.lg-follow` chip in the header — `They're on Round 3 →` — and move when *they* choose |
| Spectator | auto-follows (`adoptRemote` sets `step = ownerStep`) — there is nothing they could be mid-typing |
| Admin | `canNavigate = isOwner \|\| isAdmin`, so the pips and the setup gear are live — enough to reach setup and delete someone's abandoned game. Admins still get **no** footer nav and no Submit; those check `isOwner` |

**`validateGameInput` deliberately does NOT gate PATCH.** It demands
`playedAt`, a truthy `pointsLimit` and two named players — a round-1 autosave
has none of that, and rejecting it would make the tracker unusable for the first
twenty minutes of every game. Validation happens once, at submit.

### Submit

`validateDraftSubmit` (in `lib/draft.js`) is the submit-time gate, with
player-facing messages ("set the date this game was played before finishing
it"). It checks only `playedAt`, `pointsLimit`, exactly 2 players and a name per
player; everything else passes through to `createGame` as-is.

It then calls `normalizeDraftRounds`, which is where the sharp edge is:

- A round with a **missing, out-of-range or duplicate** `roundNumber` is
  **dropped**, not clamped. Clamping a 6 to 5 would collide with the real round
  5 under `UNIQUE (game_player_id, round_number)` and re-create exactly the
  opaque 500 the sanitiser exists to prevent.
- Secondary `roundNumber` / `drawnRound` **are** clamped into 1–5 — they have no
  uniqueness constraint, so a clamp is lossless there.

The full pipeline:

```
{ ...payload, edition: '11' }
  → validateDraftSubmit          (400 with a human message)
  → resolvePlayerIdentities      (guest name → user_id, same as POST /games)
  → computeFinalScores(players, '11')
  → resolvePlayerTimes
  → withTx(createGame(client, body, owner_user_id))
  → audit → broadcast('game.saved') → notifyGameLogged
  → relinkDraftImages(draftId, gameId)
  → UPDATE game_drafts SET submitted_at = NOW(), submitted_game_id = <gameId>
```

`relinkDraftImages` `fs.rename`s each file from `UPLOAD_DIR/drafts/<draftId>/`
into `UPLOAD_DIR/<gameId>/` and writes the matching `game_images` row (first one
gets `is_thumbnail`, captions carried through). It is **best-effort per file**
and wrapped so a missing byte can never fail an already-created game — a photo
that doesn't move is a lost photo, not a lost game.

The draft row is **kept** after submit: `submitted_at` is stamped and
`submitted_game_id` points at the result. The partial indexes are
`WHERE submitted_at IS NULL`, so a retired draft costs nothing and drops out of
`GET /drafts` automatically.

**`submitted_at`, not `submitted_game_id`, is what "finished" means.** The
pointer is `ON DELETE SET NULL`, so hard-deleting the resulting game nulled it
and the draft *resurrected itself* in the live-games list weeks after it was
played. The timestamp is the lifecycle flag; the id is navigation only.

Submit is atomic: the whole check-then-insert runs inside `withTx` around a
`SELECT … FOR UPDATE`, like PATCH/join/invite. It has to be — reading the row
outside the transaction let two simultaneous taps both pass the
already-submitted check and create two games. The button disabling itself is a
UI convenience, not the guarantee. Pinned by an integration test that fires two
concurrent submits and asserts exactly one 200, one 409, one `games` row.

The other half of that story is the client: `flush()` resolves only once the
server actually has everything typed so far. It used to bail out while a PATCH
was in flight, so tapping Submit straight after typing raced its own autosave
and submitted the *previous* payload — which is how a game with both names
filled in came back `player 2 still needs a name`.

### Live co-editing over SSE

Invite an opponent (`POST /drafts/:id/invite { userId }`) or send them the share
link (`#/play/<id>?token=<share_token>`, redeemed by `POST /drafts/:id/join`)
and they score their own seat from their own phone.

Every accepted PATCH broadcasts `draft.updated`, which `live.js` re-dispatches
on `document` as **`live:draft.updated`**. Two constraints, both load-bearing
(see pitfalls #10):

1. **`GET /events` is public and unfiltered**, so the event carries only
   `{ id, rev, by }` — never draft content. The receiving client re-reads
   through the auth-gated `GET /drafts/:id`.
2. **Clients ignore events whose `by` matches their own `clientId`** (a
   per-mount random 12-char id sent on every PATCH), then ignore any event whose
   `rev` isn't newer than what they hold. Without the first guard, the echo of
   your own write clobbers what you are currently typing.

When a remote change does arrive and a local save is still pending, `adoptRemote`
merges only the *other* seat rather than replacing the payload — your in-flight
edits survive. **Only spectators** additionally adopt the owner's `current_step`;
a seated opponent gets the follow chip instead (see "Spectating" above).

### Autosave and offline

- **localStorage mirror `tg40k:liveDraft:<id>` on EVERY mutation.** This is the
  difference from `game-form.js`, whose `tg40k:newGameDraft` only writes on a
  structural rerender — typing a whole game's scores there never touched
  storage. **The two keys must stay distinct** (invariant table) or `/games/new`'s
  "Restore unsaved game?" prompt starts offering half-played live games.
- Debounced **800ms** PATCH; immediate flush on step change, `visibilitychange`
  → hidden, and `pagehide`.
- Failure → exponential backoff (2s → 30s cap) and an offline indicator on
  `code: 'network'`.
- The mirror is **cleared once the server has the change**, so its presence on
  load means precisely "this device has edits the server never got" — that's the
  restore prompt's trigger, not a timestamp comparison.

### "A game just started" email

`notifyGameStarted(id)` in `routes/drafts.js` fires **once**, on the first PATCH
that moves a draft off `'setup'` into a round — not when the row is created.
Tapping "Start new game" makes a row immediately, and an email per abandoned tap
is noise. The mail carries both sides (name — faction — detachments) and a
`#/play/<id>` link, because the whole point is that someone can now follow along.

The once-only guard is a **claim-by-UPDATE**, not a read-then-write, so two
concurrent PATCHes can't both send:

```sql
UPDATE game_drafts SET started_notified_at = NOW()
 WHERE id = $1 AND started_notified_at IS NULL
RETURNING payload, owner_user_id
```

No row back means someone else already announced it. It's dispatched **after** the
response and wrapped in its own try/catch — a mail hiccup must never delay an
autosave. Like everything else in `lib/mail.js`, it no-ops without
`MAILER_URL` + `MAILER_TOKEN`.

### UX decisions worth not re-litigating

- **Secondaries are round-major here** (an in-hand list with Draw / Score /
  Discard) versus card-major in `game-form.js` (the whole deck as rows). **The
  stored shape is identical** — `drawn_round` and `round_number` were already
  independent nullable ints, so only the presentation inverts. A discard writes
  `round_number` = the round it left the hand, `score` 0, `was_discarded`, so
  game detail still reads back chronologically. A discarded card can be drawn
  again (nothing enforces uniqueness); a card in hand or already scored can't.
- **Remove (✕) is not Discard, and both have to exist.** Discard is a real game
  event and stays on the record — it writes the round the card left the hand.
  Remove splices the entry out of `p.secondaries` entirely, for the mis-tap in
  the draw picker: that card never happened. Recording a fat-fingered draw as a
  discard would put a card the player never held into the game's history, and
  the picker's `taken` set (which excludes discards, since a discarded card
  genuinely returns to the deck) would keep offering the *right* card as if it
  were still available. It sits on both in-hand and settled rows, behind a
  confirm — this is a phone during a game. `game-form.js` already had the
  equivalent: clearing a deck row's three inputs prunes the entry.
- **`/games/new` needed no delete affordance** for the same reason — its 11e
  layout is card-major, so "remove" is just emptying the row. The live tracker
  is the only surface where a card is a discrete object you added.
- **The 15-per-round caps are enforced where a number is ENTERED, not in the
  scoring maths.** 11e caps each half at 15 VP per battle round as well as 45
  per game. The primary stepper's ceiling is `E11_PRIMARY_ROUND_CAP` (it was an
  arbitrary 20), and scoring a secondary is offered only the headroom the round
  has left — `15 − sumSecondaryForRound(p, n)` — refusing outright at 0 and
  clamping with a toast rather than silently truncating. Both numbers come from
  the mission pack (`limits.primaryRound` / `limits.secondaryRound` in
  `app/data/mission-cards-11e.json`) and a unit test asserts they still match.
  **Do not "finish the job" by clamping per round inside `calcTotal` /
  `computeFinalScores`.** Those run on every save, including `PUT /games/:id`,
  so a per-round clamp there would silently rewrite the total of any
  already-recorded game the next time someone opened and saved it — the same
  hazard that shaped the score-detail ladder. A test pins the current
  behaviour: a game breaching 15 in one round still reports its raw total on
  both sides.
  **`/games/new` enforces the same two ceilings**, for 11e only. Its rounds
  table clamps primary and (in `rounds` mode) secondary on blur; its card-major
  11e deck is the harder case, because there the ceiling spans ROWS — two cards
  that both scored in round 3 share it, so a per-input `max` is necessary and
  nowhere near sufficient. Both surfaces therefore call the one shared
  `secondaryRoundHeadroom(p, roundNumber, exclude)` in `game-rules.js`. The
  `exclude` argument is load-bearing: without it, re-saving a card at its own
  current number would ratchet the value down a little every time. The form also
  re-clamps when a card's **scored round** moves, since dragging a card from
  round 2 to round 3 can breach round 3 without its own score changing at all.
  **10e is left on its old ceilings on purpose** — its packs score differently,
  and `/games/new` is the only path for a 10e game, so a wrong cap there would
  block a legitimate historical write-up with no way around it.
- **The live-games list shows a running score**, because the point of `#/play`
  as a tab is glancing at games in flight. `GET /drafts` computes it with the
  real `computeFinalScores` on a throwaway deep copy (it mutates), rather than a
  lighter sum written for the endpoint: a third scoring implementation is a
  third thing that can disagree, and the list disagreeing with the wizard is
  precisely the confusion this removes. An integration test asserts the listed
  score equals what submitting that draft files. The row **hides** the score
  while a game is in `setup` — `0 – 0` there reads as "losing badly" rather than
  "not started" — and the list follows `live:draft.updated` so the numbers move
  without a reload. No `by`/`clientId` filtering is needed here (unlike the
  wizard): nothing on this view is being typed into, so a re-read can't clobber
  anything.
- **`game_rounds.cp_remaining` had no UI anywhere** before this — it was plumbed
  server-side and never written. The wizard's ± stepper is its first consumer.
- **The chess clock banks seconds as they elapse** rather than computing from a
  start stamp, so a crash costs at most one autosave interval. It writes per-round
  `time_seconds`, and `resolvePlayerTimes()` already makes the player total the
  sum, so the existing chess-clock display on game detail lights up for free.
- **The 5 round pips in the sticky header are tap targets**, with a **settings
  gear (`.lg-pip-setup`) at the head of the strip** that jumps back to Setup.
  Jumping back to fix a number typed into the wrong round was an explicit user
  request; don't turn them back into a passive progress indicator. Both are
  disabled rather than hidden when `canNavigate` is false.
- **A pip reads "played" from the recorded data**, not from `n < currentRound`.
  `roundHasData(n)` asks whether either player has a primary score, a
  `cpRemaining`, a clocked time, or a secondary drawn/scored in that round. The
  round-number version marked rounds you skipped past as done, and blanked every
  pip the moment you stepped back to Setup. From Setup, the forward button is
  labelled from the same source — `Round 4 →` when round 4 is the last one with
  data — so it returns you where you were rather than to round 1.
- **Two photo buttons, not one: "📷 Take photo" and "🖼 Upload".** A single
  `<input type="file">` can offer the camera **or** the library but never both —
  `capture: 'environment'` hides the library outright — so there are two hidden
  inputs and the library one is `multiple`. Don't "simplify" them back together.
  The same constraint is why the between-rounds nudge is a three-way choice
  rather than a confirm — see below.
- **Round badges sit over the photo**, bottom-right, as
  `<span class="photo-badge is-round">`, captioned `Round N` or `End of round N`
  (the latter only from the between-rounds nudge). The same class renders on game
  detail, so a submitted game keeps its round labels.
- **Setup has the same pair of buttons under "Terrain layout"**, and they post
  `isMap: true` with a null `roundNumber` — the table you're about to play on is
  the one photo you can only take before deploying, and tagging it at source
  beats remembering to toggle Map on game detail a week later. Only the **first**
  file of a batch claims the tag (the library input is `multiple`, and a game has
  one table), so picking four photos of your board is not a lottery over which
  one the server's clear-then-set happens to land on last. A photo with no round
  is a Setup photo: `buildPhotoPanel(n)` filters on `round_number === n` and
  never sees them, and the Setup panel filters on `round_number == null`.
- **The draw picker leads with "🎲 Draw at random"**, pinned above the card list —
  tactical secondaries are drawn blind, so picking one off an alphabetical list is
  the unusual case. The free-text "card not listed" entry was **removed** from the
  picker: an unrecognised name no longer joins the shared pack (see "Security
  posture"), so offering to type one here was offering a dead end. `/games/new`
  still has "+ Card not listed" for logging an old game.
- **The army-list textarea is 420px tall** (55dvh on phones), not the generic
  80px box. A real 2000pt list is 30+ lines and the small box meant pasting into
  a letterbox.
- **Between-rounds "snap a photo?" prompt**, asked at most once per round,
  opt-out per account via `users.prompt_round_photo` (checkbox in
  `views/profile.js`). The round screen keeps its own controls either way, so
  turning the nudge off never removes the capability. It offers **both** ways in
  — Take photo and Upload — for the reason in the next bullet: the camera-vs-
  library choice has to be made before the picker opens, so a binary
  `confirmModal` could only ever offer one of them, and a shot already sitting on
  the phone couldn't answer the nudge. That's what `choiceModal` in
  `components.js` exists for; it resolves to the chosen value or `null`, keeping
  the same "back means never mind" contract as the other two modals. Either
  choice stays on the round screen rather than advancing — the picker has to
  close first.
- **Full-bleed layout** via the `live-game-mode` body class — see pitfall #9 for
  the teardown requirement.

### CSS

`app/css/style.css` ends with a `.lg-*` block (~370 lines) — **the app's only
touch-first surface**. 44px tap targets, **16px inputs** (the base is 14px,
which makes iOS Safari zoom the viewport on focus), `env(safe-area-inset-bottom)`
padding on the sticky footer, and a **700px** breakpoint — the same one every
other width query in the file uses. It briefly had its own 760px query; a second
breakpoint 60px away just creates a band where this block has collapsed and the
shared `.form-row` rules have not.

It uses **real class names**, deliberately *not* the
`div[style*="grid-template-columns"]` attribute-selector hack the existing 700px
block uses to reach into `game-form.js`'s inline grids. Don't propagate that
pattern into new code.

---

## Army lists (`app/js/army-list.js`)

`game_players.army_list_code` and the games-list free-text search over it both
predate this; what was missing was **entry and display**. `live-game.js` and
`game-form.js` now decode on blur, and `game-detail.js` renders the result in a
collapsible `<details>` block.

YAAB share codes are `YAAB1:<base64url(deflate-raw(JSON))>`. Decoding is ~30
lines with **zero dependencies** — native `DecompressionStream('deflate-raw')`
plus `atob`. It handles v2 compact tuples
(`[unitId, count, selectedPts?, [[enhName, enhPts]]?, [entryId, parentEntryId]?, wargear?]`),
pre-v2 full-army codes, a raw JSON paste, and a YAAB share **URL** (`?a=…`).

- Unit ids are 40kdc slugs, so de-slugging gives a readable name **without**
  pulling in yaab's 10MB `dc-bundle.js`. A few come out slightly off ("Arco
  Flagellants" vs "Arco-flagellants") — that's the accepted price of not
  shipping the bundle, not a bug to fix by adding a dependency.
- What gets **stored** is the readable rendering with the original code on the
  last line, so the list stays searchable in `/games?q=` *and* re-openable in
  YAAB.
- Anything undecodable is stored **exactly as pasted** — never dropped. A
  hand-typed list is a perfectly good army list.
- The `YAAB1:` format is a **frozen contract on yaab's side** (its
  `app/CLAUDE.md` says so, because bookmarked share URLs depend on it), so
  decoding it here is safe rather than a hostage to their next refactor.

---

## Fixed vs Tactical secondaries

11e secondary missions are played one of two ways, and **the choice is made per
player, in secret, at setup** (step 6: after the mission, disposition, layout and
attacker/defender are all known, before deployment). One army can run Fixed while
the other runs Tactical, which is why `secondary_mode` sits on `game_players` and
not on `games`.

- **Tactical** — draw, score once, discard. The existing model.
- **Fixed** — pick **two** cards up front. They sit face-up, **cannot be
  discarded, and are active all battle**, so each can score in *every* battle
  round it is met.

### Only four of the eighteen may be taken Fixed

A Grievous Blow, Assassination, Bring it Down, Engage on All Fronts. They are
**not** removed from the Tactical deck — it is the same card with two scoring
blocks, paying less per trigger in Fixed (uncapped, because it fires every round)
and more in Tactical (immediately flattened by a cap into a one-shot).

**That set is derived from the card data, never hard-coded.** GW's own deck
marks it: `scoringType` is `fixed`/`tactical` on a dual-mode card and `standard`
on one that scores the same either way. `build-mission-cards.py` stamps
`fixed: true` from that and **refuses to write unless exactly four come out**
(`EXPECT_FIXED_OPTIONS`), so GW widening the pool is a rebuild rather than a code
change — and a unit test pins the four names against the committed asset.

### Why it is a mode on the seat, not extra card rows

10e Pariah Nexus seeded four **duplicate rows with a `(Fixed)` name suffix**.
Those rows are still in `seed.sql` and **no recorded game has ever used one**.
Don't copy that pattern:

- `secondary_cards` has `UNIQUE (mission_pack_id, name)` — the same card cannot
  exist twice in one pack.
- `findCardId` matches on name with a bare `LIMIT 1` and no `card_type`, so a
  duplicate would resolve nondeterministically.
- `mission-cards.js` looks rules text up **by name**, so a suffixed row could
  only ever render "no rules text on file".
- `zz-residue.test.js` asserts the 11e pack holds **exactly 18** rows.

### One row per scoring round

This is the part that surprises. A Fixed mission is never discarded, so it
holds **one `player_secondaries` row per round it scored**, all sharing a card
name. There is no uniqueness constraint on `(game_player_id, card_id)`, so the
existing table takes it as-is, and `computeFinalScores` already derives each
round's secondary figure by filtering on `roundNumber` — the per-round breakdown
keeps working with no scoring change at all.

- **A card chosen but never scored survives as a lone row** with
  `round_number = NULL`, which is the same "recorded but never scored" shape 11e
  already had. `setFixedScore()` (present in both `live-game.js` and
  `game-form.js`) consumes that placeholder on the first score and re-creates it
  if every round is cleared back to zero — **zeroing a card must not un-choose
  the mission**.
- `drawn_round` is always NULL for a Fixed mission. It was chosen, not drawn.

### The 20 VP cap is PER CARD

`fixedSecondaryMissionCapLimit` in the pack: a maximum of 20 VP from **each**
Fixed card over the battle, not 20 shared between them. Two cards therefore
ceiling at 40, still under the 45 game / 15 per-round secondary caps, which apply
to both modes alike.

Like every other ceiling here it is an **input** limit — enforced where a number
is entered, never as a clamp inside `calcTotal` / `computeFinalScores`. Clamping
in the scoring maths would silently rewrite the total of an already-recorded game
the next time someone saved it (the same rule that shaped the score-detail ladder
and the per-round caps). Both entry surfaces take
`min(secondaryRoundHeadroom(...), fixedCardHeadroom(...))`, and both pass the
entry being edited as `exclude` — without it, re-saving a card at its own number
ratchets the value down a little every time.

### Where it shows up

| Surface | What it does |
|---|---|
| Live tracker Setup | Tactical/Fixed toggle per seat, then a Choose/✓ list of the four. Switching mode confirms first — it clears that seat's cards, because a drawn hand means nothing in Fixed and vice versa |
| Live tracker round screen | `buildSecondaries` branches: Fixed shows the chosen missions with a Score/Edit + Clear per round and a running `x / 20 this battle` |
| `/games/new` + edit | A Secondaries dropdown per player, then a **card × R1–R5 grid** with a per-card total. Card-major like the Tactical deck, but with five VP cells instead of one |
| Game detail | Heading says Tactical or Fixed; Fixed hides the Drawn column (there is no draw) and groups by card, then round |
| Mission card reader | `renderCardBody(card, kind, { mode })` shows **only the relevant half** of a dual-mode card, and hides a `WHEN DRAWN` clause in Fixed mode — it is dead text there. Engage on All Fronts uses that same field to define "presence", which applies in both modes, so the filter is anchored on the literal words |
| `/stats/secondary-averages` | Counts one pick per (seat, card) for a Fixed seat instead of one per row, or a card taken once and scored three times would report as three picks averaging a third of what it earned. Tactical is byte-identical to before |

Not enforced anywhere: **picking other than two**. The app records games that
already happened, and refusing the third tap is how you lose the first two — the
UI says "Pick 1 more" or "That is 3 — the rules allow 2" and stores what you tell
it.

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
- **`game_players.time_is_manual` is the opt-out from that derivation**, and it
  exists because the rule above had no escape hatch. The live tracker clocks
  **every** round, so a tracked game arrived permanently derived: the total was
  read-only on screen *and* recomputed from the sum on every save, which meant
  the only way to correct a runaway clock was to hand-edit five round splits
  until they happened to add up. With the flag set, the typed total outranks the
  rounds and they stay on the record as whatever the timer actually saw.
  - **A manual flag with an unusable total falls back to the derived rule** and
    clears itself, so the flag can never strand a game untimed.
  - The form's Total Time box carries an **Edit** button whenever any round is
    clocked (flip to hand-set, seeded with the current sum) and **Use round
    times** to go back. `refreshTotals()` must keep skipping a manual total, or
    typing a round time would silently overwrite the number you set.
  - Game detail shows the manual total in the ⏱ pill with a `title` saying what
    the round clocks sum to — two numbers on screen that don't add up need to
    say why.
  - This also unsticks the `final` score-mode trap: that mode hides the rounds
    table but keeps `r.timeSeconds`, so the total used to be derived from times
    you could no longer see or edit.
- **The live tracker writes the per-round split directly.** Its running clock
  banks seconds into the current round as they elapse, so a tracked game arrives
  fully clocked and the derived total falls out of the existing rule — no new
  code on the display side. It has **no manual-total control of its own**: fix a
  round in-wizard with the Chess clock reading field, or set the total by hand
  after submit from `/games/:id/edit`.
- **A physical chess clock on "time up" is entered as a READING, not a
  duration.** Such a clock is never reset between rounds — it keeps counting
  while that player takes their turn — so what it shows at the end of round N is
  the player's *cumulative* time. The tracker's "Chess clock reading" field
  therefore takes the number off the device and derives the round as the
  difference against everything banked before it
  (`roundTimeFromClock(p, n, seconds)` in `game-rules.js`; the running total is
  `cumulativeTimeThrough(p, n - 1)`).
  **Nothing downstream learns about clock readings** — the subtraction happens
  at the point of entry and what gets stored is still `game_rounds.time_seconds`
  per round. That also gives a free consistency property, pinned by a test:
  because `resolvePlayerTimes` makes the player total the sum of the rounds, the
  final clock reading and `game_players.time_seconds` are the same number.
  Two details that are not incidental:
  - **The field displays the reading, not the round.** You are copying a number
    off a device sitting in front of you, and being able to compare the two at a
    glance is the whole point. The derived round duration shows underneath.
  - **A reading that goes backwards is refused, not stored.** A count-up clock
    cannot read less than it did last round, so that is a typo;
    `roundTimeFromClock` returns `null` and the field says what the clock stood
    at, rather than recording a negative round or silently zeroing it. Reading
    *exactly* the previous total is allowed — that's a 0-second round, which is
    a real thing when someone passes.
  - An **unclocked round counts as zero** rather than breaking the chain, so
    forgetting to note round 2 doesn't make round 3 unenterable.
  The app's own stopwatch is unchanged and still there; both write the same
  field, because people time games both ways.
- **Entry format** (`parseDuration()` in `app/js/game-rules.js`): `m:ss`, `h:mm:ss`, or
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
  `lib/game-write.js` computes it from the same list that populates the child
  table, and `detachmentList()` trims, drops blanks and de-duplicates
  case-insensitively first. Both write paths (`POST /games`, draft submit) go
  through `createGame`, so neither can skip it.
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

### The library is a real table now, and admin-editable

A detachment typed into a game is **promoted into `detachments`** on save —
`promoteDetachments(client, factionId, names)` in `lib/game-write.js`, called
from `insertPlayerChildren`, so all three write paths (`POST /games`,
`PUT /games/:id`, draft submit) get it. Matching is case-insensitive, because
`UNIQUE (faction_id, name)` is not: without the `LOWER()` guard "gladius task
force" would sit next to "Gladius Task Force" as a separate library row.

Before this, a typed detachment existed **only** as free text in
`player_detachments`, and the suggestion list was inferred by UNIONing those
names into `/reference/factions/:id/detachments`. That mostly worked, but the
library was a side effect of game history rather than a thing anyone owned:
deleting the game deleted the suggestion, and a typo was permanent and
uncorrectable except by editing every game that carried it.

- **The UNION in `reference.js` stays.** It is what still surfaces names
  recorded before promotion existed, on installs that haven't run the backfill.
- **`seed.sql` backfills** every historical name into the library, idempotently
  (it found 6 on this box; 170 → 176 rows).
- **Admin → Detachments** (`/admin/detachments*`, `buildDetachmentsPanel` in
  `views/admin.js`) is where a mistake gets fixed. Rename rewrites the library
  **and** every `player_detachments` row for that faction, de-duplicates a seat
  that ended up holding both spellings, and recomputes the derived
  `game_players.detachment_name`. Renaming onto an existing name is therefore a
  merge — that's the intended tool for two spellings of one detachment.
  Delete refuses (409 `in_use`) while games still reference the name, because
  deleting the library row alone would leave the UNION resurrecting it.

**Why this is allowed here when secondary cards are match-only.** "Security
posture" records the opposite decision for `secondary_cards`: an unrecognised
card name auto-inserted into a *shared mission pack*, where one person's typo
reached everyone's draw picker with **no way to remove it**. The difference is
the last clause. Detachments were already shared through the UNION, so
promotion changes durability rather than exposure — and it ships with the
admin UI that the card case lacked. Don't read this as licence to re-open
auto-insert for cards.

**The trap it re-armed.** The integration fixtures save games carrying
`ZZ `-prefixed detachment names, so promotion put three of them into a real
faction's shared library on the first run — with the suite green, because
`cleanup()` and `assertNoResidue()` only knew about the mission-pack tables.
Both now sweep and assert `detachments` too. **Any new table the server writes
on a user's behalf needs the same two lines**; see "Testing".

---

## Mission card rules text (`app/js/mission-cards.js`)

The 11e deck as readable prose, so a game can be played off the app when the
physical cards aren't on the table. Tap a secondary's name anywhere it appears —
the live tracker's hand, the draw picker, `/games/new`'s deck rows, game
detail — and its card opens. Same for a player's primary mission. The live
tracker's header also carries a 📖 button that opens the **whole deck**, and
that one is available to spectators too: reading is not an edit.

### Where the data comes from

`app/data/mission-cards-11e.json` — a **committed static asset**, not a DB
table and not a runtime fetch from anyone else's server. Built by
`scripts/build-mission-cards.py` from
`game-datacards/datasources` → `11th/gdc/missions/chapter_approved_2026_2027.json`,
which is the **same repo and the same GW-app APK extraction** the sister yaab
site already trusts for faction datasheets — just a different file. Upstream is
~500KB because every string carries eight translations; the script keeps English
only and drops the app-runtime plumbing (uuids, input widget types,
scorable-period lists, layout presets), landing at ~51KB.

- `python3 scripts/build-mission-cards.py` rewrites the asset.
  `--check` rebuilds into memory and exits non-zero if the committed file has
  drifted from upstream, without writing. `--from-file` skips the download.
- It **refuses to write** unless it sees exactly 25 primaries and 18
  secondaries, each with at least one scoring objective — a silently truncated
  scrape is the failure mode worth catching, not a crash.
- Verified at build time against this box's data: all 18 seeded secondary names
  and all 25 primary names resolve, and the client's `PRIMARY_MATRIX` agrees
  with GDC's 25 disposition pairings cell for cell.

### Two things not to "fix"

- **Lookup is by name, case- and punctuation-insensitively** (`foldName`). GDC
  title-cases every word ("Bring It Down", "Burden Of Trust", "Engage On All
  Fronts") where `seed.sql` follows GW's own casing ("Bring it Down"). Don't
  rename either side to make an exact match work — `seed.sql` carries a guarded
  rename *to* GW casing specifically so existing `card_id`s survive, and the
  denormalised `player_secondaries.card_name` on recorded games goes with it.
- **Card prose is rendered as DOM nodes, never `innerHTML`.** The source marks
  keywords with `**…**`; `richText()` splits on the marker and emits real text
  nodes and `<strong>` elements, so card text cannot inject markup.

The asset is fetched **lazily on first tap** and cached in module scope —
nobody browsing the games list needs 51KB of mission prose. Caddy's `@nocache`
matcher covers `*.html *.js *.css`, not `.json`, so the fetch passes
`cache: 'no-cache'` itself to force revalidation. 10e cards are deliberately
**not** linked in game detail: the 11e deck can't answer for Pariah Nexus, and
an affordance that can only say "no rules text on file" is worse than none.

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
- **A terrain picture belongs to ONE game.** The table is dressed for that
  game; two games on "Layout B" are two different boards. So the shot is one of
  the game's own photos, flagged `game_images.is_map`, and there is no
  per-layout picture — `deployment_maps` carries a name and nothing else. This
  was the other way round until 2026-08-09; the columns, the `mapRouter`
  (`POST`/`DELETE /maps/:id/image`) and the games-list fallback to a shared
  picture were all removed, and a `DROP COLUMN IF EXISTS` migration takes the
  columns out. Files already under `UPLOAD_DIR/maps/` are **left on disk**
  unreferenced rather than unlinked. Don't reintroduce a shared picture.
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
  the game's cover photo and its own terrain shot. It is appended to `<body>`, **not** the row: `.panel` is
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
  navigate handler. The list row only carries the cover + map thumbs, so
  `openRowGallery()` fetches `GET /games/:id/images` on click and opens the
  lightbox at the photo you clicked, with the rest cyclable. Both tiles land in
  the same set — the terrain shot is just the game photo tagged MAP.

---

## Game photos

Bytes on disk, metadata in Postgres. Deliberately **not** bytea: a nightly
`pg_dumpall` shouldn't carry multi-MB blobs.

- **Where** — `UPLOAD_DIR` (`/data/uploads` in the container) is bind-mounted
  from `~/sites/sites/40kResultsTracker/uploads`. That path is the project root,
  **not** `app/`, so uploads stay out of git and out of the SPA's `try_files`
  fallback. Caddy serves them read-only at `/uploads/<game_id>/<file>` with a
  1-year immutable cache header (filenames are UUIDs, so they never collide).
  The Node process is not in the read path. Mid-game photos from the live
  tracker sit under `UPLOAD_DIR/drafts/<draft_id>/` (served at
  `/uploads/drafts/<draft_id>/<file>`) until submit renames them into the new
  game's folder.
- **Body limits — the sharp edge.** `server.js` applies
  `express.json({ limit: '256kb' })` app-wide, and it runs **before** the
  routers, so a route-level parser with a bigger limit is dead code: the global
  one 413s the request first. The upload paths are therefore explicitly skipped
  by the global parser (`IMAGE_UPLOAD_PATH`) and parse themselves at 12mb in
  `routes/images.js` and `routes/drafts.js`. This shipped broken once — every real photo failed with
  "request entity too large" while the tests passed, because the test fixture
  was a 352-byte JPEG. **Any size-limit test needs a realistically-sized
  payload.** Every other route stays at 256kb. Full detail in pitfall #11.
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
- **Resizing happens in the browser** (`shrink()` in `app/js/images.js`, shared
  by game photos, layout pictures, zip batches and mid-game draft photos): a
  ~2048px full and a ~400px thumb, both JPEG q0.82, posted as base64 data URLs.
  That keeps `sharp`/imagemagick out of the image and means a 12MP phone photo
  never crosses the wire at full size. `createImageBitmap(file, {
  imageOrientation: 'from-image' })` is load-bearing — without it, portrait
  phone photos come out sideways once re-encoded through a canvas.
- **Cover photo** — `is_thumbnail` picks the one shown in the games list, with a
  partial unique index enforcing at most one per game. The first upload becomes
  the cover automatically; deleting the cover promotes the oldest survivor.
- **Map photo** — `is_map` works the same way (own partial unique index) and
  marks the shot of the terrain **this game** was played on. The two flags are
  independent, so one photo can be both. It is set from the Photos panel's Map
  button, from game detail's Terrain Layout panel (which uploads with
  `isMap: true` — `POST /games/:id/images` accepts the flag, inserting unflagged
  and setting it afterwards so the partial unique index can't reject the insert),
  or at source in the live tracker. The games list's second thumbnail is this
  photo and nothing else — there is no shared per-layout picture to fall back to.
  The live tracker can **set the flag at source**: its Setup step has a Terrain
  layout panel whose Take photo / Upload buttons post `isMap: true`, so the tag
  is carried by `relinkDraftImages` rather than toggled by hand on game detail
  afterwards. `game_draft_images` therefore carries its own `is_map` and its own
  partial unique index — one per draft, because two would collide on the game's
  index at relink and the loser would be dropped as a failed relink (a lost
  photo). Re-shooting the table demotes the previous shot rather than deleting
  it: it stays on the game, just untagged.
- **Deleting a game leaves its photo files exactly where they are.** Both
  `DELETE /admin/games/:id` and `DELETE /drafts/:id` archive into `deleted_items`
  and touch nothing on disk, because a restore that comes back with no pictures
  isn't a restore. The `game_images` / `game_draft_images` **rows** are captured
  into the archive payload and then cascade away with their parent. The one path
  that unlinks bytes is `DELETE /admin/deleted/:id` → `removeArchivedFiles()`,
  which calls `removeGameImageFiles(id)` (`routes/images.js`) for a game or `rm -r`s
  `UPLOAD_DIR/drafts/<id>/` for a draft — and skips even that if the id has been
  reused. See "Restorable deletes".
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

## Testing

**346 tests in two suites.** Both are `node:test` — no framework, no assertion
library, no mocking library. Run the unit suite before every deploy; run the
integration suite before anything that touches `drafts.js`, `admin.js`,
`archive.js` or the schema.

```bash
bash scripts/test-unit.sh                    # 190 tests, ~1.5s, no network, no DB
bash scripts/test-live.sh                    # 156 tests, live API + real Postgres
bash scripts/test-live.sh drafts-lifecycle   # one file
```

Both shell out to `docker run`, which is why they live in `scripts/` rather than
as npm scripts. `npm test` inside `api/` runs the same unit glob on the host.

### Unit suite (`scripts/test-unit.sh`) — 190 tests, 11 files

`--network none`, no database, no containers. It mounts `app/` **read-only**,
because several suites test *frontend* modules — they're dependency-free ES
modules with no DOM access, so they're imported by relative path from `api/test/`
rather than standing up a second runner.

The three additions worth knowing about:

- **`game-rules.test.js` (34)** runs a table of 11 payloads through *both*
  `calcTotal()` (client) and `computeFinalScores()` (server) and asserts exact
  equality. That mirror is hand-maintained and had already drifted: `calcTotal`
  gated its card-detail branch on **secondaries alone** where the server gates on
  **secondaries or challengers**, so a 10e game with a scored Secret Mission and
  no secondary cards read **30 on screen and saved as 40** — the total jumped the
  moment you hit Save. Fixed on the client; that exact case is now case 11.
- **`army-list.test.js` (24)** builds its fixtures with an `encode()` copied
  verbatim from yaab's `storage.js`, so every case is a real round-trip through
  the wire format. It also carries a **format-drift canary**: given
  `YAAB_SOURCE_DIR` (the runner mounts the sister repo at `/yaab`), it reads
  yaab's own `storage.js` and asserts it still declares `EXPORT_PREFIX =
  'YAAB1:'` and writes `v: 2`. It **skips** when the mount is absent — an
  early-warning signal, not a hard dependency. The point is to find out from a
  test run rather than from a user pasting a code that no longer expands.
- **`nav-stack.test.js` (12)** installs a fake `History` / `window` / `document`
  before importing the module, and tracks `url` specifically so it can assert
  **the route never moves while a layer is open** — the failure this module
  exists to prevent.

### Integration suite (`scripts/test-live.sh`) — 156 tests, 8 files

Joined to the `web` docker network, hitting `40k-api:3000` and `postgres:5432`
directly — no Caddy, no NAT loopback (which doesn't work on this host anyway).
It requires the repo's `.env` and refuses to run without one, so it only runs on
the server. `--test-concurrency=1`: the files share one database.

**It talks to the real database**, alongside real data. The safety property is
naming, not isolation:

- Every row belongs to a user whose username starts with **`zz_test_`**;
  free-text reference rows it invents are prefixed **`ZZ `**.
- `cleanup()` only deletes rows reachable from those users.
- **`zz_test_` is also what keeps a test run out of the operator's inbox.**
  The suite files real games against the real API, so every fixture game used to
  send a "new game logged" email — a dozen a run, plus a "game started" per
  draft, which is enough to burn the shared mailer's Gmail daily quota and take
  mail down for **every** site on the box. `isFixtureActor()` in `lib/mail.js`
  is the guard; `notifyGameLogged` and `notifyGameStarted` resolve the acting
  account and return early on it.
- **`zz-residue.test.js` runs last** (the glob is alphabetical and the run is
  serial) and **fails the build** if anything is left behind — including that the
  11e pack still holds exactly its 18 seeded secondaries.

That last check is not paranoia. Before it existed, fixtures leaked **8 invented
secondary cards into the live 11e mission pack**, where they showed up in every
user's draw picker with no way to remove them. (It's also why secondaries are
match-only now — see "Security posture".) **If you add a table, add it to
`cleanup()` in FK-safe order.**

**If you add a notification, add it to the fixture guard.** The rule is the same
shape as the residue guard and fails the same way — silently, in someone else's
inbox rather than in the test output. Suppressing mail by unsetting `MAILER_URL`
around the run is the obvious alternative and is **wrong**: an interrupted run
leaves real notifications off for good, and nobody notices an email that didn't
arrive. Key the suppression off the fixture name, which is already load-bearing
here, so there is nothing to switch back on. After touching a mail path, check
`docker logs --since <window> mailer` is empty for the run.

It happened a **second** time, exactly as predicted by that sentence, when
`promoteDetachments` started writing to `detachments`: three `ZZ ` detachments
landed in a real faction's shared library and the suite still went green,
because the sweep and the assertion both enumerated only the mission-pack
tables. `cleanup()` and `assertNoResidue()` now cover `detachments` as well.
The generalisation worth carrying forward: **the residue guard has to grow
whenever the server gains a new "write this on the user's behalf" table**, and
a passing run is not evidence that it did.

### Two harness gotchas (`api/test/integration/_harness.js`)

Both cost an afternoon each; read the comments in that file before writing a new
integration test.

1. **`X-Forwarded-Proto: https` is mandatory on every request.** The session
   cookie is `Secure` and the app runs `trust proxy`, so express-session silently
   declines to set it unless `req.secure` is true. Caddy supplies the header in
   production; talking to the container directly, the test must. Without it
   **login returns 200 with no cookie** and the next call 401s for no visible
   reason. (`X-Forwarded-For` is faked per-client too, because `/auth/login` is
   rate-limited per IP and every test client shares one.)
2. **`login()` must drain the response body.** express-session flushes the
   headers and all but the *last byte*, holding that byte until the session store
   write lands in Postgres. `fetch` resolves at the headers, so returning without
   `await res.text()` hands back a cookie whose session row is still 100–300ms
   from existing.

### What isn't covered

No browser-level tests — no DOM, no Chart.js, no canvas. The war map in
particular has **zero** automated coverage, and its determinism guarantees
(pitfall #7) are enforced by review only.

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
- **Match existing patterns.** Every view is `export async function renderXxx(state, ...)`. Every route module is `export default Router()`, gated per route (or with `requireAdmin` at the top, for `admin.js` / `ratings.js` only — reads are public by default here).
- **Idempotent SQL.** New `CREATE TABLE` → `IF NOT EXISTS`. New `INSERT INTO seed` → `ON CONFLICT DO NOTHING`. Schema changes to existing tables → guarded `ALTER TABLE` in a `DO $$ … END $$` block.
- **Server-side enforcement is the source of truth.** Client gating is UX only.
- **Run `scripts/test-unit.sh` before you deploy.** It's 1.5 seconds and needs nothing running. If you touch drafts, admin, `archive.js` or the schema, run `scripts/test-live.sh` too.
- **Parse ids with `lib/params.js`, never `parseInt`; never audit a raw body.** See pitfall #12.

---

## When in doubt

- The directory's own `README.md` for module-internal conventions (see "Per-module READMEs" above)
- `DEPLOY.md` for infra + nightly backup setup
- `api/lib/README.md` to find the right helper before writing a new one
- `api/routes/README.md` for "where does this endpoint live"
- `api/test/README.md` to add a test; `scripts/README.md` for the two runners
- "Testing" above before you deploy — `scripts/test-unit.sh` costs 1.5 seconds
- Git log for "when did this change" (`git log --oneline -- path/to/file`)
- Live YAAB CSS for styling reference (`yetanotherarmybuilder` repo on the user's GitHub) — visit https://github.com/stopsign002/yetanotherarmybuilder
