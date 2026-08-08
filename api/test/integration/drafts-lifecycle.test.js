// The live game tracker, end to end over HTTP.
//
// Two properties carry this file. The first is ISOLATION: a `game_drafts` row
// is a game being played, and it must be invisible to /games, /stats, the war
// map and the `games` table itself until someone submits it. The second is
// that SUBMIT is a faithful hand-off into createGame() — the same path
// POST /games uses — so everything the wizard recorded (11e halves, cp,
// secondaries with independent drawn/scored rounds, detachments, the chess
// clock, photos) has to survive the trip.
//
// Everything else here is a scar: concurrent submits creating two games, a
// draft resurrecting itself once its game was deleted, and out-of-range round
// numbers turning a CHECK constraint into an opaque 500.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  pool, createUser, login, anon, reference, TINY_JPEG, playablePayload,
  dirExists, draftDir, gameDir, cleanup, closePool, uniq,
} from './_harness.js';

let ref;
let owner, ownerC;
let admin, adminC;

before(async () => {
  await cleanup();
  owner = await createUser({ label: 'draftowner' });
  ownerC = await login(owner);
  admin = await createUser({ role: 'admin', label: 'draftadmin' });
  adminC = await login(admin);
  // Reference data is fetched last on purpose: every client this file uses is
  // logged in above, and these round-trips give express-session's store write
  // time to land before the first test acts on a session.
  ref = await reference();
});

after(async () => {
  await cleanup();
  await closePool();
});

/* ── Fixtures ─────────────────────────────────────────────────── */

// Guest names must start with 'ZZ ' — that prefix is what cleanup() uses to
// find the banner_first_seen rows createGame() writes for a guest.
const guest = (label) => `ZZ ${uniq(label)}`;

const factionId = () => ref.factions[0].id;

function seat(name, over = {}) {
  return {
    guestName: name,
    factionId: factionId(),
    detachments: [],
    rounds: [],
    secondaries: [],
    challengers: [],
    ...over,
  };
}

function primaryRounds(values, over = {}) {
  return values.map((v, i) => ({
    roundNumber: i + 1,
    primaryScore: v,
    secondaryScore: 0,
    cpRemaining: null,
    timeSeconds: null,
    ...over,
  }));
}

function payload(players, over = {}) {
  return {
    playedAt: '2026-08-07',
    pointsLimit: 2000,
    gameFormat: 'matched',
    playMedium: 'physical',
    endCondition: 'normal',
    turnCount: 5,
    edition: '11',
    missionPackId: ref.pack.id,
    players,
    ...over,
  };
}

async function newDraft(client, body) {
  const res = await client.post('/drafts', body);
  assert.equal(res.status, 201, `draft create failed: ${JSON.stringify(res.data)}`);
  return res.data.id;
}

async function submitOk(client, draftId) {
  const res = await client.post(`/drafts/${draftId}/submit`);
  assert.equal(res.status, 200, `submit failed: ${JSON.stringify(res.data)}`);
  return res.data.gameId;
}

/** Create a draft and immediately file it. Returns the new game id. */
async function draftThenSubmit(body, client = ownerC) {
  const id = await newDraft(client, body);
  return { draftId: id, gameId: await submitOk(client, id) };
}

/* ── DB reads for things the API does not expose ───────────────── */

async function gameRow(gameId) {
  const { rows } = await pool.query('SELECT * FROM games WHERE id = $1', [gameId]);
  return rows[0];
}
async function gamePlayers(gameId) {
  const { rows } = await pool.query(
    'SELECT * FROM game_players WHERE game_id = $1 ORDER BY seat', [gameId]);
  return rows;
}
async function roundsFor(gamePlayerId) {
  const { rows } = await pool.query(
    'SELECT * FROM game_rounds WHERE game_player_id = $1 ORDER BY round_number', [gamePlayerId]);
  return rows;
}
async function draftRow(draftId) {
  const { rows } = await pool.query('SELECT * FROM game_drafts WHERE id = $1', [draftId]);
  return rows[0];
}
async function gamesCreatedBy(userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM games WHERE created_by_user_id = $1', [userId]);
  return rows[0].n;
}
async function gamesWithGuest(name) {
  const { rows } = await pool.query(
    `SELECT DISTINCT g.id FROM games g
       JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.guest_name = $1`, [name]);
  return rows.map((r) => r.id);
}

