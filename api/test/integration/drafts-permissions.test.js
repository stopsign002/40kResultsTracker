// The live tracker's auth matrix, end to end.
//
// `game_drafts` is the one place in this app where "reads are public, writes
// are gated" is not enough on its own: a write also has to establish WHICH SEAT
// the caller is. The owner may write anything; an invited opponent may write
// only seat index 1; everybody else may look but not touch. Those rules live in
// routes/drafts.js as per-route checks rather than a blanket router.use(), so
// nothing but an integration test can prove them all still hold.
//
// Everything here is created through the harness, so cleanup() can find it.
// Nothing asserts on a global count — other files' rows may be present.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PASSWORD, pool, createUser, login, tryLogin, anon, playablePayload, TINY_JPEG,
  cleanup, closePool,
} from './_harness.js';

/** @type {any} */ let ownerUser;
/** @type {any} */ let opponentUser;
/** @type {any} */ let randoUser;
/** @type {any} */ let adminUser;

/** @type {any} */ let owner;     // seat 1
/** @type {any} */ let opponent;  // seat 2, invited
/** @type {any} */ let rando;     // signed in, not in this game
/** @type {any} */ let admin;     // role 'admin', not in this game
const guest = anon();             // no session at all

before(async () => {
  await cleanup();
  ownerUser = await createUser({ label: 'dperm_owner' });
  opponentUser = await createUser({ label: 'dperm_opp' });
  randoUser = await createUser({ label: 'dperm_rando' });
  adminUser = await createUser({ label: 'dperm_admin', role: 'admin' });

  owner = await login(ownerUser);
  opponent = await login(opponentUser);
  rando = await login(randoUser);
  admin = await login(adminUser);
});

after(async () => {
  await cleanup();
  await closePool();
});

/* ── Fixtures ─────────────────────────────────────────────────── */

/** A draft owned by `owner`, with `opponent` invited into seat 2 unless told not to. */
async function newDraft({ invite = true, payload } = {}) {
  const created = await owner.post('/drafts', payload ?? playablePayload());
  assert.equal(created.status, 201, 'creating a draft should succeed');
  const id = created.data.id;
  if (invite) {
    const inv = await owner.post(`/drafts/${id}/invite`, { userId: opponentUser.id });
    assert.equal(inv.status, 200, 'inviting the opponent should succeed');
  }
  return { id, shareToken: created.data.shareToken };
}

/** An id that is a real integer but has no row behind it any more. */
async function deletedDraftId() {
  const { id } = await newDraft({ invite: false });
  assert.equal((await owner.del(`/drafts/${id}`)).status, 200);
  return id;
}

/** Read a draft back through the owner's session. */
async function readDraft(id) {
  const res = await owner.get(`/drafts/${id}`);
  assert.equal(res.status, 200);
  return res.data;
}

/** A round entry shaped the way the wizard sends them. */
const round = (n, primary) => ({
  roundNumber: n, primaryScore: primary, secondaryScore: 0, cpRemaining: null, timeSeconds: null,
});

/* ── Reads are public ─────────────────────────────────────────── */

