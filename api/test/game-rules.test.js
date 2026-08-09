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
  E11_PRIMARY_ROUND_CAP,
  E11_SECONDARY_ROUND_CAP,
  sumSecondaryForRound,
  secondaryRoundHeadroom,
  cumulativeTimeThrough,
  roundTimeFromClock,
  parseDuration,
  sumPrimary,
  sumSecondaries,
  sumSecondaryPoints,
  capLabel,
  calcTotal,
  E11_FIXED_CARD_CAP,
  FIXED_SECONDARY_COUNT,
  secondaryMode,
  isFixedMode,
  foldCardName,
  fixedCardTotal,
  fixedCardHeadroom,
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

/* ── Per-battle-round caps ─────────────────────────────────────────
 * 11e caps each half at 15 VP per round as well as 45 per game. These are
 * INPUT ceilings enforced by the live tracker, deliberately NOT a clamp inside
 * calcTotal / computeFinalScores — clamping the maths would rewrite the total
 * of an already-recorded game the next time it was saved. The last test here is
 * what pins that decision.
 */

test('the per-round caps match the mission pack the app ships', async () => {
  const fs = await import('node:fs/promises');
  const url = new URL('../../app/data/mission-cards-11e.json', import.meta.url);
  const pack = JSON.parse(await fs.readFile(url, 'utf8'));
  assert.equal(E11_PRIMARY_ROUND_CAP, pack.limits.primaryRound);
  assert.equal(E11_SECONDARY_ROUND_CAP, pack.limits.secondaryRound);
  // ...and the game-level ones we already had, so a pack update that moved
  // either number can't slip past unnoticed.
  assert.equal(E11_PRIMARY_CAP, pack.limits.primaryGame);
  assert.equal(E11_SECONDARY_CAP, pack.limits.secondaryGame);
  // Per FIXED CARD, per game — not 20 shared between the two.
  assert.equal(E11_FIXED_CARD_CAP, pack.limits.fixedSecondaryCap);
});

// ── Fixed secondary missions ──────────────────────────────────
// Only four of the eighteen may be taken Fixed, and the deck says so itself by
// giving those cards a second scoring block. If GW widens the pool this test
// fails, which is the point — the app derives the list from this data.

test('exactly four secondaries are Fixed-legal, and they are the expected four', async () => {
  const fs = await import('node:fs/promises');
  const url = new URL('../../app/data/mission-cards-11e.json', import.meta.url);
  const pack = JSON.parse(await fs.readFile(url, 'utf8'));
  const fixed = pack.secondaryMissions.filter((c) => c.fixed).map((c) => c.name).sort();
  assert.deepEqual(fixed,
    ['A Grievous Blow', 'Assassination', 'Bring It Down', 'Engage On All Fronts']);
  assert.equal(fixed.length, 4);
});

test('every Fixed-legal card carries both a fixed and a tactical scoring row', async () => {
  const fs = await import('node:fs/promises');
  const url = new URL('../../app/data/mission-cards-11e.json', import.meta.url);
  const pack = JSON.parse(await fs.readFile(url, 'utf8'));
  for (const card of pack.secondaryMissions.filter((c) => c.fixed)) {
    const modes = new Set(card.objectives.flatMap((o) => o.scoring.map((r) => r.mode)));
    assert.ok(modes.has('fixed'), `${card.name} has no fixed scoring row`);
    assert.ok(modes.has('tactical'), `${card.name} has no tactical scoring row`);
  }
});

test('secondaryMode defaults to tactical and rejects junk', () => {
  assert.equal(secondaryMode(undefined), 'tactical');
  assert.equal(secondaryMode({}), 'tactical');
  assert.equal(secondaryMode({ secondaryMode: 'nonsense' }), 'tactical');
  assert.equal(secondaryMode({ secondaryMode: 'fixed' }), 'fixed');
  assert.equal(isFixedMode({ secondaryMode: 'fixed' }), true);
  assert.equal(isFixedMode({ secondaryMode: 'tactical' }), false);
});

test('foldCardName bridges GDC title-case and GW casing', () => {
  assert.equal(foldCardName('Bring It Down'), foldCardName('Bring it Down'));
  assert.equal(foldCardName('Engage On All Fronts'), foldCardName('Engage on All Fronts'));
  assert.notEqual(foldCardName('Assassination'), foldCardName('A Grievous Blow'));
});

