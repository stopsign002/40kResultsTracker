// The guard that keeps the integration suite from mailing the operator a dozen
// times per run. It is the whole mechanism — there is no env toggle to forget
// to switch back on — so it is worth pinning.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isFixtureActor } from '../lib/mail.js';

test('isFixtureActor: recognises the integration suite\'s own accounts', () => {
  // The exact shape uniq() produces in test/integration/_harness.js.
  assert.equal(isFixtureActor('zz_test_owner_41_7'), true);
  assert.equal(isFixtureActor('zz_test_u_1_1'), true);
  assert.equal(isFixtureActor('ZZ_TEST_OWNER_41_7'), true);
});

test('isFixtureActor: a real account still gets its email', () => {
  assert.equal(isFixtureActor('stopsign002'), false);
  assert.equal(isFixtureActor('alec'), false);
  // Prefix, not substring — a real player must not be silenced by their name
  // happening to contain the marker.
  assert.equal(isFixtureActor('notzz_test_person'), false);
});

test('isFixtureActor: a missing or non-string actor mails as normal', () => {
  // A game whose creator account was deleted has a NULL username. Defaulting to
  // "suppress" there would silently drop a real notification.
  assert.equal(isFixtureActor(undefined), false);
  assert.equal(isFixtureActor(null), false);
  assert.equal(isFixtureActor(''), false);
  assert.equal(isFixtureActor(123), false);
});
