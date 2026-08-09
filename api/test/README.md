# `api/test/` — unit + integration tests

Two suites, both on Node's built-in `node:test` runner, no framework:

- **`test/*.test.js` — 190 unit cases.** Pure functions, no DB, no network, no
  filesystem. Runs in under two seconds.
- **`test/integration/*.test.js` — 156 cases.** Real HTTP against the running
  API and the **live** Postgres. Every row it creates belongs to a `zz_test_*`
  user, and it cleans up after itself. That prefix is also what keeps the run
  out of the operator's inbox — see `isFixtureActor()` in `lib/mail.js`.

## Running

```bash
# unit — anywhere, no containers needed
cd api && npm test                    # node --test test/*.test.js
node --test test/game-scoring.test.js # single file

# from the repo root, in a node:22-alpine container
scripts/test-unit.sh                  # the 190 unit cases, --network none
scripts/test-live.sh                  # all 156 integration cases
scripts/test-live.sh drafts-lifecycle # one integration file
```

`npm test` does **not** reach `test/integration/` — the glob is `test/*.test.js`,
one level deep on purpose. The integration suite has no npm script; it needs the
`web` network and `.env`, so `scripts/test-live.sh` is the only entry point.

**Both runners glob `*.test.js` through a shell, and that is deliberate.**
`node --test <dir>/` resolves the path as a *module* and dies with
`MODULE_NOT_FOUND` rather than scanning it. If you write a new runner, glob.

`scripts/test-unit.sh` mounts more than `api/`: `app/` read-only (three unit
files import frontend modules — see below) and, when it's present, the sister
`yetanotherarmybuilder` repo at `/yaab/app:ro` with `YAAB_SOURCE_DIR` pointing at
it, so the YAAB format-drift canary can actually run instead of self-skipping.

`scripts/test-live.sh` runs on the `web` network and talks to `40k-api:3000` and
`postgres:5432` **directly** — no Caddy, no NAT loopback (which doesn't work on
this host anyway). It runs `--test-concurrency=1`: the files share one database,
and a parallel run has them asserting against each other's rows.

## Unit tests — what's covered