// A Fixed mission is never discarded, so it holds one entry per round it
// scored — the total is what the 20 VP per-card ceiling applies to.
test('fixedCardTotal sums every round a Fixed mission scored in', () => {
  const p = { secondaries: [
    { cardName: 'Bring it Down', roundNumber: 1, score: 4 },
    { cardName: 'Bring It Down', roundNumber: 3, score: 8 },
    { cardName: 'Assassination', roundNumber: 2, score: 3 },
  ] };
  assert.equal(fixedCardTotal(p, 'Bring It Down'), 12, 'case must not split a card in two');
  assert.equal(fixedCardTotal(p, 'Assassination'), 3);
  assert.equal(fixedCardHeadroom(p, 'Bring it Down'), E11_FIXED_CARD_CAP - 12);
});

test('fixedCardHeadroom excludes the entry being edited so it cannot ratchet down', () => {
  const entry = { cardName: 'Assassination', roundNumber: 2, score: 6 };
  const p = { secondaries: [entry] };
  assert.equal(fixedCardHeadroom(p, 'Assassination'), E11_FIXED_CARD_CAP - 6);
  assert.equal(fixedCardHeadroom(p, 'Assassination', entry), E11_FIXED_CARD_CAP,
    're-saving a card at its own number must not shrink its own headroom');
});

test('fixedCardHeadroom never goes negative', () => {
  const p = { secondaries: [{ cardName: 'Bring it Down', roundNumber: 1, score: 40 }] };
  assert.equal(fixedCardHeadroom(p, 'Bring it Down'), 0);
});

test('two Fixed missions ceiling under the game secondary cap', () => {
  assert.ok(FIXED_SECONDARY_COUNT * E11_FIXED_CARD_CAP <= E11_SECONDARY_CAP,
    'the per-card cap must not let Fixed outscore the 45 VP secondary ceiling');
});

test('sumSecondaryForRound totals the cards that SCORED in a round, not the ones drawn in it', () => {
  const p = {
    secondaries: [
      { cardName: 'drawn r1, scored r2', drawnRound: 1, roundNumber: 2, score: 5 },
      { cardName: 'drawn r2, scored r2', drawnRound: 2, roundNumber: 2, score: 4 },
      { cardName: 'drawn r1, scored r3', drawnRound: 1, roundNumber: 3, score: 7 },
      { cardName: 'still in hand',       drawnRound: 2, roundNumber: null, score: 0 },
      { cardName: 'discarded in r2',     drawnRound: 1, roundNumber: 2, score: 0, wasDiscarded: true },
    ],
  };
  assert.equal(sumSecondaryForRound(p, 1), 0, 'nothing SCORED in round 1');
  assert.equal(sumSecondaryForRound(p, 2), 9);
  assert.equal(sumSecondaryForRound(p, 3), 7);
  assert.equal(sumSecondaryForRound(p, 4), 0);
  assert.equal(sumSecondaryForRound({}, 1), 0, 'a player with no cards is 0, not a throw');
});

test('the round caps are input ceilings — the scoring maths must NOT clamp per round', () => {
  // A game that breaches 15 in a round but stays under 45 overall. Both sides
  // must still report the raw total: the tracker stops you entering this, but
  // anything already recorded has to read back exactly as it was saved.
  const player = {
    rounds: [
      { roundNumber: 1, primaryScore: 20, secondaryScore: 0 },
      { roundNumber: 2, primaryScore: 5, secondaryScore: 0 },
    ],
    secondaries: [
      { cardName: 'over the round cap', drawnRound: 1, roundNumber: 1, score: 18 },
    ],
  };
  const forServer = [structuredClone(player)];
  computeFinalScores(forServer, '11');
  assert.equal(forServer[0].finalScore, 43, '25 primary + 18 secondary, neither game cap reached');
  assert.equal(calcTotal(structuredClone(player), '11'), forServer[0].finalScore);
});

test('secondaryRoundHeadroom spans cards, because the 15 is a ceiling on the ROUND', () => {
  const p = {
    secondaries: [
      { cardName: 'a', roundNumber: 2, score: 6 },
      { cardName: 'b', roundNumber: 2, score: 4 },
      { cardName: 'c', roundNumber: 3, score: 15 },
      { cardName: 'hand', roundNumber: null, score: 0 },
    ],
  };
  assert.equal(secondaryRoundHeadroom(p, 1), E11_SECONDARY_ROUND_CAP, 'an untouched round is wide open');
  assert.equal(secondaryRoundHeadroom(p, 2), 5, '15 - (6 + 4)');
  assert.equal(secondaryRoundHeadroom(p, 3), 0, 'a full round offers nothing');
  assert.equal(secondaryRoundHeadroom(p, null), E11_SECONDARY_ROUND_CAP,
    'a card with no scored round yet is not constrained by any round');
});

