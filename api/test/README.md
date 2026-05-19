# `api/test/` — smoke tests

Pure-JS tests using Node's built-in `node:test` runner. **No DB access** — tests cover the helpers extracted into `api/lib/` and import them directly.

## Running

```bash
cd api
npm test                              # node --test test/
node --test test/game-scoring.test.js # single file
```

11 cases currently pass (run `npm test` to confirm).

## What's covered

| File | Module under test | Cases |
|---|---|---|
| `game-scoring.test.js` | `lib/game-scoring.js` | `computeFinalScores`: zero-zero → draw, primary roll-up, **secondaries fold in via cards (NOT `r.secondaryScore`)** ← the camelCase regression test, finalScore clamps to 100, `manualWinner` overrides higher score, both `manualWinner` → draw. `validateGameInput`: rejects missing playedAt / pointsLimit / wrong player count / players with neither userId nor guestName; happy path doesn't throw. |

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
