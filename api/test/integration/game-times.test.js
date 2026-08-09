// Chess-clock totals through the real write path.
//
// A live-tracked game arrives with every round clocked, which made
// resolvePlayerTimes derive the player total forever — there was no way to
// correct it. `timeIsManual` is the opt-out; these pin the round-trip through
// POST /games, PUT /games/:id and GET /games/:id.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser, login, anon, reference, playablePayload, cleanup, closePool,
} from './_harness.js';

let user, factionId, gameId;

const CLOCKED = [600, 720, 540, 480, 300];   // 2640 total, as a live game arrives
const BY_HAND = 3000;

function clocked(body) {
  body.players.forEach((p) => {
    p.rounds.forEach((r, i) => { r.timeSeconds = CLOCKED[i]; });
  });
  return body;
}

async function seatOne() {
  const res = await anon().get(`/games/${gameId}`);
  assert.equal(res.status, 200);
  return res.data.players.find((p) => p.seat === 1);
}

test('setup', async () => {
  const u = await createUser({ label: 'time' });
  user = await login(u);
  const { factions } = await reference();
  factionId = factions[0].id;
});

test('a fully clocked game derives the player total from the rounds', async () => {
  const res = await user.post('/games', clocked(playablePayload({ factionId })));
  assert.equal(res.status, 200, JSON.stringify(res.data));
  gameId = res.data.id;

  const p = await seatOne();
  assert.equal(p.time_seconds, 2640);
  assert.equal(p.time_is_manual, false);
});

test('a hand-set total outranks the round clocks and survives the round-trip', async () => {
  const body = clocked(playablePayload({ factionId }));
  body.players[0].timeSeconds = BY_HAND;
  body.players[0].timeIsManual = true;
  assert.equal((await user.put(`/games/${gameId}`, body)).status, 200);

  const p = await seatOne();
  assert.equal(p.time_seconds, BY_HAND);
  assert.equal(p.time_is_manual, true);
  assert.deepEqual((p.rounds || []).map((r) => r.time_seconds), CLOCKED,
    'the round clocks stay on the record as whatever the timer saw');
});

test('the other seat is unaffected and stays derived', async () => {
  const res = await anon().get(`/games/${gameId}`);
  const p2 = res.data.players.find((p) => p.seat === 2);
  assert.equal(p2.time_seconds, 2640);
  assert.equal(p2.time_is_manual, false);
});

test('clearing the flag re-derives from the rounds', async () => {
  const body = clocked(playablePayload({ factionId }));
  body.players[0].timeSeconds = BY_HAND;
  body.players[0].timeIsManual = false;
  assert.equal((await user.put(`/games/${gameId}`, body)).status, 200);

  const p = await seatOne();
  assert.equal(p.time_seconds, 2640);
  assert.equal(p.time_is_manual, false);
});

test('a manual flag with an unusable total cannot strand the game untimed', async () => {
  const body = clocked(playablePayload({ factionId }));
  body.players[0].timeSeconds = 'not a duration';
  body.players[0].timeIsManual = true;
  assert.equal((await user.put(`/games/${gameId}`, body)).status, 200);

  const p = await seatOne();
  assert.equal(p.time_seconds, 2640);
  assert.equal(p.time_is_manual, false);
});

test('teardown', async () => {
  await cleanup();
  await closePool();
});
