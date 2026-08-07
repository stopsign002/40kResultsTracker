// The recycle bin, end to end over HTTP.
//
// Deleting a game or a live game no longer destroys it: the rows are
// serialised into `deleted_items` and the originals hard-deleted, while the
// PHOTO BYTES ARE DELIBERATELY LEFT ON DISK so a restore is complete. That
// split — rows gone, files staying — is the whole feature and the whole risk,
// because every other delete path in this app unlinks as it goes.
//
// Three properties carry this file:
//
//   1. ARCHIVE IS NOT DELETE. After DELETE /admin/games/:id the game is absent
//      from `games`, from GET /games and from the stats overview, but the
//      archive row and the files both still exist.
//   2. RESTORE IS FAITHFUL AND LANDS ON THE ORIGINAL ID. Per-round scores,
//      secondaries (drawn_round and round_number are independent in 11e and
//      must stay that way), detachments, final scores and photos come back
//      unchanged, at the id the game had before. Reinserting a row with an
//      explicit id does NOT advance the SERIAL sequence, so the very next
//      game created can collide on the primary key — that is the single most
//      likely way this feature breaks, and it has its own test.
//   3. PERMANENT DELETE IS THE ONLY THING THAT TOUCHES THE FILES.
//
// Nothing here asserts on a global count: the suite shares one database and
// other files' rows are present. Every assertion filters to ids this file made.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  TEST_PREFIX, pool, createUser, login, anon, reference, playablePayload,
  TINY_JPEG, dirExists, draftDir, gameDir, cleanup, closePool, uniq,
} from './_harness.js';

/** @type {any} */ let ref;
/** @type {any} */ let ownerUser, adminUser, randoUser;
/** @type {any} */ let ownerC, adminC, randoC;
const guestC = anon();

// Directories this file caused to exist. cleanup() finds a game's photo folder
// through its `games` row — but archiving deletes that row while leaving the
// folder behind, so from cleanup()'s point of view the bytes are unreachable.
// We track them ourselves. See the note on sweepArchive().
const touchedDirs = new Set();

before(async () => {
  await sweepArchive();
  await cleanup();
  ownerUser = await createUser({ label: 'binowner' });
  adminUser = await createUser({ role: 'admin', label: 'binadmin' });
  randoUser = await createUser({ label: 'binrando' });
  ownerC = await login(ownerUser);
  adminC = await login(adminUser);
  randoC = await login(randoUser);
  // Fetched last so the session-store writes above have landed. See the same
  // comment in drafts-lifecycle.test.js.
  ref = await reference();
});

after(async () => {
  await sweepArchive();
  await cleanup();
  await closePool();
});

/**
 * Remove this file's archive rows and the orphaned photo folders they point at.
 *
 * This is NOT a courtesy — it is covering a gap in the harness. cleanup() walks
 * games/game_drafts by owner, and an archived item has no such row any more, so
 * neither its `deleted_items` entry nor its files are reachable from there. A
 * leaked entry is worse than untidy: `UNIQUE (kind, original_id)` means a later
 * run that lands on the same id cannot archive at all.
 *
 * Deliberately does not edit _harness.js — see the report.
 */
