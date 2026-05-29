# `api/lib/` — backend helpers

Pure-JS modules used by `routes/*`. Every file has `// @ts-check` at the top and JSDoc on its exports — `npm run typecheck` enforces the contracts.

## Helpers at a glance

| File | Exports | Purpose |
|---|---|---|
| `db.js` | `pool`, `withTx(fn)`, `initSchema()` | pg connection pool + transaction wrapper. `withTx` is generic in the callback's return type. `initSchema` runs `db/schema.sql` then `db/seed.sql`; called once from `server.js` boot. |
| `auth.js` | `hashPassword`, `verifyPassword`, `ensureBootstrapAdmin`, `requireAuth`, `requireAdmin` | bcrypt cost-12 password hashing + session-based middleware. `requireAuth` → 401 if no session. `requireAdmin` → 401 then 403. `ensureBootstrapAdmin` only runs when `users` is empty. |
| `audit.js` | `audit(req, action, opts)` | Fire-and-forget INSERT into `audit_log`. **Never throws** — an audit-write outage cannot block the actual operation. Pass `{ type, id, payload }` for context. Keep the payload small. |
| `events.js` | `addSubscriber({ res, userId })`, `broadcast(type, data)`, `subscriberCount()` | In-process SSE subscriber set. `routes/events.js` adds subscribers; write-path endpoints call `broadcast('game.saved', ...)` to push. Failed writes silently drop the dead sub. |
| `game-scoring.js` | `computeFinalScores(players)`, `validateGameInput(body)` | Pure helpers used by `routes/games.js` POST/PUT. Operates on the **camelCase request payload**, not DB rows. Tested in `test/game-scoring.test.js` — pins the camelCase contract that has bitten production once already (see CLAUDE.md pitfall #1). |
| `glicko2.js` | `ratePeriod`, `decayRd`, `expectedScore`, `newPlayer`, `GLICKO2_DEFAULTS` | Pure Glicko-2 rating math (chess/Lichess system), **forward/causal**. `ratePeriod(player, results)` rates one player over a rating period; `expectedScore(a,b)` is the win-probability used for matchmaking. Pinned to Glickman's worked example in `test/glicko2.test.js`. No DB, no deps. |
| `whr.js` | `fitGlobal(games)` | **Whole-history** rating: a global Bayesian Bradley-Terry MAP fit over all games at once (retroactive — evidence flows both directions). Prior regularises undefeated players and pins disconnected groups; returns `{rating, rd}` per player on the same ~1500 scale as glicko. Each game may carry a weight `w` (default 1) scaling its evidence + information — used for recency decay. Tested in `test/whr.test.js`. No DB, no deps. |
| `ratings.js` | `computeRatings(opts)`, `balancedPairings`, `outcomeScore`, `displayRating`, `displayFloor`, `displayConfidence`, `MOV_FULL` | Turns the game record into all-time ratings under either model (`opts.model = 'glicko'|'whr'`): shared parse + connectivity, then `runGlicko` (per-day forward batches, elapsed-time RD decay) or `runWHR` (refit the graph at each game-date, **recency-weighted** via `recencyWeight`/`RECENCY_HALF_LIFE_DAYS`). `displayFloor` (rating − K·RD) is the confidence-adjusted **ranking key**. `db.js` imported lazily so pure helpers test without `pg`. Tunables (`MOV_FULL`, `PERIOD_DAYS`, `RANK_FLOOR_K`, `RECENCY_HALF_LIFE_DAYS`, display scale, provisional thresholds) at the top. |
| `adopt-guest.js` | `previewGuests()`, `promoteAllGuests(client)` | Promotes free-text guests into real **inactive** user accounts (or links to existing ones), then migrates `banner_first_seen` so the war map stays put. Idempotent + transactional (pass a `withTx` client). Backs `/admin/guests/preview` + `/admin/promote-guests`. |
| `game-filter.js` | `COUNTED_GAMES`, `INCLUDE_DIGITAL_IN_STATS` | The single "counts toward competitive surfaces" SQL gate (drop-in where the `games` table is aliased `g`), used by `ratings.js`, `warmap.js`, `stats.js`. Includes digital (Tabletop Simulator) games by default; env `INCLUDE_DIGITAL_IN_STATS=false` excludes them everywhere at once. With it on, it equals the legacy `g.hidden_from_stats = FALSE` byte-for-byte. |

## Conventions

- **`// @ts-check` at the top of every new file.** JSDoc the public exports. Reuse typedefs from `../types.js` (`PlayerPayload`, `GamePayload`, `BannerUnit`).
- **Side-effect-free where possible.** `game-scoring.js` is the model: no DB, no env, no `req`/`res`. Easier to test, easier to reuse.
- **Transactions:** use `withTx(async (client) => {...})` and pass `client` to inner queries. Don't BEGIN/COMMIT manually.
- **Audit + broadcast** are paired: when a write-path endpoint changes state, both fire (audit for posterity, broadcast for live UI).

## Notable invariants

- `audit()` is fire-and-forget. Never `await audit(...)` *as if it could fail* — wrap any meaningful logic before/after the call without depending on its return.
- `broadcast()` must accept JSON-serialisable data only. Don't pass Express `res` objects or DB clients.
- The pool's `error` listener logs but does not crash the process — Postgres connection blips during long uptime are normal.

## Adding a new helper

1. Create `api/lib/<name>.js` with `// @ts-check` and JSDoc.
2. Add a row to the table above.
3. Import from the consumer (a route, another helper, or a test).
4. If it has a non-trivial pure path, drop a `test/<name>.test.js` mirroring `test/game-scoring.test.js`.

## Guest adoption

`adopt-guest.js` now exists (it was the "notable absence" the earlier docs flagged). `promoteAllGuests` is the bulk fix for the "user created after their first guest game" case — it creates inactive accounts for unmatched guests, links the rest, relinks their `game_players` rows, and copies each guest's `banner_first_seen` row (preserving `first_seen_at` + anchors) so the Theatre of War doesn't reshape. Triggered by an admin button, not on boot. The per-game manual workaround in CLAUDE.md pitfall #8 still works for one-offs.
