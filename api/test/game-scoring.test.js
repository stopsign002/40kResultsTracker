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

// ── 11th edition scoring ──────────────────────────────────────
// 11e replaces 10e's single 100-point ceiling with two independent 45-point
// halves and drops challenger cards. Reproduces the numbers from the reference
// screenshot the feature was built against: primary rounds 4/8/11/8/15 = 46 raw
// clipped to 45, secondaries 32, final 77.

function e11Player(over = {}) {
  return blankPlayer({ rounds: emptyRounds(), ...over });
}
function withPrimary(p, perRound) {
  p.rounds = perRound.map((v, i) => ({ roundNumber: i + 1, primaryScore: v, secondaryScore: 0 }));
  return p;
}

test('computeFinalScores 11e: reproduces the reference game (46 primary clips to 45, +32 = 77)', () => {
  const a = withPrimary(e11Player({ guestName: 'Steve' }), [4, 8, 11, 8, 15]);
  a.secondaries = [
    { cardName: 'A Grievous Blow', drawnRound: 1, roundNumber: 3, score: 5 },
    { cardName: 'Assassination', drawnRound: 4, roundNumber: 5, score: 5 },
    { cardName: 'Beacon', drawnRound: 1, roundNumber: 2, score: 5 },
    { cardName: 'Behind Enemy Lines', drawnRound: 4, roundNumber: 5, score: 3 },
    { cardName: 'Bring It Down', drawnRound: 3, roundNumber: 3, score: 5 },
    { cardName: 'Burden Of Trust', drawnRound: 2, roundNumber: 2, score: 4 },
    { cardName: 'Cleanse', drawnRound: 3, roundNumber: null, score: 0 },
    { cardName: 'Secure No Man\'s Land', drawnRound: 5, roundNumber: 5, score: 5 },
  ];
  const b = e11Player({ guestName: 'Brendon' });
  computeFinalScores([a, b], '11');
  assert.equal(a.finalScore, 77);
  assert.equal(a.result, 'win');
});

test('computeFinalScores 11e: each half caps independently, no cross-subsidy', () => {
  const p = withPrimary(e11Player(), [20, 20, 20, 0, 0]);      // 60 primary → 45
  p.secondaries = [{ cardName: 'X', roundNumber: 1, score: 10 }];
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.finalScore, 55, 'primary overflow must not top up the secondary half');
});

test('computeFinalScores 11e: secondary half caps at 45 too', () => {
  const p = e11Player();
  p.secondaries = ROUNDS.map(rn => ({ cardName: 'C' + rn, roundNumber: rn, score: 15 }));
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.finalScore, 45);
});

test('computeFinalScores 11e: challenger cards are ignored', () => {
  const p = withPrimary(e11Player(), [5, 0, 0, 0, 0]);
  p.challengers = [{ cardName: 'Old Gambit', roundNumber: 1, score: 20 }];
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.finalScore, 5);
});

test('computeFinalScores 11e: a held card scores on its scored round, not its draw round', () => {
  const p = e11Player();
  p.secondaries = [{ cardName: 'A Grievous Blow', drawnRound: 1, roundNumber: 3, score: 5 }];
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.rounds.find(r => r.roundNumber === 1).secondaryScore, 0);
  assert.equal(p.rounds.find(r => r.roundNumber === 3).secondaryScore, 5);
});

test('computeFinalScores 11e: an unscored card contributes nothing to any round', () => {
  const p = e11Player();
  p.secondaries = [{ cardName: 'Cleanse', drawnRound: 2, roundNumber: null, score: 0 }];
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.rounds.reduce((s, r) => s + r.secondaryScore, 0), 0);
  assert.equal(p.finalScore, 0);
});

test('computeFinalScores: 10e default is unchanged when no edition is passed', () => {
  const p = withPrimary(blankPlayer(), [20, 20, 20, 20, 20]);   // 100 primary
  p.secondaries = [{ cardName: 'X', roundNumber: 1, score: 15 }];
  computeFinalScores([p, blankPlayer()]);
  assert.equal(p.finalScore, 100, '10e clamps the combined total at 100');
});