| File | Module under test | Cases |
|---|---|---|
| `game-scoring.test.js` | `lib/game-scoring.js` | **10e** `computeFinalScores`: zero-zero → draw, primary roll-up, **secondaries fold in via cards (NOT `r.secondaryScore`)** ← the camelCase regression test, finalScore clamps to 100, `manualWinner` overrides higher score, both `manualWinner` → draw. **11e**: reproduces the reference game (rounds 4/8/11/8/15 = 46 raw → clipped to 45, secondaries 32, **final 77**), each half caps independently with no cross-subsidy, challengers ignored, a held card scores on its *scored* round not its draw round. **Detail ladder**: per-round totals count when no cards exist and survive an edit round-trip; cards outrank a stale typed total; a bare final score is kept and clamped (90/100); a lone round figure outranks a submitted total; an empty game is still 0-0 draw; junk → 0, not NaN. **Times** (`resolvePlayerTimes`): per-round sums, partial clocks, per-round beating a stale total, typed total standing alone, unclocked staying `null` (not 0), junk/negatives discarded. `validateGameInput`: rejects missing playedAt / pointsLimit / wrong player count / players with neither userId nor guestName; happy path doesn't throw. |
| `glicko2.test.js` | `lib/glicko2.js` | **Pins Glickman's worked example** (1500/200 vs three opponents → 1464.06 / 151.52 / 0.05999). Idle-period RD inflation + 350 ceiling, empty-results decay, `expectedScore` symmetry + uncertainty pulling toward 50/50. |
| `ratings.test.js` | `lib/ratings.js` (pure parts) | `outcomeScore` W/L/D + margin-of-victory direction/magnitude/saturation; `displayRating` 1500→500 mapping + 0–1000 clamp; `balancedPairings` pairs closest ratings (not best-vs-worst) and handles odd counts with a sit-out. |
| `whr.test.js` | `lib/whr.js` | Whole-history `fitGlobal`: transitive ordering (A>B>C from A-beat-B, B-beat-C); undefeated player stays finite (prior); symmetric results → centre; more games → lower RD; margin-of-victory moves the estimate more than a draw. **Recency weight**: heavier (recent) result leans the rating; omitting `w` == `w=1` (regression); down-weighted games → higher RD. |
| `game-filter.test.js` | `lib/game-filter.js` | One case, and it's a tripwire: with the flag on, `COUNTED_GAMES` must equal `'g.hidden_from_stats = FALSE'` **byte for byte**, so introducing the gate changed no behaviour. |
| `draft-merge.test.js` | `lib/draft.js` | The autosave merge: nested objects merge key by key, **arrays replace wholesale** (never element-merged), `null` is a value not a delete, the base is not mutated. The `players` asymmetry: a seat-keyed patch object merges into the payload's seat array without touching the other seat, an owner patch may touch both seats plus top-level keys, arrays *inside* a seat still replace, a seat patch on an empty payload fills the missing seats. `opponentSeatPatch` scope: seat 2 only, any other top-level key or a `"0"` seat → rejected. |
| `draft-submit.test.js` | `lib/draft.js` + `lib/game-scoring.js` | `validateDraftSubmit`'s friendly messages (missing date / points limit / player count / a nameless seat); round-number sanitising — no round number → dropped, outside 1–5 → dropped (NOT clamped onto an existing round, which the `UNIQUE (game_player_id, round_number)` index would reject), duplicates dropped, secondary `roundNumber`/`drawnRound` clamped into 1–5; the 11e 45/45 halves and the reference game surviving the draft-submit path. |
| `game-rules.test.js` | **`app/js/game-rules.js`** + `app/js/components.js`, diffed against `lib/game-scoring.js` | `parseDuration` / `fmtDuration` round-trip; `sumPrimary` / `sumSecondaries` / `sumSecondaryPoints`; `capLabel`; `calcTotal` for both editions; `ROUNDS` still the 5 rounds the DB CHECKs pin; `PRIMARY_MATRIX` is a complete 5×5 grid keyed by `FORCE_DISPOSITIONS`. **Per-round caps**: `E11_*_ROUND_CAP` and the game-level `E11_*_CAP` are asserted against `app/data/mission-cards-11e.json`, so a pack update that moved a limit fails here; `sumSecondaryForRound` totals what SCORED in a round rather than what was drawn; `secondaryRoundHeadroom` spans cards (the 15 is a ceiling on the round), excludes the entry being edited so re-saving cannot ratchet a score down, and floors at 0 on legacy data that already breaches the cap. **Count-up chess clock**: `cumulativeTimeThrough` sums what was banked (treating an unclocked round as 0 so a gap does not break the chain) and `roundTimeFromClock` subtracts it from a reading — returning `null` for a reading that goes backwards or for junk, but `0` for a reading equal to the prior total, since a 0-second round is real. A full five-round game is round-tripped readings-in/splits-out, asserting the last reading equals the summed player total `resolvePlayerTimes` would produce; and a game breaching 15 in one round still reports its raw total on **both** sides — pinning that the caps are input ceilings, not a clamp in the maths. Ends with **`MIRROR_CASES` — 11 payloads asserted equal under `calcTotal` and the server's `computeFinalScores`**. That's the file's whole point: `game-rules.js` is a hand-maintained mirror, and this is what stops the on-screen total from disagreeing with the one that gets saved. |
| `army-list.test.js` | **`app/js/army-list.js`** | The YAAB share-code decoder, round-tripped against an in-file copy of yaab's own encoder: v2 compact tuples, enhancements and Led-By nesting, de-slugged unit ids, null `selectedPts` rendering no cost (and never `NaN`), share URLs, pre-v2 codes, raw JSON pastes, a v3 payload that still fits the tuple shape. `normaliseArmyList` keeps anything undecodable **exactly as pasted**. Plus the format-drift canary — see below. |
| `mail.test.js` | `lib/mail.js` | `isFixtureActor` — the guard that stops an integration run mailing the operator once per fixture game. Matches the suite's `zz_test_` usernames (case-insensitively) as a **prefix**, so a real player whose name merely contains the marker still gets their email; a null / missing / non-string actor mails as normal, because defaulting to "suppress" would silently drop a real notification when a creator's account has been deleted. |
| `nav-stack.test.js` | **`app/js/nav-stack.js`** | The back-button layer stack, against a hand-written `FakeHistory`: one sentinel per open, second layer pushes nothing, back closes a layer without moving the route, one layer per press, a press never closes *and* navigates, self-close consumes the sentinel, the sentinel is released only on the last layer, a route change drops every layer, a throwing teardown leaves the stack consistent. |

### Why three of these import from `app/js/`

`army-list.test.js`, `game-rules.test.js` and `nav-stack.test.js` import over
`../../app/js/…`. That is not a stray path — it is the only way to test them:

- The frontend has **no build step and no test runner of its own** (by design),
  but these three modules are dependency-free ESM that plain Node can import.
- `game-rules.js` is a *hand-maintained mirror* of `lib/game-scoring.js`. The
  mirror table is the only mechanical thing keeping the two in step; putting the
  test anywhere else would mean nothing runs it.

`scripts/test-unit.sh` mounts `app/` read-only for exactly this. Keep new
frontend tests here rather than starting a second runner.

### The YAAB format-drift canary

