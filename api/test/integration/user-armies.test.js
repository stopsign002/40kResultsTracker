// PUT /auth/me/armies (the registered-army list), the armies ride-alongs on
// /auth/me, /reference/users and /stats/player/:key, and the PATCH /auth/me
// regression: a partial update must not wipe the fields it omits.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  pool, createUser, login, anon, cleanup, closePool, reference, playablePayload,
} from './_harness.js';

let factions;
let user;
let client;

before(async () => {
  await cleanup();
  ({ factions } = await reference());
  user = await createUser({ label: 'armies' });
  client = await login(user);
});

after(async () => {
  await cleanup();
  await closePool();
});

test('PUT /auth/me/armies saves an ordered list and defaults the first to primary', async () => {
  const res = await client.put('/auth/me/armies', {
    armies: [
      { factionId: factions[0].id, name: '  The Silent Host ' },
      { factionId: factions[1].id },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.armies.length, 2);
  assert.deepEqual(res.data.armies.map((a) => a.factionId), [factions[0].id, factions[1].id]);
  assert.deepEqual(res.data.armies.map((a) => a.position), [0, 1]);
  assert.equal(res.data.armies[0].name, 'The Silent Host');
  assert.equal(res.data.armies[0].isPrimary, true);
  assert.equal(res.data.armies[1].isPrimary, false);

  const me = await client.get('/auth/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.data.armies, res.data.armies);
});

test('a second PUT replaces the whole list — order, primary and old rows', async () => {
  const res = await client.put('/auth/me/armies', {
    armies: [
      { factionId: factions[1].id, name: 'Second Wave' },
      { factionId: factions[0].id, name: 'The Silent Host', isPrimary: true },
    ],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.armies.map((a) => a.factionId), [factions[1].id, factions[0].id]);
  assert.equal(res.data.armies[0].isPrimary, false);
  assert.equal(res.data.armies[1].isPrimary, true);

  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM user_armies WHERE user_id = $1', [user.id]
  );
  assert.equal(rows[0].n, 2, 'replace left extra rows behind');
});

test('two armies may share a faction', async () => {
  const res = await client.put('/auth/me/armies', {
    armies: [
      { factionId: factions[0].id, name: 'First List' },
      { factionId: factions[0].id, name: 'Second List' },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.armies.length, 2);
});

test('an unknown factionId is a 400, not a 500', async () => {
  const res = await client.put('/auth/me/armies', { armies: [{ factionId: 2147483000 }] });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'bad_faction');
});

test('two primaries are refused', async () => {
  const res = await client.put('/auth/me/armies', {
    armies: [
      { factionId: factions[0].id, isPrimary: true },
      { factionId: factions[1].id, isPrimary: true },
    ],
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'multiple_primary');
});

test('a non-array body is refused and anonymous writes are 401', async () => {
  const bad = await client.put('/auth/me/armies', { armies: 'necrons' });
  assert.equal(bad.status, 400);
  const anonRes = await anon().put('/auth/me/armies', { armies: [] });
  assert.equal(anonRes.status, 401);
});

test('anonymous /reference/users carries each user\'s armies', async () => {
  const armyless = await createUser({ label: 'armyless' });
  const res = await anon().get('/reference/users');
  assert.equal(res.status, 200);
  const mine = res.data.find((u) => u.id === user.id);
  assert.ok(mine, 'fixture user missing from /reference/users');
  assert.equal(mine.armies.length, 2);
  assert.equal(mine.armies[0].name, 'First List');
  const bare = res.data.find((u) => u.id === armyless.id);
  assert.deepEqual(bare.armies, [], 'an army-less user should carry an empty list');
});

test('the player profile carries armies for a user: key', async () => {
  // The key only resolves once the user has appeared in a game; the fixture
  // name links via resolvePlayerIdentities at save time.
  const created = await client.post('/games', playablePayload({ p1: user.display_name }));
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const res = await anon().get(`/stats/player/${encodeURIComponent(`user:${user.id}`)}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.armies.length, 2);
  assert.deepEqual(res.data.armies.map((a) => a.name), ['First List', 'Second List']);
});

test('PUT [] clears the list', async () => {
  const res = await client.put('/auth/me/armies', { armies: [] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.armies, []);
});

test('PATCH /auth/me leaves omitted fields alone and \'\' clears armyName', async () => {
  const set = await client.patch('/auth/me', { armyName: 'The Eternal Crusade' });
  assert.equal(set.status, 200);
  assert.equal(set.data.armyName, 'The Eternal Crusade');

  // The regression: toggling the photo prompt used to wipe army_name to NULL.
  const toggle = await client.patch('/auth/me', { promptRoundPhoto: false });
  assert.equal(toggle.status, 200);
  assert.equal(toggle.data.promptRoundPhoto, false);
  assert.equal(toggle.data.armyName, 'The Eternal Crusade', 'partial PATCH wiped armyName');

  const empty = await client.patch('/auth/me', {});
  assert.equal(empty.status, 200);
  assert.equal(empty.data.armyName, 'The Eternal Crusade');

  const clearRes = await client.patch('/auth/me', { armyName: '' });
  assert.equal(clearRes.status, 200);
  assert.equal(clearRes.data.armyName, null);
});
