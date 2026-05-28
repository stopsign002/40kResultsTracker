import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAdmin } from '../lib/auth.js';
import { computeRatings, balancedPairings, displayRating, displayFloor, displayConfidence, displayBand } from '../lib/ratings.js';
import { GLICKO2_DEFAULTS } from '../lib/glicko2.js';

const router = Router();

// Player ranking is private to admins per the product spec — the whole module
// sits behind requireAdmin. Server enforcement is the source of truth; the
// frontend also hides the nav link for non-admins.
router.use(requireAdmin);

async function userDirectory() {
  const { rows } = await pool.query(
    `SELECT id, display_name, army_name, is_active FROM users`
  );
  const map = new Map();
  for (const u of rows) map.set(u.id, { displayName: u.display_name, armyName: u.army_name, isActive: u.is_active });
  return map;
}

const movFlag = (req) => req.query.marginOfVictory !== 'false';
const modelFlag = (req) => (req.query.model === 'whr' ? 'whr' : 'glicko');

// ── Full ranked leaderboard ───────────────────────────────────────────────
router.get('/leaderboard', async (req, res) => {
  const marginOfVictory = movFlag(req);
  const model = modelFlag(req);
  const [data, dir] = await Promise.all([computeRatings({ marginOfVictory, model }), userDirectory()]);

  const players = [...data.players.entries()].map(([userId, p]) => {
    const u = dir.get(userId) || {};
    const games = p.games || 0;
    return {
      userId,
      displayName: u.displayName || `#${userId}`,
      armyName: u.armyName || null,
      isActive: u.isActive ?? true,
      displayFloor: displayFloor(p.rating, p.rd), // confidence-adjusted; ranking + headline
      displayRating: displayRating(p.rating),     // raw mean estimate ("est")
      rating: p.rating,
      rd: p.rd,
      confidence: displayConfidence(p.rd),
      games, wins: p.wins, losses: p.losses, draws: p.draws,
      winRate: games ? Math.round((p.wins / games) * 1000) / 10 : 0,
      lastPlayed: p.lastPlayed,
      provisional: p.provisional,
      component: p.component,
      inMainPool: p.component === data.mainComponent,
    };
  });
  // Rank by the confidence floor so an unproven player doesn't leap to the top.
  players.sort((a, b) => b.displayFloor - a.displayFloor || b.displayRating - a.displayRating || b.games - a.games);

  res.json({
    settings: data.settings,
    players,
    componentCount: data.components.length,
    generatedAt: new Date().toISOString(),
  });
});

// ── Balanced matchmaking for the players present tonight ───────────────────
// ?present=1,2,3,...  (user ids). Unrated-but-present players join at the
// default Glicko prior so they can still be matched.
router.get('/suggest', async (req, res) => {
  const marginOfVictory = movFlag(req);
  const model = modelFlag(req);
  const present = String(req.query.present || '')
    .split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isInteger);
  if (present.length < 2) return res.status(400).json({ error: 'select at least two players' });

  const [data, dir] = await Promise.all([computeRatings({ marginOfVictory, model }), userDirectory()]);
  const nameOf = (id) => (dir.get(id)?.displayName) || `#${id}`;

  const pool2 = present.map(id => {
    const p = data.players.get(id);
    return { userId: id, rating: p ? p.rating : GLICKO2_DEFAULTS.rating, rd: p ? p.rd : GLICKO2_DEFAULTS.rd };
  });

  const lastPlayed = (a, b) => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return data.lastPlayedPair.get(`${lo}:${hi}`) || null;
  };

  const configs = balancedPairings(pool2, { limit: 4 }).map(cfg => ({
    totalGap: cfg.totalGap,
    bye: cfg.bye != null ? { userId: cfg.bye, displayName: nameOf(cfg.bye) } : null,
    pairs: cfg.pairs.map(p => ({
      a: { userId: p.a, displayName: nameOf(p.a), displayRating: displayRating(pool2.find(x => x.userId === p.a).rating) },
      b: { userId: p.b, displayName: nameOf(p.b), displayRating: displayRating(pool2.find(x => x.userId === p.b).rating) },
      winProbA: Math.round(p.winProbA * 1000) / 10,
      gap: p.gap,
      lastPlayed: lastPlayed(p.a, p.b),
    })),
  }));

  res.json({ settings: data.settings, configs });
});

// ── Every player's rating trajectory on a shared timeline (compare chart) ──
// Each player's series carries a point on each day they played; the client
// plots them all on a time axis and highlights one on click.
router.get('/history', async (req, res) => {
  const [data, dir] = await Promise.all([
    computeRatings({ marginOfVictory: movFlag(req), model: modelFlag(req) }), userDirectory(),
  ]);
  const players = [...data.players.entries()]
    .filter(([, p]) => p.history.length)
    .map(([userId, p]) => ({
      userId,
      displayName: dir.get(userId)?.displayName || `#${userId}`,
      // y = mean estimate; lo/hi = ±1 RD band for the highlight shading.
      series: p.history.map(h => {
        const band = displayBand(h.rd);
        return {
          x: h.date, y: h.displayRating,
          lo: Math.max(0, h.displayRating - band),
          hi: Math.min(1000, h.displayRating + band),
        };
      }),
    }))
    .sort((a, b) => (a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : 0));
  res.json({ settings: data.settings, players });
});

export default router;
