# `api/routes/` — Express route modules

Each file exports a `Router()` mounted from `api/server.js`. The full endpoint catalogue with payloads lives in repo-root `CLAUDE.md` "HTTP API reference"; this page is the navigator.

## Modules at a glance

| File | Mounted at | Auth gate | What it serves |
|---|---|---|---|
| `auth.js` | `/auth` | **per-route** (login/logout reachable while logged out) | login, logout, me, PATCH me (self-serve `army_name`), change-password |
| `admin.js` | `/admin` | `requireAdmin` (top-level) | user CRUD, game visibility toggle, game hard-delete, audit log viewer |
| `games.js` | `/games` | `requireAuth` (top-level) | list (with filters + free-text `q`), get, create, update. **HEAVIEST file**: contains `insertPlayerChildren`, `resolvePlayerIdentities`, `recordBannerFirstSeen` |
| `stats.js` | `/stats` | `requireAuth` | overview, faction/player win rates, mission/deployment breakdowns, matchups, head-to-head, first-turn impact, secondary averages, detachment win rates, trends, calendar, per-player profile |
| `warmap.js` | `/stats` (second mount) | `requireAuth` | single endpoint `/stats/warmap` — banners feed for the Theatre of War |
| `reference.js` | `/reference` | `requireAuth` | factions, per-faction detachments (UNION of seeded + free-text from past games), mission packs, mission details, users, distinct player names |
| `events.js` | `/events` | `requireAuth` | SSE long-poll. Heartbeat every 25s; emits `game.saved`, `season.changed` |
| `seasons.js` | `/seasons` | mixed (`GET` auth, `POST` admin) | list seasons, start a new season (closes current, generates new map seed) |

## Quirks worth knowing

- **`auth.js` skips `router.use(requireAuth)`** because login and logout must work while logged out. Each route inside applies `requireAuth` inline where needed.
- **`/stats` is mounted twice** — once for `stats.js`, once for `warmap.js`. They share a prefix without collision because the paths inside don't overlap.
- **SSE buffering**: `events.js` sets `X-Accel-Buffering: no` and `caddy.example` gives the `/api/events` handler `flush_interval -1`. Don't put `encode gzip` on the SSE handler — it would buffer the stream.
- **Rate limiting** lives in `server.js` (not in `auth.js`) so it applies before the route handler.

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

Add a row to the HTTP API reference table in CLAUDE.md and update the endpoint count at the bottom (`grep -E "router\.(get|post|put|patch|delete)" api/routes/*.js | wc -l`).

## When in doubt

- For "where does endpoint X live": grep for the path here.
- For "how do I write a new endpoint": copy the closest sibling.
- For payload shapes: CLAUDE.md HTTP API reference + `api/types.js` JSDoc typedefs.
- For request/response audit trail: `audit_log` table (admin → Audit Log panel).