/* ── Draft isolation ───────────────────────────────────────────── */

test('a draft carrying scores stays out of the games list, the stats overview, faction win-rates and the war map, and creates no games row', async () => {
  const p1 = guest('iso_a');
  const p2 = guest('iso_b');

  const overviewBefore = (await ownerC.get('/stats/overview')).data;
  const factionBefore = (await ownerC.get('/stats/faction-winrates')).data
    .find((r) => r.faction_id === factionId());

  const draftId = await newDraft(ownerC, payload([
    seat(p1, { rounds: primaryRounds([10, 10, 10, 10, 5]) }),
    seat(p2, { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const listed = await ownerC.get('/games?limit=200');
  assert.equal(listed.status, 200);
  assert.ok(!JSON.stringify(listed.data).includes(p1), 'draft player leaked into GET /games');
  assert.ok(!JSON.stringify(listed.data).includes(p2), 'draft player leaked into GET /games');

  const searched = await ownerC.get(`/games?q=${encodeURIComponent(p1)}`);
  assert.equal(searched.status, 200);
  assert.deepEqual(searched.data, [], 'a draft is findable through the games search');

  const overviewAfter = (await ownerC.get('/stats/overview')).data;
  assert.equal(overviewAfter.total_games, overviewBefore.total_games,
    'a draft moved the /stats/overview game count');

  const factionAfter = (await ownerC.get('/stats/faction-winrates')).data
    .find((r) => r.faction_id === factionId());
  assert.equal(factionAfter?.games ?? 0, factionBefore?.games ?? 0,
    'a draft moved /stats/faction-winrates');

  const warmap = await ownerC.get('/stats/warmap');
  assert.equal(warmap.status, 200);
  const banners = warmap.data.map((b) => b.player_key);
  assert.ok(!banners.includes(`guest:${p1}`), 'a draft raised a banner on the war map');
  assert.ok(!banners.includes(`guest:${p2}`), 'a draft raised a banner on the war map');

  assert.deepEqual(await gamesWithGuest(p1), [], 'a draft created a games row');
  assert.deepEqual(await gamesWithGuest(p2), [], 'a draft created a games row');

  // Sanity: the draft really does exist, so the absences above mean something.
  assert.ok(await draftRow(draftId));
});

test('submitting a draft makes it appear in the games list', async () => {
  const p1 = guest('vis_a');
  const p2 = guest('vis_b');
  const draftId = await newDraft(ownerC, payload([
    seat(p1, { rounds: primaryRounds([10, 10, 10, 10, 5]) }),
    seat(p2, { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  assert.deepEqual((await ownerC.get(`/games?q=${encodeURIComponent(p1)}`)).data, []);

  const gameId = await submitOk(ownerC, draftId);

  const found = await ownerC.get(`/games?q=${encodeURIComponent(p1)}`);
  assert.equal(found.status, 200);
  assert.deepEqual(found.data.map((g) => g.id), [gameId]);
  assert.ok(JSON.stringify(found.data).includes(p1));
  assert.ok(JSON.stringify(found.data).includes(p2));
});

/* ── The live-games list shows running scores ──────────────────── */

// GET /drafts carries `scores` so #/play reads at a glance. It is computed with
// the REAL computeFinalScores on a throwaway copy, so the list can never
// disagree with the wizard's own readout or with what the game finally files as.
test('the live-games list reports a running score computed the same way the game will be filed', async () => {
  const draftId = await newDraft(ownerC, payload([
    seat(guest('list_a'), {
      rounds: primaryRounds([4, 8, 11, 8, 15]),
      secondaries: [
        { cardName: 'ZZ List Card One', drawnRound: 1, roundNumber: 2, score: 12 },
        { cardName: 'ZZ List Card Two', drawnRound: 2, roundNumber: 3, score: 10 },
        { cardName: 'ZZ List Card Three', drawnRound: 4, roundNumber: 5, score: 10 },
      ],
    }),
    seat(guest('list_b'), {
      rounds: primaryRounds([5, 5, 5, 5, 5]),
      secondaries: [{ cardName: 'ZZ List Card Four', drawnRound: 1, roundNumber: 1, score: 10 }],
    }),
  ]));
  // Past setup, or the client hides the score rather than showing 0 – 0.
  await ownerC.patch(`/drafts/${draftId}`, { baseRev: 0, clientId: 'zz-list', patch: {}, currentStep: 'round5' });

  const listed = await anon().get('/drafts');
  assert.equal(listed.status, 200);
  const row = listed.data.find((d) => d.id === draftId);
  assert.ok(row, 'the in-progress game should be listed');

  // Exactly the pinned reference game, so the list agrees with the 77/35 that
  // submitting it produces.
  assert.deepEqual(row.scores, [77, 35]);

  const gameId = await submitOk(ownerC, draftId);
  const [a, b] = await gamePlayers(gameId);
  assert.equal(a.final_score, row.scores[0], 'the filed score must match what the list showed');
  assert.equal(b.final_score, row.scores[1]);
});

test('a draft still in setup scores zero rather than throwing', async () => {
  const draftId = await newDraft(ownerC, { playedAt: '2026-08-07', pointsLimit: 2000, players: [] });
  const row = (await anon().get('/drafts')).data.find((d) => d.id === draftId);
  assert.ok(row);
  assert.deepEqual(row.scores, [null, null], 'no two seats yet, so there is nothing to score');
  assert.equal(row.current_step, 'setup');
});

/* ── Submit correctness: 11e scoring ───────────────────────────── */

test('the pinned 11e reference draft caps primary and secondary independently and lands on a final score of 77', async () => {
  const p1 = guest('ref_a');
  const p2 = guest('ref_b');
  const { gameId } = await draftThenSubmit(payload([
    seat(p1, {
      rounds: primaryRounds([4, 8, 11, 8, 15]),
      secondaries: [
        { cardName: 'ZZ Ref Card One', drawnRound: 1, roundNumber: 2, score: 12 },
        { cardName: 'ZZ Ref Card Two', drawnRound: 2, roundNumber: 3, score: 10 },
        { cardName: 'ZZ Ref Card Three', drawnRound: 4, roundNumber: 5, score: 10 },
      ],
    }),
    seat(p2, {
      rounds: primaryRounds([5, 5, 5, 5, 5]),
      secondaries: [{ cardName: 'ZZ Ref Card Four', drawnRound: 1, roundNumber: 1, score: 10 }],
    }),
  ]));

  const [a, b] = await gamePlayers(gameId);
  // 46 raw primary clips to 45; 32 secondary is under its own 45 cap and is
  // NOT allowed to soak up the discarded primary point.
  assert.equal(a.final_score, 77);
  assert.equal(b.final_score, 35);
  assert.equal(a.result, 'win');
  assert.equal(b.result, 'loss');
});

test('equal final scores record a draw for both players', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('draw_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('draw_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.equal(a.final_score, b.final_score);
  assert.equal(a.result, 'draw');
  assert.equal(b.result, 'draw');
});

test('a manualWinner flag on player 0 overrides the score comparison', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('mw_a'), { rounds: primaryRounds([1, 1, 1, 1, 1]), manualWinner: true }),
    seat(guest('mw_b'), { rounds: primaryRounds([9, 9, 9, 9, 9]) }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.ok(a.final_score < b.final_score, 'fixture should have player 0 losing on points');
  assert.equal(a.result, 'win');
  assert.equal(b.result, 'loss');
});

test('a manualWinner flag on both players records a draw despite unequal scores', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('mwb_a'), { rounds: primaryRounds([1, 1, 1, 1, 1]), manualWinner: true }),
    seat(guest('mwb_b'), { rounds: primaryRounds([9, 9, 9, 9, 9]), manualWinner: true }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.notEqual(a.final_score, b.final_score);
  assert.equal(a.result, 'draw');
  assert.equal(b.result, 'draw');
});

test('per-round cp_remaining values reach game_rounds', async () => {
  const cp = [3, 4, 2, 5, 1];
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('cp_a'), {
      rounds: primaryRounds([5, 5, 5, 5, 5]).map((r, i) => ({ ...r, cpRemaining: cp[i] })),
    }),
    seat(guest('cp_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.deepEqual((await roundsFor(a.id)).map((r) => r.cp_remaining), cp);
  assert.deepEqual((await roundsFor(b.id)).map((r) => r.cp_remaining), [null, null, null, null, null]);
});

test('a secondary drawn in one round and scored in another keeps both round numbers, and a discard survives', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('sec_a'), {
      rounds: primaryRounds([5, 5, 5, 5, 5]),
      secondaries: [
        { cardName: 'ZZ Held Card', drawnRound: 1, roundNumber: 3, score: 8 },
        { cardName: 'ZZ Binned Card', drawnRound: 2, roundNumber: 2, score: 0, wasDiscarded: true },
      ],
    }),
    seat(guest('sec_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const [a] = await gamePlayers(gameId);
  const { rows } = await pool.query(
    'SELECT * FROM player_secondaries WHERE game_player_id = $1 ORDER BY id', [a.id]);
  assert.equal(rows.length, 2);

  const held = rows.find((r) => r.card_name === 'ZZ Held Card');
  assert.equal(held.drawn_round, 1);
  assert.equal(held.round_number, 3);
  assert.notEqual(held.drawn_round, held.round_number);
  assert.equal(held.score, 8);
  assert.equal(held.was_discarded, false);

  const binned = rows.find((r) => r.card_name === 'ZZ Binned Card');
  assert.equal(binned.was_discarded, true);
  assert.equal(binned.drawn_round, 2);
  assert.equal(binned.round_number, 2);

  // The card scored in round 3, not the round it was drawn.
  const perRound = await roundsFor(a.id);
  assert.equal(perRound.find((r) => r.round_number === 3).secondary_score, 8);
  assert.equal(perRound.find((r) => r.round_number === 1).secondary_score, 0);
});

test('multiple detachments reach player_detachments and game_players.detachment_name is the joined string', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('det_a'), {
      detachments: ['ZZ Gladius Task Force', 'ZZ Anvil Siege Force'],
      rounds: primaryRounds([5, 5, 5, 5, 5]),
    }),
    seat(guest('det_b'), {
      detachments: ['ZZ Solo Detachment'],
      rounds: primaryRounds([5, 5, 5, 5, 5]),
    }),
  ]));

  const [a, b] = await gamePlayers(gameId);
  const { rows } = await pool.query(
    'SELECT detachment_name, sort_order FROM player_detachments WHERE game_player_id = $1 ORDER BY sort_order',
    [a.id]);
  assert.deepEqual(rows.map((r) => r.detachment_name),
    ['ZZ Gladius Task Force', 'ZZ Anvil Siege Force']);
  assert.deepEqual(rows.map((r) => r.sort_order), [0, 1]);
  assert.equal(a.detachment_name, 'ZZ Gladius Task Force, ZZ Anvil Siege Force');
  assert.equal(b.detachment_name, 'ZZ Solo Detachment');
});

test('per-round chess-clock times sum into game_players.time_seconds', async () => {
  const times = [120, 180, 240, 60, 90];
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('clk_a'), {
      rounds: primaryRounds([5, 5, 5, 5, 5]).map((r, i) => ({ ...r, timeSeconds: times[i] })),
      timeSeconds: 99999,
    }),
    seat(guest('clk_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const [a] = await gamePlayers(gameId);
  assert.equal(a.time_seconds, times.reduce((s, v) => s + v, 0));
  assert.deepEqual((await roundsFor(a.id)).map((r) => r.time_seconds), times);
});

test('a draft with no per-round times keeps the typed player total', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('clk2_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]), timeSeconds: 3600 }),
    seat(guest('clk2_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]), timeSeconds: 3000 }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.equal(a.time_seconds, 3600);
  assert.equal(b.time_seconds, 3000);
});

test('a draft with neither per-round nor typed times leaves time_seconds NULL rather than zero', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('clk3_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('clk3_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.equal(a.time_seconds, null);
  assert.equal(b.time_seconds, null);
});

test('army_list_code round-trips through submit', async () => {
  const code = `YAAB1:zz-test-${uniq('list')}`;
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('list_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]), armyListCode: code }),
    seat(guest('list_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const [a, b] = await gamePlayers(gameId);
  assert.equal(a.army_list_code, code);
  assert.equal(b.army_list_code, null);
});

test('submit forces edition 11 even when the stored payload says 10', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('ed_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('ed_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ], { edition: '10' }));
  assert.equal((await gameRow(gameId)).edition, '11');
});

test('a submitted draft is attached to the active season', async () => {
  const { rows } = await pool.query('SELECT id FROM seasons WHERE is_active = TRUE LIMIT 1');
  const activeSeason = rows[0]?.id ?? null;
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('sea_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('sea_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  assert.equal((await gameRow(gameId)).season_id, activeSeason);
});

/* ── Submit validation ─────────────────────────────────────────── */

const invalidPayloads = [
  ['no playedAt', () => payload([
    seat(guest('v1_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('v1_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ], { playedAt: null })],
  ['no pointsLimit', () => payload([
    seat(guest('v2_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('v2_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ], { pointsLimit: null })],
  ['a player with neither userId nor guestName', () => payload([
    seat(guest('v3_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    { factionId: null, detachments: [], rounds: [], secondaries: [], challengers: [] },
  ])],
  ['only one player', () => payload([
    seat(guest('v4_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ])],
  ['three players', () => payload([
    seat(guest('v5_a')), seat(guest('v5_b')), seat(guest('v5_c')),
  ])],
];

for (const [label, build] of invalidPayloads) {
  test(`submitting a draft with ${label} is rejected with 400 and creates no game row`, async () => {
    const draftId = await newDraft(ownerC, build());
    const before = await gamesCreatedBy(owner.id);

    const res = await ownerC.post(`/drafts/${draftId}/submit`);
    assert.equal(res.status, 400, `expected 400, got ${res.status} ${JSON.stringify(res.data)}`);

    assert.equal(await gamesCreatedBy(owner.id), before, 'a rejected submit still created a game');
    const row = await draftRow(draftId);
    assert.equal(row.submitted_at, null);
    assert.equal(row.submitted_game_id, null);
  });
}

/* ── Round-number hygiene ──────────────────────────────────────── */

test('rounds numbered 0, 6 and a duplicate 3 do not reach the CHECK/UNIQUE constraints as a 500', async () => {
  const p1 = guest('rn_a');
  const draftId = await newDraft(ownerC, payload([
    seat(p1, {
      rounds: [
        { roundNumber: 0, primaryScore: 5, secondaryScore: 0 },
        { roundNumber: 6, primaryScore: 5, secondaryScore: 0 },
        { roundNumber: 3, primaryScore: 7, secondaryScore: 0 },
        { roundNumber: 3, primaryScore: 9, secondaryScore: 0 },
        { roundNumber: 1, primaryScore: 4, secondaryScore: 0 },
        { roundNumber: 2, primaryScore: 3, secondaryScore: 0 },
      ],
    }),
    seat(guest('rn_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const res = await ownerC.post(`/drafts/${draftId}/submit`);
  assert.ok(res.status === 200 || res.status === 400,
    `expected a clean 200 or 400, got ${res.status} ${JSON.stringify(res.data)}`);

  if (res.status === 400) {
    assert.deepEqual(await gamesWithGuest(p1), []);
    return;
  }

  const players = await gamePlayers(res.data.gameId);
  for (const p of players) {
    const rows = await roundsFor(p.id);
    const numbers = rows.map((r) => r.round_number);
    for (const n of numbers) {
      assert.ok(n >= 1 && n <= 5, `round_number ${n} escaped the 1..5 range`);
    }
    assert.equal(new Set(numbers).size, numbers.length, 'duplicate round_number survived');
  }
  // 0, 6 and the second 3 are dropped rather than clamped onto an existing round.
  assert.deepEqual((await roundsFor(players[0].id)).map((r) => r.round_number), [1, 2, 3]);
});

test('secondary roundNumber and drawnRound outside 1..5 are clamped into range', async () => {
  const { gameId } = await draftThenSubmit(payload([
    seat(guest('sc_a'), {
      rounds: primaryRounds([5, 5, 5, 5, 5]),
      secondaries: [
        { cardName: 'ZZ Out Of Range Card', drawnRound: 0, roundNumber: 9, score: 5 },
        { cardName: 'ZZ Negative Card', drawnRound: -3, roundNumber: 12, score: 3 },
      ],
    }),
    seat(guest('sc_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const [a] = await gamePlayers(gameId);
  const { rows } = await pool.query(
    'SELECT card_name, drawn_round, round_number FROM player_secondaries WHERE game_player_id = $1 ORDER BY id',
    [a.id]);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.ok(r.drawn_round >= 1 && r.drawn_round <= 5, `drawn_round ${r.drawn_round} out of range`);
    assert.ok(r.round_number >= 1 && r.round_number <= 5, `round_number ${r.round_number} out of range`);
  }
  assert.equal(rows[0].drawn_round, 1);
  assert.equal(rows[0].round_number, 5);
});

/* ── Photos through submit ─────────────────────────────────────── */

test('mid-game photos move from the draft folder onto the game, keeping their captions and exactly one cover', async () => {
  const draftId = await newDraft(ownerC, payload([
    seat(guest('img_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('img_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const captions = ['ZZ deployment', 'ZZ turn three'];
  for (const caption of captions) {
    const res = await ownerC.post(`/drafts/${draftId}/images`, { dataUrl: TINY_JPEG, caption });
    assert.equal(res.status, 201, JSON.stringify(res.data));
  }

  const { rows: draftImages } = await pool.query(
    'SELECT * FROM game_draft_images WHERE draft_id = $1 ORDER BY id', [draftId]);
  assert.equal(draftImages.length, 2);
  assert.ok(await dirExists(draftDir(draftId)));
  for (const img of draftImages) {
    assert.ok(await dirExists(path.join(draftDir(draftId), img.file_name)), 'full file missing pre-submit');
    assert.ok(await dirExists(path.join(draftDir(draftId), img.thumb_name)), 'thumb missing pre-submit');
  }

  const gameId = await submitOk(ownerC, draftId);

  const { rows: gameImages } = await pool.query(
    'SELECT * FROM game_images WHERE game_id = $1 ORDER BY id', [gameId]);
  assert.equal(gameImages.length, 2);
  assert.deepEqual(gameImages.map((r) => r.caption).sort(), [...captions].sort());
  assert.equal(gameImages.filter((r) => r.is_thumbnail).length, 1, 'exactly one cover expected');

  for (const img of gameImages) {
    assert.ok(await dirExists(path.join(gameDir(gameId), img.file_name)), 'full file did not move');
    assert.ok(await dirExists(path.join(gameDir(gameId), img.thumb_name)), 'thumb did not move');
  }
  for (const img of draftImages) {
    assert.equal(await dirExists(path.join(draftDir(draftId), img.file_name)), false,
      'full file left behind in the draft folder');
  }
  assert.equal(await dirExists(draftDir(draftId)), false, 'draft photo folder survived submit');

  const { rows: leftovers } = await pool.query(
    'SELECT id FROM game_draft_images WHERE draft_id = $1', [draftId]);
  assert.deepEqual(leftovers, []);
});

test('the setup map photo keeps its tag through submit, and re-shooting the table demotes the old one', async () => {
  const draftId = await newDraft(ownerC, payload([
    seat(guest('map_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('map_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const first = await ownerC.post(`/drafts/${draftId}/images`,
    { dataUrl: TINY_JPEG, caption: 'ZZ first table', isMap: true });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(first.data.is_map, true);

  const round = await ownerC.post(`/drafts/${draftId}/images`,
    { dataUrl: TINY_JPEG, caption: 'ZZ round one', roundNumber: 1 });
  assert.equal(round.data.is_map, false);

  const second = await ownerC.post(`/drafts/${draftId}/images`,
    { dataUrl: TINY_JPEG, caption: 'ZZ second table', isMap: true });
  assert.equal(second.status, 201, JSON.stringify(second.data));

  const { rows: onDraft } = await pool.query(
    'SELECT id, caption, is_map FROM game_draft_images WHERE draft_id = $1 ORDER BY id', [draftId]);
  assert.equal(onDraft.length, 3);
  assert.deepEqual(onDraft.filter((r) => r.is_map).map((r) => r.caption), ['ZZ second table'],
    'the second table shot should be the only one still tagged');

  const gameId = await submitOk(ownerC, draftId);

  const { rows: onGame } = await pool.query(
    'SELECT caption, is_map FROM game_images WHERE game_id = $1 ORDER BY id', [gameId]);
  assert.equal(onGame.length, 3);
  assert.deepEqual(onGame.filter((r) => r.is_map).map((r) => r.caption), ['ZZ second table'],
    'is_map did not survive the relink onto the game');
});

/* ── Submitted, then the game deleted ──────────────────────────── */

test('a draft whose submitted game was hard-deleted stays retired instead of resurrecting itself', async () => {
  const { draftId, gameId } = await draftThenSubmit(payload([
    seat(guest('zomb_a'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('zomb_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));

  const submitted = await draftRow(draftId);
  assert.equal(submitted.submitted_game_id, gameId);
  assert.ok(submitted.submitted_at);

  const del = await adminC.del(`/admin/games/${gameId}`);
  assert.equal(del.status, 200, JSON.stringify(del.data));

  const after = await draftRow(draftId);
  assert.equal(after.submitted_game_id, null, 'FK should have been SET NULL');
  assert.ok(after.submitted_at, 'submitted_at must outlive the game row');

  const open = await ownerC.get('/drafts');
  assert.equal(open.status, 200);
  assert.ok(!open.data.some((d) => d.id === draftId), 'a retired draft reappeared in GET /drafts');

  const patched = await ownerC.patch(`/drafts/${draftId}`, { patch: { notes: 'ZZ nope' } });
  assert.equal(patched.status, 409);
});

/* ── Concurrency ───────────────────────────────────────────────── */

test('two simultaneous submits of one draft yield one 200, one 409 and exactly one game', async () => {
  const p1 = guest('race_a');
  const draftId = await newDraft(ownerC, payload([
    seat(p1, { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
    seat(guest('race_b'), { rounds: primaryRounds([5, 5, 5, 5, 5]) }),
  ]));
  const before = await gamesCreatedBy(owner.id);

  const results = await Promise.all([
    ownerC.post(`/drafts/${draftId}/submit`),
    ownerC.post(`/drafts/${draftId}/submit`),
  ]);
  const statuses = results.map((r) => r.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 409], `got ${JSON.stringify(results.map((r) => [r.status, r.data]))}`);

  assert.equal(await gamesCreatedBy(owner.id), before + 1,
    'a concurrent submit created a second game');
  assert.equal((await gamesWithGuest(p1)).length, 1);
});

test('concurrent PATCHes each bump rev exactly once, so no update is lost', async () => {
  const draftId = await newDraft(ownerC, payload([
    seat(guest('rev_a')), seat(guest('rev_b')),
  ]));
  assert.equal((await draftRow(draftId)).rev, 0);

  const n = 6;
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      ownerC.patch(`/drafts/${draftId}`, { patch: { notes: `ZZ concurrent ${i}` } }))
  );
  const ok = results.filter((r) => r.status === 200);
  assert.equal(ok.length, n, `expected every PATCH to succeed, got ${JSON.stringify(results.map((r) => r.status))}`);

  const row = await draftRow(draftId);
  assert.equal(row.rev, ok.length, 'rev did not track the number of accepted patches');
  assert.equal(new Set(ok.map((r) => r.data.rev)).size, ok.length, 'two patches were handed the same rev');
});

/* ── Delete ────────────────────────────────────────────────────── */

test('deleting a draft removes the row, its image rows and the photo directory on disk', async () => {
  const draftId = await newDraft(ownerC, payload([
    seat(guest('del_a')), seat(guest('del_b')),
  ]));
  const up = await ownerC.post(`/drafts/${draftId}/images`, { dataUrl: TINY_JPEG, caption: 'ZZ bye' });
  assert.equal(up.status, 201);
  assert.ok(await dirExists(draftDir(draftId)));

  const res = await ownerC.del(`/drafts/${draftId}`);
  assert.equal(res.status, 200);

  assert.equal(await draftRow(draftId), undefined);
  const { rows } = await pool.query('SELECT id FROM game_draft_images WHERE draft_id = $1', [draftId]);
  assert.deepEqual(rows, []);
  // The photo folder deliberately SURVIVES: deleting a live game archives it to
  // deleted_items, and a restore that came back with blank tiles would defeat
  // the point. The files are only unlinked by a permanent delete from the
  // admin panel — covered in deleted-items.test.js.
  assert.equal(await dirExists(draftDir(draftId)), true,
    'the photo folder must be kept so the archived game can be restored intact');

  assert.equal((await ownerC.get(`/drafts/${draftId}`)).status, 404);
});

// Regression: a card the pack no longer has must not be able to fail a submit.
// A real in-progress game became unfileable when a secondary_cards row it
// referenced was deleted — player_secondaries.card_id is a FK, so the whole
// transaction died on a constraint violation. The id now degrades to
// name-only, because the denormalised card_name is what every view displays.
test('a secondary whose card row was deleted mid-game still submits, keeping its name', async () => {
  const owner = await createUser({ label: 'dangle' });
  const c = await login(owner);
  const { pack } = await reference();

  // A card that exists when drawn and is gone by the time the game is filed.
  const { rows: [card] } = await pool.query(
    `INSERT INTO secondary_cards (mission_pack_id, name, card_type)
     VALUES ($1, 'ZZ Vanishing Card', 'tactical') RETURNING id`, [pack.id]
  );

  const payload = playablePayload();
  payload.missionPackId = pack.id;
  payload.players[0].secondaries = [{
    cardId: card.id, cardName: 'ZZ Vanishing Card',
    drawnRound: 1, roundNumber: 2, score: 7, wasDiscarded: false,
  }];
  const made = await c.post('/drafts', payload);
  assert.equal(made.status, 201);

  await pool.query('DELETE FROM secondary_cards WHERE id = $1', [card.id]);

  const submitted = await c.post(`/drafts/${made.data.id}/submit`);
  assert.equal(submitted.status, 200, 'a deleted card row must not fail the submit');

  const { rows } = await pool.query(
    `SELECT ps.card_id, ps.card_name, ps.score, ps.round_number, ps.drawn_round
       FROM player_secondaries ps
       JOIN game_players gp ON gp.id = ps.game_player_id
      WHERE gp.game_id = $1`, [submitted.data.gameId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_id, null, 'the dangling id should be dropped');
  assert.equal(rows[0].card_name, 'ZZ Vanishing Card', 'the name is the record and must survive');
  assert.equal(rows[0].score, 7, 'the points scored must survive');
  assert.equal(rows[0].drawn_round, 1);
  assert.equal(rows[0].round_number, 2);
});

// Secondaries are match-only: the 11e deck is a fixed 18 cards published by GW,
// so a name that doesn't match one is almost always a typo. Auto-inserting put
// that typo into the shared mission pack, where every user saw it in the draw
// picker with no way to remove it — and made pack rows deletable-but-referenced,
// which turned a routine cleanup into a FK violation on a finished game.
test('an unrecognised secondary is recorded on the game but does NOT join the mission pack', async () => {
  const owner = await createUser({ label: 'nogrow' });
  const c = await login(owner);
  const { pack } = await reference();

  const before = await pool.query(
    'SELECT count(*)::int AS n FROM secondary_cards WHERE mission_pack_id = $1', [pack.id]
  );

  const payload = playablePayload();
  payload.missionPackId = pack.id;
  payload.players[0].secondaries = [{
    cardId: null, cardName: 'ZZ Behind Enemey Lines', // deliberate typo
    drawnRound: 1, roundNumber: 2, score: 5, wasDiscarded: false,
  }];
  const made = await c.post('/drafts', payload);
  const submitted = await c.post(`/drafts/${made.data.id}/submit`);
  assert.equal(submitted.status, 200);

  const after = await pool.query(
    'SELECT count(*)::int AS n FROM secondary_cards WHERE mission_pack_id = $1', [pack.id]
  );
  assert.equal(after.rows[0].n, before.rows[0].n,
    'submitting a game must never grow the shared mission pack');

  const { rows } = await pool.query(
    `SELECT ps.card_id, ps.card_name, ps.score FROM player_secondaries ps
       JOIN game_players gp ON gp.id = ps.game_player_id
      WHERE gp.game_id = $1`, [submitted.data.gameId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].card_id, null, 'no id, because no such card exists');
  assert.equal(rows[0].card_name, 'ZZ Behind Enemey Lines', 'the typed name is still the record');
  assert.equal(rows[0].score, 5, 'and it still scores');
});

test('a secondary that DOES match a seeded card still resolves to its id', async () => {
  const owner = await createUser({ label: 'matches' });
  const c = await login(owner);
  const { pack } = await reference();

  const payload = playablePayload();
  payload.missionPackId = pack.id;
  payload.players[0].secondaries = [{
    cardId: null, cardName: 'assassination', // case-insensitive match
    drawnRound: 1, roundNumber: 1, score: 5, wasDiscarded: false,
  }];
  const made = await c.post('/drafts', payload);
  const submitted = await c.post(`/drafts/${made.data.id}/submit`);
  assert.equal(submitted.status, 200);

  const { rows } = await pool.query(
    `SELECT ps.card_id, sc.name FROM player_secondaries ps
       JOIN game_players gp ON gp.id = ps.game_player_id
       LEFT JOIN secondary_cards sc ON sc.id = ps.card_id
      WHERE gp.game_id = $1`, [submitted.data.gameId]
  );
  assert.ok(rows[0].card_id, 'a real card name must still link to its row');
  assert.equal(rows[0].name, 'Assassination');
});
