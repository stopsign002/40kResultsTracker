# `api/routes/` — Express route modules

Each file exports a `Router()` mounted from `api/server.js`, always through
`catchAsync(...)`. The full endpoint catalogue with payloads lives in repo-root
`CLAUDE.md` "HTTP API reference"; this page is the navigator.

## Modules at a glance

**Only two modules have a top-level gate** — `admin.js` and `ratings.js`, both
`router.use(requireAdmin)`. Everything else is per-route or ungated. Reads are
public by design across most of the API; adding a blanket `router.use(requireAuth)`
to a read module silently takes the site private.

| File | Mounted at | Auth gate | What it serves |
|---|---|---|---|
| `auth.js` | `/auth` | **per-route** (login/logout/`GET /me` reachable while logged out; `GET /me` self-checks the session and 401s) | login, logout, me, PATCH me (self-serve `army_name` + `promptRoundPhoto`), change-password |
| `admin.js` | `/admin` | `requireAdmin` (**top-level**) | user CRUD, game visibility toggle, game delete (**archives**), the **recycle bin** (`/deleted*`), audit log viewer, guest-account preview + promotion |
| `games.js` | `/games` | **none top-level** — `GET /`, `GET /:id` public; `POST /`, `PUT /:id` inline `requireAuth` | list (with filters + free-text `q`), get, create, update. The write helpers live in `lib/game-write.js`; this file keeps the filter SQL and `PUT`'s delete-then-reinsert body. Still has **no DELETE** — hard delete is the admin escape hatch |
| `images.js` | `/games` (mounted **before** `games.js`) + `/maps` via the named `mapRouter` export | per-route: `GET /:gameId/images` public, writes `requireAuth` | game photos (list/upload/flag/delete) and terrain-layout pictures. Bytes go to `UPLOAD_DIR` on disk and are served **by Caddy**, not by Node. Also exports `removeGameImageFiles(gameId)` — now called from `lib/archive.js#removeArchivedFiles`, i.e. only on a **permanent** delete |
| `stats.js` | `/stats` | **none — every route is public** | overview, faction/player win rates, mission/deployment breakdowns, matchups, head-to-head, first-turn impact, secondary averages, detachment win rates, trends, calendar, per-player profile |
| `warmap.js` | `/stats` (second mount) | **none — public** | two endpoints: `/stats/warmap` (banners feed for the Theatre of War) and `/stats/warmap-timeline` (the game list its time slider scrubs) |
| `reference.js` | `/reference` | **none — public** | factions, per-faction detachments (UNION of seeded + free-text from past games), mission packs, mission details, users, unified player picker, distinct player names |
| `events.js` | `/events` | **none — public and unfiltered** | SSE long-poll. Heartbeat every 25s; emits `game.saved`, `season.changed`, `draft.updated` |
| `seasons.js` | `/seasons` | mixed (`GET` **public**, `POST` inline `requireAdmin`) | list seasons, start a new season (closes current, generates new map seed) |
| `drafts.js` | `/drafts` | **per-route + seat-scoped**; the three GETs are public | **live game tracker** — in-progress games ("drafts") in their own `game_drafts` table. Create / list / read / autosave-PATCH / invite / join / submit / delete plus mid-game photos under `UPLOAD_DIR/drafts/<id>/`. A draft is NOT a result: it never reaches `/games`, `/stats`, `/ratings` or the war map until `POST /:id/submit` runs it through `lib/game-write.js#createGame` (11e only) and moves its photos onto the new game |
| `ratings.js` | `/ratings` | `requireAdmin` (**top-level**) | **admin-only** player ranking (WHR default, Glicko-2 optional): leaderboard, balanced matchmaking (`/suggest`), per-player rating history. Computed on the fly via `lib/ratings.js`; no tables |

Note the mount order in `server.js`: `/reference` sits **between** the two
`/stats` mounts, and `images.js` is mounted on `/games` **before** `games.js` so
`/games/:id/images` isn't swallowed by `games.js`'s `GET /:id`.

## The two modules that changed shape

### `drafts.js` — spectating, and archive-on-delete

