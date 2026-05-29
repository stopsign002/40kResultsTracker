import { Router } from 'express';
import { pool } from '../lib/db.js';
import { COUNTED_GAMES } from '../lib/game-filter.js';

const router = Router();

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
router.get('/warmap', async (req, res) => {
  // Optional ?season=<id>. When omitted, defaults to the active season so
  // archived past seasons stay reachable from the UI but the live map is
  // always the current one.
  let seasonId = req.query.season ? parseInt(String(req.query.season), 10) : null;
  if (!seasonId) {
    const r = await pool.query(`SELECT id FROM seasons WHERE is_active = TRUE LIMIT 1`);
    seasonId = r.rows[0]?.id ?? null;
  }
  const seasonFilter = seasonId ? `AND g.season_id = ${seasonId}` : '';

  // Optional ?through_game_id=<id>. When provided, restricts the aggregation
  // to games at or before that game in chronological order (played_at ASC,
  // id ASC tiebreak). Drives the war-map time-travel slider. Banners whose
  // earliest played game falls after the cutoff simply have zero rows in
  // the `active` CTE and are excluded from the result.
  const throughGameId = req.query.through_game_id
    ? parseInt(String(req.query.through_game_id), 10)
    : null;
  const throughFilter = throughGameId
    ? `AND (g.played_at, g.id) <= (SELECT played_at, id FROM games WHERE id = ${throughGameId})`
    : '';

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
    JOIN games g ON g.id = gp.game_id AND ${COUNTED_GAMES}
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
        gp.user_id, gp.guest_name, gp.faction_id, gp.result, gp.final_score,
        g.turn_count
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id AND ${COUNTED_GAMES} ${seasonFilter} ${throughFilter}
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
      SUM(ab.final_score * 5.0 / GREATEST(COALESCE(ab.turn_count, 5), 1))::float
                                                           AS adjusted_points,
      bfs.first_seen_at::text                              AS first_seen_at,
      bfs.anchor_x                                         AS anchor_x,
      bfs.anchor_y                                         AS anchor_y
    FROM active ab
    JOIN factions f ON f.id = ab.faction_id
    LEFT JOIN users u ON u.id = ab.user_id
    JOIN banner_first_seen bfs
      ON bfs.player_key = ab.player_key AND bfs.faction_id = ab.faction_id
    GROUP BY ab.player_key, player_name, u.army_name, f.id, f.name,
             bfs.first_seen_at, bfs.anchor_x, bfs.anchor_y
    ORDER BY bfs.first_seen_at, ab.player_key, f.id
  `);

  const totalGamesRow = await pool.query(
    `SELECT COUNT(*)::int AS total_games FROM games g
      WHERE ${COUNTED_GAMES} ${seasonFilter} ${throughFilter}`
  );
  const totalGames = Math.max(1, totalGamesRow.rows[0]?.total_games ?? 1);
  const winsSat   = Math.log1p(totalGames);
  const pointsSat = Math.log1p(totalGames * 75);

  for (const r of rows) {
    const winRate = r.games > 0 ? r.wins / r.games : 0;
    const winsWeight   = Math.log1p(r.wins)             / winsSat;
    const pointsWeight = Math.log1p(r.adjusted_points)  / pointsSat;
    r.territory_score = Math.min(1, winsWeight * 0.66 + pointsWeight * 0.33);
    r.win_rate = r.games > 0 ? Math.round(winRate * 1000) / 10 : 0;
  }

  res.json(rows);
});

// Ordered list of games in a season — drives the war-map time-travel
// slider. Returns enough metadata to label each slider tick (date,
// players, factions, who won) without a second round-trip.
router.get('/warmap-timeline', async (req, res) => {
  let seasonId = req.query.season ? parseInt(String(req.query.season), 10) : null;
  if (!seasonId) {
    const r = await pool.query(`SELECT id FROM seasons WHERE is_active = TRUE LIMIT 1`);
    seasonId = r.rows[0]?.id ?? null;
  }
  const seasonFilter = seasonId ? `AND g.season_id = ${seasonId}` : '';

  const { rows } = await pool.query(`
    SELECT
      g.id,
      g.played_at::text                              AS played_at,
      COALESCE(u1.display_name, gp1.guest_name)      AS p1_name,
      COALESCE(u2.display_name, gp2.guest_name)      AS p2_name,
      f1.name                                        AS p1_faction,
      f2.name                                        AS p2_faction,
      gp1.result                                     AS p1_result
    FROM games g
    LEFT JOIN game_players gp1 ON gp1.game_id = g.id AND gp1.seat = 1
    LEFT JOIN game_players gp2 ON gp2.game_id = g.id AND gp2.seat = 2
    LEFT JOIN factions f1 ON f1.id = gp1.faction_id
    LEFT JOIN factions f2 ON f2.id = gp2.faction_id
    LEFT JOIN users   u1 ON u1.id = gp1.user_id
    LEFT JOIN users   u2 ON u2.id = gp2.user_id
    WHERE ${COUNTED_GAMES} ${seasonFilter}
    ORDER BY g.played_at ASC, g.id ASC
  `);
  res.json(rows);
});

export default router;
