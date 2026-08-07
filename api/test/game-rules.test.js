// Unit tests for app/js/game-rules.js — the client-side rules constants and
// score maths shared by views/game-form.js and views/live-game.js.
//
// WHY THIS FRONTEND MODULE IS TESTED FROM api/test/:
// game-rules.js and components.js are *frontend* files, but both are
// dependency-free ES modules that import cleanly in Node (they only touch the
// DOM from inside function bodies), and `npm test` runs from api/. Importing
// them by relative path from here also lets calcTotal() be diffed directly
// against the server's computeFinalScores(), which is the whole point of the
// last section of this file: game-rules.js is a hand-maintained mirror of
// api/lib/game-scoring.js and the two drifting apart is a documented hazard.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUNDS,
  FORCE_DISPOSITIONS,
  PRIMARY_MATRIX,
  E11_PRIMARY_CAP,
  E11_SECONDARY_CAP,
  parseDuration,
  sumPrimary,
  sumSecondaries,
  sumSecondaryPoints,
  capLabel,
  calcTotal,
} from '../../app/js/game-rules.js';
import { fmtDuration } from '../../app/js/components.js';
import { computeFinalScores } from '../lib/game-scoring.js';

const rounds = (primaries, secondaries = []) =>
  primaries.map((primaryScore, i) => ({
    roundNumber: i + 1,
    primaryScore,
    secondaryScore: secondaries[i] ?? 0,
  }));

const cards = (...scores) =>
  scores.map((score, i) => ({ cardName: `Card ${i + 1}`, roundNumber: i + 1, score }));

/* ── parseDuration ─────────────────────────────────────────────── */

test('parseDuration reads m:ss off a chess clock as whole seconds', () => {
  assert.equal(parseDuration('12:34'), 754);
  assert.equal(parseDuration('0:59'), 59);
  assert.equal(parseDuration('0:00'), 0);
});

test('parseDuration reads h:mm:ss as whole seconds', () => {
  assert.equal(parseDuration('1:05:30'), 3930);
  assert.equal(parseDuration('2:00:00'), 7200);
});

test('parseDuration treats a bare number as minutes, including a fractional one', () => {
  assert.equal(parseDuration('90'), 5400);
  assert.equal(parseDuration('7.5'), 450);
  assert.equal(parseDuration('0'), 0);
});

test('parseDuration rejects an out-of-range component rather than coercing it', () => {
  assert.equal(parseDuration('12:99'), null);
  assert.equal(parseDuration('1:99:00'), null);
  assert.equal(parseDuration('1:00:99'), null);
});

test('parseDuration returns null for junk and for blank input', () => {
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('12:ab'), null);
  assert.equal(parseDuration('1:2:3:4'), null);
  assert.equal(parseDuration('-5'), null);
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('   '), null);
  assert.equal(parseDuration(null), null);
  assert.equal(parseDuration(undefined), null);
});

test('fmtDuration is the inverse of parseDuration for representative clock values', () => {
  for (const text of ['12:34', '0:59', '1:05:30', '2:00:00']) {
    const seconds = parseDuration(text);
    assert.equal(fmtDuration(seconds), text, `round-trip failed for ${text}`);
    assert.equal(parseDuration(fmtDuration(seconds)), seconds);
  }
  // Bare-minute entry normalises to the clock rendering rather than back to itself.
  assert.equal(fmtDuration(parseDuration('90')), '1:30:00');
  assert.equal(fmtDuration(parseDuration('7.5')), '7:30');
  assert.equal(parseDuration('1:30:00'), 5400);
  assert.equal(parseDuration('7:30'), 450);
});

/* ── the sum helpers ───────────────────────────────────────────── */

test('sumPrimary adds the primary score of every round and treats a missing rounds array as zero', () => {
  assert.equal(sumPrimary({ rounds: rounds([4, 8, 11, 8, 15]) }), 46);
  assert.equal(sumPrimary({ rounds: [] }), 0);
  assert.equal(sumPrimary({}), 0);
  assert.equal(sumPrimary({ rounds: [{ roundNumber: 1 }, { roundNumber: 2, primaryScore: 5 }] }), 5);
});

test('sumSecondaries adds the score of every recorded card', () => {
  assert.equal(sumSecondaries({ secondaries: cards(5, 8, 4, 10, 5) }), 32);
  assert.equal(sumSecondaries({ secondaries: [] }), 0);
  assert.equal(sumSecondaries({}), 0);
});

test('sumSecondaryPoints prefers the cards when there are any and falls back to the per-round figures', () => {
  const withCards = { rounds: rounds([0, 0, 0, 0, 0], [99, 99, 0, 0, 0]), secondaries: cards(5, 8, 4) };
  assert.equal(sumSecondaryPoints(withCards), 17, 'cards outrank stale per-round totals');

  const roundsOnly = { rounds: rounds([0, 0, 0, 0, 0], [5, 5, 5, 5, 5]), secondaries: [] };
  assert.equal(sumSecondaryPoints(roundsOnly), 25);

  assert.equal(sumSecondaryPoints({}), 0);
});