// ── Round-totals entry (no card detail recorded) ──────────────
// Some games are logged from memory: nobody noted which secondary scored, only
// that N points came in during round R. The per-round figures must then be
// taken as entered rather than recomputed from an empty card list.

test('computeFinalScores 11e: per-round secondary totals count when no cards were recorded', () => {
  const p = withPrimary(e11Player(), [5, 5, 5, 5, 5]);   // 25 primary
  p.rounds[0].secondaryScore = 4;
  p.rounds[1].secondaryScore = 8;
  p.rounds[3].secondaryScore = 3;
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.finalScore, 25 + 15);
});

test('computeFinalScores 11e: entered round totals survive, not zeroed', () => {
  const p = e11Player();
  p.rounds[2].secondaryScore = 7;
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.rounds[2].secondaryScore, 7);
});

test('computeFinalScores 11e: cards win when present, round totals recomputed', () => {
  const p = e11Player();
  p.rounds[0].secondaryScore = 99;            // stale/bogus hand entry
  p.secondaries = [{ cardName: 'Beacon', drawnRound: 1, roundNumber: 1, score: 5 }];
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.rounds[0].secondaryScore, 5, 'card detail overrides the typed total');
  assert.equal(p.finalScore, 5);
});

test('computeFinalScores 11e: round totals still respect the 45 secondary cap', () => {
  const p = e11Player();
  for (const r of p.rounds) r.secondaryScore = 15;   // 75
  computeFinalScores([p, e11Player()], '11');
  assert.equal(p.finalScore, 45);
});

test('computeFinalScores 10e: round totals count when no cards or challengers exist', () => {
  const p = withPrimary(blankPlayer(), [10, 10, 0, 0, 0]);
  p.rounds[0].secondaryScore = 6;
  p.rounds[1].secondaryScore = 4;
  computeFinalScores([p, blankPlayer()]);
  assert.equal(p.finalScore, 30);
});

test('computeFinalScores 10e: a challenger alone still counts as card detail', () => {
  const p = withPrimary(blankPlayer(), [10, 0, 0, 0, 0]);
  p.rounds[0].secondaryScore = 99;
  p.challengers = [{ cardName: 'Gambit', roundNumber: 1, score: 8 }];
  computeFinalScores([p, blankPlayer()]);
  assert.equal(p.rounds[0].secondaryScore, 8);
  assert.equal(p.finalScore, 18);
});

// ── Chess-clock times ─────────────────────────────────────────
import { resolvePlayerTimes } from '../lib/game-scoring.js';

function timedPlayer(perRound, total) {
  const p = blankPlayer({ rounds: emptyRounds() });
  if (perRound) perRound.forEach((v, i) => { p.rounds[i].timeSeconds = v; });
  if (total !== undefined) p.timeSeconds = total;
  return p;
}

test('resolvePlayerTimes: per-round entries sum to the player total', () => {
  const p = timedPlayer([300, 420, 600, 180, 240]);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, 1740);
});

test('resolvePlayerTimes: a partially-clocked game sums only what is there', () => {
  const p = timedPlayer([300, null, 600, null, null]);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, 900);
});

test('resolvePlayerTimes: per-round wins over a stale typed total', () => {
  const p = timedPlayer([300, 300], 99999);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, 600, 'granular and headline figures must not disagree');
});

test('resolvePlayerTimes: typed total stands when no round has a time', () => {
  const p = timedPlayer(null, 3600);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, 3600);
});

test('resolvePlayerTimes: an unclocked game stays null rather than 0', () => {
  const p = timedPlayer(null);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, null, 'untimed is not a 0-second game');
});

test('resolvePlayerTimes: junk and negatives are discarded', () => {
  const p = timedPlayer(null, -5);
  resolvePlayerTimes([p]);
  assert.equal(p.timeSeconds, null);
  const q = timedPlayer(null, 'abc');
  resolvePlayerTimes([q]);
  assert.equal(q.timeSeconds, null);
});