async function sweepArchive() {
  await pool.query(
    'DELETE FROM deleted_items WHERE deleted_by_name LIKE $1', [TEST_PREFIX + '%']
  ).catch(() => { /* table may not exist yet on a stale container */ });
  for (const dir of touchedDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  touchedDirs.clear();
}

/* ── Fixtures ─────────────────────────────────────────────────── */

// Guest names must start with 'ZZ ' — that prefix is what cleanup() uses to
// find the banner_first_seen rows createGame() writes for a guest.
const guest = (label) => `ZZ ${uniq(label)}`;

/**
 * A submittable draft payload with the things a restore is most likely to
 * drop: two detachments on one seat, and a secondary drawn in one round and
 * scored in another.
 */
function richPayload(label) {
  const body = playablePayload({
    factionId: ref.factions[0].id,
    p1: guest(`${label}_a`),
    p2: guest(`${label}_b`),
  });
  body.missionPackId = ref.pack.id;
  body.turnCount = 5;
  body.players[0].detachments = ['ZZ Gladius Task Force', 'ZZ Anvil Siege Force'];
  body.players[1].detachments = ['ZZ Solo Detachment'];
  body.players[0].secondaries = [
    { cardName: 'ZZ Bin Held Card', drawnRound: 1, roundNumber: 4, score: 8, wasDiscarded: false },
    { cardName: 'ZZ Bin Binned Card', drawnRound: 2, roundNumber: 2, score: 0, wasDiscarded: true },
  ];
  body.players[1].secondaries = [
    { cardName: 'ZZ Bin Other Card', drawnRound: 3, roundNumber: 5, score: 5, wasDiscarded: false },
  ];
  body.players[0].rounds = body.players[0].rounds.map((r, i) => ({ ...r, cpRemaining: 5 - i }));
  return body;
}

/** Create a draft, keeping its photo folder on the sweep list. */
async function newDraft(client, label) {
  const res = await client.post('/drafts', richPayload(label));
  assert.equal(res.status, 201, `draft create failed: ${JSON.stringify(res.data)}`);
  touchedDirs.add(draftDir(res.data.id));
  return res.data.id;
}

/** Create a real game by filing a draft. Returns the game id. */
async function newGame(label, client = ownerC) {
  const draftId = await newDraft(client, label);
  const res = await client.post(`/drafts/${draftId}/submit`);
  assert.equal(res.status, 200, `submit failed: ${JSON.stringify(res.data)}`);
  touchedDirs.add(gameDir(res.data.gameId));
  return res.data.gameId;
}

async function addGamePhoto(gameId, caption, client = ownerC) {
  const res = await client.post(`/games/${gameId}/images`, { dataUrl: TINY_JPEG, caption });
  assert.equal(res.status, 201, `photo upload failed: ${JSON.stringify(res.data)}`);
}

async function addDraftPhoto(draftId, caption, client = ownerC) {
  const res = await client.post(`/drafts/${draftId}/images`, { dataUrl: TINY_JPEG, caption });
  assert.equal(res.status, 201, `draft photo upload failed: ${JSON.stringify(res.data)}`);
}

/* ── DB reads for things the API does not expose ───────────────── */

async function gameRow(gameId) {
  const { rows } = await pool.query(
    `SELECT played_at, points_limit, game_format, mission_pack_id, turn_count,
            end_condition, play_medium, edition, hidden_from_stats, notes,
            created_by_user_id
       FROM games WHERE id = $1`, [gameId]);
  return rows[0];
}

async function draftRow(draftId) {
  const { rows } = await pool.query(
    `SELECT owner_user_id, opponent_user_id, share_token, payload, current_step,
            submitted_at, submitted_game_id
       FROM game_drafts WHERE id = $1`, [draftId]);
  return rows[0];
}

/**
 * Everything about a game that a restore has to reproduce, with the surrogate
 * keys and timestamps left out — game_player ids are free to change, scores
 * are not.
 */
async function snapshotGame(gameId) {
  const { rows: players } = await pool.query(
    `SELECT id, seat, user_id, guest_name, faction_id, detachment_name,
            went_first, is_attacker, time_seconds, final_score, result
       FROM game_players WHERE game_id = $1 ORDER BY seat`, [gameId]);
  const seats = [];
  for (const p of players) {
    const { rows: rounds } = await pool.query(
      `SELECT round_number, primary_score, secondary_score, cp_remaining, time_seconds
         FROM game_rounds WHERE game_player_id = $1 ORDER BY round_number`, [p.id]);
    const { rows: secondaries } = await pool.query(
      `SELECT card_name, drawn_round, round_number, score, was_discarded
         FROM player_secondaries WHERE game_player_id = $1 ORDER BY card_name`, [p.id]);
    const { rows: detachments } = await pool.query(
      `SELECT detachment_name, sort_order
         FROM player_detachments WHERE game_player_id = $1 ORDER BY sort_order`, [p.id]);
    const { id, ...rest } = p;
    seats.push({ ...rest, rounds, secondaries, detachments });
  }
  return { game: await gameRow(gameId), seats };
}

async function gameImageRows(gameId) {
  const { rows } = await pool.query(
    `SELECT file_name, thumb_name, caption, is_thumbnail, is_map, width, height
       FROM game_images WHERE game_id = $1 ORDER BY file_name`, [gameId]);
  return rows;
}

async function draftImageRows(draftId) {
  const { rows } = await pool.query(
    `SELECT file_name, thumb_name, caption, round_number, width, height
       FROM game_draft_images WHERE draft_id = $1 ORDER BY file_name`, [draftId]);
  return rows;
}

async function archiveRow(kind, originalId) {
  const { rows } = await pool.query(
    'SELECT * FROM deleted_items WHERE kind = $1 AND original_id = $2', [kind, originalId]);
  return rows[0];
}

/** The archive row's own id, which is what the three endpoints take. */
async function archiveId(kind, originalId) {
  const row = await archiveRow(kind, originalId);
  assert.ok(row, `no deleted_items row for ${kind} ${originalId}`);
  return row.id;
}

/** This file's entry in GET /admin/deleted, found by archive id. */
async function listedEntry(id) {
  const res = await adminC.get('/admin/deleted');
  assert.equal(res.status, 200, `GET /admin/deleted failed: ${JSON.stringify(res.data)}`);
  assert.ok(Array.isArray(res.data), 'GET /admin/deleted should return an array');
  return { list: res.data, entry: res.data.find((r) => r.id === id) };
}

async function filesOnDisk(dir, rows) {
  const present = [];
  for (const r of rows) {
    present.push(await dirExists(path.join(dir, r.file_name)));
    present.push(await dirExists(path.join(dir, r.thumb_name)));
  }
  return present;
}

/* ── Archiving a game ──────────────────────────────────────────── */

test('deleting a game as an admin archives it into deleted_items and leaves its photo files on disk', async () => {
  const gameId = await newGame('arch');
  await addGamePhoto(gameId, 'ZZ cover shot');
  await addGamePhoto(gameId, 'ZZ turn three');

  const images = await gameImageRows(gameId);
  assert.equal(images.length, 2, 'fixture should have two photos');
  assert.deepEqual(await filesOnDisk(gameDir(gameId), images), [true, true, true, true],
    'fixture photos are not on disk before the delete');

  const del = await adminC.del(`/admin/games/${gameId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));

  // The row is really gone — this is an archive, not a hidden flag.
  assert.equal(await gameRow(gameId), undefined, 'the games row survived the archive');
  assert.equal((await ownerC.get(`/games/${gameId}`)).status, 404);
  const { rows: players } = await pool.query(
    'SELECT id FROM game_players WHERE game_id = $1', [gameId]);
  assert.deepEqual(players, [], 'game_players rows survived the archive');

  const listed = await ownerC.get('/games?limit=200');
  assert.equal(listed.status, 200);
  assert.ok(!listed.data.some((g) => g.id === gameId), 'an archived game is still in GET /games');

  const row = await archiveRow('game', gameId);
  assert.ok(row, 'no deleted_items row was written');
  assert.equal(row.kind, 'game');
  assert.equal(row.original_id, gameId);
  assert.equal(row.deleted_by_user_id, adminUser.id);
  assert.equal(row.deleted_by_name, adminUser.display_name);
  assert.ok(row.deleted_at, 'deleted_at was not stamped');
  assert.ok(typeof row.label === 'string' && row.label.length > 0, 'the archive row has no label');

  // The photo ROWS are captured in the payload — without them a restore can
  // find the bytes but not know what they were.
  const captured = JSON.stringify(row.payload);
  for (const img of images) {
    assert.ok(captured.includes(img.file_name), `payload does not carry ${img.file_name}`);
    assert.ok(captured.includes(img.thumb_name), `payload does not carry ${img.thumb_name}`);
    assert.ok(captured.includes(img.caption), `payload does not carry the caption ${img.caption}`);
  }

  // And the bytes stayed put. Every other delete path in this app unlinks.
  assert.ok(await dirExists(gameDir(gameId)), 'the game photo folder was removed by an archive');
  assert.deepEqual(await filesOnDisk(gameDir(gameId), images), [true, true, true, true],
    'archiving a game unlinked its photo files');
});

test('an archived game stops counting toward the stats overview', async () => {
  const before = (await ownerC.get('/stats/overview')).data;

  const gameId = await newGame('stats');
  const withGame = (await ownerC.get('/stats/overview')).data;
  assert.equal(withGame.total_games, before.total_games + 1,
    'fixture game did not reach the overview, so the delete assertion below is vacuous');

  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);

  const after = (await ownerC.get('/stats/overview')).data;
  assert.equal(after.total_games, before.total_games,
    'an archived game is still counted by /stats/overview');
});

/* ── Restoring a game ──────────────────────────────────────────── */

test('restoring an archived game returns it at its original id with its rounds, secondaries, detachments and final scores unchanged', async () => {
  const gameId = await newGame('restore');
  const before = await snapshotGame(gameId);

  // Sanity on the fixture: an 11e secondary that was drawn in one round and
  // scored in another is exactly the shape a lossy serialisation flattens.
  const held = before.seats[0].secondaries.find((s) => s.card_name === 'ZZ Bin Held Card');
  assert.ok(held, 'fixture lost its secondary before the test started');
  assert.notEqual(held.drawn_round, held.round_number,
    'fixture must carry a secondary whose drawn and scored rounds differ');
  assert.equal(before.seats[0].detachments.length, 2, 'fixture should have two detachments on seat 1');
  assert.ok(before.seats[0].final_score > 0, 'fixture scored nothing, so a restore of zeroes would pass');

  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);

  const id = await archiveId('game', gameId);
  const res = await adminC.post(`/admin/deleted/${id}/restore`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.ok, true);
  assert.equal(res.data.kind, 'game');
  assert.equal(res.data.restoredId, gameId, 'a restore must land on the original id');

  const fetched = await ownerC.get(`/games/${gameId}`);
  assert.equal(fetched.status, 200, 'the restored game is not readable at its original id');
  assert.equal(fetched.data.id, gameId);

  assert.deepEqual(await snapshotGame(gameId), before,
    'the restored game does not match what was archived');

  assert.equal(await archiveRow('game', gameId), undefined,
    'the deleted_items row survived a successful restore');
});

test('restoring an archived game reattaches its photos with exactly one cover', async () => {
  const gameId = await newGame('photos');
  await addGamePhoto(gameId, 'ZZ restore cover');
  await addGamePhoto(gameId, 'ZZ restore second');
  const before = await gameImageRows(gameId);
  assert.equal(before.filter((r) => r.is_thumbnail).length, 1, 'fixture should have one cover');

  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);
  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 200);

  const after = await gameImageRows(gameId);
  assert.deepEqual(after, before, 'the restored photo rows do not match what was archived');
  assert.equal(after.filter((r) => r.is_thumbnail).length, 1,
    'a restore must leave exactly one cover — the partial unique index allows no more');

  assert.deepEqual(await filesOnDisk(gameDir(gameId), after), [true, true, true, true],
    'the restored photo rows point at files that are not on disk');

  const served = await ownerC.get(`/games/${gameId}/images`);
  assert.equal(served.status, 200);
  assert.equal(served.data.length, 2, 'the restored photos are not served by the images endpoint');
});

test('a game created after a restore gets a fresh id instead of colliding with the restored one', async () => {
  const restoredId = await newGame('seq');
  assert.equal((await adminC.del(`/admin/games/${restoredId}`)).status, 200);
  const id = await archiveId('game', restoredId);
  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 200);

  // Reinserting with an explicit id does not advance the SERIAL sequence, so
  // without a setval the next insert tries to reuse `restoredId` and dies on
  // the primary key.
  const nextId = await newGame('seq_after');
  assert.notEqual(nextId, restoredId, 'the next game reused the restored id');
  assert.equal((await ownerC.get(`/games/${nextId}`)).status, 200);
  assert.equal((await ownerC.get(`/games/${restoredId}`)).status, 200,
    'creating the next game overwrote the restored one');
});

/* ── Archiving and restoring a live game ───────────────────────── */

test('deleting a live game as its owner archives it and leaves the mid-game photos on disk', async () => {
  const draftId = await newDraft(ownerC, 'darch');
  await addDraftPhoto(draftId, 'ZZ deployment');
  const images = await draftImageRows(draftId);
  assert.equal(images.length, 1, 'fixture should have one mid-game photo');
  assert.deepEqual(await filesOnDisk(draftDir(draftId), images), [true, true]);

  const del = await ownerC.del(`/drafts/${draftId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));

  assert.equal(await draftRow(draftId), undefined, 'the game_drafts row survived the archive');
  assert.equal((await ownerC.get(`/drafts/${draftId}`)).status, 404);
  const open = await ownerC.get('/drafts');
  assert.equal(open.status, 200);
  assert.ok(!open.data.some((d) => d.id === draftId), 'an archived draft is still in GET /drafts');
  assert.deepEqual(await draftImageRows(draftId), [], 'the draft image rows survived the archive');

  const row = await archiveRow('draft', draftId);
  assert.ok(row, 'no deleted_items row was written for the draft');
  assert.equal(row.kind, 'draft');
  assert.equal(row.original_id, draftId);
  assert.equal(row.deleted_by_user_id, ownerUser.id);
  assert.equal(row.deleted_by_name, ownerUser.display_name);
  assert.ok(typeof row.label === 'string' && row.label.length > 0, 'the archive row has no label');

  assert.ok(await dirExists(draftDir(draftId)), 'the draft photo folder was removed by an archive');
  assert.deepEqual(await filesOnDisk(draftDir(draftId), images), [true, true],
    'archiving a draft unlinked its mid-game photos');
});

test('restoring an archived live game puts it back in GET /drafts with its payload and photos intact', async () => {
  const draftId = await newDraft(ownerC, 'drest');
  await addDraftPhoto(draftId, 'ZZ round two');
  const patched = await ownerC.patch(`/drafts/${draftId}`, { patch: { notes: 'ZZ mid game' } });
  assert.equal(patched.status, 200);

  const before = await draftRow(draftId);
  const beforeImages = await draftImageRows(draftId);
  assert.ok(before.payload?.players?.length === 2, 'fixture payload is not what we think it is');

  assert.equal((await ownerC.del(`/drafts/${draftId}`)).status, 200);

  const id = await archiveId('draft', draftId);
  const res = await adminC.post(`/admin/deleted/${id}/restore`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.ok, true);
  assert.equal(res.data.kind, 'draft');
  assert.equal(res.data.restoredId, draftId, 'a draft restore must land on the original id');

  const after = await draftRow(draftId);
  assert.ok(after, 'the draft was not reinserted');
  assert.deepEqual(after.payload, before.payload, 'the restored draft payload differs from the archived one');
  assert.equal(after.owner_user_id, before.owner_user_id);
  assert.equal(after.current_step, before.current_step);
  assert.equal(after.submitted_at, null, 'a restored draft must still be in progress');

  const fetched = await ownerC.get(`/drafts/${draftId}`);
  assert.equal(fetched.status, 200, 'the restored draft is not readable');
  const open = await ownerC.get('/drafts');
  assert.ok(open.data.some((d) => d.id === draftId), 'the restored draft is missing from GET /drafts');

  assert.deepEqual(await draftImageRows(draftId), beforeImages,
    'the restored draft photo rows do not match what was archived');
  assert.deepEqual(await filesOnDisk(draftDir(draftId), beforeImages), [true, true],
    'the restored draft photo rows point at files that are not on disk');

  assert.equal(await archiveRow('draft', draftId), undefined,
    'the deleted_items row survived a successful draft restore');
});

test('an admin deleting somebody else\'s live game archives it the same way, credited to the admin', async () => {
  const draftId = await newDraft(ownerC, 'dadmin');
  await addDraftPhoto(draftId, 'ZZ not mine');
  const images = await draftImageRows(draftId);

  const del = await adminC.del(`/drafts/${draftId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));

  assert.equal(await draftRow(draftId), undefined);
  const row = await archiveRow('draft', draftId);
  assert.ok(row, 'an admin delete of another user\'s draft did not archive it');
  assert.equal(row.deleted_by_user_id, adminUser.id, 'the archive credits the wrong actor');
  assert.equal(row.deleted_by_name, adminUser.display_name);
  assert.deepEqual(await filesOnDisk(draftDir(draftId), images), [true, true],
    'an admin delete of another user\'s draft unlinked the photos');

  // And it is still restorable by the owner's route back into their list.
  const id = await archiveId('draft', draftId);
  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 200);
  assert.ok(await draftRow(draftId));
});

test('a logged-in non-owner who is not an admin still cannot delete somebody else\'s live game', async () => {
  const draftId = await newDraft(ownerC, 'dnope');
  const res = await randoC.del(`/drafts/${draftId}`);
  assert.equal(res.status, 403);
  assert.ok(await draftRow(draftId), 'the draft was deleted by a stranger');
  assert.equal(await archiveRow('draft', draftId), undefined,
    'a refused delete still wrote an archive row');
});

/* ── Permanent delete ──────────────────────────────────────────── */

test('permanently deleting an archived game removes the archive row and unlinks the photo files', async () => {
  const gameId = await newGame('purge');
  await addGamePhoto(gameId, 'ZZ doomed');
  const images = await gameImageRows(gameId);

  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  assert.ok(await dirExists(gameDir(gameId)), 'archiving already removed the files');

  const id = await archiveId('game', gameId);
  const res = await adminC.del(`/admin/deleted/${id}`);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.ok, true);

  assert.equal(await archiveRow('game', gameId), undefined, 'the archive row survived a permanent delete');
  assert.deepEqual(await filesOnDisk(gameDir(gameId), images), [false, false],
    'a permanent delete left the photo bytes on disk');
  assert.equal(await dirExists(gameDir(gameId)), false,
    'a permanent delete left the game photo folder behind');
  assert.equal((await ownerC.get(`/games/${gameId}`)).status, 404);
});

test('permanently deleting an archived live game unlinks its mid-game photo folder', async () => {
  const draftId = await newDraft(ownerC, 'dpurge');
  await addDraftPhoto(draftId, 'ZZ doomed draft');
  const images = await draftImageRows(draftId);

  assert.equal((await ownerC.del(`/drafts/${draftId}`)).status, 200);
  assert.ok(await dirExists(draftDir(draftId)), 'archiving already removed the draft files');

  const id = await archiveId('draft', draftId);
  assert.equal((await adminC.del(`/admin/deleted/${id}`)).status, 200);

  assert.equal(await archiveRow('draft', draftId), undefined);
  assert.deepEqual(await filesOnDisk(draftDir(draftId), images), [false, false],
    'a permanent delete left the draft photo bytes on disk');
  assert.equal(await dirExists(draftDir(draftId)), false,
    'a permanent delete left the draft photo folder behind');
});

test('restoring an archive entry that was permanently deleted returns 404', async () => {
  const gameId = await newGame('gone');
  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);
  assert.equal((await adminC.del(`/admin/deleted/${id}`)).status, 200);

  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 404);
  assert.equal((await ownerC.get(`/games/${gameId}`)).status, 404,
    'a 404 restore still brought the game back');
});

test('restoring the same archive entry twice returns 404 the second time', async () => {
  const gameId = await newGame('twice');
  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);

  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 200);
  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 404,
    'a consumed archive entry can be restored again');
});

test('an archive id that does not exist is a 404 for both restore and permanent delete', async () => {
  assert.equal((await adminC.post('/admin/deleted/999999/restore')).status, 404);
  assert.equal((await adminC.del('/admin/deleted/999999')).status, 404);
});

/* ── Listing ───────────────────────────────────────────────────── */

test('the archive lists an entry with its kind, original id, actor and restorability, newest first', async () => {
  const firstGame = await newGame('list_one');
  assert.equal((await adminC.del(`/admin/games/${firstGame}`)).status, 200);
  const firstId = await archiveId('game', firstGame);

  const secondDraft = await newDraft(ownerC, 'list_two');
  assert.equal((await ownerC.del(`/drafts/${secondDraft}`)).status, 200);
  const secondId = await archiveId('draft', secondDraft);

  const { list, entry } = await listedEntry(firstId);
  assert.ok(entry, 'the archived game is missing from GET /admin/deleted');
  assert.equal(entry.kind, 'game');
  assert.equal(entry.original_id, firstGame);
  assert.equal(entry.deleted_by_name, adminUser.display_name);
  assert.ok(entry.deleted_at, 'the listed entry carries no deleted_at');
  assert.ok(typeof entry.label === 'string' && entry.label.length > 0);
  assert.equal(entry.canRestore, true, 'a free original id should be restorable');

  const draftEntry = list.find((r) => r.id === secondId);
  assert.ok(draftEntry, 'the archived draft is missing from GET /admin/deleted');
  assert.equal(draftEntry.kind, 'draft');
  assert.equal(draftEntry.original_id, secondDraft);
  assert.equal(draftEntry.deleted_by_name, ownerUser.display_name);
  assert.equal(draftEntry.canRestore, true);

  // Ordering is asserted only between the two rows this test made — other
  // files' rows share the table.
  const positions = list.map((r) => r.id);
  assert.ok(positions.indexOf(secondId) < positions.indexOf(firstId),
    'GET /admin/deleted is not newest-first');
});

test('an archived game whose original id has been taken reports canRestore false and refuses the restore with 409', async () => {
  const gameId = await newGame('occupied');
  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);

  // Squat on the id the archive wants back. Owned by a test user, so cleanup()
  // takes it away again.
  await pool.query(
    `INSERT INTO games (id, created_by_user_id, played_at, points_limit, game_format, edition)
     VALUES ($1, $2, '2026-08-07', 2000, 'matched', '11')`,
    [gameId, ownerUser.id]
  );

  const { entry } = await listedEntry(id);
  assert.ok(entry, 'the archive entry disappeared once its id was taken');
  assert.equal(entry.canRestore, false,
    'canRestore must be false when the original id is occupied');

  const res = await adminC.post(`/admin/deleted/${id}/restore`);
  assert.equal(res.status, 409, `expected 409, got ${res.status} ${JSON.stringify(res.data)}`);

  // The refusal is not destructive: the archive row and the squatter both stay.
  assert.ok(await archiveRow('game', gameId), 'a refused restore consumed the archive row');
  assert.ok(await gameRow(gameId), 'a refused restore clobbered the row occupying the id');
});

/* ── Authorization ─────────────────────────────────────────────── */

test('GET /admin/deleted is 401 for an anonymous visitor, 403 for a signed-in non-admin and 200 for an admin', async () => {
  assert.equal((await guestC.get('/admin/deleted')).status, 401);
  assert.equal((await randoC.get('/admin/deleted')).status, 403);
  assert.equal((await adminC.get('/admin/deleted')).status, 200);
});

test('restoring from the archive is 401 for an anonymous visitor, 403 for a signed-in non-admin and 200 for an admin', async () => {
  const gameId = await newGame('authres');
  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);

  assert.equal((await guestC.post(`/admin/deleted/${id}/restore`)).status, 401);
  assert.equal((await randoC.post(`/admin/deleted/${id}/restore`)).status, 403);
  // Neither refusal may have done the work anyway.
  assert.equal(await gameRow(gameId), undefined, 'a refused restore brought the game back');
  assert.ok(await archiveRow('game', gameId));

  assert.equal((await adminC.post(`/admin/deleted/${id}/restore`)).status, 200);
  assert.ok(await gameRow(gameId));
});

test('permanently deleting from the archive is 401 for an anonymous visitor, 403 for a signed-in non-admin and 200 for an admin', async () => {
  const gameId = await newGame('authdel');
  await addGamePhoto(gameId, 'ZZ auth photo');
  const images = await gameImageRows(gameId);
  assert.equal((await adminC.del(`/admin/games/${gameId}`)).status, 200);
  const id = await archiveId('game', gameId);

  assert.equal((await guestC.del(`/admin/deleted/${id}`)).status, 401);
  assert.equal((await randoC.del(`/admin/deleted/${id}`)).status, 403);
  assert.ok(await archiveRow('game', gameId), 'a refused permanent delete removed the archive row');
  assert.deepEqual(await filesOnDisk(gameDir(gameId), images), [true, true],
    'a refused permanent delete still unlinked the files');

  assert.equal((await adminC.del(`/admin/deleted/${id}`)).status, 200);
  assert.equal(await archiveRow('game', gameId), undefined);
});
