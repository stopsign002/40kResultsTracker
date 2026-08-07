# `api/routes/` — Express route modules

Each file exports a `Router()` mounted from `api/server.js`. The full endpoint catalogue with payloads lives in repo-root `CLAUDE.md` "HTTP API reference"; this page is the navigator.

## Modules at a glance

| File | Mounted at | Auth gate | What it serves |
|---|---|---|---|
| `auth.js` | `/auth` | **per-route** (login/logout reachable while logged out) | login, logout, me, PATCH me (self-serve `army_name`), change-password |
| `admin.js` | `/admin` | `requireAdmin` (top-level) | user CRUD, game visibility toggle, game hard-delete, audit log viewer, guest-account preview + promotion |
| `games.js` | `/games` | `requireAuth` (top-level) | list (with filters + free-text `q`), get, create, update. **HEAVIEST file**: contains `insertPlayerChildren`, `resolvePlayerIdentities`, `recordBannerFirstSeen` |
| `images.js` | `/games` (mounted **before** `games.js`) + `/maps` via the named `mapRouter` export | reads public, writes `requireAuth` | game photos (list/upload/flag/delete) and terrain-layout pictures. Bytes go to `UPLOAD_DIR` on disk and are served **by Caddy**, not by Node. Also exports `removeGameImageFiles(gameId)`, which `admin.js` calls on hard-delete because `ON DELETE CASCADE` removes rows but not files. |
| `stats.js` | `/stats` | `requireAuth` | overview, faction/player win rates, mission/deployment breakdowns, matchups, head-to-head, first-turn impact, secondary averages, detachment win rates, trends, calendar, per-player profile |
| `warmap.js` | `/stats` (second mount) | `requireAuth` | single endpoint `/stats/warmap` — banners feed for the Theatre of War |
| `reference.js` | `/reference` | `requireAuth` | factions, per-faction detachments (UNION of seeded + free-text from past games), mission packs, mission details, users, distinct player names |
| `events.js` | `/events` | `requireAuth` | SSE long-poll. Heartbeat every 25s; emits `game.saved`, `season.changed` |
| `seasons.js` | `/seasons` | mixed (`GET` auth, `POST` admin) | list seasons, start a new season (closes current, generates new map seed) |
| `drafts.js` | `/drafts` | **per-route** (`GET /:id` also accepts `?token=`) | **live game tracker** — in-progress games ("drafts") in their own `game_drafts` table. Create / list / autosave-PATCH / invite / join / submit / delete plus mid-game photos under `UPLOAD_DIR/drafts/<id>/`. A draft is NOT a result: it never reaches `/games`, `/stats`, `/ratings` or the war map until `POST /:id/submit` runs it through `lib/game-write.js#createGame` (11e only) and moves its photos onto the new game. |
| `ratings.js` | `/ratings` | `requireAdmin` (top-level) | **admin-only** Glicko-2 player ranking: leaderboard, balanced matchmaking (`/suggest`), per-player rating history. Computed on the fly via `lib/ratings.js`; no tables. |

## Quirks worth knowing

- **`auth.js` skips `router.use(requireAuth)`** because login and logout must work while logged out. Each route inside applies `requireAuth` inline where needed.
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

## Conventions for new routes

```js
import { Router } from 'express';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';

const router = Router();
router.use(requireAuth);   // or requireAdmin

router.get('/foo', async (req, res) => {
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

Then mount in `server.js`:

```js
import fooRoutes from './routes/foo.js';
app.use('/foo', fooRoutes);
```

Add a row to the HTTP API reference table in CLAUDE.md and update the endpoint count at the bottom:

```bash
grep -hE "(router|mapRouter)\.(get|post|put|patch|delete)\(" api/routes/*.js | wc -l
```

The `mapRouter` alternative matters — `images.js` exports a second router that
`server.js` mounts at `/maps`, and a pattern matching only `router.` misses it.

## When in doubt

- For "where does endpoint X live": grep for the path here.
- For "how do I write a new endpoint": copy the closest sibling.
- For payload shapes: CLAUDE.md HTTP API reference + `api/types.js` JSDoc typedefs.
- For request/response audit trail: `audit_log` table (admin → Audit Log panel).
