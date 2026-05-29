// Guards the "inert by default" property: with digital included (the default),
// the counted-games filter must equal the legacy literal so competitive queries
// emit byte-identical SQL and nothing changes until the flag is flipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTED_GAMES, INCLUDE_DIGITAL_IN_STATS } from '../lib/game-filter.js';

test('game-filter: digital included by default', () => {
  // Tests run without INCLUDE_DIGITAL_IN_STATS set → default true.
  assert.equal(INCLUDE_DIGITAL_IN_STATS, true);
  assert.equal(COUNTED_GAMES, 'g.hidden_from_stats = FALSE');
});
