// Tests for the whole-history (global Bradley-Terry) fit. No DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitGlobal } from '../lib/whr.js';

const g = (a, b, s) => ({ a, b, s });

test('whr: transitive ordering A>B>C emerges from the global fit', () => {
  // A beat B, B beat C. A never played C, but should still rank above C.
  const r = fitGlobal([g(1, 2, 1), g(2, 3, 1)]);
  assert.ok(r.get(1).rating > r.get(2).rating, 'A > B');
  assert.ok(r.get(2).rating > r.get(3).rating, 'B > C');
  assert.ok(r.get(1).rating > r.get(3).rating, 'A > C transitively');
  // B sits near the prior centre (balanced 1 win, 1 loss).
  assert.ok(Math.abs(r.get(2).rating - 1500) < 1, 'B ~ 1500');
});

test('whr: an undefeated player stays finite (prior regularises)', () => {
  const r = fitGlobal([g(1, 2, 1), g(1, 3, 1)]);
  assert.ok(Number.isFinite(r.get(1).rating), 'finite despite 100% win rate');
  assert.ok(r.get(1).rating > 1500, 'still rated above the field');
  assert.ok(r.get(1).rating < 2600, 'but reined in by the prior');
});

test('whr: symmetric results land both players at the centre', () => {
  const r = fitGlobal([g(1, 2, 1), g(2, 1, 1)]); // each beat the other once
  assert.ok(Math.abs(r.get(1).rating - 1500) < 1);
  assert.ok(Math.abs(r.get(2).rating - 1500) < 1);
});

test('whr: more games → lower uncertainty', () => {
  const games = [g(1, 2, 1), g(1, 2, 0), g(1, 2, 1), g(1, 2, 0), g(1, 3, 1)];
  const r = fitGlobal(games);
  // Player 1 (5 games) is more certain than player 3 (1 game).
  assert.ok(r.get(1).rd < r.get(3).rd, 'more games → smaller RD');
  // A zero-game player would sit at the prior RD ceiling.
  assert.ok(r.get(3).rd <= 350);
});

test('whr: margin-of-victory score moves the estimate more than a draw', () => {
  const blowout = fitGlobal([g(1, 2, 0.95)]);
  const draw = fitGlobal([g(1, 2, 0.5)]);
  assert.ok(blowout.get(1).rating > draw.get(1).rating, 'decisive win rates higher');
  assert.ok(Math.abs(draw.get(1).rating - 1500) < 1, 'a draw keeps you at centre');
});
