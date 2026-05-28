// @ts-check
// Turns the raw game record into Glicko-2 player ratings and matchmaking
// suggestions. The Glicko-2 math lives in glicko2.js; this file decides which
// games feed it, batches them into rating periods, maps 40k scores to outcomes,
// and exposes the balanced-pairing helper. All DB reads are non-mutating.
// db.js is imported lazily inside computeRatings so the pure helpers (and their
// unit tests) don't drag in the pg dependency.
import { ratePeriod, decayRd, expectedScore, newPlayer } from './glicko2.js';
import { fitGlobal } from './whr.js';

// ── Tunables (single source of truth) ─────────────────────────────────────
export const MOV_FULL = 50;          // score gap (of ~100) at which a win counts "maximally"
export const PERIOD_LABEL = 'per-day (time-decayed)';
const PERIOD_DAYS = 30;              // inactivity-decay timescale: RD inflates by ~one Glicko period per 30 idle days
const DISPLAY_CENTER = 500;          // a 1500 rating shows as this on the 0–1000 dial
const DISPLAY_SCALE = 0.8;           // points of display per point of rating
const PROVISIONAL_GAMES = 5;         // fewer games than this → "provisional"
const PROVISIONAL_RD = 150;          // or RD above this → "provisional"
const RANK_FLOOR_K = 1.1;            // leaderboard ranks by rating − K·RD (confidence floor)
const STALE_RD = 10;                 // RD added per idle 30-day period (leaderboard freshness)
const RECENCY_HALF_LIFE_DAYS = 182;  // whole-history: a game's weight halves every ~6 months (set huge to disable)

/** Map a raw rating (mean estimate) onto the 0–1000 dial. */
export function displayRating(rating) {
  const v = Math.round(DISPLAY_CENTER + (rating - 1500) * DISPLAY_SCALE);
  return Math.max(0, Math.min(1000, v));
}

/** Confidence-adjusted "floor" on the dial — what the leaderboard ranks by, so
 *  an unproven player with a wide band sits low until they earn it. */
export function displayFloor(rating, rd) {
  return displayRating(rating - RANK_FLOOR_K * rd);
}

/** 95%-ish confidence half-width, expressed in display-dial points. */
export function displayConfidence(rd) {
  return Math.round(2 * rd * DISPLAY_SCALE);
}

/** Inflate RD for `periods` of inactivity (used for leaderboard freshness). */
function inflateStale(rd, periods) {
  return Math.min(350, Math.sqrt(rd * rd + STALE_RD * STALE_RD * Math.max(0, periods)));
}

/**
 * Convert one game outcome to a Glicko score in [0,1]. Direction comes from the
 * stored result (respects manual-winner overrides / concessions); magnitude
 * comes from the score gap when margin-of-victory is on.
 *
 * @param {'win'|'loss'|'draw'|null} result
 * @param {number} myScore @param {number} oppScore @param {boolean} marginOfVictory
 * @returns {number|null} null when the game has no usable result
 */
export function outcomeScore(result, myScore, oppScore, marginOfVictory) {
  if (result === 'draw') return 0.5;
  if (result !== 'win' && result !== 'loss') return null;
  if (!marginOfVictory) return result === 'win' ? 1 : 0;
  const mag = Math.min(1, Math.abs((myScore || 0) - (oppScore || 0)) / MOV_FULL);
  return result === 'win' ? 0.5 + 0.5 * mag : 0.5 - 0.5 * mag;
}

// ── Union-find for connectivity ("who shares an opponent graph with whom") ──
class DSU {
  constructor() { /** @type {Map<number,number>} */ this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = /** @type {number} */ (this.parent.get(root));
    let cur = x;
    while (this.parent.get(cur) !== root) { const next = this.parent.get(cur); this.parent.set(cur, root); cur = /** @type {number} */ (next); }
    return root;
  }
  union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.parent.set(ra, rb); }
}

/** Whole-day bucket key (YYYY-MM-DD) + integer day gap between two such keys. */
function dayKey(playedAt) { return String(playedAt).slice(0, 10); }
function daysBetween(a, b) {
  const ms = new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime();
  return Math.max(0, Math.round(ms / 86400000));
}
function today() { return new Date().toISOString().slice(0, 10); }

/** Time-based recency weight for a game played on `gameDay`, viewed from `refDate`. */
function recencyWeight(gameDay, refDate) {
  return Math.pow(0.5, daysBetween(gameDay, refDate) / RECENCY_HALF_LIFE_DAYS);
}

