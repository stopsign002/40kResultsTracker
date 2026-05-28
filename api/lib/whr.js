// @ts-check
// "Whole-history" rating: a global Bayesian Bradley-Terry (logistic) fit over
// ALL games at once, so evidence propagates both forward AND backward — beating
// someone who later proves weak is worth less, losing to someone strong hurts
// less, and the whole graph is reconciled simultaneously. Contrast with
// glicko2.js, which is causal/online (a game's effect is locked to opponents'
// ratings at that moment).
//
// Model: P(i beats j) = 1 / (1 + 10^(-(Ri-Rj)/400)) — the Elo logistic on the
// same ~1500 scale glicko2.js uses, so the rest of the app treats both models
// uniformly. Each game contributes a fractional score s ∈ [0,1] for player a
// (1 win / 0 loss / 0.5 draw / margin-of-victory); b gets 1-s.
//
// A N(1500, PRIOR_SD²) prior on every rating regularises the fit: an undefeated
// player can't run to +∞, and otherwise-disconnected groups stay on a common
// scale (the prior pins the absolute level that Bradley-Terry leaves free).
// Uncertainty = 1/sqrt(Fisher information); a player with zero games lands at
// RD = PRIOR_SD, matching Glicko's prior so the two models are comparable.

const Q = Math.log(10) / 400;
const PRIOR = 1500;
const PRIOR_SD = 350;
const MAX_ITER = 500;
const TOL = 1e-4;

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * MAP-fit every player's rating from the full set of games.
 *
 * Each game may carry a weight `w` (default 1) that scales how much evidence it
 * contributes — used for time-based recency decay (older games weigh less). A
 * down-weighted game also contributes less Fisher information, so it widens RD,
 * which is exactly right: a rating resting on stale games is less certain.
 *
 * @param {Array<{ a: number, b: number, s: number, w?: number }>} games
 *        s = player a's score share in [0,1]; w = optional weight in (0,1].
 * @returns {Map<number, { rating: number, rd: number }>}
 */
export function fitGlobal(games) {
  // Per-player game list: opponent + this player's score share + weight.
  /** @type {Map<number, Array<{opp:number, s:number, w:number}>>} */
  const adj = new Map();
  const add = (p, opp, s, w) => { if (!adj.has(p)) adj.set(p, []); adj.get(p).push({ opp, s, w }); };
  for (const g of games) {
    const w = g.w == null ? 1 : g.w;
    add(g.a, g.b, g.s, w);
    add(g.b, g.a, 1 - g.s, w);
  }

  const R = new Map();
  for (const p of adj.keys()) R.set(p, PRIOR);
  const invPriorVar = 1 / (PRIOR_SD * PRIOR_SD);

  // Coordinate Newton ascent on the MAP objective. The prior makes each
  // 1-D step well-conditioned, so this converges in a handful of sweeps.
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let maxDelta = 0;
    for (const [p, ms] of adj) {
      const rp = R.get(p);
      let grad = -(rp - PRIOR) * invPriorVar;
      let info = invPriorVar;
      for (const { opp, s, w } of ms) {
        const pr = sigmoid(Q * (rp - R.get(opp)));
        grad += w * Q * (s - pr);
        info += w * Q * Q * pr * (1 - pr);
      }
      const delta = grad / info;
      R.set(p, rp + delta);
      if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
    }
    if (maxDelta < TOL) break;
  }

  // Uncertainty from the (weighted) curvature at the converged estimate.
  const out = new Map();
  for (const [p, ms] of adj) {
    const rp = R.get(p);
    let info = invPriorVar;
    for (const { opp, w } of ms) {
      const pr = sigmoid(Q * (rp - R.get(opp)));
      info += w * Q * Q * pr * (1 - pr);
    }
    out.set(p, { rating: rp, rd: Math.min(PRIOR_SD, 1 / Math.sqrt(info)) });
  }
  return out;
}
