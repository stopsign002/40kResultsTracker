// Admin → Detachments: promotion at save time, and the rename/merge that fixes
// a typo across the library AND every game that carried it.
//
// Everything here is named with the suite's `ZZ ` prefix so cleanup() and
// zz-residue.test.js can find it — promoteDetachments writes into a real
// faction's shared library, which is exactly the leak those two guard.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser, login, anon, reference, playablePayload, cleanup, closePool, pool, uniq,
} from './_harness.js';

let admin, user, factionId;
const label = (s) => `ZZ ${s} ${uniq('d')}`;

async function saveGameWith(detachments) {
  const body = playablePayload({ factionId });
  body.players[0].detachments = detachments;
  const res = await user.post('/games', body);
  assert.equal(res.status, 200, `game save failed: ${JSON.stringify(res.data)}`);
  return res.data.id;
}

async function libraryRows(name) {
  const { rows } = await pool.query(
    'SELECT name FROM detachments WHERE faction_id = $1 AND LOWER(name) = LOWER($2) ORDER BY name',
    [factionId, name]
  );
  return rows.map((r) => r.name);
}

async function seatDetachments(gameId) {
  const res = await anon().get(`/games/${gameId}`);
  assert.equal(res.status, 200);
  const seat = res.data.players.find((p) => (p.detachments || []).length);
  return seat || {};
}

test('setup', async () => {
  admin = await login(await createUser({ role: 'admin', label: 'detadm' }));
  user = await login(await createUser({ label: 'detusr' }));
  factionId = (await reference()).factions[0].id;
});

test('a detachment typed into a game joins its faction library', async () => {
  const name = label('Promoted');
  await saveGameWith([name]);

  assert.deepEqual(await libraryRows(name), [name],
    'the typed detachment should have been promoted into the library');

  const listed = await admin.get(`/admin/detachments?factionId=${factionId}`);
  assert.equal(listed.status, 200);
  const row = listed.data.find((r) => r.name === name);
  assert.ok(row, 'it should appear in the admin listing');
  assert.equal(row.inLibrary, true);
  assert.ok(row.games >= 1, 'and report the game that used it');
});

test('promotion is case-insensitive — a second spelling is not a second row', async () => {
  const name = label('Case');
  for (const spelling of [name, name.toLowerCase(), name.toUpperCase()]) {
    await saveGameWith([spelling]);
  }
  const rows = await libraryRows(name);
  assert.equal(rows.length, 1, `expected one library row, got: ${rows.join(' | ')}`);
});

test('rename rewrites the library and every game that used the old name', async () => {
  const typo = label('Gladuis');
  const fixed = typo.replace('Gladuis', 'Gladius');
  const gameId = await saveGameWith([typo]);

  const out = await admin.patch('/admin/detachments', { factionId, from: typo, to: fixed });
  assert.equal(out.status, 200);
  assert.equal(out.data.merged, false, 'nothing to merge into, so this is a plain rename');
  assert.ok(out.data.seatsUpdated >= 1, 'it should report the game seats it rewrote');

  const seat = await seatDetachments(gameId);
  assert.deepEqual(seat.detachments, [fixed], 'the recorded game should carry the corrected name');
  assert.equal(seat.detachment_name, fixed, 'and so should the derived display string');

  assert.deepEqual(await libraryRows(typo), [], 'the typo should be gone from the library');
  assert.deepEqual(await libraryRows(fixed), [fixed], 'and the corrected name should have taken its place');
});

test('renaming onto an existing name merges, without doubling a seat that held both', async () => {
  const good = label('Anvil');
  const bad = `${good} Forse`;

  // One seat carrying BOTH spellings is the case that would read back as
  // "Anvil, Anvil" if the merge did not de-duplicate.
  const gameId = await saveGameWith([good, bad]);

  const out = await admin.patch('/admin/detachments', { factionId, from: bad, to: good });
  assert.equal(out.status, 200);
  assert.equal(out.data.merged, true, 'the target already existed, so this is a merge');

  const seat = await seatDetachments(gameId);
  assert.deepEqual(seat.detachments, [good], 'the duplicate should be collapsed to one');
  assert.equal(seat.detachment_name, good, 'the display string must not read "X, X"');

  const listed = await admin.get(`/admin/detachments?factionId=${factionId}`);
  assert.equal(listed.data.filter((r) => r.name === bad).length, 0,
    'the bad spelling should be gone from the listing entirely');
});

test('delete refuses while games still use the name, and works once they do not', async () => {
  const used = label('InUse');
  await saveGameWith([used]);

  const refused = await admin.del(
    `/admin/detachments?factionId=${factionId}&name=${encodeURIComponent(used)}`);
  assert.equal(refused.status, 409);
  assert.equal(refused.data.code, 'in_use');

  const unused = label('Unused');
  assert.equal((await admin.post('/admin/detachments', { factionId, name: unused })).status, 201);
  const ok = await admin.del(
    `/admin/detachments?factionId=${factionId}&name=${encodeURIComponent(unused)}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await libraryRows(unused), []);
});

test('adding a duplicate is a 409, and non-admins are locked out entirely', async () => {
  const name = label('Dup');
  assert.equal((await admin.post('/admin/detachments', { factionId, name })).status, 201);
  const again = await admin.post('/admin/detachments', { factionId, name: name.toLowerCase() });
  assert.equal(again.status, 409, 'a case-insensitive duplicate should be refused');

  const calls = [
    ['get', `/admin/detachments?factionId=${factionId}`, undefined],
    ['post', '/admin/detachments', { factionId, name: 'ZZ Nope' }],
    ['patch', '/admin/detachments', { factionId, from: 'ZZ a', to: 'ZZ b' }],
    ['del', `/admin/detachments?factionId=${factionId}&name=ZZ%20x`, undefined],
  ];
  for (const [method, path, body] of calls) {
    assert.equal((await user[method](path, body)).status, 403, `${method} ${path} should be admin-only`);
    assert.equal((await anon()[method](path, body)).status, 401, `${method} ${path} should reject anonymous`);
  }
});

test('teardown', async () => {
  await cleanup();
  await closePool();
});
