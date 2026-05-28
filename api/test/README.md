# `api/test/` — smoke tests

Pure-JS tests using Node's built-in `node:test` runner. **No DB access** — tests cover the helpers extracted into `api/lib/` and import them directly. (`lib/ratings.js` imports `db.js` lazily so its pure helpers stay testable without `pg`.)

## Running

```bash
cd api
npm test                              # node --test test/*.test.js
node --test test/game-scoring.test.js # single file
```

19 cases currently pass (run `npm test` to confirm). Note the npm script globs `test/*.test.js` — `node --test test/` (bare directory) is not expanded by newer Node and errors with "Cannot find module '/app/test'".

## What's covered

| File | Module under test | Cases |
|---|---|---|
| `game-scoring.test.js` | `lib/game-scoring.js` | `computeFinalScores`: zero-zero → draw, primary roll-up, **secondaries fold in via cards (NOT `r.secondaryScore`)** ← the camelCase regression test, finalScore clamps to 100, `manualWinner` overrides higher score, both `manualWinner` → draw. `validateGameInput`: rejects missing playedAt / pointsLimit / wrong player count / players with neither userId nor guestName; happy path doesn't throw. |
| `glicko2.test.js` | `lib/glicko2.js` | **Pins Glickman's worked example** (1500/200 vs three opponents → 1464.06 / 151.52 / 0.05999). Idle-period RD inflation + 350 ceiling, empty-results decay, `expectedScore` symmetry + uncertainty pulling toward 50/50. |
| `ratings.test.js` | `lib/ratings.js` (pure parts) | `outcomeScore` W/L/D + margin-of-victory direction/magnitude; `displayRating` 1500→500 mapping + 0–1000 clamp; `balancedPairings` pairs closest ratings (not best-vs-worst) and handles odd counts with a sit-out. |

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
