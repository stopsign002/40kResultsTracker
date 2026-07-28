# `api/test/` — smoke tests

Pure-JS tests using Node's built-in `node:test` runner. **No DB access** — tests cover the helpers extracted into `api/lib/` and import them directly. (`lib/ratings.js` imports `db.js` lazily so its pure helpers stay testable without `pg`.)

## Running

```bash
cd api
npm test                              # node --test test/*.test.js
node --test test/game-scoring.test.js # single file
```

55 cases currently pass (run `npm test` to confirm). Note the npm script globs `test/*.test.js` — `node --test test/` (bare directory) is not expanded by newer Node and errors with "Cannot find module '/app/test'".

## What's covered

| File | Module under test | Cases |
|---|---|---|
| `game-scoring.test.js` | `lib/game-scoring.js` | **10e** `computeFinalScores`: zero-zero → draw, primary roll-up, **secondaries fold in via cards (NOT `r.secondaryScore`)** ← the camelCase regression test, finalScore clamps to 100, `manualWinner` overrides higher score, both `manualWinner` → draw. **11e**: reproduces the reference game (rounds 4/8/11/8/15 = 46 raw → clipped to 45, secondaries 32, **final 77**), each half caps independently with no cross-subsidy, challengers ignored, a held card scores on its *scored* round not its draw round. **Detail ladder**: per-round totals count when no cards exist and survive an edit round-trip; cards outrank a stale typed total; a bare final score is kept and clamped (90/100); a lone round figure outranks a submitted total; an empty game is still 0-0 draw; junk → 0, not NaN. **Times** (`resolvePlayerTimes`): per-round sums, partial clocks, per-round beating a stale total, typed total standing alone, unclocked staying `null` (not 0), junk/negatives discarded. `validateGameInput`: rejects missing playedAt / pointsLimit / wrong player count / players with neither userId nor guestName; happy path doesn't throw. |
| `glicko2.test.js` | `lib/glicko2.js` | **Pins Glickman's worked example** (1500/200 vs three opponents → 1464.06 / 151.52 / 0.05999). Idle-period RD inflation + 350 ceiling, empty-results decay, `expectedScore` symmetry + uncertainty pulling toward 50/50. |
| `ratings.test.js` | `lib/ratings.js` (pure parts) | `outcomeScore` W/L/D + margin-of-victory direction/magnitude; `displayRating` 1500→500 mapping + 0–1000 clamp; `balancedPairings` pairs closest ratings (not best-vs-worst) and handles odd counts with a sit-out. |
| `whr.test.js` | `lib/whr.js` | Whole-history `fitGlobal`: transitive ordering (A>B>C from A-beat-B, B-beat-C); undefeated player stays finite (prior); symmetric results → centre; more games → lower RD; margin-of-victory moves the estimate more than a draw. **Recency weight**: heavier (recent) result leans the rating; omitting `w` == `w=1` (regression); down-weighted games → higher RD. |

## Not covered here, and how it *is* covered

The frontend has no test runner (no build step, by design), and there are no
HTTP-level tests. Two things fill that gap during development, and both caught
real bugs this cycle — use them for anything touching schema, uploads or SQL:

- **A throwaway DB + API container**, built from an empty database. This is the
  only thing that catches a migration placed above its own `CREATE TABLE`
  (see `db/README.md`), because the live DB already has every table.
- **Realistically-sized fixtures.** The photo-upload tests passed against a
  352-byte JPEG while every real photo 413'd. Anything asserting on a size limit
  needs a payload of a plausible size.

`app/js/zip.js` is dependency-free and importable in plain Node, so it can be
exercised directly against archives built with python's `zipfile` — that's how
the STORED/DEFLATE, nested-path, trailing-comment and junk-entry cases were
verified.

## Why this scope

The codebase has friend-group scale and no CI gating. The point of these tests is to **lock in the specific contract that has caused real production bugs** — primarily the camelCase / snake_case payload boundary (CLAUDE.md pitfall #1). They run in <100ms and catch the entire bug class.

End-to-end HTTP tests (login → save → fetch round-trip) would need a test DB and Docker setup; deferred.

## Adding a test

1. **Make the code under test importable from `lib/`.** If it's currently inline in a route, lift the pure parts out — that's how `game-scoring.js` got created.
2. Create `test/<name>.test.js`:

   ```js
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   import { fnUnderTest } from '../lib/<name>.js';

   test('description', () => {
     assert.equal(fnUnderTest(input), expected);
   });
   ```

3. Run `npm test` to confirm. The runner auto-discovers any `*.test.js` under `test/`.

## Anti-patterns

- Don't touch the live DB. If you need DB-shaped data, build a fixture object in the test file.
- Don't import from `routes/`. Routes do too much (req/res, audit, broadcast). Lift the pure piece into `lib/` and test that.
- Don't add network or filesystem dependencies. Keep it Node-built-in.
