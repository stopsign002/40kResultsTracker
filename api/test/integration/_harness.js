// Shared plumbing for the integration suite.
//
// These tests talk to a RUNNING api container over the `web` docker network and
// to the real Postgres, because most of what the live game tracker gets wrong
// is not arithmetic — it is auth boundaries, transaction behaviour, FK cascades
// and file moves, none of which a pure unit test can see.
//
// SAFETY: every row these tests create is owned by a user whose username starts
// with TEST_PREFIX, and cleanup only ever deletes rows reachable from those
// users. Nothing here touches a row it did not create. If you add a new table,
// add it to cleanup() in FK-safe order.

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcrypt';

export const BASE = process.env.TEST_API_URL || 'http://40k-api:3000';
export const UPLOADS = process.env.TEST_UPLOAD_DIR || '/uploads';
export const TEST_PREFIX = 'zz_test_';
export const PASSWORD = 'zz-test-password-1234';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// One bcrypt hash for every test user: cost 12 takes ~250ms and we make a lot
// of them.
let cachedHash = null;
async function passwordHash() {
  if (!cachedHash) cachedHash = await bcrypt.hash(PASSWORD, 12);
  return cachedHash;
}

let seq = 0;
export function uniq(label = 'u') {
  seq += 1;
  return `${TEST_PREFIX}${label}_${process.pid}_${seq}`;
}