// Glicko-2 (forward/causal): chronological per-DAY batches; same-day games rate
// against pre-day ratings, idle gaps inflate RD by elapsed time. History gets a
// point on each day the player actually played (rating only moves when you play).
function runGlicko(games) {
  const days = new Map();
  for (const gm of games) { if (!days.has(gm.day)) days.set(gm.day, []); days.get(gm.day).push(gm); }
  const orderedDays = [...days.keys()].sort();
  const state = new Map();
  const lastSeen = new Map();
  const hist = new Map();
  const pre = (uid) => state.get(uid) || newPlayer();
  for (const day of orderedDays) {
    const resultsByPlayer = new Map();
    const push = (uid, opp, score) => {
      if (!resultsByPlayer.has(uid)) resultsByPlayer.set(uid, []);
      resultsByPlayer.get(uid).push({ rating: opp.rating, rd: opp.rd, score });
    };
    for (const gm of days.get(day)) {
      const ra = pre(gm.a), rb = pre(gm.b);
      push(gm.a, rb, gm.sa);
      push(gm.b, ra, 1 - gm.sa);
    }
    for (const uid of resultsByPlayer.keys()) {
      let cur = pre(uid);
      if (lastSeen.has(uid)) {
        const t = daysBetween(lastSeen.get(uid), day) / PERIOD_DAYS;
        if (t > 0) cur = decayRd(cur, t);
      }
      const next = ratePeriod(cur, resultsByPlayer.get(uid));
      state.set(uid, next);
      lastSeen.set(uid, day);
      if (!hist.has(uid)) hist.set(uid, []);
      hist.get(uid).push({ date: day, rating: next.rating, displayRating: displayRating(next.rating), rd: Math.round(next.rd) });
    }
  }
  return { state, hist };
}

// Whole-history (global Bradley-Terry): refit the entire graph at each distinct
// game-date. A player's estimate can move on a date they DIDN'T play, because
// new results about their opponents reshape the whole fit — that's the point.
function runWHR(games) {
  const state = new Map();
  const hist = new Map();
  const dates = [...new Set(games.map(g => g.day))].sort();
  // Each fit weights games by recency relative to its reference date: the
  // windowed point at date `d` is judged "as of d"; the leaderboard fit (all
  // games) is judged as of the latest game date.
  for (const d of dates) {
    const through = [];
    for (const g of games) if (g.day <= d) through.push({ a: g.a, b: g.b, s: g.sa, w: recencyWeight(g.day, d) });
    const fit = fitGlobal(through);
    for (const [uid, v] of fit) {
      if (!hist.has(uid)) hist.set(uid, []);
      hist.get(uid).push({ date: d, rating: v.rating, displayRating: displayRating(v.rating), rd: Math.round(v.rd) });
    }
  }
  const latest = dates.length ? dates[dates.length - 1] : today();
  const full = fitGlobal(games.map(g => ({ a: g.a, b: g.b, s: g.sa, w: recencyWeight(g.day, latest) })));
  for (const [uid, v] of full) state.set(uid, { rating: v.rating, rd: v.rd });
  return { state, hist };
}

/**
 * Compute all-time ratings from every non-hidden game.
 *
 * @param {{ marginOfVictory?: boolean, model?: 'glicko'|'whr' }} [opts]
 * @returns {Promise<{
 *   settings: { marginOfVictory: boolean, model: string, period: string },
 *   players: Map<number, { rating:number, rd:number, games:number,
 *     wins:number, losses:number, draws:number, lastPlayed:string|null,
 *     provisional:boolean, component:number, history:Array<{date:string,rating:number,displayRating:number,rd:number}> }>,
 *   components: Array<{ id:number, size:number, members:number[] }>,
 *   mainComponent: number|null,
 *   lastPlayedPair: Map<string, string>,
 * }>}
 */
