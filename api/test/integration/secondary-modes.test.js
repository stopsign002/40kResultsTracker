// Tactical vs Fixed secondary missions through the real write path.
//
// The choice is made per player and in secret, so the two seats can differ —
// this pins that the column is per-seat and not a game-level flag. A Fixed
// mission is never discarded and scores in EVERY round it is met, so it holds
// one player_secondaries row PER SCORING ROUND; the round-by-round secondary
// figures have to fall out of that unchanged.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser, login, anon, reference, playablePayload, cleanup, closePool,
} from './_harness.js';

let user, factionId, packId, cards, gameId;

// Seed casing, not GDC's — the DB is what findCardId matches against.
const BRING = 'Bring it Down';
const ASSASSIN = 'Assassination';

const cardId = (name) =>
  (cards.find((c) => c.name.toLowerCase() === name.toLowerCase()) || {}).id ?? null;

function fixedSeat(p) {
  p.secondaryMode = 'fixed';
  p.secondaries = [
    // Bring it Down scored in two separate rounds — the shape Tactical cannot have.
    { cardId: cardId(BRING), cardName: BRING, drawnRound: null, roundNumber: 1, score: 4 },
    { cardId: cardId(BRING), cardName: BRING, drawnRound: null, roundNumber: 3, score: 8 },
    // Chosen but never scored: the pick still has to survive the round-trip.
    { cardId: cardId(ASSASSIN), cardName: ASSASSIN, drawnRound: null, roundNumber: null, score: 0 },
  ];
  return p;
}

async function seats() {
  const res = await anon().get(`/games/${gameId}`);
  assert.equal(res.status, 200);
  return {
    one: res.data.players.find((p) => p.seat === 1),
    two: res.data.players.find((p) => p.seat === 2),
  };
}

test('setup', async () => {
  const u = await createUser({ label: 'sec' });
  user = await login(u);
  const { factions, pack, details } = await reference();
  factionId = factions[0].id;
  packId = pack.id;
  cards = details.secondaryCards || [];
  assert.ok(cardId(BRING), `the 11e pack should carry "${BRING}"`);
});

test('a game can be Fixed on one seat and Tactical on the other', async () => {
  const body = playablePayload({ factionId });
  body.missionPackId = packId;
  fixedSeat(body.players[0]);
  body.players[1].secondaryMode = 'tactical';
  body.players[1].secondaries = [
    { cardId: cardId(ASSASSIN), cardName: ASSASSIN, drawnRound: 2, roundNumber: 2, score: 5 },
  ];

  const res = await user.post('/games', body);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  gameId = res.data.id;

  const { one, two } = await seats();
  assert.equal(one.secondary_mode, 'fixed');
  assert.equal(two.secondary_mode, 'tactical', 'the choice is per player, not per game');
});

test('a Fixed mission keeps one row per scoring round', async () => {
  const { one } = await seats();
  const bring = one.secondaries.filter((s) => s.card_name === BRING);
  assert.equal(bring.length, 2);
  assert.deepEqual(bring.map((s) => s.round_number).sort(), [1, 3]);
  assert.equal(bring.reduce((sum, s) => sum + s.score, 0), 12);
});

test('a Fixed mission chosen but never scored survives as its own row', async () => {
  const { one } = await seats();
  const picked = one.secondaries.filter((s) => s.card_name === ASSASSIN);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].round_number, null);
  assert.equal(picked[0].score, 0);
});

test('per-round secondary figures still derive from the rows', async () => {
  const { one } = await seats();
  const byRound = Object.fromEntries(one.rounds.map((r) => [r.round_number, r.secondary_score]));
  assert.equal(byRound[1], 4);
  assert.equal(byRound[2], 0);
  assert.equal(byRound[3], 8);
});

test('the player total counts every Fixed scoring round once', async () => {
  const { one } = await seats();
  // playablePayload gives seat 1 five rounds of 5 primary = 25, plus 12 secondary.
  assert.equal(one.final_score, 37);
});

test('an unknown secondary mode is stored as tactical, not rejected', async () => {
  const body = playablePayload({ factionId, p1: 'ZZ Junk One', p2: 'ZZ Junk Two' });
  body.missionPackId = packId;
  body.players[0].secondaryMode = 'nonsense';
  const res = await user.post('/games', body);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const got = await anon().get(`/games/${res.data.id}`);
  assert.equal(got.data.players.find((p) => p.seat === 1).secondary_mode, 'tactical');
});

test('editing a game preserves the per-seat mode', async () => {
  const body = playablePayload({ factionId });
  body.missionPackId = packId;
  fixedSeat(body.players[0]);
  assert.equal((await user.put(`/games/${gameId}`, body)).status, 200);
  const { one } = await seats();
  assert.equal(one.secondary_mode, 'fixed');
  assert.equal(one.secondaries.filter((s) => s.card_name === BRING).length, 2);
});

test('switching a seat back to Tactical clears the mode', async () => {
  const body = playablePayload({ factionId });
  body.missionPackId = packId;
  body.players[0].secondaryMode = 'tactical';
  body.players[0].secondaries = [];
  assert.equal((await user.put(`/games/${gameId}`, body)).status, 200);
  const { one } = await seats();
  assert.equal(one.secondary_mode, 'tactical');
  assert.equal(one.secondaries.length, 0);
});

test('teardown', async () => {
  await cleanup();
  await closePool();
});