- **`GET /`, `GET /:id`, `GET /:id/images` are public.** `GET /` returns
  **everyone's** in-progress games (`WHERE d.submitted_at IS NULL`), each row
  carrying `owner_name` / `opponent_name` / `viewerSeat` / `isOwner`, ordered
  yours-first then newest `updated_at`. A game nobody can find is a game nobody
  can watch. `share_token` is still echoed **to the owner only** — it is the
  credential for *claiming* the second seat, not for reading.
- **`DELETE /:id` is owner or admin, and archives.** `withTx((client) =>
  archiveDraft(client, id, req))`. It deliberately **leaves
  `UPLOAD_DIR/drafts/<id>/` on disk** so a restore keeps its photos; only
  `DELETE /admin/deleted/:id` unlinks.
- **`notifyGameStarted(id)`** fires once when a draft first leaves setup —
  detected inside the PATCH transaction as `current_step === 'setup'` → a
  `round*` step, with `started_notified_at IS NULL`. The mail is claimed with
  `UPDATE … SET started_notified_at = NOW() WHERE id = $1 AND started_notified_at
  IS NULL RETURNING …`, so two phones racing can't double-send. Called after the
  response, wrapped in try/catch — a mailer outage must not fail an autosave.
- **Lifecycle keys off `submitted_at`, never `submitted_game_id`.** All four
  checks (`GET /`, PATCH 409, submit 409, photo-upload 409) read `submitted_at`.
  `submitted_game_id` is `ON DELETE SET NULL`, so hard-deleting the resulting game
  used to null it and **resurrect a finished draft into the live list**. The
  pointer is now for navigation only and may legitimately be NULL.
- **Every state transition takes `SELECT … FOR UPDATE` inside `withTx`** — PATCH,
  join, invite and **submit**. Submit had to join them: reading the row outside
  the transaction let two simultaneous taps both pass the already-submitted check
  and create two games. Pinned by an integration test that fires two concurrent
  submits and asserts one 200, one 409, one `games` row.

### `admin.js` — the recycle bin

