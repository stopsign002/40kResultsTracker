// Pins the Glicko-2 math against Mark Glickman's own worked example
// (http://www.glicko.net/glicko/glicko2.pdf, §"Example"). If these drift,
// the rating engine is wrong. Run with: cd api && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratePeriod, decayRd, expectedScore, newPlayer } from '../lib/glicko2.js';

test('glicko2: matches Glickman worked example', () => {
  const player = { rating: 1500, rd: 200, vol: 0.06 };
  const results = [
    { rating: 1400, rd: 30,  score: 1 }, // win
    { rating: 1550, rd: 100, score: 0 }, // loss
    { rating: 1700, rd: 300, score: 0 }, // loss
  ];
  const out = ratePeriod(player, results);
  assert.ok(Math.abs(out.rating - 1464.06) < 0.1, `rating ${out.rating}`);
  assert.ok(Math.abs(out.rd - 151.52) < 0.1, `rd ${out.rd}`);
  assert.ok(Math.abs(out.vol - 0.05999) < 0.0001, `vol ${out.vol}`);
});

test('glicko2: idle period only inflates RD, never past the ceiling', () => {
  const player = { rating: 1500, rd: 200, vol: 0.06 };
  const out = decayRd(player);
  assert.equal(out.rating, 1500);
  assert.ok(out.rd > 200, 'RD should grow when idle');
  assert.ok(out.rd <= 350, 'RD capped at 350');

  // A maximally-uncertain player stays capped.
  const fresh = decayRd(newPlayer());
  assert.ok(fresh.rd <= 350);
});

test('glicko2: empty result set decays like an idle period', () => {
  const player = { rating: 1600, rd: 120, vol: 0.06 };
  const out = ratePeriod(player, []);
  assert.equal(out.rating, 1600);
  assert.ok(out.rd > 120);
});

test('glicko2: expectedScore is symmetric and rating-ordered', () => {
  const even = expectedScore({ rating: 1500, rd: 50 }, { rating: 1500, rd: 50 });
  assert.ok(Math.abs(even - 0.5) < 1e-9, 'equal players → 50/50');

  const a = { rating: 1700, rd: 50 };
  const b = { rating: 1400, rd: 50 };
  const pa = expectedScore(a, b);
  const pb = expectedScore(b, a);
  assert.ok(pa > 0.5, 'stronger player favoured');
  assert.ok(Math.abs(pa + pb - 1) < 1e-9, 'probabilities sum to 1');

  // Higher uncertainty pulls the prediction toward 50/50.
  const confident = expectedScore({ rating: 1700, rd: 30 }, { rating: 1400, rd: 30 });
  const unsure = expectedScore({ rating: 1700, rd: 300 }, { rating: 1400, rd: 300 });
  assert.ok(confident > unsure, 'more certainty → more decisive prediction');
});