The last test in `army-list.test.js` reads yaab's own `js/storage.js` — from
`$YAAB_SOURCE_DIR` if set, else
`/home/stopsign002/sites/sites/yetanotherarmybuilder/app/js/storage.js` — and
asserts two anchors are still there: `EXPORT_PREFIX = 'YAAB1:'` and a `v: 2`
payload. If the sister repo isn't mounted it **skips rather than fails**; it's an
early-warning canary, not a hard dependency. `scripts/test-unit.sh` mounts the
repo when it exists, so a clean local run reports `# skipped 0`.

## Integration tests — `test/integration/`

Real HTTP, real sessions, real Postgres, real photo files on disk. 132 cases.

| File | What it pins |
|---|---|
| `_harness.js` | Not a test — the shared plumbing. See "Harness rules" below. |
| `drafts-permissions.test.js` (70) | The live tracker's whole auth matrix over HTTP: who can read (anyone, signed in or not), who gets `share_token` (owner only), PATCH scoping (owner anything / opponent seat 2 only / rando and anon nothing), merge semantics end-to-end, invite + join (self-invite, non-integer and deactivated userIds, second invite after a join, wrong token, already-claimed seat), submit and delete, photo writes, and that a submitted draft rejects everything with a 409 and stays finished even when its game row is deleted. |
| `drafts-lifecycle.test.js` (33) | The tracker end to end. **Isolation** — a scoring draft is absent from `/games`, the stats overview, faction win-rates and the war map, and creates no `games` row until submit. **Faithful hand-off into `createGame`** — the pinned 11e reference game scores 77 over HTTP, `manualWinner`, `cp_remaining`, an independently drawn/scored secondary, multiple detachments, per-round chess-clock sums, `army_list_code`, forced edition 11, season attachment. **Scars** — rounds 0/6/duplicate-3 don't surface as an opaque 500 on the CHECK/UNIQUE constraints; mid-game photos move onto the game keeping captions and exactly one cover; the Setup terrain-layout photo keeps `is_map` through the relink and re-shooting the table demotes the previous one; a draft whose game was hard-deleted stays retired; **two simultaneous submits → one 200, one 409, exactly one game**; deleting a draft takes its rows and its photo dir. **Reference-data safety** — a secondary whose card row vanished mid-game still submits by name, and an unrecognised secondary is recorded on the game without joining the mission pack. **List scores** — `GET /drafts` reports the pinned reference game as `[77, 35]` and the filed game matches it exactly; a draft with no seats yet is `[null, null]` rather than a throw. |
| `game-images.test.js` (6) | The terrain shot as a game photo. `POST /games/:id/images` accepts `isMap`, the first upload still auto-becomes the cover, re-shooting the table **demotes** the previous shot rather than colliding on the `(game_id) WHERE is_map` partial unique index — and a second game on the same layout starts with no photos, since nothing is shared between games. |
| `deleted-items.test.js` (19) | The recycle bin. Three properties: **archive is not delete** (the game leaves `games`, `/games` and the stats while the archive row and the photo files remain); **restore is faithful and lands on the original id** (rounds, secondaries with independent drawn/scored rounds, detachments, scores, photos with exactly one cover — and a game created *afterwards* gets a fresh id rather than colliding, which is the SERIAL-sequence hazard); **permanent delete is the only thing that unlinks files**. Plus the live-game side, admin-deleting-someone-else's, `canRestore false` + 409 when the id has been reoccupied, 404s for restoring a purged or already-restored entry, and 401/403/200 on all three routes. |
| `detachments-admin.test.js` (8) | The detachment library. **Promotion**: a name typed into a saved game lands in that faction's `detachments` table, case-insensitively, so a second spelling is not a second row. **Rename**: rewrites the library *and* every `player_detachments` row for the faction, and the derived `game_players.detachment_name` with it. **Merge**: renaming onto an existing name collapses a seat that held both spellings, so the display string can't read "X, X". **Refusals**: delete is 409 `in_use` while games reference the name, a case-insensitive add is 409, and all four routes are 403 for a plain user / 401 for anon. |
| `zz-residue.test.js` (3) | Runs **last** and fails the build on any leakage. See below. |

## Harness rules that will bite you

All of these were learned the hard way. `_harness.js` exports `createUser`,
`login`, `tryLogin`, `anon`, `reference`, `playablePayload`, `TINY_JPEG`,
`cleanup`, `assertNoResidue`, `closePool` and friends — use them rather than
hand-rolling a `fetch`.

- **`X-Forwarded-Proto: https` on every single request.** The session cookie is
  `Secure` and the app runs `trust proxy`, so express-session silently declines
  to set it unless `req.secure`. Caddy supplies this header in production;
  talking to the container directly, you must. Without it **login returns 200
  with no `Set-Cookie`** and every subsequent request 401s. `login()` asserts on
  the cookie's presence with exactly that hint.
