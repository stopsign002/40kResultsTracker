// Pure helpers from lib/ratings.js (no DB). computeRatings itself is exercised
// against the live DB via the /ratings smoke tests. Run: cd api && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeScore, balancedPairings, displayRating, displayConfidence } from '../lib/ratings.js';

test('outcomeScore: pure win/loss/draw when MoV off', () => {
  assert.equal(outcomeScore('win', 90, 10, false), 1);
  assert.equal(outcomeScore('loss', 10, 90, false), 0);
  assert.equal(outcomeScore('draw', 50, 50, false), 0.5);
  assert.equal(outcomeScore(null, 0, 0, false), null);
});

test('outcomeScore: margin of victory scales magnitude but keeps direction', () => {
  const blowout = outcomeScore('win', 95, 20, true);
  const squeaker = outcomeScore('win', 51, 49, true);
  assert.ok(blowout > squeaker, 'bigger margin → stronger win signal');
  assert.ok(squeaker > 0.5, 'any win stays above 0.5');
  assert.ok(blowout <= 1, 'never exceeds 1');
  // Losing side is the mirror image.
  assert.ok(Math.abs(outcomeScore('loss', 20, 95, true) + blowout - 1) < 1e-9);
  // A gap at/over MOV_FULL saturates to a full win.
  assert.equal(outcomeScore('win', 80, 10, true), 1);
});

test('displayRating: 1500 maps to 500 and clamps to 0–1000', () => {
  assert.equal(displayRating(1500), 500);
  assert.ok(displayRating(1700) > 500);
  assert.ok(displayRating(1300) < 500);
  assert.equal(displayRating(100), 0);   // clamped
  assert.equal(displayRating(3000), 1000); // clamped
  assert.ok(displayConfidence(350) > displayConfidence(50));
});

test('balancedPairings: pairs closest ratings, handles odd counts', () => {
  const players = [
    { userId: 1, rating: 1800, rd: 50 },
    { userId: 2, rating: 1780, rd: 50 },
    { userId: 3, rating: 1500, rd: 50 },
    { userId: 4, rating: 1490, rd: 50 },
  ];
  const [best] = balancedPairings(players);
  assert.equal(best.bye, null);
  // Closest-skill pairing is (1,2) and (3,4), not best-vs-worst.
  const sigs = best.pairs.map(p => [p.a, p.b].sort((x, y) => x - y).join('-')).sort();
  assert.deepEqual(sigs, ['1-2', '3-4']);
  for (const p of best.pairs) assert.ok(p.winProbA > 0 && p.winProbA < 1);

  const odd = balancedPairings(players.concat({ userId: 5, rating: 1200, rd: 50 }));
  assert.ok(odd[0].bye !== null, 'odd count yields a sit-out');
  assert.equal(odd[0].pairs.length, 2);
});
