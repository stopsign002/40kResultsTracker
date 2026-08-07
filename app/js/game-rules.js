// 40k rules constants + score maths shared by views/game-form.js (full entry
// form) and views/live-game.js (round-by-round mobile wizard). Everything here
// is client-side display logic — the server value is always authoritative.
// calcTotal() must track computeFinalScores() in api/lib/game-scoring.js
// exactly; if you change one, change the other.

export const ROUNDS = [1, 2, 3, 4, 5];

// Edition a brand-new game is stamped with. Games recorded before the edition
// column existed were all 10e and were backfilled as such by the migration —
// only the *default for new entries* moves forward. Bump this when 12e lands.
export const DEFAULT_EDITION = '11';

// 11e differences the form has to model: each player picks their own primary
// mission, secondaries persist in hand (so a card has a draw round distinct
// from the round it scores), challenger cards no longer exist, and each half
// of the score caps at 45 independently.
// GW ships three recommended terrain layouts per 11e matched-play mission.
// Anything else is a table you laid out yourself.
export const MATCHED_PLAY_LAYOUTS = ['Layout A', 'Layout B', 'Layout C'];

export const E11_PRIMARY_CAP = 45;
export const E11_SECONDARY_CAP = 45;

// 11e also caps each half at 15 VP **per battle round**, not just 45 per game.
// Both figures come from the mission pack itself — `primaryMissionScoreBattleRoundLimit`
// and `secondaryMissionScoreBattleRoundLimit` in app/data/mission-cards-11e.json,
// alongside the 45s these sit next to.
//
// These are INPUT ceilings, enforced where a number is entered (the live
// tracker), NOT a clamp inside calcTotal/computeFinalScores. Clamping in the
// scoring maths would silently rewrite the total of any already-recorded game
// the next time it was saved — the same "an edit round-trip must not change a
// game underneath you" rule that shaped the score-detail ladder.
export const E11_PRIMARY_ROUND_CAP = 15;
export const E11_SECONDARY_ROUND_CAP = 15;

// Secondary VP landing in ONE battle round. A card's `roundNumber` is the round
// it scored (null if it never did), so this — not the draw round — is the figure
// the 15-per-round ceiling applies to.
export function sumSecondaryForRound(p, roundNumber) {
  return (p.secondaries || [])
    .filter((s) => s.roundNumber === roundNumber)
    .reduce((sum, s) => sum + (s.score || 0), 0);
}

/* ── Chess clocks that count UP ──────────────────────────────────
 * A clock on "time up" is never reset between rounds — it just keeps running
 * while that player takes their turn. So what it reads at the end of round N is
 * the player's CUMULATIVE time, not the round's.
 *
 * What the app stores is unchanged: `game_rounds.time_seconds` per round, with
 * the player total derived as their sum by resolvePlayerTimes(). Only the entry
 * is cumulative — the difference is taken here, at the point of entry, so
 * nothing downstream has to learn about clock readings.
 */

// What the clock stood at once round `roundNumber` was banked. Rounds with no
// time recorded count as zero rather than breaking the chain: a player who
// forgot to note round 2 still gets a sane round 3.
export function cumulativeTimeThrough(p, roundNumber) {
  return (p.rounds || [])
    .filter((r) => r.roundNumber <= roundNumber && Number.isFinite(r.timeSeconds))
    .reduce((sum, r) => sum + Math.max(0, r.timeSeconds), 0);
}

// The round's own duration, given what the clock reads now.
//
// Returns null when the reading is EARLIER than where the clock already stood —
// that's a mistyped reading, and the honest answer is "that can't be right"
// rather than a negative round or a silent zero.
export function roundTimeFromClock(p, roundNumber, clockSeconds) {
  if (clockSeconds == null || !Number.isFinite(clockSeconds) || clockSeconds < 0) return null;
  const delta = clockSeconds - cumulativeTimeThrough(p, roundNumber - 1);
  return delta < 0 ? null : delta;
}

// Secondary VP still available in a battle round. `exclude` is the entry being
// edited — its own current score must not count against itself, or re-saving a
// card at the same number would ratchet it down every time.
//
// Both entry surfaces need this, and neither can use a plain per-input `max`:
// the ceiling is on the ROUND, so it spans cards. The live tracker asks for the
// headroom before offering a number; /games/new clamps on blur, and again when
// a card's scored round moves (which can breach the new round without the
// card's own score changing at all).
export function secondaryRoundHeadroom(p, roundNumber, exclude = null) {
  if (roundNumber == null) return E11_SECONDARY_ROUND_CAP;
  const used = (p.secondaries || [])
    .filter((s) => s !== exclude && s.roundNumber === roundNumber)
    .reduce((sum, s) => sum + (s.score || 0), 0);
  return Math.max(0, E11_SECONDARY_ROUND_CAP - used);
}

// 11e Force Dispositions. Each player picks one (every detachment is associated
// with one); cross-referencing yours against your opponent's is what decides
// the named primary mission EACH of you plays — hence PRIMARY_MATRIX below,
// keyed [yours][theirs]. Source: the Chapter Approved 2026-27 mission matrix.
export const FORCE_DISPOSITIONS = [
  'Take and Hold', 'Purge the Foe', 'Disruption', 'Reconnaissance', 'Priority Assets',
];

