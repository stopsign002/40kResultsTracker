// @ts-check
// Glicko-2 rating system (Mark E. Glickman). Pure, dependency-free, and
// unit-tested against Glickman's own worked example so the math stays pinned.
// Reference: http://www.glicko.net/glicko/glicko2.pdf
//
// All public functions take/return ratings on the ORIGINAL scale (≈1500-centred,
// like chess Elo). The Glicko-2 internal scale (µ, φ) lives only inside here.

const SCALE = 173.7178;        // converts between original scale and Glicko-2 µ/φ
const DEFAULT_RATING = 1500;
const DEFAULT_RD = 350;        // a brand-new player: maximally uncertain
const DEFAULT_VOL = 0.06;      // σ — how erratic a player's results are
const TAU = 0.5;               // system constant; constrains volatility change
const EPS = 1e-6;              // volatility-iteration convergence tolerance
const MAX_RD = 350;            // RD never exceeds the unknown-player value

export const GLICKO2_DEFAULTS = Object.freeze({
  rating: DEFAULT_RATING,
  rd: DEFAULT_RD,
  vol: DEFAULT_VOL,
});

/** @returns {{ rating: number, rd: number, vol: number }} a fresh unrated player */
export function newPlayer() {
  return { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL };
}

function g(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedG(mu, muJ, phiJ) {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * Rate one player over a single rating period.
 *
 * @param {{ rating: number, rd: number, vol: number }} player  pre-period state (original scale)
 * @param {Array<{ rating: number, rd: number, score: number }>} results
 *        one entry per game this period; `score` is the outcome in [0,1]
 *        (1 win, 0 loss, 0.5 draw, or a margin-of-victory value in between).
 * @returns {{ rating: number, rd: number, vol: number }} post-period state (original scale)
 */
export function ratePeriod(player, results) {
  // No games this period → only RD decays.
  if (!results || results.length === 0) return decayRd(player);

  const mu = (player.rating - DEFAULT_RATING) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;

  // Step 3: estimated variance v and the rating-direction sum.
  let vInv = 0;          // Σ g(φ_j)² E (1−E)
  let deltaSum = 0;      // Σ g(φ_j) (s_j − E)
  for (const r of results) {
    const muJ = (r.rating - DEFAULT_RATING) / SCALE;
    const phiJ = r.rd / SCALE;
    const gj = g(phiJ);
    const e = expectedG(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    deltaSum += gj * (r.score - e);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 4: new volatility via the Illinois (regula falsi) algorithm.
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta2 - phi2 - v - ex);
    const den = 2 * (phi2 + v + ex) * (phi2 + v + ex);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; }
    else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  // Step 5/6: pre-period RD bump, then new φ′ and µ′.
  const phiStar = Math.sqrt(phi2 + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  let rd = SCALE * phiPrime;
  if (rd > MAX_RD) rd = MAX_RD;
  return {
    rating: SCALE * muPrime + DEFAULT_RATING,
    rd,
    vol: sigmaPrime,
  };
}

/**
 * A player who sat out: rating and volatility unchanged, RD grows toward the
 * unknown-player ceiling. `periods` lets the caller decay by a fractional
 * number of rating periods (e.g. real elapsed-time / period-length) so sparse
 * play inflates uncertainty proportionally instead of per-calendar-day.
 *
 * @param {{ rating: number, rd: number, vol: number }} player
 * @param {number} [periods=1]
 * @returns {{ rating: number, rd: number, vol: number }}
 */
export function decayRd(player, periods = 1) {
  const phi = player.rd / SCALE;
  const phiStar = Math.sqrt(phi * phi + player.vol * player.vol * Math.max(0, periods));
  let rd = SCALE * phiStar;
  if (rd > MAX_RD) rd = MAX_RD;
  return { rating: player.rating, rd, vol: player.vol };
}

const Q = Math.log(10) / 400; // 0.0057565… — Glicko (v1) expected-score constant

/**
 * Probability that player A beats player B, accounting for both players'
 * uncertainty (RD). Uses the Glicko-1 expected-score formula on the original
 * scale — uncertainty pulls the prediction toward 50/50. Drives matchmaking.
 *
 * @param {{ rating: number, rd: number }} a
 * @param {{ rating: number, rd: number }} b
 * @returns {number} win probability for A, in (0,1)
 */
export function expectedScore(a, b) {
  const gCombined = 1 / Math.sqrt(1 + (3 * Q * Q * (a.rd * a.rd + b.rd * b.rd)) / (Math.PI * Math.PI));
  return 1 / (1 + Math.pow(10, (-gCombined * (a.rating - b.rating)) / 400));
}
