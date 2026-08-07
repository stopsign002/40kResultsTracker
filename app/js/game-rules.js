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
export function calcTotal(p, edition) {
  const primary = sumPrimary(p);
  const sec = sumSecondaryPoints(p);
  // Same ladder as computeFinalScores: with nothing broken down, the submitted
  // total is the record.
  if (!(p.secondaries || []).length && primary === 0 && sec === 0) {
    const cap = edition === '11' ? 90 : 100;
    return Math.min(cap, Math.max(0, parseInt(p.finalScore, 10) || 0));
  }
  if (edition === '11') {
    return Math.min(E11_PRIMARY_CAP, primary) + Math.min(E11_SECONDARY_CAP, sec);
  }
  const chal = (p.secondaries || []).length
    ? (p.challengers || []).reduce((s, c) => s + (c.score || 0), 0)
    : 0;
  return Math.min(100, primary + sec + chal);
}
