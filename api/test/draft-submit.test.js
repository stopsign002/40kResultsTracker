import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraftRounds, validateDraftSubmit } from '../lib/draft.js';
import { computeFinalScores } from '../lib/game-scoring.js';

const player = (over = {}) => ({
  userId: null, guestName: 'Alec', factionId: 1, finalScore: 0, result: null,
  rounds: [], secondaries: [], challengers: [], ...over,
});

const submittable = (over = {}) => ({
  playedAt: '2026-08-06',
  pointsLimit: 2000,
  players: [player(), player({ guestName: 'Sarah', factionId: 2 })],
  ...over,
});

// ── validateDraftSubmit ───────────────────────────────────────

test('validateDraftSubmit accepts a complete draft', () => {
  assert.doesNotThrow(() => validateDraftSubmit(submittable()));
});

test('validateDraftSubmit names the missing date', () => {
  assert.throws(() => validateDraftSubmit(submittable({ playedAt: null })),
    /set the date this game was played/);
});

test('validateDraftSubmit names the missing points limit', () => {
  assert.throws(() => validateDraftSubmit(submittable({ pointsLimit: null })),
    /set the points limit/);
});

test('validateDraftSubmit rejects a wrong player count', () => {
  assert.throws(() => validateDraftSubmit(submittable({ players: [player()] })),
    /exactly 2 players/);
  assert.throws(() => validateDraftSubmit(submittable({ players: null })),
    /exactly 2 players/);
});

test('validateDraftSubmit points at the nameless seat', () => {
  const body = submittable();
  body.players[1].guestName = null;
  assert.throws(() => validateDraftSubmit(body), /player 2 still needs a name/);
});

test('validateDraftSubmit accepts a seat identified by userId alone', () => {
  const body = submittable();
  body.players[1] = player({ guestName: null, userId: 7 });
  assert.doesNotThrow(() => validateDraftSubmit(body));
});

test('validateDraftSubmit rejects an empty payload', () => {
  assert.throws(() => validateDraftSubmit(null), /nothing recorded/);
});

// ── round-number clamping ─────────────────────────────────────

test('rounds with no round number are dropped', () => {
  const p = { players: [player({ rounds: [
    { roundNumber: 1, primaryScore: 5 },
    { roundNumber: null, primaryScore: 3 },
    { primaryScore: 4 },
    { roundNumber: '', primaryScore: 9 },
  ] })] };
  normalizeDraftRounds(p);
  assert.deepEqual(p.players[0].rounds.map(r => r.roundNumber), [1]);
});

test('rounds outside 1-5 are dropped, not clamped onto an existing round', () => {
  const p = { players: [player({ rounds: [
    { roundNumber: 0, primaryScore: 1 },
    { roundNumber: 5, primaryScore: 2 },
    { roundNumber: 6, primaryScore: 3 },
    { roundNumber: 99, primaryScore: 4 },
  ] })] };
  normalizeDraftRounds(p);
  assert.deepEqual(p.players[0].rounds.map(r => r.roundNumber), [5]);
  assert.deepEqual(p.players[0].rounds.map(r => r.primaryScore), [2]);
});

test('duplicate round numbers are dropped so the unique index cannot fire', () => {
  const p = { players: [player({ rounds: [
    { roundNumber: 2, primaryScore: 7 },
    { roundNumber: 2, primaryScore: 8 },
    { roundNumber: '3', primaryScore: 9 },
  ] })] };
  normalizeDraftRounds(p);
  assert.deepEqual(p.players[0].rounds.map(r => r.roundNumber), [2, 3]);
  assert.deepEqual(p.players[0].rounds.map(r => r.primaryScore), [7, 9]);
});

test('secondary roundNumber and drawnRound clamp into 1-5', () => {
  const p = { players: [player({ secondaries: [
    { cardName: 'A', score: 5, roundNumber: 0, drawnRound: 9 },
    { cardName: 'B', score: 3, roundNumber: 7, drawnRound: 2 },
    { cardName: 'C', score: 2, roundNumber: null, drawnRound: undefined },
    { cardName: 'D', score: 4, roundNumber: 'x', drawnRound: 3 },
  ] })] };
  normalizeDraftRounds(p);
  assert.deepEqual(p.players[0].secondaries.map(s => [s.roundNumber, s.drawnRound]), [
    [1, 5], [5, 2], [null, null], [null, 3],
  ]);
});

test('validateDraftSubmit normalises rounds on its way through', () => {
  const body = submittable();
  body.players[0].rounds = [{ roundNumber: 8, primaryScore: 5 }, { primaryScore: 2 }];
  validateDraftSubmit(body);
  assert.deepEqual(body.players[0].rounds, []);
});

// ── 11e caps via computeFinalScores ───────────────────────────

test('11e halves cap independently at 45/45 for a submitted draft', () => {
  const body = submittable();
  body.players[0].rounds = [1, 2, 3, 4, 5].map(n => ({ roundNumber: n, primaryScore: 12 }));
  body.players[0].secondaries = [1, 2, 3, 4, 5].map(n => ({ cardName: `S${n}`, roundNumber: n, score: 12 }));
  body.players[1].rounds = [{ roundNumber: 1, primaryScore: 10 }];
  validateDraftSubmit(body);
  computeFinalScores(body.players, '11');
  assert.equal(body.players[0].finalScore, 90);
  assert.equal(body.players[0].result, 'win');
  assert.equal(body.players[1].finalScore, 10);
});

test('11e reference game: 46 primary clips to 45, secondaries 32, final 77', () => {
  const body = submittable();
  body.players[0].rounds = [4, 8, 11, 8, 15].map((primaryScore, i) => ({ roundNumber: i + 1, primaryScore }));
  body.players[0].secondaries = [
    { cardName: 'a', roundNumber: 1, score: 5 },
    { cardName: 'b', roundNumber: 2, score: 8 },
    { cardName: 'c', roundNumber: 3, score: 4 },
    { cardName: 'd', roundNumber: 4, score: 10 },
    { cardName: 'e', roundNumber: 5, score: 5 },
  ];
  validateDraftSubmit(body);
  computeFinalScores(body.players, '11');
  assert.equal(body.players[0].finalScore, 77);
});

test('an out-of-range round is gone before it can inflate the 11e primary half', () => {
  const body = submittable();
  body.players[0].rounds = [
    ...[1, 2, 3, 4, 5].map(n => ({ roundNumber: n, primaryScore: 5 })),
    { roundNumber: 6, primaryScore: 40 },
  ];
  validateDraftSubmit(body);
  computeFinalScores(body.players, '11');
  assert.equal(body.players[0].finalScore, 25);
});
