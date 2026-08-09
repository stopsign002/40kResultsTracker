# `api/` — backend service

Express 4 + Postgres 17 service for the 40k results tracker. ESM (`"type": "module"`), Node 22, no build step. Runs as the `40k-api` container in `docker-compose.yml`; Caddy reverse-proxies `/api/*` to port 3000.

## Boot sequence (`server.js`)

1. `installRejectionGuard()` — **first statement in the file**, before the app exists. Node 22 exits the process on an unhandled rejection or uncaught exception; this turns both into a log line. See `lib/README.md` → "Async handlers and the process guard".
2. Construct Express app + the split body parser (`express.json({ limit: '256kb' })` app-wide, skipped for POSTs matching `IMAGE_UPLOAD_PATH`) + Postgres-backed session middleware (`connect-pg-simple`, table `session`, cookie `tg40k.sid`). `app.set('trust proxy', 1)` — Caddy is in front.
3. `GET /health` inline, then `express-rate-limit` on `/auth/login` (20 attempts / IP / 15 min)
4. Mount every route module **through `catchAsync(...)`**, in this order:
   `/auth`, `/admin`, `/games` (`images.js`), `/games` (`games.js`), `/stats` (`stats.js`), `/reference`, `/stats` (`warmap.js`), `/events`, `/seasons`, `/ratings`, `/drafts`
5. Top-level error handler emits the uniform `{ error, code? }` body; 413 / `entity.too.large` is rewritten to a human message with `code: 'too_large'`
6. `initSchema()` — runs `db/schema.sql` then `db/seed.sql` (both idempotent — safe on every boot). A failure here `process.exit(1)`s rather than serving a half-built DB
7. `ensureBootstrapAdmin()` — if `users` is empty AND `ADMIN_PASSWORD` is set, insert the admin user
8. `app.listen(PORT)`

Steps 6–7 run **after** the routes are wired, inside the trailing async IIFE — the
mounting is synchronous, the DB work is not.

**A new router must be mounted through `catchAsync(...)`.** Express 4 doesn't
await handlers, so an unwrapped async route that rejects is an unhandled
rejection, and before the guard landed that killed the container — remotely,
unauthenticated, via `POST /auth/login` with a non-string password.

## Layout

| Path | What |
|---|---|
| `server.js` | Entry point; the boot sequence above |
| `package.json` | Deps: `express`, `pg`, `bcrypt`, `express-session`, `connect-pg-simple`, `express-rate-limit` |
| `Dockerfile` | `node:22-alpine`, `npm install --omit=dev`, `node server.js` |
| `tsconfig.json` | Editor / `npm run typecheck` only — `noEmit`, `allowJs+checkJs` |
| `types.js` | Shared JSDoc typedefs (`PlayerPayload`, `GamePayload`, `BannerUnit`, etc.) |
| `lib/` | Helpers — see `lib/README.md` |
| `routes/` | Route modules — see `routes/README.md` |
| `db/` | Schema + seed — see `db/README.md` |
| `test/` | Unit tests + `test/integration/` HTTP suite — see `test/README.md` |

## Scripts

```bash
cd api
npm install                # one-time
npm start                  # node server.js
npm test                   # node --test test/*.test.js  (156 unit cases, no DB, <2s)
npm run typecheck          # tsc -p tsconfig.json (no emit)
```

From the **repo root** (both run in a `node:22-alpine` container, so nothing has
to be installed on the host):

```bash
scripts/test-unit.sh                    # the 156 unit cases, --network none
scripts/test-live.sh                    # the 122 integration cases, against the LIVE api + DB
scripts/test-live.sh drafts-lifecycle   # one integration file
```

`npm test` covers `test/*.test.js` only — it never reaches `test/integration/`,
which needs the `web` network and a real Postgres. Note the glob: `node --test
test/` (a bare directory) is resolved as a *module* and dies with
`MODULE_NOT_FOUND`, so every runner globs `*.test.js` through a shell.

## Environment variables

Set in `.env` at repo root (see `.env.example`):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `postgres://40k_user:…@postgres:5432/40k_db` |
| `SESSION_SECRET` | session cookie signing key |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | only honoured when `users` is empty (bootstrap) |
| `PORT` | defaults to 3000 |
| `NODE_ENV` | `production` enables secure cookies |

## Conventions

- Every route module: `export default Router()` mounted from `server.js` **through `catchAsync(...)`**. Auth gating is per-route or top-level depending on the module — reads are public on most of them, so check `routes/README.md` before adding a `router.use(requireAuth)`.
- Database calls: use `pool.query` from `lib/db.js` for one-offs, `withTx(async (client) => {...})` for transactions.
- **Never `parseInt` a path param or a query limit.** Use `idParam` / `intParam` from `lib/params.js`. `parseInt('abc')` is `NaN` and `parseInt('1e20'.repeat…)` overflows a Postgres `integer`; the driver binds both happily and PG throws 22P02 / 22003. A malformed request is a 400, not a 500.
- Audit + broadcast: every state-changing endpoint calls `audit(req, '<action>', { ... })` from `lib/audit.js` and `broadcast('<event>', { ... })` from `lib/events.js` to wake up SSE subscribers. **Don't put a raw request body in the audit payload** — `PATCH /admin/users/:id` once wrote plaintext passwords into `audit_log`, which the admin panel renders and `pg_dumpall` ships off-site.
- Errors: throw with `err.status` to control HTTP status; the top-level handler shapes the JSON. It returns `'internal error'` for any 5xx — don't leak `e.message` (which for a pg error is the query and its parameters).
- Destructive endpoints archive, they don't purge. `DELETE /admin/games/:id` and `DELETE /drafts/:id` go through `lib/archive.js` into `deleted_items`; only `DELETE /admin/deleted/:id` unlinks bytes.

## When in doubt

- `lib/README.md` to pick a helper
- `routes/README.md` to find an endpoint
- `db/README.md` for migration patterns
- `test/README.md` to add coverage
- Repo-root `CLAUDE.md` for cross-cutting orientation
