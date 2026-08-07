# `api/lib/` — backend helpers

Pure-JS modules used by `routes/*`. Almost every file has `// @ts-check` at the top and JSDoc on its exports — `npm run typecheck` enforces the contracts. (`async-routes.js`, `params.js` and `mail.js` are the three that don't: they carry a long WHY comment instead and have no interesting types to check.)

## Helpers at a glance

| File | Exports | Purpose |
|---|---|---|
| `db.js` | `pool`, `withTx(fn)`, `initSchema()` | pg connection pool + transaction wrapper. `withTx` is generic in the callback's return type. `initSchema` runs `db/schema.sql` then `db/seed.sql`; called once from `server.js` boot. |
| `auth.js` | `hashPassword`, `verifyPassword`, `ensureBootstrapAdmin`, `requireAuth`, `requireAdmin` | bcrypt cost-12 password hashing + session-based middleware. `requireAuth` → 401 if no session. `requireAdmin` → 401 then 403. `ensureBootstrapAdmin` only runs when `users` is empty. |
| `audit.js` | `audit(req, action, opts)` | Fire-and-forget INSERT into `audit_log`. **Never throws** — an audit-write outage cannot block the actual operation. Pass `{ type, id, payload }` for context. Keep the payload small. |
| `events.js` | `addSubscriber({ res, userId })`, `broadcast(type, data)`, `subscriberCount()` | In-process SSE subscriber set. `routes/events.js` adds subscribers; write-path endpoints call `broadcast('game.saved', ...)` to push. Failed writes silently drop the dead sub. |
| `game-scoring.js` | `computeFinalScores(players, edition)`, `resolvePlayerTimes(players)`, `validateGameInput(body)`, cap constants | Pure helpers used by `routes/games.js` POST/PUT. Operates on the **camelCase request payload**, not DB rows. `computeFinalScores` resolves a **three-rung detail ladder** (cards → per-round figures → bare final score) and applies the edition's ceiling; `resolvePlayerTimes` applies the same shape to chess-clock times (per-round sum wins over a typed total). Tested in `test/game-scoring.test.js` — pins the camelCase contract that has bitten production once already (see CLAUDE.md pitfall #1). |
| `glicko2.js` | `ratePeriod`, `decayRd`, `expectedScore`, `newPlayer`, `GLICKO2_DEFAULTS` | Pure Glicko-2 rating math (chess/Lichess system), **forward/causal**. `ratePeriod(player, results)` rates one player over a rating period; `expectedScore(a,b)` is the win-probability used for matchmaking. Pinned to Glickman's worked example in `test/glicko2.test.js`. No DB, no deps. |
| `whr.js` | `fitGlobal(games)` | **Whole-history** rating: a global Bayesian Bradley-Terry MAP fit over all games at once (retroactive — evidence flows both directions). Prior regularises undefeated players and pins disconnected groups; returns `{rating, rd}` per player on the same ~1500 scale as glicko. Each game may carry a weight `w` (default 1) scaling its evidence + information — used for recency decay. Tested in `test/whr.test.js`. No DB, no deps. |
| `ratings.js` | `computeRatings(opts)`, `balancedPairings`, `outcomeScore`, `displayRating`, `displayFloor`, `displayConfidence`, `MOV_FULL` | Turns the game record into all-time ratings under either model (`opts.model = 'glicko'|'whr'`): shared parse + connectivity, then `runGlicko` (per-day forward batches, elapsed-time RD decay) or `runWHR` (refit the graph at each game-date, **recency-weighted** via `recencyWeight`/`RECENCY_HALF_LIFE_DAYS`). `displayFloor` (rating − K·RD) is the confidence-adjusted **ranking key**. `db.js` imported lazily so pure helpers test without `pg`. Tunables (`MOV_FULL`, `PERIOD_DAYS`, `RANK_FLOOR_K`, `RECENCY_HALF_LIFE_DAYS`, display scale, provisional thresholds) at the top. |
| `adopt-guest.js` | `previewGuests()`, `promoteAllGuests(client)` | Promotes free-text guests into real **inactive** user accounts (or links to existing ones), then migrates `banner_first_seen` so the war map stays put. Idempotent + transactional (pass a `withTx` client). Backs `/admin/guests/preview` + `/admin/promote-guests`. |
| `game-write.js` | `createGame(client, body, actorUserId)`, `resolvePlayerIdentities`, `resolveGameLookups`, `insertPlayerChildren`, `recordBannerFirstSeen`, `detachmentList`, `joinDetachments`, `notifyGameLogged`, `FORCE_DISPOSITIONS` | The single INSERT path into `games` + `game_players` + children, shared by `POST /games` and `POST /drafts/:id/submit`. Call `createGame` inside `withTx`. The caller keeps the surrounding pipeline (validate → `resolvePlayerIdentities` → `computeFinalScores` → `resolvePlayerTimes` before; `audit` → `broadcast` → `notifyGameLogged` after). `PUT /games/:id` keeps its own delete-then-reinsert body but shares these helpers. Two reference-data rules live in here — see "Card ids on the write path" below. |
| `draft.js` | `mergePatch`, `mergeDraftPatch`, `opponentSeatPatch`, `normalizeDraftRounds`, `validateDraftSubmit` | Pure helpers behind `routes/drafts.js`. `mergeDraftPatch` is the autosave merge: objects merge key by key, **arrays replace wholesale**, `null` is a value — except `players`, which a patch addresses as an object keyed by seat index and which merges seat-by-seat (see below). The seat index is bounded `0..1`, which is load-bearing, not tidiness: it previously accepted any integer, so `{"players":{"1e7":{}}}` — a 40-byte authenticated PATCH — grew the array to ten million entries, 618MB of heap and 30MB of JSONB on the row. `normalizeDraftRounds` **drops** out-of-range/duplicate `game_rounds` (clamping would collide under `UNIQUE (game_player_id, round_number)`) and **clamps** secondary `roundNumber`/`drawnRound` into 1–5, which is lossless there. Tested in `test/draft-merge.test.js` + `test/draft-submit.test.js`. |
| `mail.js` | `notify(subject, text)` | Fire-and-forget POST to the shared `mailer` container. **No-ops unless `MAILER_URL` + `MAILER_TOKEN` are set**, never throws, never blocks — a mail hiccup must not fail a game save. 10s `AbortSignal.timeout`. Two callers: `notifyGameLogged` in `game-write.js` (a game was filed) and `notifyGameStarted` in `routes/drafts.js` (a live game left setup). |
| `params.js` | `idParam(value)`, `intParam(value, {min,max,fallback})` | The only sanctioned way to turn a path param or query string into a number. `idParam` returns a positive integer ≤ 2147483647 or **null**; `intParam` clamps into a range with a fallback. `Number.isInteger(1e20)` is `true` but Postgres `integer` stops at 2147483647, so the old truthiness guards handed 22003 straight to the driver. Used by `games`, `stats`, `warmap`, `reference`, `admin`, `images`, `seasons`, `drafts`. |
| `async-routes.js` | `catchAsync(router)`, `installRejectionGuard()` | The process-survival pair — see "Async handlers and the process guard" below. `server.js` calls `installRejectionGuard()` first and wraps every router in `catchAsync(...)` at mount. |
| `faction-anchors.js` | `FACTION_HOMES`, `SPARE_ANCHORS`, `chooseSpareAnchor(claimed)` | Server-side mirror of the war map's anchor table, plus 12 spare anchors so the 2nd+ player of a faction doesn't stack on the same seed site. **`FACTION_HOMES` here and in `app/js/views/warmap.js` must be edited together**, append-only. |
| `archive.js` | `archiveGame(client, gameId, req)`, `archiveDraft(client, draftId, req)`, `restoreItem(client, itemId, req)`, `purgeItem(client, itemId)`, `removeArchivedFiles(purged)`, `isOccupied(client, kind, originalId)` | The recycle bin behind `DELETE /admin/games/:id`, `DELETE /drafts/:id` and `/admin/deleted*`. Serialises the whole row-set into `deleted_items.payload` (JSONB, captured with `row_to_json` so dates survive) and hard-deletes the originals — **not** a `deleted_at` flag on `games`, which would have to be honoured by ~20 queries across stats/warmap/ratings/`v_game_player_stats`. `restoreItem` **scrubs every FK against the live tables first** (a dangling nullable ref is dropped, a NOT NULL owner falls back to the restoring admin, and it reports what it changed as `repaired`) — same discipline as `dropDanglingCardIds` in `game-write.js`, because a restore that dies on a foreign key defeats the point of a bin. It then re-inserts every row with its ORIGINAL id and `setval`s each touched SERIAL sequence past the table's max. `purgeItem` is DB-only; call `removeArchivedFiles` with its result **after** the transaction commits — a leftover file is recoverable, an archive row with no files is not. Call the rest inside `withTx`. |
| `game-filter.js` | `COUNTED_GAMES`, `INCLUDE_DIGITAL_IN_STATS` | The single "counts toward competitive surfaces" SQL gate (drop-in where the `games` table is aliased `g`), used by `ratings.js`, `warmap.js`, `stats.js`. Includes digital (Tabletop Simulator) games by default; env `INCLUDE_DIGITAL_IN_STATS=false` excludes them everywhere at once. With it on, it equals the legacy `g.hidden_from_stats = FALSE` byte-for-byte. |

## Conventions

- **`// @ts-check` at the top of every new file.** JSDoc the public exports. Reuse typedefs from `../types.js` (`PlayerPayload`, `GamePayload`, `BannerUnit`).
- **Side-effect-free where possible.** `game-scoring.js` is the model: no DB, no env, no `req`/`res`. Easier to test, easier to reuse.
- **Transactions:** use `withTx(async (client) => {...})` and pass `client` to inner queries. Don't BEGIN/COMMIT manually.
- **Audit + broadcast** are paired: when a write-path endpoint changes state, both fire (audit for posterity, broadcast for live UI).

## The draft patch shape (`draft.js`)

A draft payload holds `players` as an **array** of two seats. A PATCH body
addresses them as an **object keyed by seat index** (`{ players: { "0": …, "1": … } }`).
That asymmetry is deliberate: wholesale array replacement is right for
`rounds` / `secondaries` / `detachments` (an element merge would resurrect a
deleted entry) and wrong for `players`, where one phone patching its own seat
would wipe the seat it never sent. `opponentSeatPatch` enforces the invited
opponent's scope — a lone `players["1"]` and nothing else.

## Card ids on the write path (`game-write.js`)

Two rules that look like small details and are not.

**An unrecognised secondary is recorded, not created.** Secondaries resolve
through the private `findCardId` — **match-only**. Challengers still go through
`resolveCardId`, which auto-inserts. The asymmetry is deliberate: the 11e deck is
a fixed 18 cards published by GW, so a name that doesn't match one is almost
always a typo, and auto-inserting put that typo into the *shared* mission pack
where every user then saw it in their draw picker with no way to remove it. It
also made pack rows deletable-but-referenced. Nothing is lost by returning null —
`player_secondaries.card_name` is denormalised and is what every view actually
renders, so the unmatched name is recorded against that game and stays out of
everyone else's deck. `test/integration/zz-residue.test.js` fails the build if a
test fixture ever leaks a card back into the pack.

**A dangling card id degrades to name-only.** `createGame` calls the private
`dropDanglingCardIds` immediately after `resolveGameLookups`. A card id stored on
a draft can dangle — the pack row may have been deleted between the card being
drawn and the game being submitted — and `player_secondaries.card_id` is a FK, so
that took the whole submit down with an opaque 500: a game played to the end
became unfileable because of a row nobody had touched. It **must** run *after*
`resolveGameLookups`, not before: earlier, and the name gets re-resolved and
silently re-creates the pack row that was just deleted.

`restoreItem` in `archive.js` applies the same discipline to every FK on an
archived row-set. A restore that dies on a foreign key defeats the point of a bin.

## Async handlers and the process guard (`async-routes.js`)

Express 4 does not await async route handlers, and Node 22 defaults to
`--unhandled-rejections=throw`. So a handler that rejected **exited the
process** — and that was remotely triggerable with no session:
`POST /auth/login` with `{"password":{}}` reached `bcrypt.compare`, which rejects
on a non-string. `GET /games/abc` did it too (`parseInt` → `NaN` → 22P02), along
with a dozen similar id/limit parses. `restart: unless-stopped` brought it back in
seconds, but every SSE subscriber and in-flight request died with it, repeatably.

- **`catchAsync(router)`** walks the router's stack *after* the routes are
  registered and wraps each handler so a rejection becomes `next(err)` — straight
  into the existing error middleware, which already returns a sanitised 500. It
  preserves each handler's `length` (Express uses arity to tell request handlers
  from the 4-arg error middleware) and its `name` (readable stack traces).
