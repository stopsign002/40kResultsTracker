import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

router.use(requireAuth);

// Helper: shared filter clauses
function buildFilters(q, startIndex = 1) {
  const where = ['g.hidden_from_stats = FALSE'];
  const params = [];
  let i = startIndex;
  if (q.format) { where.push(`g.game_format = $${i++}`); params.push(q.format); }
  if (q.missionPack) { where.push(`g.mission_pack_id = $${i++}`); params.push(q.missionPack); }
  if (q.dateFrom) { where.push(`g.played_at >= $${i++}`); params.push(q.dateFrom); }
  if (q.dateTo) { where.push(`g.played_at <= $${i++}`); params.push(q.dateTo); }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params, nextIndex: i };
}

// ── Overview: total games, wins/losses, recent activity ──────
router.get('/overview', async (req, res) => {
  const { whereSql, params } = buildFilters(req.query);
  const totals = await pool.query(
    `SELECT COUNT(DISTINCT g.id)::int AS total_games,
            COUNT(DISTINCT gp.user_id)::int AS active_players
     FROM games g LEFT JOIN game_players gp ON gp.game_id = g.id
     ${whereSql}`,
    params
  );
  const recent = await pool.query(
    `SELECT g.played_at::text AS date, COUNT(*)::int AS games
     FROM games g ${whereSql}
     GROUP BY g.played_at
     ORDER BY g.played_at DESC LIMIT 30`,
    params
  );
  res.json({ ...totals.rows[0], recent: recent.rows });
});

// ── Faction win rates ────────────────────────────────────────
router.get('/faction-winrates', async (req, res) => {
  const { whereSql, params } = buildFilters(req.query);
  const sql = `
    SELECT f.id AS faction_id, f.name AS faction,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN factions f ON f.id = gp.faction_id
    ${whereSql}
    GROUP BY f.id, f.name
    ORDER BY games DESC, f.name
  `;
  const { rows } = await pool.query(sql, params);
  for (const r of rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }
  res.json(rows);
});

// ── Per-player stats ─────────────────────────────────────────
router.get('/player-winrates', async (req, res) => {
  const { whereSql, params } = buildFilters(req.query);
  const sql = `
    SELECT
      COALESCE(u.id::text, 'guest:' || gp.guest_name) AS player_key,
      COALESCE(u.display_name, gp.guest_name) AS player_name,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    LEFT JOIN users u ON u.id = gp.user_id
    ${whereSql}
    GROUP BY player_key, player_name
    ORDER BY games DESC
  `;
  const { rows } = await pool.query(sql, params);
  for (const r of rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }
  res.json(rows);
});

// ── Faction performance per primary mission ──────────────────
router.get('/faction-mission-breakdown', async (req, res) => {
  const factionId = parseInt(req.query.factionId, 10);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  const sql = `
    SELECT pm.id AS primary_mission_id, pm.name AS primary_mission,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
    WHERE gp.faction_id = $1 AND pm.id IS NOT NULL
    GROUP BY pm.id, pm.name
    ORDER BY games DESC, pm.name
  `;
  const { rows } = await pool.query(sql, [factionId]);
  for (const r of rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }
  res.json(rows);
});

// ── Faction performance per deployment map ───────────────────
router.get('/faction-deployment-breakdown', async (req, res) => {
  const factionId = parseInt(req.query.factionId, 10);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  const sql = `
    SELECT dm.id AS deployment_map_id, dm.name AS deployment_map,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int AS wins,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    LEFT JOIN deployment_maps dm ON dm.id = g.deployment_map_id
    WHERE gp.faction_id = $1 AND dm.id IS NOT NULL
    GROUP BY dm.id, dm.name
    ORDER BY games DESC
  `;
  const { rows } = await pool.query(sql, [factionId]);
  for (const r of rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }
  res.json(rows);
});

// ── Faction matchup matrix (faction A vs faction B win %) ────
router.get('/faction-matchups', async (_req, res) => {
  const sql = `
    SELECT a.faction_id AS faction_a, fa.name AS faction_a_name,
           b.faction_id AS faction_b, fb.name AS faction_b_name,
           COUNT(*)::int AS games,
           SUM(CASE WHEN a.result = 'win' THEN 1 ELSE 0 END)::int AS wins
    FROM game_players a
    JOIN game_players b ON a.game_id = b.game_id AND a.seat <> b.seat
    JOIN games g ON g.id = a.game_id AND g.hidden_from_stats = FALSE
    JOIN factions fa ON fa.id = a.faction_id
    JOIN factions fb ON fb.id = b.faction_id
    WHERE a.faction_id IS NOT NULL AND b.faction_id IS NOT NULL
    GROUP BY a.faction_id, b.faction_id, fa.name, fb.name
  `;
  const { rows } = await pool.query(sql);
  res.json(rows);
});

// ── Head-to-head between two players ─────────────────────────
router.get('/head-to-head', async (req, res) => {
  const a = req.query.userA, b = req.query.userB;
  if (!a || !b) return res.status(400).json({ error: 'userA and userB required' });
  const sql = `
    SELECT g.id, g.played_at,
      pa.final_score AS score_a, pa.result AS result_a, fa.name AS faction_a,
      pb.final_score AS score_b, pb.result AS result_b, fb.name AS faction_b,
      pm.name AS primary_mission, dm.name AS deployment_map
    FROM games g
    JOIN game_players pa ON pa.game_id = g.id AND pa.user_id = $1
    JOIN game_players pb ON pb.game_id = g.id AND pb.user_id = $2
    LEFT JOIN factions fa ON fa.id = pa.faction_id
    LEFT JOIN factions fb ON fb.id = pb.faction_id
    LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
    LEFT JOIN deployment_maps dm ON dm.id = g.deployment_map_id
    WHERE g.hidden_from_stats = FALSE
    ORDER BY g.played_at DESC
  `;
  const { rows } = await pool.query(sql, [a, b]);
  res.json(rows);
});

// ── Going-first impact ───────────────────────────────────────
router.get('/first-turn-impact', async (req, res) => {
  const { whereSql, params } = buildFilters(req.query);
  const sql = `
    SELECT
      gp.went_first,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win' THEN 1 ELSE 0 END)::int AS wins,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    ${whereSql}
    GROUP BY gp.went_first
    ORDER BY gp.went_first DESC
  `;
  const { rows } = await pool.query(sql, params);
  for (const r of rows) r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  res.json(rows);
});

// ── Secondary card averages ──────────────────────────────────
router.get('/secondary-averages', async (_req, res) => {
  const sql = `
    SELECT ps.card_name,
      COUNT(*)::int AS picks,
      ROUND(AVG(ps.score)::numeric, 2) AS avg_score,
      MAX(ps.score) AS max_score
    FROM player_secondaries ps
    JOIN game_players gp ON gp.id = ps.game_player_id
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    GROUP BY ps.card_name
    HAVING COUNT(*) >= 1
    ORDER BY picks DESC, avg_score DESC
  `;
  const { rows } = await pool.query(sql);
  res.json(rows);
});

export default router;
