// Smoke tests for the pure helpers used by the games endpoints. Run with:
//   cd api && npm test
// These do not touch the database; they exist mainly to lock in the
// payload-shape contract that has bitten us before (camelCase vs snake_case).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFinalScores, validateGameInput } from '../lib/game-scoring.js';

const ROUNDS = [1, 2, 3, 4, 5];
function emptyRounds() { return ROUNDS.map(n => ({ roundNumber: n, primaryScore: 0, secondaryScore: 0 })); }
function blankPlayer(over = {}) {
  return {
    userId: null, guestName: 'Test',
    factionId: 1, detachmentId: null,
    armyListCode: null, wentFirst: false, isAttacker: null,
    manualWinner: false,
    rounds: emptyRounds(),
    secondaries: [], challengers: [],
    ...over,
  };
}

test('computeFinalScores: zero-zero is a draw', () => {
  const players = [blankPlayer({ guestName: 'A' }), blankPlayer({ guestName: 'B' })];
  computeFinalScores(players);
  assert.equal(players[0].finalScore, 0);
  assert.equal(players[1].finalScore, 0);
  assert.equal(players[0].result, 'draw');
  assert.equal(players[1].result, 'draw');
});

test('computeFinalScores: primary scores roll up', () => {
  const a = blankPlayer({ guestName: 'A' });
  const b = blankPlayer({ guestName: 'B' });
  a.rounds[0].primaryScore = 15;
  a.rounds[1].primaryScore = 10;
  b.rounds[0].primaryScore = 5;
  computeFinalScores([a, b]);
  assert.equal(a.finalScore, 25);
  assert.equal(b.finalScore, 5);
  assert.equal(a.result, 'win');
  assert.equal(b.result, 'loss');
});

test('computeFinalScores: secondary scores fold in via cards (not r.secondaryScore)', () => {
  // Critical regression test for the camelCase / snake_case bug.
  // computeFinalScores reads secondaries[].score (camelCase payload),
  // NOT game_rounds.secondary_score (DB row).
  const a = blankPlayer({ guestName: 'A' });
  a.secondaries.push({ cardId: 1, cardName: 'Foo', roundNumber: 1, score: 4 });
  a.secondaries.push({ cardId: 2, cardName: 'Bar', roundNumber: 2, score: 7 });
  a.challengers.push({ cardId: 9, cardName: 'Plough', roundNumber: 3, score: 5 });
  const b = blankPlayer({ guestName: 'B' });
  computeFinalScores([a, b]);
  assert.equal(a.finalScore, 16);
  // Per-round secondary_score must also be derived correctly
  assert.equal(a.rounds[0].secondaryScore, 4);
  assert.equal(a.rounds[1].secondaryScore, 7);
  assert.equal(a.rounds[2].secondaryScore, 5);
  assert.equal(a.rounds[3].secondaryScore, 0);
});

test('computeFinalScores: clamps to 100', () => {
  const a = blankPlayer({ guestName: 'A' });
  a.rounds.forEach(r => r.primaryScore = 100); // 500 raw
  const b = blankPlayer({ guestName: 'B' });
  computeFinalScores([a, b]);
  assert.equal(a.finalScore, 100);
});

test('computeFinalScores: manualWinner overrides higher score', () => {
  const a = blankPlayer({ guestName: 'A' });
  const b = blankPlayer({ guestName: 'B', manualWinner: true });
  a.rounds[0].primaryScore = 50;
  computeFinalScores([a, b]);
  assert.equal(b.result, 'win');
  assert.equal(a.result, 'loss');
});

test('computeFinalScores: both manualWinner = draw', () => {
  const a = blankPlayer({ guestName: 'A', manualWinner: true });
  const b = blankPlayer({ guestName: 'B', manualWinner: true });
  a.rounds[0].primaryScore = 50;
  computeFinalScores([a, b]);
  assert.equal(a.result, 'draw');
  assert.equal(b.result, 'draw');
});

test('validateGameInput: rejects missing playedAt', () => {
  assert.throws(() => validateGameInput({ pointsLimit: 2000, players: [blankPlayer(), blankPlayer()] }),
    /playedAt required/);
});

test('validateGameInput: rejects missing pointsLimit', () => {
  assert.throws(() => validateGameInput({ playedAt: '2025-01-01', players: [blankPlayer(), blankPlayer()] }),
    /pointsLimit required/);
});

test('validateGameInput: requires exactly two players', () => {
  assert.throws(() => validateGameInput({ playedAt: '2025-01-01', pointsLimit: 2000, players: [blankPlayer()] }),
    /exactly 2 players/);
});

test('validateGameInput: each player needs userId or guestName', () => {
  const noName = blankPlayer({ guestName: null, userId: null });
  assert.throws(() => validateGameInput({ playedAt: '2025-01-01', pointsLimit: 2000, players: [noName, blankPlayer()] }),
    /each player needs/);
});

test('validateGameInput: passes a well-formed payload', () => {
  assert.doesNotThrow(() => validateGameInput({
    playedAt: '2025-01-01',
    pointsLimit: 2000,
    players: [blankPlayer({ guestName: 'A' }), blankPlayer({ guestName: 'B' })],
  }));
});