/* ── capLabel ──────────────────────────────────────────────────── */

test('capLabel renders the plain figure over the cap when nothing is clipped', () => {
  assert.equal(capLabel(32, 45), '32 / 45');
  assert.equal(capLabel(0, 45), '0 / 45');
  assert.equal(capLabel(45, 45), '45 / 45');
});

test('capLabel shows the raw figure alongside the clipped one when the cap is biting', () => {
  assert.equal(capLabel(46, 45), '45 / 45 (46 raw)');
  assert.equal(capLabel(60, 45), '45 / 45 (60 raw)');
});

/* ── calcTotal: 11e ────────────────────────────────────────────── */

test('calcTotal for 11e caps the primary and secondary halves independently at 45 each', () => {
  const p = { rounds: rounds([20, 0, 0, 0, 0]), secondaries: cards(50) };
  assert.equal(calcTotal(p, '11'), Math.min(E11_PRIMARY_CAP, 20) + Math.min(E11_SECONDARY_CAP, 50));
  assert.equal(calcTotal(p, '11'), 65, 'a 50-point secondary half banks 45, no cross-subsidy');
});

test('calcTotal for 11e reproduces the pinned reference game: 46 raw primary clipped to 45, plus 32 secondary, is 77', () => {
  const p = { rounds: rounds([4, 8, 11, 8, 15]), secondaries: cards(5, 8, 4, 10, 5) };
  assert.equal(sumPrimary(p), 46);
  assert.equal(sumSecondaries(p), 32);
  assert.equal(calcTotal(p, '11'), 77);
});

test('calcTotal for 11e clips both halves at once when both overflow', () => {
  const p = { rounds: rounds([15, 15, 15, 15, 15]), secondaries: cards(30, 30) };
  assert.equal(calcTotal(p, '11'), 90);
});

/* ── calcTotal: 10e ────────────────────────────────────────────── */

test('calcTotal for 10e is the combined primary, secondary and challenger total capped at 100', () => {
  const p = {
    rounds: rounds([10, 10, 10, 0, 0]),
    secondaries: cards(8, 8, 4),
    challengers: [{ cardName: 'Command Insertion', roundNumber: 3, score: 10 }],
  };
  assert.equal(calcTotal(p, '10'), 30 + 20 + 10);
});

test('calcTotal for 10e clips the combined total at 100 rather than at two independent halves', () => {
  const p = { rounds: rounds([20, 20, 20, 10, 0]), secondaries: cards(20, 20) };
  assert.equal(calcTotal(p, '10'), 100, '70 + 40 = 110 raw, clipped to the single 100 ceiling');
});

/* ── the score-detail ladder ───────────────────────────────────── */

test('with cards recorded the cards are the source of truth and stale per-round secondary figures are ignored', () => {
  const p = {
    rounds: rounds([10, 10, 0, 0, 0], [99, 99, 99, 0, 0]),
    secondaries: cards(5, 5),
    finalScore: 12345,
  };
  assert.equal(calcTotal(p, '11'), 20 + 10);
});

test('with no cards but per-round figures present the typed round totals are taken as given', () => {
  const p = {
    rounds: rounds([10, 10, 10, 0, 0], [6, 6, 6, 0, 0]),
    secondaries: [],
    finalScore: 12345,
  };
  assert.equal(calcTotal(p, '11'), 30 + 18);
});

test('with neither cards nor round detail the submitted final score stands, clamped to 90 in 11e', () => {
  assert.equal(calcTotal({ rounds: rounds([0, 0, 0, 0, 0]), secondaries: [], finalScore: 83 }, '11'), 83);
  assert.equal(calcTotal({ rounds: [], secondaries: [], finalScore: 120 }, '11'), 90);
  assert.equal(calcTotal({ rounds: [], secondaries: [], finalScore: -5 }, '11'), 0);
  assert.equal(calcTotal({ rounds: [], secondaries: [], finalScore: null }, '11'), 0);
});

test('with neither cards nor round detail the submitted final score is clamped to 100 in 10e', () => {
  assert.equal(calcTotal({ rounds: [], secondaries: [], finalScore: 88 }, '10'), 88);
  assert.equal(calcTotal({ rounds: [], secondaries: [], finalScore: 150 }, '10'), 100);
});

/* ── frozen rules constants ────────────────────────────────────── */

test('ROUNDS is exactly the five battle rounds mirrored by the DB CHECK constraints', () => {
  assert.deepEqual(ROUNDS, [1, 2, 3, 4, 5]);
});