export async function computeRatings(opts = {}) {
  const marginOfVictory = opts.marginOfVictory !== false; // default ON
  const model = opts.model === 'glicko' ? 'glicko' : 'whr'; // whole-history is the default
  const { pool } = await import('./db.js');
  const { rows } = await pool.query(`
    SELECT g.id, g.played_at::text AS played_at,
           a.user_id AS a_user, a.final_score AS a_score, a.result AS a_result,
           b.user_id AS b_user, b.final_score AS b_score, b.result AS b_result
    FROM games g
    JOIN game_players a ON a.game_id = g.id AND a.seat = 1
    JOIN game_players b ON b.game_id = g.id AND b.seat = 2
    WHERE g.hidden_from_stats = FALSE
    ORDER BY g.played_at ASC, g.id ASC
  `);

  // Shared parse: usable games (chronological, score-share for a), connectivity,
  // per-player win/loss/draw + last-played, and last-met per pair (matchmaker).
  // Note outcomeScore guarantees sA + sB = 1, so we keep only a's share.
  const games = [];
  const dsu = new DSU();
  const meta = new Map();
  const lastPlayedPair = new Map();
  const ensureMeta = (uid) => {
    if (!meta.has(uid)) meta.set(uid, { games: 0, wins: 0, losses: 0, draws: 0, lastPlayed: null });
    return meta.get(uid);
  };
  for (const r of rows) {
    if (r.a_user == null || r.b_user == null || r.a_user === r.b_user) continue;
    const sA = outcomeScore(r.a_result, r.a_score, r.b_score, marginOfVictory);
    if (sA == null || outcomeScore(r.b_result, r.b_score, r.a_score, marginOfVictory) == null) continue;
    games.push({ a: r.a_user, b: r.b_user, sa: sA, day: dayKey(r.played_at) });
    dsu.union(r.a_user, r.b_user);
    for (const [uid, res] of [[r.a_user, r.a_result], [r.b_user, r.b_result]]) {
      const mm = ensureMeta(uid);
      mm.games++;
      if (res === 'win') mm.wins++; else if (res === 'loss') mm.losses++; else mm.draws++;
      if (!mm.lastPlayed || r.played_at > mm.lastPlayed) mm.lastPlayed = r.played_at;
    }
    const lo = Math.min(r.a_user, r.b_user), hi = Math.max(r.a_user, r.b_user);
    lastPlayedPair.set(`${lo}:${hi}`, r.played_at); // ascending order → last write wins
  }

  const { state, hist } = model === 'whr' ? runWHR(games) : runGlicko(games);

  // Connected components over players that share the game graph.
  const compRoots = new Map();
  for (const uid of state.keys()) {
    const root = dsu.find(uid);
    if (!compRoots.has(root)) compRoots.set(root, []);
    compRoots.get(root).push(uid);
  }
  const components = [...compRoots.entries()]
    .map(([id, members]) => ({ id, size: members.length, members }))
    .sort((a, b) => b.size - a.size);
  const mainComponent = components.length ? components[0].id : null;

  const now = today();
  const players = new Map();
  for (const [uid, s] of state.entries()) {
    const m = meta.get(uid);
    // Freshness: inflate RD for the gap between the last game and now, so a
    // long-dormant player reads as less certain (and provisional) today.
    const tNow = m.lastPlayed ? daysBetween(dayKey(m.lastPlayed), now) / PERIOD_DAYS : 0;
    const currentRd = Math.round(inflateStale(s.rd, tNow));
    players.set(uid, {
      rating: Math.round(s.rating),
      rd: currentRd,
      games: m.games, wins: m.wins, losses: m.losses, draws: m.draws,
      lastPlayed: m.lastPlayed,
      provisional: m.games < PROVISIONAL_GAMES || currentRd > PROVISIONAL_RD,
      component: dsu.find(uid),
      history: hist.get(uid) || [],
    });
  }

  return {
    settings: { marginOfVictory, model, period: model === 'whr' ? 'whole-history' : PERIOD_LABEL },
    players, components, mainComponent, lastPlayedPair,
  };
}

// ── Balanced matchmaker ────────────────────────────────────────────────────
// For points on a line, the minimum-total-gap perfect matching is "sort, then
// pair adjacent". We expose the best pairing plus a few near-optimal variants
// (so a "reshuffle" can avoid an unwanted rematch without abandoning balance).

function adjacencyCost(sorted) {
  let cost = 0;
  for (let i = 0; i + 1 < sorted.length; i += 2) cost += Math.abs(sorted[i].rating - sorted[i + 1].rating);
  return cost;
}

/**
 * @param {Array<{userId:number, rating:number, rd:number}>} present
 * @param {{ limit?: number }} [opts]
 * @returns {Array<{ pairs: Array<{a:number,b:number,winProbA:number,gap:number}>, bye: number|null, totalGap: number }>}
 */
export function balancedPairings(present, opts = {}) {
  const limit = opts.limit || 4;
  const base = [...present].sort((x, y) => y.rating - x.rating);

  // Candidate orderings: the sorted order, plus single adjacent swaps of it.
  const candidates = [base];
  for (let i = 0; i + 1 < base.length; i++) {
    const swapped = base.slice();
    [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
    candidates.push(swapped);
  }

  const seen = new Set();
  const configs = [];
  for (const order of candidates) {
    let arr = order, bye = null;
    if (arr.length % 2 === 1) {
      // Drop the player whose removal yields the cheapest adjacency matching.
      let bestCost = Infinity, bestArr = arr, bestBye = null;
      for (let k = 0; k < arr.length; k += 2) {
        const trial = arr.slice(0, k).concat(arr.slice(k + 1));
        const c = adjacencyCost(trial);
        if (c < bestCost) { bestCost = c; bestArr = trial; bestBye = arr[k].userId; }
      }
      arr = bestArr; bye = bestBye;
    }
    const pairs = [];
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const a = arr[i], b = arr[i + 1];
      pairs.push({ a: a.userId, b: b.userId, winProbA: expectedScore(a, b), gap: Math.abs(a.rating - b.rating) });
    }
    const sig = pairs.map(p => [p.a, p.b].sort((x, y) => x - y).join('-')).sort().join('|') + `#${bye ?? ''}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    configs.push({ pairs, bye, totalGap: pairs.reduce((s, p) => s + p.gap, 0) });
  }
  configs.sort((a, b) => a.totalGap - b.totalGap);
  return configs.slice(0, limit);
}
