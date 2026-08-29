import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArmies } from '../lib/armies.js';

test('normalizeArmies rejects a non-array', () => {
  for (const bad of [undefined, null, 'necrons', 42, { factionId: 1 }]) {
    assert.throws(() => normalizeArmies(bad), /must be an array/);
  }
});

test('normalizeArmies accepts an empty list', () => {
  assert.deepEqual(normalizeArmies([]), []);
});

test('normalizeArmies rejects more than 50 entries', () => {
  const many = Array.from({ length: 51 }, () => ({ factionId: 1 }));
  assert.throws(() => normalizeArmies(many), /no more than 50/);
});

test('normalizeArmies rejects a bad factionId', () => {
  for (const bad of [undefined, null, 0, -3, 1.5, '7abc', 1e20, 'x']) {
    assert.throws(() => normalizeArmies([{ factionId: bad }]), /valid factionId/);
  }
});

test('normalizeArmies rejects a non-object entry', () => {
  assert.throws(() => normalizeArmies([null]), /must be an object/);
  assert.throws(() => normalizeArmies([[1]]), /must be an object/);
});

test('normalizeArmies trims names and turns blank into null', () => {
  const out = normalizeArmies([
    { factionId: 1, name: '  The Silent Host  ' },
    { factionId: 2, name: '   ' },
    { factionId: 3 },
  ]);
  assert.equal(out[0].name, 'The Silent Host');
  assert.equal(out[1].name, null);
  assert.equal(out[2].name, null);
});

test('normalizeArmies rejects a non-string or over-long name', () => {
  assert.throws(() => normalizeArmies([{ factionId: 1, name: 7 }]), /name must be a string/);
  assert.throws(() => normalizeArmies([{ factionId: 1, name: 'x'.repeat(121) }]), /120 characters/);
  assert.doesNotThrow(() => normalizeArmies([{ factionId: 1, name: 'x'.repeat(120) }]));
});

test('normalizeArmies rejects two primaries', () => {
  assert.throws(
    () => normalizeArmies([{ factionId: 1, isPrimary: true }, { factionId: 2, isPrimary: true }]),
    /only one army can be primary/
  );
});

test('normalizeArmies defaults the first entry to primary when none is flagged', () => {
  const out = normalizeArmies([{ factionId: 5 }, { factionId: 6 }]);
  assert.equal(out[0].isPrimary, true);
  assert.equal(out[1].isPrimary, false);
});

test('normalizeArmies keeps an explicit primary where it was flagged', () => {
  const out = normalizeArmies([{ factionId: 5 }, { factionId: 6, isPrimary: true }]);
  assert.equal(out[0].isPrimary, false);
  assert.equal(out[1].isPrimary, true);
});

test('normalizeArmies only honours isPrimary === true', () => {
  const out = normalizeArmies([{ factionId: 5, isPrimary: 'yes' }, { factionId: 6, isPrimary: 1 }]);
  assert.equal(out[0].isPrimary, true); // fell through to the first-entry default
  assert.equal(out[1].isPrimary, false);
});

test('normalizeArmies preserves list order', () => {
  const out = normalizeArmies([{ factionId: 9 }, { factionId: 3 }, { factionId: 7 }]);
  assert.deepEqual(out.map((a) => a.factionId), [9, 3, 7]);
});
