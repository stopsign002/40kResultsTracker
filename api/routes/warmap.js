import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
router.use(requireAuth);

// Returns per-(player, faction) records that drive war map territory.
// Each unique (player_key, faction_id) is its own banner: Joe's Necrons and
// Jane's Necrons are separate units that hold separate territories.
//
// IMPORTANT: the `first_seen_at` field comes from the `banner_first_seen`
// table — a row is created the moment a banner first saves a game and
// never updated thereafter. The client sorts banners by this timestamp
// to deterministically allocate home fortresses, so adding new games
// (even backdated ones) or hiding old games does NOT shift existing
// fortresses. Only NEW banners ever join the back of the order.
router.get('/warmap', async (_req, res) => {
  // Lazy backfill: cover any banner that exists in game_players but for
  // some reason isn't in banner_first_seen yet (e.g. an admin-inserted
  // game, a row from before this column existed, or the games.js save
  // path being skipped). Idempotent on the (player_key, faction_id) PK.
  await pool.query(`
    INSERT INTO banner_first_seen (player_key, faction_id)
    SELECT DISTINCT
      CASE WHEN gp.user_id IS NOT NULL
           THEN 'user:' || gp.user_id::text
           ELSE 'guest:' || gp.guest_name
      END AS player_key,
      gp.faction_id
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    WHERE gp.faction_id IS NOT NULL
    ON CONFLICT (player_key, faction_id) DO NOTHING
  `);

  const { rows } = await pool.query(`
    WITH active AS (
      SELECT
        CASE WHEN gp.user_id IS NOT NULL
             THEN 'user:' || gp.user_id::text
             ELSE 'guest:' || gp.guest_name
        END AS player_key,
        gp.user_id, gp.guest_name, gp.faction_id, gp.result, gp.final_score
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
      WHERE gp.faction_id IS NOT NULL
    )
    SELECT
      ab.player_key,
      COALESCE(u.display_name, ab.guest_name)              AS player_name,
      u.army_name                                          AS army_name,
      f.id                                                 AS faction_id,
      f.name                                               AS faction,
      COUNT(*)::int                                        AS games,
      SUM(CASE WHEN ab.result = 'win'  THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN ab.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN ab.result = 'draw' THEN 1 ELSE 0 END)::int AS draws,
      ROUND(AVG(ab.final_score)::numeric, 1)               AS avg_score,
      bfs.first_seen_at::text                              AS first_seen_at
    FROM active ab
    JOIN factions f ON f.id = ab.faction_id
    LEFT JOIN users u ON u.id = ab.user_id
    JOIN banner_first_seen bfs
      ON bfs.player_key = ab.player_key AND bfs.faction_id = ab.faction_id
    GROUP BY ab.player_key, player_name, u.army_name, f.id, f.name, bfs.first_seen_at
    ORDER BY bfs.first_seen_at, ab.player_key, f.id
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
