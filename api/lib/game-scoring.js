// @ts-check
/** @import { PlayerPayload, GamePayload } from '../types.js' */

// Pure helpers used by routes/games.js. Kept here (not inline in the route)
// so the smoke tests can import them without spinning up the whole HTTP
// stack. See api/test/game-scoring.test.js.

// 11e splits the 90-point ceiling into two independent halves: primary and
// secondary each cap at 45, so a 46-point primary banks 45 and the overflow
// cannot be recovered by a weak secondary. 10e instead caps the combined total
// at 100 and folds challenger cards into the secondary half.
export const E11_PRIMARY_CAP = 45;
export const E11_SECONDARY_CAP = 45;
export const E11_TOTAL_CAP = E11_PRIMARY_CAP + E11_SECONDARY_CAP;
export const E10_TOTAL_CAP = 100;

/**
 * Operates on the request payload, which is camelCase (primaryScore,
 * roundNumber, etc.) — NOT on DB rows. See CLAUDE.md "Common pitfalls".
 *
 * Mutates each player in place: sets `r.secondaryScore` per round,
 * `p.finalScore` per player, and (for two-player games) the `result` field.
 *
 * `edition` defaults to '10' so existing callers and the payload contract tests
 * keep their old behaviour; routes/games.js passes the game's real edition.
 *
 * @param {PlayerPayload[]} players
 * @param {'10'|'11'} [edition]
 * @returns {void}
 */
export function computeFinalScores(players, edition = '10') {
  const is11 = edition === '11';
  for (const p of players) {
    const cards = p.secondaries || [];
    const chals = is11 ? [] : (p.challengers || []);

    // Some games get logged without anyone noting WHICH secondary scored —
    // only that N points came in during round R. With no card detail the
    // hand-entered per-round secondary totals are the entire record, so they
    // are taken as given; recomputing from an empty card list would zero the
    // whole secondary half. When cards ARE present they remain the source of
    // truth and the per-round figure is derived from them as before.
    const hasCardDetail = cards.length > 0 || chals.length > 0;

    // The third rung of the ladder: some games are reported as nothing but a
    // final score. With neither cards nor any round figure there is nothing to
    // add up, so the submitted total is the record — recomputing would score
    // the game 0-0 and file it as a draw.
    const hasRoundDetail = (p.rounds || []).some(
      r => (r.primaryScore || 0) > 0 || (r.secondaryScore || 0) > 0);

    if (!hasCardDetail && !hasRoundDetail) {
      const cap = is11 ? E11_TOTAL_CAP : E10_TOTAL_CAP;
      const raw = Math.round(Number(p.finalScore));
      p.finalScore = Number.isFinite(raw) ? Math.min(cap, Math.max(0, raw)) : 0;
      continue;
    }

    if (hasCardDetail) {
      // In 11e a card's roundNumber is the round it SCORED (null if it never
      // did), so the points still land on the correct round even though the
      // card was drawn earlier and held.
      for (const r of p.rounds || []) {
        const secPts = cards
          .filter(s => s.roundNumber === r.roundNumber)
          .reduce((sum, s) => sum + (s.score || 0), 0);
        const chalPts = chals
          .filter(c => c.roundNumber === r.roundNumber)
          .reduce((sum, c) => sum + (c.score || 0), 0);
        r.secondaryScore = secPts + chalPts;
      }
    }

    const primaryTotal = (p.rounds || []).reduce((sum, r) => sum + (r.primaryScore || 0), 0);
    const secTotal = hasCardDetail
      ? cards.reduce((sum, s) => sum + (s.score || 0), 0)
      : (p.rounds || []).reduce((sum, r) => sum + (r.secondaryScore || 0), 0);
    const chalTotal = hasCardDetail
      ? chals.reduce((sum, c) => sum + (c.score || 0), 0)
      : 0;
    p.finalScore = is11
      ? Math.min(E11_PRIMARY_CAP, primaryTotal) + Math.min(E11_SECONDARY_CAP, secTotal)
      : Math.min(E10_TOTAL_CAP, primaryTotal + secTotal + chalTotal);
  }
  if (players.length === 2) {
    const [a, b] = players;
    // Manual winner override (checkbox per player). Both checked = draw.
    if (a.manualWinner && b.manualWinner) { a.result = 'draw'; b.result = 'draw'; }
    else if (a.manualWinner) { a.result = 'win'; b.result = 'loss'; }
    else if (b.manualWinner) { a.result = 'loss'; b.result = 'win'; }
    else if (a.finalScore > b.finalScore) { a.result = 'win'; b.result = 'loss'; }
    else if (a.finalScore < b.finalScore) { a.result = 'loss'; b.result = 'win'; }
    else { a.result = 'draw'; b.result = 'draw'; }
  }
}

/**
 * Chess-clock times. Per-round entries are optional detail: if ANY round for a
 * player carries a time, the player's total is their sum — so the granular and
 * headline figures can never disagree. With no per-round data the typed total
 * stands on its own. Same shape as the secondary card/round-total rule.
 *
 * Mutates each player in place, setting `p.timeSeconds`.
 *
 * @param {PlayerPayload[]} players
 * @returns {void}
 */
export function resolvePlayerTimes(players) {
  for (const p of players || []) {
    const perRound = (p.rounds || [])
      .map(r => toSeconds(r.timeSeconds))
      .filter(v => v != null);
    if (perRound.length) {
      p.timeSeconds = perRound.reduce((sum, v) => sum + v, 0);
    } else {
      p.timeSeconds = toSeconds(p.timeSeconds);
    }
  }
}

/** Non-negative whole seconds, or null for anything unusable. */
function toSeconds(v) {
  if (v == null || v === '') return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Throws if the inbound game payload is missing required fields. Run before
 * computeFinalScores / insertPlayerChildren / etc.
 *
 * @param {Partial<GamePayload>} body
 * @returns {void}
 */
export function validateGameInput(body) {
  if (!body.playedAt) throw new Error('playedAt required');
  if (!body.pointsLimit) throw new Error('pointsLimit required');
  if (!Array.isArray(body.players) || body.players.length !== 2) throw new Error('exactly 2 players required');
  for (const p of body.players) {
    if (!p.userId && !p.guestName) throw new Error('each player needs userId or guestName');
  }
}
