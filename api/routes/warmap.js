import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

// Returns per-(player, faction) records that drive war map territory.
// Each unique (player_key, faction_id) is its own banner: Joe's Necrons and
// Jane's Necrons are separate units that hold separate territories. The
// `first_played_at` field is used by the client to deterministically
// allocate home fortresses (earlier = closer to faction's regional anchor).
router.get('/warmap', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      CASE WHEN gp.user_id IS NOT NULL
           THEN 'user:' || gp.user_id::text
           ELSE 'guest:' || gp.guest_name
      END                                                          AS player_key,
      COALESCE(u.display_name, gp.guest_name)                      AS player_name,
      u.army_name                                                  AS army_name,
      f.id                                                         AS faction_id,
      f.name                                                       AS faction,
      COUNT(*)::int                                                AS games,
      SUM(CASE WHEN gp.result = 'win'  THEN 1 ELSE 0 END)::int     AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int     AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int     AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1)                       AS avg_score,
      MIN(g.played_at)::text                                       AS first_played_at
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    JOIN factions f ON f.id = gp.faction_id
    LEFT JOIN users u ON u.id = gp.user_id
    WHERE gp.faction_id IS NOT NULL
    GROUP BY player_key, player_name, u.army_name, f.id, f.name
    ORDER BY first_played_at, player_key, f.id
  `);

  for (const r of rows) {
    const winRate = r.games > 0 ? r.wins / r.games : 0;
    const gameWeight = Math.log1p(r.games) / Math.log1p(50); // diminishing past ~50 games
    r.territory_score = Math.min(1, gameWeight * 0.70 + winRate * 0.30);
    r.win_rate = r.games > 0 ? Math.round(winRate * 1000) / 10 : 0;
  }

  res.json(rows);
});

export default router;