export async function createUser({ role = 'user', active = true, label = 'u' } = {}) {
  const username = uniq(label);
  const { rows } = await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, username, display_name, role`,
    [username, username, await passwordHash(), role, active]
  );
  return rows[0];
}

// Two headers every request needs, and neither is optional:
//
// X-Forwarded-Proto — the session cookie is Secure and the app runs
//   `trust proxy`, so express-session silently declines to set it unless
//   req.secure is true. Caddy supplies this in production; talking to the
//   container directly, we must. Without it login returns 200 and NO cookie.
//
// X-Forwarded-For — /auth/login is rate-limited to 20 attempts per IP per 15
//   minutes. Every container shares one source IP, so a suite that logs in
//   more than 20 users would start 429-ing halfway through. A distinct
//   forwarded IP per client gives each its own bucket. `trust proxy: 1` makes
//   express read it.
function proxyHeaders(clientIp) {
  return { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': clientIp };
}

let ipSeq = 0;
function nextIp() {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
}

/** A client bound to one user's session cookie. */
export async function login(user) {
  const clientIp = nextIp();
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...proxyHeaders(clientIp) },
    body: JSON.stringify({ username: user.username, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `login failed for ${user.username} (${res.status})`);
  const cookie = (res.headers.getSetCookie?.() || [])
    .map((c) => c.split(';')[0]).join('; ');
  assert.ok(cookie, 'no session cookie returned — is X-Forwarded-Proto being sent?');
  // Draining the body is NOT cosmetic. express-session flushes the headers and
  // all but the LAST BYTE of the response, then holds that byte until the
  // session store write completes — so a client that reads the body is
  // guaranteed the row is durable. `fetch` resolves at the headers, so
  // returning here without reading hands back a cookie whose session row is
  // still ~100-300ms from landing in Postgres, and the very next request 401s.
  await res.text();
  return makeClient(cookie, user, clientIp);
}

/** Raw login attempt, for testing that bad credentials are refused. */
export async function tryLogin(username, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...proxyHeaders(nextIp()) },
    body: JSON.stringify({ username, password }),
  });
  await res.text(); // see login() — the last body byte gates the session write
  return res.status;
}

/** An unauthenticated client, for checking what the public can reach. */
export function anon() {
  return makeClient(null, null, nextIp());
}

function makeClient(cookie, user, clientIp) {
  async function call(method, url, body) {
    const headers = proxyHeaders(clientIp);
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, data, ok: res.ok };
  }
  return {
    user,
    get: (u) => call('GET', u),
    post: (u, b) => call('POST', u, b),
    patch: (u, b) => call('PATCH', u, b),
    put: (u, b) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
  };
}

/* ── Fixtures ─────────────────────────────────────────────────── */

export async function reference() {
  const c = anon();
  const factions = (await c.get('/reference/factions')).data;
  const packs = (await c.get('/reference/mission-packs')).data;
  const pack = packs.find((p) => p.name === '2026 - 2027 Chapter Approved') || packs[0];
  const details = (await c.get(`/reference/mission-packs/${pack.id}/details`)).data;
  return { factions, pack, details };
}

/** A payload that will pass validateDraftSubmit as-is. */
export function playablePayload({ factionId = null, p1 = 'ZZ One', p2 = 'ZZ Two' } = {}) {
  const rounds = (vals) => vals.map((v, i) => ({
    roundNumber: i + 1, primaryScore: v, secondaryScore: 0, cpRemaining: null, timeSeconds: null,
  }));
  return {
    playedAt: '2026-08-07',
    pointsLimit: 2000,
    gameFormat: 'matched',
    playMedium: 'physical',
    edition: '11',
    endCondition: 'normal',
    players: [
      { guestName: p1, factionId, detachments: [], rounds: rounds([5, 5, 5, 5, 5]), secondaries: [], challengers: [] },
      { guestName: p2, factionId, detachments: [], rounds: rounds([3, 3, 3, 3, 3]), secondaries: [], challengers: [] },
    ],
  };
}

// A real 1x1 JPEG — a fake data URL is rejected by the MIME/size checks, and a
// tiny fixture once hid a body-limit bug (see CLAUDE.md, game photos).
export const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AL+AB0FFFFAH/9k=';

export async function dirExists(p) {
  try { await fs.stat(p); return true; } catch { return false; }
}
export const draftDir = (id) => path.join(UPLOADS, 'drafts', String(id));
export const gameDir = (id) => path.join(UPLOADS, String(id));

/* ── Teardown ─────────────────────────────────────────────────── */

/**
 * Remove everything reachable from this suite's users, in FK-safe order.
 * games.created_by_user_id is ON DELETE RESTRICT, so games must go before the
 * users that created them or the delete fails.
 */
export async function cleanup() {
  const like = TEST_PREFIX + '%';

  const { rows: users } = await pool.query(
    'SELECT id FROM users WHERE username LIKE $1', [like]
  );
  const ids = users.map((u) => u.id);

  if (ids.length) {
    const { rows: games } = await pool.query(
      'SELECT id FROM games WHERE created_by_user_id = ANY($1::int[])', [ids]
    );
    for (const g of games) {
      await fs.rm(gameDir(g.id), { recursive: true, force: true }).catch(() => {});
    }
    const { rows: drafts } = await pool.query(
      'SELECT id FROM game_drafts WHERE owner_user_id = ANY($1::int[])', [ids]
    );
    for (const d of drafts) {
      await fs.rm(draftDir(d.id), { recursive: true, force: true }).catch(() => {});
    }
    await pool.query('DELETE FROM games WHERE created_by_user_id = ANY($1::int[])', [ids]);
    await pool.query('DELETE FROM game_drafts WHERE owner_user_id = ANY($1::int[])', [ids]);
  }

  // Reference rows the SERVER created on our behalf. resolveGameLookups
  // auto-inserts a secondary_cards / primary_missions / deployment_maps /
  // mission_rules row for any free-text name a submitted game carries — that is
  // deliberate (it powers "+ Card not listed"), but it means a test that
  // submits a game with an invented card name permanently adds that card to a
  // real mission pack, where every user then sees it in the draw picker.
  // Ask me how I know.
  //
  // Every fixture name in this suite starts with "ZZ " for exactly this reason.
  // Deleted only when nothing real points at them, so a name that somehow
  // collided with a genuine card can't take real games' scoring with it.
  // NEVER delete a card a live draft still points at. Doing exactly that
  // orphaned a real in-progress game: the draft's payload kept the card id,
  // player_secondaries.card_id is a FK, and the owner's submit died on a
  // constraint violation for a row they had never heard of. The server now
  // degrades a dangling id to name-only (see dropDanglingCardIds), but the
  // cleanup has no business creating the situation in the first place.
  await pool.query(`
    DELETE FROM secondary_cards sc
     WHERE sc.name LIKE 'ZZ %'
       AND NOT EXISTS (SELECT 1 FROM player_secondaries ps WHERE ps.card_id = sc.id)
       AND NOT EXISTS (
         SELECT 1 FROM game_drafts d,
                       LATERAL jsonb_array_elements(d.payload->'players') p,
                       LATERAL jsonb_array_elements(p->'secondaries') s
          WHERE (s->>'cardId')::int = sc.id)`).catch(() => {});
  for (const table of ['primary_missions', 'deployment_maps', 'mission_rules', 'challenger_cards']) {
    await pool.query(`DELETE FROM ${table} WHERE name LIKE 'ZZ %'`).catch(() => {});
  }

  // Archived items are invisible to the sweeps above: archiving DELETES the
  // games/game_drafts row (which is how cleanup finds the photo folder) while
  // deliberately keeping the folder. Left alone these leak, and
  // UNIQUE (kind, original_id) then stops a later run archiving the same id.
  const { rows: archived } = await pool.query(
    `SELECT id, kind, original_id FROM deleted_items WHERE deleted_by_name LIKE $1`, [like]
  );
  for (const row of archived) {
    const dir = row.kind === 'draft' ? draftDir(row.original_id) : gameDir(row.original_id);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  if (archived.length) {
    await pool.query('DELETE FROM deleted_items WHERE id = ANY($1::int[])',
      [archived.map((r) => r.id)]);
  }

  await pool.query('DELETE FROM audit_log WHERE actor_username LIKE $1', [like]);
  await pool.query("DELETE FROM banner_first_seen WHERE player_key LIKE 'guest:ZZ %'");
  if (ids.length) {
    await pool.query(
      "DELETE FROM banner_first_seen WHERE player_key = ANY($1::text[])",
      [ids.map((i) => `user:${i}`)]
    );
  }
  await pool.query('DELETE FROM users WHERE username LIKE $1', [like]);
}

/** Assert the suite left nothing behind. Called by the final test file. */
export async function assertNoResidue() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*) FROM users WHERE username LIKE $1) AS users,
       (SELECT count(*) FROM audit_log WHERE actor_username LIKE $1) AS audit,
       (SELECT count(*) FROM banner_first_seen WHERE player_key LIKE 'guest:ZZ %') AS banners,
       (SELECT count(*) FROM secondary_cards WHERE name LIKE 'ZZ %') AS cards,
       (SELECT count(*) FROM primary_missions WHERE name LIKE 'ZZ %') AS missions,
       (SELECT count(*) FROM deployment_maps WHERE name LIKE 'ZZ %') AS maps,
       (SELECT count(*) FROM mission_rules WHERE name LIKE 'ZZ %') AS rules,
       (SELECT count(*) FROM deleted_items WHERE deleted_by_name LIKE $1) AS archived`,
    [TEST_PREFIX + '%']
  );
  const r = rows[0];
  assert.equal(Number(r.users), 0, 'test users left behind');
  assert.equal(Number(r.audit), 0, 'test audit rows left behind');
  assert.equal(Number(r.banners), 0, 'test banner rows left behind');
  // These are the ones that are USER-VISIBLE if they leak — an invented card
  // name ends up in the live draw picker for everyone.
  assert.equal(Number(r.cards), 0, 'test secondary cards leaked into a real mission pack');
  assert.equal(Number(r.missions), 0, 'test primary missions leaked into a real mission pack');
  assert.equal(Number(r.maps), 0, 'test deployment maps leaked into a real mission pack');
  assert.equal(Number(r.rules), 0, 'test mission rules leaked into a real mission pack');
  assert.equal(Number(r.archived), 0, 'test items left behind in the deleted-items archive');
}

export async function closePool() {
  await pool.end();
}