- **`installRejectionGuard()`** is the backstop for rejections *outside* the
  request lifecycle — a fire-and-forget `notify`, a timer. Log and keep serving.

It reaches into Express 4's `router.stack` internals on purpose: the alternative
is a dependency, and Express 4 is in security-only maintenance so those internals
are not going to move. The two real fixes still belong in the handlers —
`params.js` for the ids, a `typeof` check in `routes/auth.js` for the password.
`catchAsync` is the net under them, not a substitute.

## The detail ladder (`game-scoring.js`)

Games arrive with wildly varying amounts of detail, so both scoring helpers
resolve **from the data, never from a stored mode flag**. Priority, highest first:

| Rung | Condition | Result |
|---|---|---|
| cards | `secondaries[]` (or, in 10e, `challengers[]`) non-empty | cards are the truth; each round's `secondaryScore` is **recomputed** from them |
| rounds | no cards, but some round has a primary/secondary figure | the typed per-round numbers are taken as given |
| final | nothing broken down at all | the submitted `finalScore` is kept, clamped to the edition ceiling |

`resolvePlayerTimes` is the same idea for the clock: any per-round time makes the
player total their sum; otherwise the typed total stands.

Why it matters: the original implementation recomputed unconditionally, so
**re-saving a game that had no card detail silently zeroed it**. Deriving from
the data means an edit round-trip is lossless at every rung. If you add another
rung, keep the same rule — no client-supplied mode flag decides scoring.

