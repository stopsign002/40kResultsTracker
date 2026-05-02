import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

// Returns faction scores for the war map territory calculation
// Score = weighted blend of win% (30%) and games played (70%, log-scaled)
router.get('/warmap', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      f.id                                                         AS faction_id,
      f.name                                                       AS faction,
      COUNT(*)::int                                                AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int     AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int    AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int    AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1)                      AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    JOIN factions f ON f.id = gp.faction_id
    WHERE gp.faction_id IS NOT NULL
    GROUP BY f.id, f.name
    ORDER BY games DESC
  `);

  for (const r of rows) {
    const winRate = r.games > 0 ? r.wins / r.games : 0;
    // log scale games so early games matter, late games diminish
    const gameWeight = Math.log1p(r.games) / Math.log1p(50); // normalised around ~50 games
    // territory score: 70% games played, 30% win rate — clamped [0, 1]
    r.territory_score = Math.min(1, gameWeight * 0.70 + winRate * 0.30);
    r.win_rate = r.games > 0 ? Math.round(winRate * 1000) / 10 : 0;
  }

  res.json(rows);
});

export default router;