describe('reads', () => {
  test('anyone, signed in or not, can list the open drafts', async () => {
    const { id } = await newDraft();
    for (const [who, client] of [
      ['anon', guest], ['rando', rando], ['opponent', opponent],
      ['owner', owner], ['admin', admin],
    ]) {
      const res = await client.get('/drafts');
      assert.equal(res.status, 200, `${who} should be able to list drafts`);
      assert.ok(Array.isArray(res.data), `${who} should get an array`);
      // Filter to the row we made — never assert on a global count.
      assert.ok(res.data.some((d) => d.id === id), `${who} should see draft ${id}`);
    }
  });

  test('anyone, signed in or not, can read a single draft', async () => {
    const { id } = await newDraft();
    for (const [who, client] of [
      ['anon', guest], ['rando', rando], ['opponent', opponent],
      ['owner', owner], ['admin', admin],
    ]) {
      const res = await client.get(`/drafts/${id}`);
      assert.equal(res.status, 200, `${who} should be able to read draft ${id}`);
      assert.equal(res.data.id, id);
    }
  });

  test("anyone, signed in or not, can list a draft's photos", async () => {
    const { id } = await newDraft();
    for (const [who, client] of [
      ['anon', guest], ['rando', rando], ['opponent', opponent],
      ['owner', owner], ['admin', admin],
    ]) {
      const res = await client.get(`/drafts/${id}/images`);
      assert.equal(res.status, 200, `${who} should be able to list draft photos`);
      assert.ok(Array.isArray(res.data), `${who} should get an array`);
    }
  });

  test('the owner reads their own draft as viewerSeat 1 and isOwner true', async () => {
    const { id } = await newDraft();
    const res = await owner.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.viewerSeat, 1);
    assert.equal(res.data.isOwner, true);
  });

  test('an invited opponent reads the draft as viewerSeat 2 and isOwner false', async () => {
    const { id } = await newDraft();
    const res = await opponent.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.viewerSeat, 2);
    assert.equal(res.data.isOwner, false);
  });

  test('a signed-in non-participant reads the draft as a seatless spectator', async () => {
    const { id } = await newDraft();
    const res = await rando.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.viewerSeat, null);
    assert.equal(res.data.isOwner, false);
  });

  test('an anonymous reader reads the draft as a seatless spectator', async () => {
    const { id } = await newDraft();
    const res = await guest.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.viewerSeat, null);
    assert.equal(res.data.isOwner, false);
  });

  test('reading a draft that does not exist is a 404', async () => {
    const id = await deletedDraftId();
    assert.equal((await guest.get(`/drafts/${id}`)).status, 404);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 404);
  });
});

/* ── The invite secret ────────────────────────────────────────── */
// share_token is what POST /:id/join accepts. Leaking it to a spectator lets
// anyone claim the opponent seat, so it is owner-only on the read.

