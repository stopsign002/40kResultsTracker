// Runs LAST (the suite is globbed alphabetically and run with
// --test-concurrency=1) and asserts the integration suite left the database as
// it found it.
//
// This exists because it already went wrong. `resolveGameLookups` auto-inserts
// a reference row for any free-text mission/card/layout name a submitted game
// carries — by design, it's what powers "+ Card not listed" — so a test that
// submitted a game with an invented secondary permanently added that card to
// the real 11e pack, and it showed up in every user's draw picker. Cleaning up
// after ourselves is not optional when the fixtures write to shared reference
// data.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, cleanup, assertNoResidue, closePool } from './_harness.js';

before(async () => { await cleanup(); });
after(async () => { await closePool(); });

test('the integration suite leaves no users, audit rows, banners or reference rows behind', async () => {
  await assertNoResidue();
});

test('the 11e mission pack still holds exactly its 18 seeded secondaries', async () => {
  const { rows } = await pool.query(
    `SELECT sc.name FROM secondary_cards sc
       JOIN mission_packs mp ON mp.id = sc.mission_pack_id
      WHERE mp.name = '2026 - 2027 Chapter Approved'
      ORDER BY sc.name`
  );
  assert.equal(rows.length, 18,
    `the 11e deck should hold 18 cards, found ${rows.length}: ${rows.map((r) => r.name).join(', ')}`);
  // Spot-check a couple of real ones so "18" can't be satisfied by 18 wrong cards.
  const names = rows.map((r) => r.name);
  for (const expected of ['Assassination', 'Behind Enemy Lines', "Secure No Man's Land"]) {
    assert.ok(names.includes(expected), `the 11e deck is missing "${expected}"`);
  }
});

test('no mission pack or faction has grown a card, mission, layout, rule or detachment named like a test fixture', async () => {
  for (const table of ['secondary_cards', 'primary_missions', 'deployment_maps', 'mission_rules', 'challenger_cards', 'detachments']) {
    const { rows } = await pool.query(`SELECT name FROM ${table} WHERE name LIKE 'ZZ %'`);
    assert.equal(rows.length, 0,
      `${table} still holds test fixtures: ${rows.map((r) => r.name).join(', ')}`);
  }
});
