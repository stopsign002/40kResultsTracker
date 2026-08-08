// Fire-and-forget notification helper. POSTs to the shared `mailer` service
// on the `web` network. Never throws and never blocks the caller — a mail
// hiccup must not break a game save. Configured via MAILER_URL + MAILER_TOKEN
// (see .env); if either is missing, notifications are silently skipped.
const MAILER_URL = process.env.MAILER_URL || '';
const MAILER_TOKEN = process.env.MAILER_TOKEN || '';

// The integration suite runs against the LIVE api container and the REAL
// database, so every fixture game it files went out as a "new game logged"
// email — a full run mailed the operator a dozen times about games that never
// happened. Suppressing it by unsetting MAILER_URL around the run was the
// obvious fix and the wrong one: an interrupted run leaves real notifications
// silently off, and nobody notices a missing email.
//
// So the signal is the fixture naming instead — the same `zz_test_` prefix the
// suite's cleanup and residue guard already depend on (see
// api/test/integration/_harness.js). A game whose creator is a test user is not
// a game anybody wants to hear about. Callers resolve the acting account and
// pass its username; anything else mails as normal.
const FIXTURE_PREFIX = 'zz_test_';

export function isFixtureActor(username) {
  return typeof username === 'string'
    && username.toLowerCase().startsWith(FIXTURE_PREFIX);
}

export function notify(subject, text) {
  if (!MAILER_URL || !MAILER_TOKEN) return;
  fetch(MAILER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MAILER_TOKEN}`,
    },
    body: JSON.stringify({ subject, text }),
    signal: AbortSignal.timeout(10000),
  })
    .then(async (r) => {
      if (!r.ok) console.error('[notify] mailer', r.status, await r.text().catch(() => ''));
    })
    .catch((e) => console.error('[notify] failed:', e.message));
}
