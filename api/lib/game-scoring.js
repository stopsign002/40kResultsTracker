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
    // Compute per-round secondary_score from player_secondaries + challengers.
    // In 11e a card's roundNumber is the round it SCORED (null if it never
    // did), so the points still land on the correct round even though the card
    // was drawn earlier and held.
    for (const r of p.rounds || []) {
      const secPts = (p.secondaries || [])
        .filter(s => s.roundNumber === r.roundNumber)
        .reduce((sum, s) => sum + (s.score || 0), 0);
      const chalPts = is11 ? 0 : (p.challengers || [])
        .filter(c => c.roundNumber === r.roundNumber)
        .reduce((sum, c) => sum + (c.score || 0), 0);
      r.secondaryScore = secPts + chalPts;
    }
    const primaryTotal = (p.rounds || []).reduce((sum, r) => sum + (r.primaryScore || 0), 0);
    const secTotal     = (p.secondaries || []).reduce((sum, s) => sum + (s.score || 0), 0);
    const chalTotal    = is11 ? 0 : (p.challengers || []).reduce((sum, c) => sum + (c.score || 0), 0);
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
