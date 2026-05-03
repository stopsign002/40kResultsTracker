# `api/` — backend service

Express 4 + Postgres 17 service for the 40k results tracker. ESM (`"type": "module"`), Node 22, no build step. Runs as the `40k-api` container in `docker-compose.yml`; Caddy reverse-proxies `/api/*` to port 3000.

## Boot sequence (`server.js`)

1. Construct Express app + Postgres-backed session middleware (`connect-pg-simple`)
2. Apply `express-rate-limit` to `/auth/login` (20 attempts / IP / 15 min)
3. `initSchema()` — runs `db/schema.sql` then `db/seed.sql` (both idempotent — safe on every boot)
4. `ensureBootstrapAdmin()` — if `users` is empty AND `ADMIN_PASSWORD` is set, insert the admin user
5. Mount route modules: `/health`, `/auth`, `/admin`, `/games`, `/stats` (twice — once for `routes/stats.js`, once for `routes/warmap.js`), `/reference`, `/events`, `/seasons`
6. Top-level error handler emits the uniform `{ error, code? }` body
7. `app.listen(PORT)`

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
| `test/` | Smoke tests — see `test/README.md` |

## Scripts

```bash
cd api
npm install                # one-time
npm start                  # node server.js
npm test                   # node --test test/  (currently 11 cases on game-scoring)
npm run typecheck          # tsc -p tsconfig.json (no emit)
```

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

- Every route module: `export default Router()` mounted from `server.js`. Auth gating is inline (`requireAuth` / `requireAdmin` from `lib/auth.js`); `/auth` is the exception so login/logout are reachable while logged out.
- Database calls: use `pool.query` from `lib/db.js` for one-offs, `withTx(async (client) => {...})` for transactions.
- Audit + broadcast: every state-changing endpoint calls `audit(req, '<action>', { ... })` from `lib/audit.js` and `broadcast('<event>', { ... })` from `lib/events.js` to wake up SSE subscribers.
- Errors: throw with `err.status` to control HTTP status; the top-level handler shapes the JSON.

## When in doubt

- `lib/README.md` to pick a helper
- `routes/README.md` to find an endpoint
- `db/README.md` for migration patterns
- `test/README.md` to add coverage
- Repo-root `CLAUDE.md` for cross-cutting orientation
