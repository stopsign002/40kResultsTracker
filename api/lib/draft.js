// @ts-check

// Pure helpers behind routes/drafts.js — the autosave merge and the
// submit-time sanitiser. No DB, no req/res, so test/draft-submit.test.js can
// import them directly (see api/test/README.md).

const ROUND_MIN = 1;
const ROUND_MAX = 5;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merge an autosave patch into the stored payload, returning a new object.
 *
 * Arrays REPLACE wholesale rather than merging element-by-element: the wizard's
 * arrays (rounds, secondaries, detachments) are ordered lists where an element
 * merge would resurrect a deleted entry instead of removing it. `null` is a
 * value, not a delete instruction — clearing a field is how the client says
 * "this is now blank".
 *
 * @template T
 * @param {T} base
 * @param {any} patch
 * @returns {any}
 */
export function mergePatch(base, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(patch)) {
    out[key] = mergePatch(out[key], patch[key]);
  }
  return out;
}

/**
 * The `players` key is the one place the patch shape differs from the payload
 * shape: the payload holds an ARRAY of two seats, but a patch addresses seats
 * as an OBJECT keyed by index ("0", "1"). Wholesale array replacement is right
 * for `rounds`/`secondaries`/`detachments` and wrong here — one phone patching
 * its own seat would otherwise wipe the other seat it never sent.
 *
 * @param {any} baseSeats
 * @param {Record<string, any>} seatPatch
 * @returns {any[]}
 */
function mergeSeats(baseSeats, seatPatch) {
  const out = Array.isArray(baseSeats) ? baseSeats.slice() : [];
  for (const key of Object.keys(seatPatch)) {
    const index = Number(key);
    // A game has exactly two seats. Without the upper bound, a 40-byte patch
  // with the key "1e7" grew the players array to ten million entries — 618MB
  // of heap and 30MB of JSONB written to the row, from one authenticated PATCH.
  if (!Number.isInteger(index) || index < 0 || index > 1) continue;
    while (out.length <= index) out.push({});
    out[index] = mergePatch(out[index], seatPatch[key]);
  }
  return out;
}

/**
 * Apply one autosave patch to a stored draft payload. Generic deep-merge
 * everywhere except `players`, which merges seat-by-seat — see mergeSeats.
 *
 * @param {any} payload
 * @param {any} patch
 * @returns {any}
 */
export function mergeDraftPatch(payload, patch) {
  if (!isPlainObject(patch)) return payload;
  const { players, ...rest } = patch;
  const out = mergePatch(payload, rest);
  if (players !== undefined) {
    out.players = isPlainObject(players)
      ? mergeSeats(isPlainObject(payload) ? payload.players : null, players)
      : players;
  }
  return out;
}

/**
 * The seat sub-patch an invited opponent is allowed to send, or null if the
 * patch reaches outside seat 2. Server-side scope enforcement — the wizard
 * hides the other seat, but that is UX only.
 *
 * @param {any} patch
 * @returns {any|null}
 */
export function opponentSeatPatch(patch) {
  if (!isPlainObject(patch)) return null;
  const keys = Object.keys(patch);
  if (keys.length !== 1 || keys[0] !== 'players') return null;
  const seats = patch.players;
  if (!isPlainObject(seats)) return null;
  const seatKeys = Object.keys(seats);
  if (seatKeys.length !== 1 || seatKeys[0] !== '1') return null;
  return seats['1'];
}

function roundOrNull(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(ROUND_MAX, Math.max(ROUND_MIN, n));
}

/**
 * Force every round number in a draft payload inside 1–5 before it reaches the
 * `CHECK (round_number BETWEEN 1 AND 5)` constraints. A raw wizard payload can
 * carry a half-built round with no number at all, and the constraint violation
 * surfaces as an opaque 500 rather than something the player can act on.
 *
 * `game_rounds` has UNIQUE (game_player_id, round_number), so out-of-range and
 * duplicate rounds are DROPPED rather than clamped onto an existing round.
 * Secondary card rounds are nullable and unconstrained, so those clamp.
 *
 * Mutates each player in place.
 *
 * @param {any} payload   A raw, not-yet-validated draft payload
 * @returns {void}
 */
export function normalizeDraftRounds(payload) {
  for (const p of payload?.players || []) {
    if (Array.isArray(p.rounds)) {
      const seen = new Set();
      p.rounds = p.rounds.filter((r) => {
        if (!r || r.roundNumber == null || r.roundNumber === '') return false;
        const n = Math.round(Number(r.roundNumber));
        if (!Number.isFinite(n) || n < ROUND_MIN || n > ROUND_MAX) return false;
        if (seen.has(n)) return false;
        seen.add(n);
        r.roundNumber = n;
        return true;
      });
    }
    for (const s of p.secondaries || []) {
      if (!s) continue;
      s.roundNumber = roundOrNull(s.roundNumber);
      s.drawnRound = roundOrNull(s.drawnRound);
    }
  }
}

/**
 * Gate a draft payload on its way to createGame(). Throws with a message meant
 * to be shown to the player, so routes/drafts.js can hand it straight back as
 * a 400. Also normalises round numbers.
 *
 * @param {any} payload   A raw, not-yet-validated draft payload
 * @returns {void}
 */
export function validateDraftSubmit(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('this game has nothing recorded yet');
  if (!payload.playedAt) throw new Error('set the date this game was played before finishing it');
  if (!payload.pointsLimit) throw new Error('set the points limit before finishing this game');
  if (!Array.isArray(payload.players) || payload.players.length !== 2) {
    throw new Error('a finished game needs exactly 2 players');
  }
  payload.players.forEach((p, i) => {
    if (!p || (!p.userId && !p.guestName)) throw new Error(`player ${i + 1} still needs a name`);
  });
  normalizeDraftRounds(payload);
}