## Notable invariants

- `audit()` is fire-and-forget. Never `await audit(...)` *as if it could fail* — wrap any meaningful logic before/after the call without depending on its return.
- `broadcast()` must accept JSON-serialisable data only. Don't pass Express `res` objects or DB clients.
- The pool's `error` listener logs but does not crash the process — Postgres connection blips during long uptime are normal.
- **Anything that unlinks a file runs after the transaction commits**, never inside it. `purgeItem` is DB-only and hands its result to `removeArchivedFiles`; `relinkDraftImages` runs after submit's `withTx`. A leftover file is recoverable; a committed row pointing at bytes that are already gone is not.
- **Photo bytes survive an archive.** Only `removeArchivedFiles` unlinks them, which is exactly what makes a restore come back with its pictures.

## Adding a new helper

1. Create `api/lib/<name>.js` with `// @ts-check` and JSDoc.
2. Add a row to the table above.
3. Import from the consumer (a route, another helper, or a test).
4. If it has a non-trivial pure path, drop a `test/<name>.test.js` mirroring `test/game-scoring.test.js`. If its contract is only observable over HTTP, add an integration case instead — see `test/README.md`.

## Guest adoption

`adopt-guest.js` now exists (it was the "notable absence" the earlier docs flagged). `promoteAllGuests` is the bulk fix for the "user created after their first guest game" case — it creates inactive accounts for unmatched guests, links the rest, relinks their `game_players` rows, and copies each guest's `banner_first_seen` row (preserving `first_seen_at` + anchors) so the Theatre of War doesn't reshape. Triggered by an admin button, not on boot. The per-game manual workaround in CLAUDE.md pitfall #8 still works for one-offs.