test('PRIMARY_MATRIX is a complete 5 by 5 grid whose keys match FORCE_DISPOSITIONS on both axes', () => {
  assert.equal(FORCE_DISPOSITIONS.length, 5);
  assert.equal(new Set(FORCE_DISPOSITIONS).size, 5, 'the five dispositions must be distinct');

  assert.deepEqual(Object.keys(PRIMARY_MATRIX).sort(), [...FORCE_DISPOSITIONS].sort());

  let cells = 0;
  for (const mine of FORCE_DISPOSITIONS) {
    const row = PRIMARY_MATRIX[mine];
    assert.ok(row, `PRIMARY_MATRIX is missing the row for ${mine}`);
    assert.deepEqual(Object.keys(row).sort(), [...FORCE_DISPOSITIONS].sort(), `row ${mine} has the wrong opponents`);
    for (const theirs of FORCE_DISPOSITIONS) {
      const mission = row[theirs];
      assert.equal(typeof mission, 'string', `${mine} vs ${theirs} is not a string`);
      assert.ok(mission.trim().length > 0, `${mine} vs ${theirs} is empty`);
      cells += 1;
    }
  }
  assert.equal(cells, 25);
});

/* ── the client/server mirror ──────────────────────────────────── */

// calcTotal() in app/js/game-rules.js is a HAND-MAINTAINED mirror of
// computeFinalScores() in api/lib/game-scoring.js. If they drift, the number the
// player watches during the game changes the instant they hit Save. This table
// runs both implementations over the same payloads and demands they agree
// exactly.
const MIRROR_CASES = [
  {
    name: '11e with cards, primary half clipped (the pinned reference game)',
    edition: '11',
    player: { rounds: rounds([4, 8, 11, 8, 15]), secondaries: cards(5, 8, 4, 10, 5), finalScore: 0 },
  },
  {
    name: '11e with cards, secondary half clipped',
    edition: '11',
    player: { rounds: rounds([20, 0, 0, 0, 0]), secondaries: cards(20, 20, 20), finalScore: 0 },
  },
  {
    name: '11e with cards, neither half clipped',
    edition: '11',
    player: { rounds: rounds([5, 5, 5, 5, 5]), secondaries: cards(4, 4, 4), finalScore: 0 },
  },
  {
    name: '11e rounds-only, no cards recorded',
    edition: '11',
    player: { rounds: rounds([10, 10, 10, 10, 10], [5, 5, 5, 5, 5]), secondaries: [], finalScore: 0 },
  },
  {
    name: '11e final-score-only, under the ceiling',
    edition: '11',
    player: { rounds: rounds([0, 0, 0, 0, 0]), secondaries: [], finalScore: 83 },
  },
  {
    name: '11e final-score-only, over the 90 ceiling',
    edition: '11',
    player: { rounds: [], secondaries: [], finalScore: 120 },
  },
  {
    name: '10e with cards and a challenger, under the 100 ceiling',
    edition: '10',
    player: {
      rounds: rounds([10, 10, 10, 0, 0]),
      secondaries: cards(8, 8, 4),
      challengers: [{ cardName: 'Command Insertion', roundNumber: 3, score: 10 }],
      finalScore: 0,
    },
  },
  {
    name: '10e with cards, combined total clipped at 100',
    edition: '10',
    player: { rounds: rounds([20, 20, 20, 10, 0]), secondaries: cards(20, 20), finalScore: 0 },
  },
  {
    name: '10e rounds-only, no cards recorded',
    edition: '10',
    player: { rounds: rounds([15, 15, 15, 5, 5], [6, 6, 6, 6, 6]), secondaries: [], finalScore: 0 },
  },
  {
    name: '10e final-score-only, over the 100 ceiling',
    edition: '10',
    player: { rounds: [], secondaries: [], finalScore: 150 },
  },
  {
    // Reachable from the 10e form: score mode "cards", one Secret Mission
    // scored, no secondary cards filled in. calcTotal() gates its challenger
    // sum on p.secondaries.length, while computeFinalScores() gates on
    // "cards OR challengers" — so the client silently drops the challenger
    // points and the on-screen total jumps the moment you hit Save.
    name: '10e with a challenger but no secondary cards',
    edition: '10',
    player: {
      rounds: rounds([10, 10, 10, 0, 0]),
      secondaries: [],
      challengers: [{ cardName: 'Unbroken Wall', roundNumber: 4, score: 10 }],
      finalScore: 0,
    },
  },
];

for (const { name, edition, player } of MIRROR_CASES) {
  test(`calcTotal agrees exactly with the server's computeFinalScores for ${name}`, () => {
    const forServer = [structuredClone(player)];
    computeFinalScores(forServer, edition);
    const client = calcTotal(structuredClone(player), edition);
    assert.equal(client, forServer[0].finalScore);
  });
}

test('calcTotal and computeFinalScores agree on every case in the mirror table at once', () => {
  const disagreements = [];
  for (const { name, edition, player } of MIRROR_CASES) {
    const forServer = [structuredClone(player)];
    computeFinalScores(forServer, edition);
    const client = calcTotal(structuredClone(player), edition);
    if (client !== forServer[0].finalScore) {
      disagreements.push(`${name}: client ${client} vs server ${forServer[0].finalScore}`);
    }
  }
  assert.deepEqual(disagreements, []);
});
