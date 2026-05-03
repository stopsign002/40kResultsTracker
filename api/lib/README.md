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

## Notable absence

There is no `adopt-guest.js` helper. The "user created after their first guest game" case is handled manually — see CLAUDE.md pitfall #8 for the workaround. If this becomes a frequent operation, this directory is where the helper would land.