- `GET /deleted` lists `deleted_items` newest-first with a computed `canRestore`
  (a `CASE d.kind` `NOT EXISTS` check that the original id hasn't been reoccupied).
- `POST /deleted/:id/restore` → `restoreItem` inside `withTx`; returns
  `{ ok, kind, restoredId, repaired }`, audits `deleted.restore`, and broadcasts
  `game.saved` or `draft.updated` so open clients notice.
- `DELETE /deleted/:id` is the permanent one — `purgeItem` inside `withTx`, then
  `removeArchivedFiles(purged)` **after the commit**. This is the only path in
  the whole API that unlinks photo bytes.
- `DELETE /games/:id` now calls `archiveGame` and **does not** call
  `removeGameImageFiles` — that would destroy the photos of a game still sitting
  in the bin.
- `PATCH /users/:id` audits a **redacted** body:
  `const { password: _password, ...audited } = req.body || {};` plus
  `passwordChanged: true`. It previously logged the raw body, which put plaintext
  passwords into `audit_log` — rendered by the admin panel and shipped off-site by
  `pg_dumpall`.

## Quirks worth knowing

- **Every router is mounted through `catchAsync(...)`, and it is not optional.**
  Express 4 doesn't await handlers and Node 22 exits on an unhandled rejection, so
  before the wrapper landed a rejected handler **killed the container** —
  remotely, unauthenticated. A new router mounted bare re-opens that. See
  `lib/README.md` → "Async handlers and the process guard".
- **Parse ids with `idParam` / `intParam` from `lib/params.js`, never `parseInt`.**
  `GET /games/abc` → `NaN` → Postgres 22P02; a 20-digit id → 22003. Both are 400s
  about a malformed request, not 500s. Eight of the eleven modules already import
  it; match them.
- **Don't put `e.message` in an error response.** `games.js` used to return the
  raw pg `detail`, which is the failing query and its bound parameters. The
  top-level handler already returns `'internal error'` for 5xx — let it.
- **`auth.js` skips `router.use(requireAuth)`** because login and logout must work while logged out. Each route inside applies `requireAuth` inline where needed. Login also **type-checks** `username` and `password` (`typeof … !== 'string'` → 400): a non-string reached `bcrypt.compare`, which rejects, which used to take the process down. `last_login_at` is stamped fire-and-forget on success only, so a returning user on a live 30-day cookie doesn't refresh it.
- **`/stats` is mounted twice** — once for `stats.js`, once for `warmap.js`. They share a prefix without collision because the paths inside don't overlap.
- **SSE buffering**: `events.js` sets `X-Accel-Buffering: no` and `caddy.example` gives the `/api/events` handler `flush_interval -1`. Don't put `encode gzip` on the SSE handler — it would buffer the stream.
- **Rate limiting** lives in `server.js` (not in `auth.js`) so it applies before the route handler.
- **Body-size limits are set in `server.js`, and order matters.** The app-wide
  `express.json({ limit: '256kb' })` runs *before* the routers, so a route-level
  parser with a larger limit is dead code — the global one 413s first. Upload
  paths are therefore matched by `IMAGE_UPLOAD_PATH` and skipped by the global
  parser so they can parse themselves at 12mb. If you add another upload
  endpoint, add it to that pattern or it will silently reject anything over
  256kb. See CLAUDE.md "Game photos → Body limits".
- **`drafts.js` writes are scoped, not just authenticated.** The draft *owner*
  may patch anything; an invited *opponent* may patch only `patch.players["1"]`
  — see `lib/README.md` "The draft patch shape". `PATCH /drafts/:id` takes a
  `SELECT … FOR UPDATE` inside `withTx` so two phones autosaving at once
  serialise instead of clobbering each other.
- **`draft.updated` SSE events carry no draft content.** `GET /events` is public
  and unfiltered, so the payload is only `{ id, rev, by }` — enough for the other
  phone to decide to re-read, and useless to an eavesdropper.
- **`games.js` reads are public.** The comment at the top of the file is the
  authority, not the auth table in older docs: unauthenticated visitors can
  browse games and photos; only writes call `requireAuth` inline.
- **Destructive routes archive; they don't purge.** `DELETE /admin/games/:id` and
  `DELETE /drafts/:id` both hand off to `lib/archive.js`. If you add a third
  deletion path, archive from it too — and don't unlink files from it.

## Conventions for new routes

The template below is for a module that **should** be gated. Most aren't — check
the table above before copying the `router.use` line.

```js
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';
import { idParam } from '../lib/params.js';

const router = Router();
router.use(requireAuth);   // or requireAdmin — omit entirely for a public read module

router.get('/foo/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad foo id' });
  // pool.query / withTx for DB work
});

router.post('/foo', async (req, res) => {
  // ... do the work ...
  await audit(req, 'foo.create', { type: 'foo', id: newId });
  broadcast('foo.changed', { id: newId });
  res.json({ ok: true });
});

export default router;
```

Then mount in `server.js` — **through `catchAsync`**:

```js
import fooRoutes from './routes/foo.js';
app.use('/foo', catchAsync(fooRoutes));
```

Add a row to the HTTP API reference table in CLAUDE.md and update the endpoint count at the bottom:

```bash
grep -hE "(router|mapRouter)\.(get|post|put|patch|delete)\(" api/routes/*.js | wc -l
```

The `mapRouter` alternative matters — `images.js` exports a second router that
`server.js` mounts at `/maps`, and a pattern matching only `router.` misses it.
The count is currently **66** in `routes/*.js` (admin 11, auth 5, drafts 12,
events 1, games 4, images 6, ratings 3, reference 7, seasons 2, stats 13,
warmap 2), plus `/health` defined inline in `server.js`.

If the new route changes an auth boundary or the draft lifecycle, add a case to
`api/test/integration/` — `drafts-permissions.test.js` is the permission matrix
and will not notice a new hole on its own. See `test/README.md`.

## When in doubt

- For "where does endpoint X live": grep for the path here.
- For "how do I write a new endpoint": copy the closest sibling.
- For payload shapes: CLAUDE.md HTTP API reference + `api/types.js` JSDoc typedefs.
- For request/response audit trail: `audit_log` table (admin → Audit Log panel).