describe('share_token', () => {
  test('the share token is returned to the owner', async () => {
    const { id } = await newDraft();
    const res = await owner.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(typeof res.data.share_token, 'string');
    assert.ok(res.data.share_token.length > 0);
  });

  test('the share token is withheld from the invited opponent', async () => {
    const { id } = await newDraft();
    const res = await opponent.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.share_token, null);
  });

  test('the share token is withheld from a signed-in non-participant', async () => {
    const { id } = await newDraft();
    const res = await rando.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.share_token, null);
  });

  test('the share token is withheld from an anonymous reader', async () => {
    const { id } = await newDraft();
    const res = await guest.get(`/drafts/${id}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.share_token, null);
  });
});

/* ── PATCH scoping ────────────────────────────────────────────── */

describe('PATCH scoping', () => {
  test('the owner may patch a game-level field', async () => {
    const { id } = await newDraft();
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(res.status, 200);
  });

  test('the owner may patch their own seat', async () => {
    const { id } = await newDraft();
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: { players: { 0: { guestName: 'ZZ One Renamed' } } },
    });
    assert.equal(res.status, 200);
  });

  test('the owner may patch the opponent seat as well', async () => {
    const { id } = await newDraft();
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: { players: { 1: { guestName: 'ZZ Two Renamed' } } },
    });
    assert.equal(res.status, 200);
  });

  test('the owner may move the game on by sending currentStep', async () => {
    const { id } = await newDraft();
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: {}, currentStep: 'round2',
    });
    assert.equal(res.status, 200);
    assert.equal((await readDraft(id)).current_step, 'round2');
  });

  test('an invited opponent may patch their own seat', async () => {
    const { id } = await newDraft();
    const res = await opponent.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-opp', patch: { players: { 1: { guestName: 'ZZ Opponent Says So' } } },
    });
    assert.equal(res.status, 200);
    assert.equal((await readDraft(id)).payload.players[1].guestName, 'ZZ Opponent Says So');
  });

  test('an invited opponent cannot patch the owning seat', async () => {
    const { id } = await newDraft();
    const res = await opponent.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-opp', patch: { players: { 0: { guestName: 'ZZ Hijack' } } },
    });
    assert.equal(res.status, 403);
    assert.equal((await readDraft(id)).payload.players[0].guestName, 'ZZ One');
  });

  test('an invited opponent cannot patch a game-level field', async () => {
    const { id } = await newDraft();
    const res = await opponent.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-opp', patch: { pointsLimit: 1000 },
    });
    assert.equal(res.status, 403);
  });

  test('an invited opponent cannot smuggle a game-level field alongside their seat', async () => {
    const { id } = await newDraft();
    const res = await opponent.patch(`/drafts/${id}`, {
      baseRev: null,
      clientId: 'zz-opp',
      patch: { pointsLimit: 1000, players: { 1: { guestName: 'ZZ Two' } } },
    });
    assert.equal(res.status, 403);
  });

  test('an invited opponent cannot move the game on by sending currentStep', async () => {
    const { id } = await newDraft();
    const res = await opponent.patch(`/drafts/${id}`, {
      baseRev: null,
      clientId: 'zz-opp',
      patch: { players: { 1: { guestName: 'ZZ Two' } } },
      currentStep: 'summary',
    });
    assert.equal(res.status, 403);
  });

  test('a signed-in non-participant cannot patch a draft at all', async () => {
    const { id } = await newDraft();
    const res = await rando.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-rando', patch: { players: { 1: { guestName: 'ZZ Nope' } } },
    });
    assert.equal(res.status, 403);
  });

  test('an anonymous caller cannot patch a draft at all', async () => {
    const { id } = await newDraft();
    const res = await guest.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-anon', patch: { players: { 1: { guestName: 'ZZ Nope' } } },
    });
    assert.equal(res.status, 401);
  });

  test('patching a draft that does not exist is a 404', async () => {
    const id = await deletedDraftId();
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(res.status, 404);
  });

  test('rev increments on every accepted patch', async () => {
    const { id } = await newDraft();
    const start = (await readDraft(id)).rev;

    const first = await owner.patch(`/drafts/${id}`, {
      baseRev: start, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.rev, start + 1);

    const second = await owner.patch(`/drafts/${id}`, {
      baseRev: first.data.rev, clientId: 'zz-owner', patch: { pointsLimit: 1750 },
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.rev, start + 2);
    assert.equal((await readDraft(id)).rev, start + 2);
  });

  test('a patch sent from the current rev is not reported stale', async () => {
    const { id } = await newDraft();
    const rev = (await readDraft(id)).rev;
    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: rev, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.stale, false);
  });

  test('a patch sent from a rev someone else has already moved past is reported stale', async () => {
    const { id } = await newDraft();
    const rev = (await readDraft(id)).rev;

    // The other phone writes first...
    const ahead = await opponent.patch(`/drafts/${id}`, {
      baseRev: rev, clientId: 'zz-opp', patch: { players: { 1: { guestName: 'ZZ Two Moved' } } },
    });
    assert.equal(ahead.status, 200);

    // ...so this one is patching from a base that is behind.
    const behind = await owner.patch(`/drafts/${id}`, {
      baseRev: rev, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(behind.status, 200);
    assert.equal(behind.data.stale, true);
  });
});

/* ── Merge semantics ──────────────────────────────────────────── */
// Pinned as pure functions in draft-merge.test.js; pinned here as the shape a
// second phone actually reads back off the wire.

describe('merge semantics', () => {
  test('a patched object merges key by key and leaves its siblings alone', async () => {
    const { id } = await newDraft();
    const before = await readDraft(id);
    assert.equal(before.payload.gameFormat, 'matched');

    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: before.rev, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(res.status, 200);

    const after = await readDraft(id);
    assert.equal(after.payload.pointsLimit, 1500);
    assert.equal(after.payload.gameFormat, 'matched');
    assert.equal(after.payload.playMedium, 'physical');
    assert.equal(after.payload.playedAt, '2026-08-07');
  });

  test('a patched array replaces the stored array wholesale rather than merging it', async () => {
    const { id } = await newDraft();
    const before = await readDraft(id);
    assert.equal(before.payload.players[0].rounds.length, 5);

    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: before.rev,
      clientId: 'zz-owner',
      patch: { players: { 0: { rounds: [round(1, 10), round(2, 12)] } } },
    });
    assert.equal(res.status, 200);

    const after = await readDraft(id);
    assert.equal(after.payload.players[0].rounds.length, 2);
    assert.equal(after.payload.players[0].rounds[0].primaryScore, 10);
    assert.equal(after.payload.players[0].rounds[1].primaryScore, 12);
    // The seat that was not addressed is untouched.
    assert.equal(after.payload.players[1].rounds.length, 5);
    assert.equal(after.payload.players[1].guestName, 'ZZ Two');
  });

  test('patching a field to null stores null rather than deleting the field', async () => {
    const { id } = await newDraft();
    const before = await readDraft(id);
    assert.equal(before.payload.endCondition, 'normal');

    const res = await owner.patch(`/drafts/${id}`, {
      baseRev: before.rev, clientId: 'zz-owner', patch: { endCondition: null },
    });
    assert.equal(res.status, 200);

    const after = await readDraft(id);
    assert.ok('endCondition' in after.payload, 'the key should survive as an explicit null');
    assert.equal(after.payload.endCondition, null);
  });
});

/* ── Invite / join ────────────────────────────────────────────── */

describe('invite and join', () => {
  test('a signed-in non-participant cannot invite anyone into a draft', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await rando.post(`/drafts/${id}/invite`, { userId: randoUser.id });
    assert.equal(res.status, 403);
  });

  test('the invited opponent cannot invite a third party into the draft', async () => {
    const { id } = await newDraft();
    const res = await opponent.post(`/drafts/${id}/invite`, { userId: randoUser.id });
    assert.equal(res.status, 403);
  });

  test('an anonymous caller cannot invite anyone into a draft', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await guest.post(`/drafts/${id}/invite`, { userId: randoUser.id });
    assert.equal(res.status, 401);
  });

  test('the owner cannot invite themselves as their own opponent', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await owner.post(`/drafts/${id}/invite`, { userId: ownerUser.id });
    assert.equal(res.status, 400);
  });

  test('an invite with a non-integer userId is rejected', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await owner.post(`/drafts/${id}/invite`, { userId: 'not-a-number' });
    assert.equal(res.status, 400);
  });

  test('inviting a user id that does not exist is a 404', async () => {
    const { id } = await newDraft({ invite: false });
    const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0) + 100000 AS id FROM users');
    const res = await owner.post(`/drafts/${id}/invite`, { userId: rows[0].id });
    assert.equal(res.status, 404);
  });

  test('inviting a deactivated user is a 404', async () => {
    const dead = await createUser({ label: 'dperm_inactive', active: false });
    const { id } = await newDraft({ invite: false });
    const res = await owner.post(`/drafts/${id}/invite`, { userId: dead.id });
    assert.equal(res.status, 404);
  });

  test('inviting a second player once someone has joined is a 409', async () => {
    const { id } = await newDraft();  // opponent is already in seat 2
    const res = await owner.post(`/drafts/${id}/invite`, { userId: randoUser.id });
    assert.equal(res.status, 409);
    assert.equal((await readDraft(id)).opponent_user_id, opponentUser.id);
  });

  test('a signed-in non-participant cannot clear the invited opponent', async () => {
    const { id } = await newDraft();
    const res = await rando.del(`/drafts/${id}/invite`);
    assert.equal(res.status, 403);
  });

  test('the invited opponent cannot clear themselves out of the draft', async () => {
    const { id } = await newDraft();
    const res = await opponent.del(`/drafts/${id}/invite`);
    assert.equal(res.status, 403);
  });

  test('an anonymous caller cannot clear the invited opponent', async () => {
    const { id } = await newDraft();
    const res = await guest.del(`/drafts/${id}/invite`);
    assert.equal(res.status, 401);
  });

  test('the owner can clear the invited opponent', async () => {
    const { id } = await newDraft();
    const res = await owner.del(`/drafts/${id}/invite`);
    assert.equal(res.status, 200);
    assert.equal((await readDraft(id)).opponent_user_id, null);
  });

  test('joining with the wrong share token is rejected', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await rando.post(`/drafts/${id}/join`, { token: 'zz-not-the-token' });
    assert.equal(res.status, 403);
    assert.equal((await readDraft(id)).opponent_user_id, null);
  });

  test('joining with no token at all is rejected', async () => {
    const { id } = await newDraft({ invite: false });
    const res = await rando.post(`/drafts/${id}/join`, {});
    assert.equal(res.status, 403);
  });

  test('joining with the right share token claims the opponent seat', async () => {
    const { id, shareToken } = await newDraft({ invite: false });
    const res = await rando.post(`/drafts/${id}/join`, { token: shareToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.viewerSeat, 2);
    assert.equal(res.data.isOwner, false);
    assert.equal((await readDraft(id)).opponent_user_id, randoUser.id);
  });

  test('the owner cannot join their own game as the opponent', async () => {
    const { id, shareToken } = await newDraft({ invite: false });
    const res = await owner.post(`/drafts/${id}/join`, { token: shareToken });
    assert.equal(res.status, 400);
    assert.equal((await readDraft(id)).opponent_user_id, null);
  });

  test('joining a draft someone else already claimed is a 409', async () => {
    const { id, shareToken } = await newDraft();  // opponent already in seat 2
    const res = await rando.post(`/drafts/${id}/join`, { token: shareToken });
    assert.equal(res.status, 409);
  });

  test('an anonymous caller cannot join even with the right share token', async () => {
    const { id, shareToken } = await newDraft({ invite: false });
    const res = await guest.post(`/drafts/${id}/join`, { token: shareToken });
    assert.equal(res.status, 401);
  });
});

/* ── Submit and delete ────────────────────────────────────────── */

describe('submit and delete', () => {
  test('an invited opponent cannot finish the game', async () => {
    const { id } = await newDraft();
    assert.equal((await opponent.post(`/drafts/${id}/submit`, {})).status, 403);
  });

  test('a signed-in non-participant cannot finish the game', async () => {
    const { id } = await newDraft();
    assert.equal((await rando.post(`/drafts/${id}/submit`, {})).status, 403);
  });

  test('an anonymous caller cannot finish the game', async () => {
    const { id } = await newDraft();
    assert.equal((await guest.post(`/drafts/${id}/submit`, {})).status, 401);
  });

  test('the owner can finish the game', async () => {
    const { id } = await newDraft();
    const res = await owner.post(`/drafts/${id}/submit`, {});
    assert.equal(res.status, 200);
    assert.ok(Number.isInteger(res.data.gameId), 'submit should hand back a game id');
  });

  test('a signed-in non-participant cannot delete a draft', async () => {
    const { id } = await newDraft();
    assert.equal((await rando.del(`/drafts/${id}`)).status, 403);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 200);
  });

  test('the invited opponent cannot delete the draft', async () => {
    const { id } = await newDraft();
    assert.equal((await opponent.del(`/drafts/${id}`)).status, 403);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 200);
  });

  test('an anonymous caller cannot delete a draft', async () => {
    const { id } = await newDraft();
    assert.equal((await guest.del(`/drafts/${id}`)).status, 401);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 200);
  });

  test("an admin can delete someone else's draft", async () => {
    const { id } = await newDraft();
    assert.equal((await admin.del(`/drafts/${id}`)).status, 200);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 404);
  });

  test('the owner can delete their own draft', async () => {
    const { id } = await newDraft();
    assert.equal((await owner.del(`/drafts/${id}`)).status, 200);
    assert.equal((await owner.get(`/drafts/${id}`)).status, 404);
  });
});

/* ── Mid-game photos ──────────────────────────────────────────── */
// GET /:id/images is public; the writes are not.

describe('photo writes', () => {
  const photo = (caption) => ({ dataUrl: TINY_JPEG, caption, clientId: 'zz-test' });

  test('an anonymous caller cannot upload a mid-game photo', async () => {
    const { id } = await newDraft();
    assert.equal((await guest.post(`/drafts/${id}/images`, photo('zz anon'))).status, 401);
  });

  test('a signed-in non-participant cannot upload a mid-game photo', async () => {
    const { id } = await newDraft();
    assert.equal((await rando.post(`/drafts/${id}/images`, photo('zz rando'))).status, 403);
  });

  test('the owner can upload a mid-game photo', async () => {
    const { id } = await newDraft();
    const res = await owner.post(`/drafts/${id}/images`, photo('zz owner'));
    assert.equal(res.status, 201);
    assert.equal(res.data.draft_id, id);
  });

  test('an invited opponent can upload a mid-game photo', async () => {
    const { id } = await newDraft();
    const res = await opponent.post(`/drafts/${id}/images`, photo('zz opponent'));
    assert.equal(res.status, 201);
    assert.equal(res.data.draft_id, id);
  });

  test('an anonymous caller cannot delete a mid-game photo', async () => {
    const { id } = await newDraft();
    const up = await owner.post(`/drafts/${id}/images`, photo('zz owner'));
    assert.equal(up.status, 201);
    assert.equal((await guest.del(`/drafts/${id}/images/${up.data.id}`)).status, 401);
    assert.equal((await owner.get(`/drafts/${id}/images`)).data.length, 1);
  });

  test('a signed-in non-participant cannot delete a mid-game photo', async () => {
    const { id } = await newDraft();
    const up = await owner.post(`/drafts/${id}/images`, photo('zz owner'));
    assert.equal(up.status, 201);
    assert.equal((await rando.del(`/drafts/${id}/images/${up.data.id}`)).status, 403);
    assert.equal((await owner.get(`/drafts/${id}/images`)).data.length, 1);
  });

  test('the owner can delete a mid-game photo', async () => {
    const { id } = await newDraft();
    const up = await owner.post(`/drafts/${id}/images`, photo('zz owner'));
    assert.equal(up.status, 201);
    assert.equal((await owner.del(`/drafts/${id}/images/${up.data.id}`)).status, 200);
    assert.equal((await owner.get(`/drafts/${id}/images`)).data.length, 0);
  });
});

/* ── Lifecycle ────────────────────────────────────────────────── */
// A submitted draft is finished forever. The gate is submitted_at, NOT
// submitted_game_id — that column is ON DELETE SET NULL, so binding the check
// to it would un-finish a draft whose game was later deleted.

describe('a submitted draft', () => {
  let submittedId;

  before(async () => {
    const { id } = await newDraft();
    const res = await owner.post(`/drafts/${id}/submit`, {});
    assert.equal(res.status, 200, 'the fixture submit should succeed');
    submittedId = id;
  });

  test('rejects any further patch with a 409', async () => {
    const res = await owner.patch(`/drafts/${submittedId}`, {
      baseRev: null, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    });
    assert.equal(res.status, 409);
  });

  test('cannot be submitted a second time', async () => {
    assert.equal((await owner.post(`/drafts/${submittedId}/submit`, {})).status, 409);
  });

  test('rejects a new photo upload with a 409', async () => {
    const res = await owner.post(`/drafts/${submittedId}/images`, {
      dataUrl: TINY_JPEG, caption: 'zz too late', clientId: 'zz-test',
    });
    assert.equal(res.status, 409);
  });

  test('drops out of the open-drafts list', async () => {
    const res = await owner.get('/drafts');
    assert.equal(res.status, 200);
    assert.ok(!res.data.some((d) => d.id === submittedId), 'a finished game is not in progress');
  });

  test('stays finished even when the resulting game row is deleted', async () => {
    // submitted_game_id is ON DELETE SET NULL, so this is exactly the case that
    // once resurrected a finished game into the live list.
    const { id } = await newDraft();
    const sub = await owner.post(`/drafts/${id}/submit`, {});
    assert.equal(sub.status, 200);

    const del = await admin.del(`/admin/games/${sub.data.gameId}`);
    assert.equal(del.status, 200);

    const after = await owner.get(`/drafts/${id}`);
    assert.equal(after.status, 200);
    assert.equal(after.data.submitted_game_id, null, 'the pointer is expected to go null');
    assert.notEqual(after.data.submitted_at, null, 'but the draft is still finished');

    const list = await owner.get('/drafts');
    assert.ok(!list.data.some((d) => d.id === id), 'and must not come back to the live list');
    assert.equal((await owner.patch(`/drafts/${id}`, {
      baseRev: null, clientId: 'zz-owner', patch: { pointsLimit: 1500 },
    })).status, 409);
  });
});

/* ── Accounts ─────────────────────────────────────────────────── */

describe('inactive users', () => {
  test('a deactivated user cannot log in', async () => {
    const dead = await createUser({ label: 'dperm_disabled', active: false });
    assert.equal(await tryLogin(dead.username, PASSWORD), 401);
  });
});