- **A distinct `X-Forwarded-For` per client.** `/auth/login` is rate-limited to
  20 attempts per IP per 15 minutes and every container shares one source IP, so
  a suite creating more than 20 users starts 429-ing halfway through. The harness
  hands each client its own synthetic `10.x.x.x` and reuses it for that client's
  whole life.
- **`login()` drains the response body, and that is not cosmetic.**
  express-session flushes the headers and all but the *last byte*, then holds
  that byte until the session-store write lands. `fetch` resolves at the headers,
  so returning without `await res.text()` hands back a cookie whose session row
  is still ~100–300ms from existing in Postgres — and the next request 401s.
- **Never assert on a global count.** Other files' rows are in the same database
  at the same time. Assert on the rows you created.
- **Every row must trace back to a `zz_test_*` user**, because that is the only
  thing `cleanup()` can find. It deletes games and drafts by
  `created_by_user_id` / `owner_user_id`, their photo directories, audit rows by
  `actor_username`, banners by `player_key`, and finally the users — in that
  order, since `games.created_by_user_id` is `ON DELETE RESTRICT`.
- **Name reference-data fixtures `ZZ …`.** `resolveGameLookups` auto-inserts a
  reference row for any free-text mission / layout / rule name, so a fixture
  lands **permanently in a real mission pack**. This actually happened: eight
  invented secondary cards leaked into the live 11e pack and showed up in every
  user's draw picker. `cleanup()` sweeps `name LIKE 'ZZ %'` out of
  `primary_missions`, `deployment_maps`, `mission_rules`, `challenger_cards`
  and — since detachments started being promoted into a faction's shared library
  on save — `detachments`,
  and out of `secondary_cards` **only when nothing real still points at the row** —
  deleting a card a live draft referenced is what orphaned a real in-progress
  game. (Secondaries no longer auto-insert at all; see `lib/README.md` → "Card
  ids on the write path".)
- **`cleanup()` also clears `deleted_items`.** Archiving removes the
  `games` / `game_drafts` row while keeping the folder, so an archived fixture is
  otherwise unreachable — and `UNIQUE (kind, original_id)` would then block a
  later run archiving the same id.

## `zz-residue.test.js` — the build's last word

Named to sort last, and the suite runs serially, so it genuinely runs last. It
asserts:

1. `assertNoResidue()` — zero surviving test users, audit rows, banners,
   `deleted_items`, and zero `ZZ %` rows in any reference table **or in
   `detachments`**. That last one was added after `promoteDetachments` leaked
   three fixtures into a real faction's library with the suite still green: the
   sweep and the assertion both enumerated only the mission-pack tables. Any new
   table the server writes on a user's behalf needs adding to both.
2. The 11e pack still holds **exactly its 18 seeded secondaries**, spot-checking
   three by name so "18" can't be satisfied by 18 wrong cards.
3. No mission pack **or faction** has grown a card, mission, layout, rule or
   detachment named like a fixture.

If you add a test that creates something new, make sure `cleanup()` can reach it
and that this file would notice if it couldn't.

## Adding a test

**Unit**, when the behaviour is a pure function:

1. **Make the code under test importable from `lib/`.** If it's inline in a
   route, lift the pure part out — that's how `game-scoring.js` got created.
2. Create `test/<name>.test.js`:

   ```js
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   import { fnUnderTest } from '../lib/<name>.js';

   test('description', () => {
     assert.equal(fnUnderTest(input), expected);
   });
   ```

3. `npm test`, or `scripts/test-unit.sh` if it touches `app/`.

**Integration**, when the contract only exists over HTTP — an auth boundary, a
transaction, a photo file, anything with a `withTx` in it:

1. Create `test/integration/<name>.test.js` and import the harness.
2. Create users with `createUser()` / `login()`; never reuse a real account.
3. `before(cleanup)` / `after(closePool)`, and give every fixture a `ZZ ` name.
4. `scripts/test-live.sh <name>`, then the whole suite so `zz-residue` runs.

## Anti-patterns

- **Unit tests must not touch the DB, the network or the filesystem.** If you
  need DB-shaped data, build a fixture object. That's the line between the two
  suites, and it's why the unit run needs `--network none` and nothing else.
- Don't import from `routes/` in a unit test. Routes do too much (req/res, audit,
  broadcast). Lift the pure piece into `lib/`, or write it as an integration test.
- Don't assert on global counts, or on a row you didn't create.
- **Size-limit assertions need realistically-sized payloads.** The photo-upload
  tests passed against a 352-byte JPEG while every real photo 413'd, because the
  app-wide 256kb parser 413s before the route's own 12mb one is reached. See
  CLAUDE.md pitfall #11.