export const PRIMARY_MATRIX = {
  'Take and Hold': {
    'Take and Hold': 'Battlefield Dominance',
    'Purge the Foe': 'Immovable Object',
    'Disruption': 'Determined Acquisition',
    'Reconnaissance': 'Purge and Secure',
    'Priority Assets': 'Inescapable Dominion',
  },
  'Purge the Foe': {
    'Take and Hold': 'Unstoppable Force',
    'Purge the Foe': 'Meatgrinder',
    'Disruption': 'Punishment',
    'Reconnaissance': 'Consecrate',
    'Priority Assets': "Destroyer's Wrath",
  },
  'Disruption': {
    'Take and Hold': 'Death Trap',
    'Purge the Foe': 'Delaying Action',
    'Disruption': 'Outmanoeuvre',
    'Reconnaissance': 'Smoke and Mirrors',
    'Priority Assets': 'Locate and Deny',
  },
  'Reconnaissance': {
    'Take and Hold': 'Reconnaissance Sweep',
    'Purge the Foe': 'Triangulation',
    'Disruption': 'Surveil the Foe',
    'Reconnaissance': 'Gather Intel',
    'Priority Assets': 'Search and Scour',
  },
  'Priority Assets': {
    'Take and Hold': 'Secure Asset',
    'Purge the Foe': 'Vital Link',
    'Disruption': 'Extract Relic',
    'Reconnaissance': 'Vanguard Operation',
    'Priority Assets': 'Sabotage',
  },
};

// Chess-clock entry. Accepts what people actually type off a clock: "12:34",
// "1:05:30", or a bare number meaning minutes ("12" = 12 minutes). Returns
// whole seconds, or null for blank/unparseable.
export function parseDuration(text) {
  const raw = (text || '').trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const mins = parseFloat(raw);
    return Number.isFinite(mins) ? Math.round(mins * 60) : null;
  }
  const parts = raw.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(x => !/^\d+$/.test(x.trim()))) return null;
  const nums = parts.map(x => parseInt(x.trim(), 10));
  const [h, m, s] = nums.length === 3 ? nums : [0, nums[0], nums[1]];
  if (m > 59 || s > 59) return null;
  return h * 3600 + m * 60 + s;
}

export function sumPrimary(p) {
  return (p.rounds || []).reduce((s, r) => s + (r.primaryScore || 0), 0);
}

export function sumSecondaries(p) {
  return (p.secondaries || []).reduce((s, x) => s + (x.score || 0), 0);
}

// Mirrors computeFinalScores: with no cards recorded, the per-round secondary
// figures are the record; with cards, they're derived from the cards.
export function sumSecondaryPoints(p) {
  if ((p.secondaries || []).length) return sumSecondaries(p);
  return (p.rounds || []).reduce((s, r) => s + (r.secondaryScore || 0), 0);
}

// "32 / 45", or "45 / 45 (46 raw)" when the cap is actually biting, so it's
// obvious the entry wasn't mis-typed — the ceiling just clipped it.
export function capLabel(raw, cap) {
  return `${Math.min(cap, raw)} / ${cap}${raw > cap ? ` (${raw} raw)` : ''}`;
}

// Mirrors computeFinalScores() in api/lib/game-scoring.js. Kept in sync by hand;
// it only drives the live readout, the server value is authoritative.
// A line-for-line mirror of computeFinalScores in api/lib/game-scoring.js. It
// is deliberately written the long way rather than reusing sumSecondaryPoints,
// because the two must agree on the *gate* as well as the arithmetic.
//
// It previously gated card-detail on secondaries alone, where the server gates
// on `cards.length > 0 || chals.length > 0`. A 10e player with a scored Secret
// Mission and no secondary cards — reachable straight from the 10e form, which
// renders challenger slots alongside the secondary ones — read 30 on screen and
// saved as 40. Exactly the drift this file's header warns about.
export function calcTotal(p, edition) {
  const is11 = edition === '11';
  const cards = p.secondaries || [];
  const chals = is11 ? [] : (p.challengers || []);
  const hasCardDetail = cards.length > 0 || chals.length > 0;
  const hasRoundDetail = (p.rounds || []).some(
    (r) => (r.primaryScore || 0) > 0 || (r.secondaryScore || 0) > 0);

  if (!hasCardDetail && !hasRoundDetail) {
    const cap = is11 ? E11_PRIMARY_CAP + E11_SECONDARY_CAP : 100;
    const raw = Math.round(Number(p.finalScore));
    return Number.isFinite(raw) ? Math.min(cap, Math.max(0, raw)) : 0;
  }

  const primary = sumPrimary(p);
  const secTotal = hasCardDetail
    ? cards.reduce((sum, s) => sum + (s.score || 0), 0)
    : (p.rounds || []).reduce((sum, r) => sum + (r.secondaryScore || 0), 0);
  const chalTotal = hasCardDetail
    ? chals.reduce((sum, c) => sum + (c.score || 0), 0)
    : 0;

  return is11
    ? Math.min(E11_PRIMARY_CAP, primary) + Math.min(E11_SECONDARY_CAP, secTotal)
    : Math.min(100, primary + secTotal + chalTotal);
}
