import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePatch, mergeDraftPatch, opponentSeatPatch } from '../lib/draft.js';

// ── generic deep merge ────────────────────────────────────────

test('nested objects merge key by key', () => {
  const base = { a: 1, nested: { x: 1, y: 2, deep: { k: 'keep', j: 'old' } } };
  const out = mergePatch(base, { nested: { y: 9, deep: { j: 'new' } } });
  assert.deepEqual(out, { a: 1, nested: { x: 1, y: 9, deep: { k: 'keep', j: 'new' } } });
});

test('arrays replace wholesale — a shorter array truncates', () => {
  const base = { rounds: [{ n: 1 }, { n: 2 }, { n: 3 }] };
  const out = mergePatch(base, { rounds: [{ n: 1 }] });
  assert.deepEqual(out.rounds, [{ n: 1 }]);
});

test('arrays are never element-merged', () => {
  const base = { secondaries: [{ cardName: 'a', score: 5 }] };
  const out = mergePatch(base, { secondaries: [{ cardName: 'b' }] });
  assert.deepEqual(out.secondaries, [{ cardName: 'b' }]);
});

test('null is a value, not a delete', () => {
  const out = mergePatch({ notes: 'something', keep: 1 }, { notes: null });
  assert.equal(out.notes, null);
  assert.ok('notes' in out);
  assert.equal(out.keep, 1);
});

test('merging does not mutate the base', () => {
  const base = { nested: { x: 1 } };
  const out = mergePatch(base, { nested: { x: 2 } });
  assert.equal(base.nested.x, 1);
  assert.equal(out.nested.x, 2);
});

test('an object replaces a scalar and vice versa', () => {
  assert.deepEqual(mergePatch({ a: 5 }, { a: { b: 1 } }), { a: { b: 1 } });
  assert.deepEqual(mergePatch({ a: { b: 1 } }, { a: 5 }), { a: 5 });
});

// ── players: object-keyed patch onto an array payload ─────────

test('a seat-keyed patch merges into the players array without touching the other seat', () => {
  const payload = {
    players: [
      { guestName: 'Alec', factionId: 1, rounds: [{ roundNumber: 1, primaryScore: 5 }] },
      { guestName: 'Sarah', factionId: 2, rounds: [] },
    ],
  };
  const out = mergeDraftPatch(payload, { players: { 1: { factionId: 9 } } });
  assert.equal(out.players[0].guestName, 'Alec');
  assert.deepEqual(out.players[0].rounds, [{ roundNumber: 1, primaryScore: 5 }]);
  assert.equal(out.players[1].guestName, 'Sarah');
  assert.equal(out.players[1].factionId, 9);
});

test('an owner patch can touch both seats plus top-level keys', () => {
  const payload = { pointsLimit: 1000, players: [{ guestName: 'Alec' }, { guestName: 'Sarah' }] };
  const out = mergeDraftPatch(payload, {
    pointsLimit: 2000,
    players: { 0: { factionId: 3 }, 1: { factionId: 4 } },
  });
  assert.equal(out.pointsLimit, 2000);
  assert.deepEqual(out.players.map(p => [p.guestName, p.factionId]), [['Alec', 3], ['Sarah', 4]]);
});

test('arrays inside a seat still replace wholesale', () => {
  const payload = { players: [{}, { rounds: [{ roundNumber: 1 }, { roundNumber: 2 }] }] };
  const out = mergeDraftPatch(payload, { players: { 1: { rounds: [{ roundNumber: 1 }] } } });
  assert.deepEqual(out.players[1].rounds, [{ roundNumber: 1 }]);
});

test('a seat patch on an empty payload fills the missing seats', () => {
  const out = mergeDraftPatch({}, { players: { 1: { guestName: 'Sarah' } } });
  assert.equal(out.players.length, 2);
  assert.deepEqual(out.players[0], {});
  assert.equal(out.players[1].guestName, 'Sarah');
});

test('a patch without players leaves the players array alone', () => {
  const payload = { players: [{ guestName: 'Alec' }, { guestName: 'Sarah' }] };
  const out = mergeDraftPatch(payload, { currentStepNote: 'x' });
  assert.deepEqual(out.players, payload.players);
});

// ── opponent scope ────────────────────────────────────────────

test('opponentSeatPatch accepts a lone seat-2 patch', () => {
  assert.deepEqual(opponentSeatPatch({ players: { 1: { factionId: 4 } } }), { factionId: 4 });
});

test('opponentSeatPatch rejects a seat-1 patch', () => {
  assert.equal(opponentSeatPatch({ players: { 0: { factionId: 4 } } }), null);
  assert.equal(opponentSeatPatch({ players: { 0: {}, 1: {} } }), null);
});

test('opponentSeatPatch rejects any other top-level key', () => {
  assert.equal(opponentSeatPatch({ pointsLimit: 2000 }), null);
  assert.equal(opponentSeatPatch({ players: { 1: {} }, notes: 'hi' }), null);
});

test('opponentSeatPatch rejects an array players patch', () => {
  assert.equal(opponentSeatPatch({ players: [null, { factionId: 4 }] }), null);
});

test('opponentSeatPatch rejects junk', () => {
  assert.equal(opponentSeatPatch(null), null);
  assert.equal(opponentSeatPatch({}), null);
  assert.equal(opponentSeatPatch({ players: null }), null);
});