test('secondaryRoundHeadroom excludes the entry being edited, so re-saving cannot ratchet it down', () => {
  const entry = { cardName: 'a', roundNumber: 2, score: 6 };
  const p = { secondaries: [entry, { cardName: 'b', roundNumber: 2, score: 4 }] };
  // Without the exclusion this would be 5, and re-entering 6 would clamp to 5,
  // then 4 the next time, and so on.
  assert.equal(secondaryRoundHeadroom(p, 2, entry), 11, '15 - 4, the OTHER card only');
  assert.equal(Math.min(entry.score, secondaryRoundHeadroom(p, 2, entry)), 6,
    're-clamping an unchanged entry must leave it alone');
});

test('secondaryRoundHeadroom never goes negative on data that already breaches the cap', () => {
  // Reachable from a game recorded before the caps existed. The clamp must
  // offer 0, not a negative number that would flip a score to below zero.
  const p = { secondaries: [{ cardName: 'legacy', roundNumber: 4, score: 22 }] };
  assert.equal(secondaryRoundHeadroom(p, 4), 0);
  assert.equal(secondaryRoundHeadroom({}, 4), E11_SECONDARY_ROUND_CAP, 'no cards is not a throw');
});

/* ── Count-up chess clock ──────────────────────────────────────────
 * The clock is never reset between rounds, so a reading is CUMULATIVE. What
 * gets stored is still the per-round figure; the subtraction happens at entry.
 */

const clocked = (...perRound) => ({
  rounds: perRound.map((timeSeconds, i) => ({ roundNumber: i + 1, timeSeconds })),
});

test('cumulativeTimeThrough adds up everything banked to the end of a round', () => {
  const p = clocked(300, 240, 420);           // 5:00, 4:00, 7:00
  assert.equal(cumulativeTimeThrough(p, 0), 0, 'nothing is banked before round 1');
  assert.equal(cumulativeTimeThrough(p, 1), 300);
  assert.equal(cumulativeTimeThrough(p, 2), 540);
  assert.equal(cumulativeTimeThrough(p, 3), 960);
  assert.equal(cumulativeTimeThrough(p, 5), 960, 'rounds that were never played add nothing');
  assert.equal(cumulativeTimeThrough({}, 3), 0, 'a player with no rounds is 0, not a throw');
});

test('an unclocked round counts as zero rather than breaking the chain', () => {
  // Forgetting to note round 2 must not make round 3 unenterable.
  const p = clocked(300, null, null);
  assert.equal(cumulativeTimeThrough(p, 2), 300);
  assert.equal(roundTimeFromClock(p, 3, 900), 600, '15:00 on the clock, 5:00 banked → 10:00');
});

test('roundTimeFromClock subtracts what the clock already stood at', () => {
  const p = clocked(300, 240, null);
  // Clock reads 14:30 at the end of round 3; 9:00 was banked over rounds 1-2.
  assert.equal(roundTimeFromClock(p, 3, 870), 330);
  // The very first round is the reading itself — nothing precedes it.
  assert.equal(roundTimeFromClock(clocked(), 1, 420), 420);
});

test('a reading that goes backwards is rejected, not stored as a negative round', () => {
  const p = clocked(300, 240, null);          // 9:00 banked
  assert.equal(roundTimeFromClock(p, 3, 500), null, 'a count-up clock cannot read less than before');
  assert.equal(roundTimeFromClock(p, 3, 540), 0, 'reading exactly the prior total is a 0-second round, not an error');
});

test('roundTimeFromClock rejects junk instead of coercing it', () => {
  const p = clocked(300);
  for (const bad of [null, undefined, NaN, Infinity, -60, 'abc']) {
    assert.equal(roundTimeFromClock(p, 2, bad), null, `${String(bad)} should not parse as a clock reading`);
  }
});

test('a full clocked game round-trips: readings in, per-round out, player total is the sum', () => {
  // What a real clock would show at the end of each round.
  const readings = [412, 903, 1500, 2010, 2415];
  const p = { rounds: ROUNDS.map((n) => ({ roundNumber: n, timeSeconds: null })) };
  for (const [i, reading] of readings.entries()) {
    const n = i + 1;
    const secs = roundTimeFromClock(p, n, reading);
    assert.notEqual(secs, null, `round ${n} should accept ${reading}`);
    p.rounds.find((r) => r.roundNumber === n).timeSeconds = secs;
  }
  assert.deepEqual(p.rounds.map((r) => r.timeSeconds), [412, 491, 597, 510, 405]);
  // resolvePlayerTimes makes the player total the sum of the rounds, so the
  // final clock reading and the recorded total have to be the same number.
  const total = p.rounds.reduce((s, r) => s + r.timeSeconds, 0);
  assert.equal(total, readings[readings.length - 1]);
  assert.equal(fmtDuration(total), '40:15');
});
