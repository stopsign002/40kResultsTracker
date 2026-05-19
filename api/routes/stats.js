import { Router } from 'express';
import { pool } from '../lib/db.js';

const router = Router();

// Public reads — anyone can browse stats.

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

// ── Per-detachment win rates ─────────────────────────────────
// Groups game_players by (faction, detachment_name) to surface which
// detachments actually win. Detachments are free-text now, so unknown
// or empty values bucket into "(unspecified)".
router.get('/detachment-winrates', async (req, res) => {
  const factionId = req.query.factionId ? parseInt(req.query.factionId, 10) : null;
  const where = ['g.hidden_from_stats = FALSE'];
  const params = [];
  let i = 1;
  if (factionId) { where.push(`gp.faction_id = $${i++}`); params.push(factionId); }
  const sql = `
    SELECT
      f.id                                             AS faction_id,
      f.name                                           AS faction,
      COALESCE(NULLIF(TRIM(gp.detachment_name), ''), '(unspecified)') AS detachment,
      COUNT(*)::int                                    AS games,
      SUM(CASE WHEN gp.result = 'win'  THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1)           AS avg_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id
    JOIN factions f ON f.id = gp.faction_id
    WHERE ${where.join(' AND ')}
    GROUP BY f.id, f.name, detachment
    ORDER BY games DESC, f.name, detachment
  `;
  const { rows } = await pool.query(sql, params);
  for (const r of rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }
  res.json(rows);
});

// ── Trends over time ────────────────────────────────────────
// Three series the dashboard can plot: monthly games played, monthly
// average final score (across all players), and faction popularity
// (top N factions by total games, with their per-month counts).
router.get('/trends', async (_req, res) => {
  const monthlyGames = await pool.query(`
    SELECT TO_CHAR(date_trunc('month', g.played_at), 'YYYY-MM') AS month,
           COUNT(*)::int AS games
    FROM games g
    WHERE g.hidden_from_stats = FALSE
    GROUP BY month
    ORDER BY month
  `);
  const monthlyAvgScore = await pool.query(`
    SELECT TO_CHAR(date_trunc('month', g.played_at), 'YYYY-MM') AS month,
           ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score
    FROM games g
    JOIN game_players gp ON gp.game_id = g.id
    WHERE g.hidden_from_stats = FALSE
    GROUP BY month
    ORDER BY month
  `);
  const factionPopularity = await pool.query(`
    WITH top_factions AS (
      SELECT f.id, f.name
      FROM factions f
      JOIN game_players gp ON gp.faction_id = f.id
      JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
      GROUP BY f.id, f.name
      ORDER BY COUNT(*) DESC
      LIMIT 8
    )
    SELECT
      TO_CHAR(date_trunc('month', g.played_at), 'YYYY-MM') AS month,
      f.id AS faction_id,
      f.name AS faction,
      COUNT(*)::int AS games
    FROM top_factions f
    JOIN game_players gp ON gp.faction_id = f.id
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    GROUP BY month, f.id, f.name
    ORDER BY month, f.name
  `);
  res.json({
    monthlyGames: monthlyGames.rows,
    monthlyAvgScore: monthlyAvgScore.rows,
    factionPopularity: factionPopularity.rows,
  });
});

// ── Calendar heatmap data ───────────────────────────────────
// Returns one row per date that has at least one game, with the count.
// Default range: last 365 days. Client renders a GitHub-style year grid.
router.get('/calendar', async (req, res) => {
  const days = Math.min(parseInt(req.query.days, 10) || 365, 730);
  const { rows } = await pool.query(`
    SELECT g.played_at::text AS date, COUNT(*)::int AS games
    FROM games g
    WHERE g.hidden_from_stats = FALSE
      AND g.played_at >= CURRENT_DATE - INTERVAL '${days} days'
    GROUP BY g.played_at
    ORDER BY g.played_at
  `);
  res.json({ days, range_end: new Date().toISOString().slice(0, 10), rows });
});

// ── Per-player profile ──────────────────────────────────────
// :playerKey is either "user:<id>" or "guest:<name>". Returns:
//   - identity (display name, army name)
//   - overall win/loss/draw + recent-form streak
//   - per-faction breakdown
//   - longest win and loss streaks
//   - biggest single-game win + loss (by score margin)
router.get('/player/:playerKey', async (req, res) => {
  const playerKey = req.params.playerKey;
  if (!playerKey || playerKey.length > 200) return res.status(400).json({ error: 'invalid player key' });

  const playerKeyExpr = `(CASE WHEN gp.user_id IS NOT NULL
                              THEN 'user:' || gp.user_id::text
                              ELSE 'guest:' || gp.guest_name END)`;

  // Identity
  const idRow = await pool.query(`
    SELECT
      ${playerKeyExpr} AS player_key,
      COALESCE(u.display_name, gp.guest_name) AS player_name,
      u.army_name
    FROM game_players gp
    LEFT JOIN users u ON u.id = gp.user_id
    WHERE ${playerKeyExpr} = $1
    LIMIT 1
  `, [playerKey]);
  if (!idRow.rows[0]) return res.status(404).json({ error: 'player not found' });
  const identity = idRow.rows[0];

  // Overall + per-faction
  const overall = await pool.query(`
    SELECT
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win'  THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int AS draws,
      ROUND(AVG(gp.final_score)::numeric, 1) AS avg_score,
      MAX(gp.final_score)::int AS best_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    WHERE ${playerKeyExpr} = $1
  `, [playerKey]);

  const byFaction = await pool.query(`
    SELECT f.id AS faction_id, f.name AS faction,
      COUNT(*)::int AS games,
      SUM(CASE WHEN gp.result = 'win'  THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN gp.result = 'loss' THEN 1 ELSE 0 END)::int AS losses,
      SUM(CASE WHEN gp.result = 'draw' THEN 1 ELSE 0 END)::int AS draws
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    JOIN factions f ON f.id = gp.faction_id
    WHERE ${playerKeyExpr} = $1
    GROUP BY f.id, f.name
    ORDER BY games DESC
  `, [playerKey]);
  for (const r of byFaction.rows) {
    r.win_rate = r.games ? Math.round((r.wins / r.games) * 1000) / 10 : 0;
  }

  // Game-by-game results in order — used to compute streaks client-side
  // sized but kept simple by computing here.
  const gameSeq = await pool.query(`
    SELECT g.id, g.played_at::text AS played_at, gp.result, gp.final_score,
           opp.final_score AS opp_score
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.hidden_from_stats = FALSE
    JOIN game_players opp ON opp.game_id = g.id AND opp.seat <> gp.seat
    WHERE ${playerKeyExpr} = $1
    ORDER BY g.played_at, g.id
  `, [playerKey]);

  let curStreak = 0;        // signed: positive = current win streak, negative = loss streak
  let longestWin = 0;
  let longestLoss = 0;
  let runWin = 0, runLoss = 0;
  let biggestWinMargin = 0;
  let biggestLossMargin = 0;
  for (const r of gameSeq.rows) {
    const margin = (r.final_score || 0) - (r.opp_score || 0);
    if (r.result === 'win') {
      runWin++; runLoss = 0;
      if (runWin > longestWin) longestWin = runWin;
      if (margin > biggestWinMargin) biggestWinMargin = margin;
    } else if (r.result === 'loss') {
      runLoss++; runWin = 0;
      if (runLoss > longestLoss) longestLoss = runLoss;
      if (-margin > biggestLossMargin) biggestLossMargin = -margin;
    } else {
      runWin = 0; runLoss = 0;
    }
  }
  // current streak = most recent result's run
  const last = gameSeq.rows[gameSeq.rows.length - 1];
  if (last) {
    if (last.result === 'win') {
      let n = 0;
      for (let i = gameSeq.rows.length - 1; i >= 0 && gameSeq.rows[i].result === 'win'; i--) n++;
      curStreak = n;
    } else if (last.result === 'loss') {
      let n = 0;
      for (let i = gameSeq.rows.length - 1; i >= 0 && gameSeq.rows[i].result === 'loss'; i--) n++;
      curStreak = -n;
    }
  }
  const o = overall.rows[0];
  const win_rate = o.games ? Math.round((o.wins / o.games) * 1000) / 10 : 0;

  res.json({
    ...identity,
    games: o.games || 0,
    wins: o.wins || 0,
    losses: o.losses || 0,
    draws: o.draws || 0,
    win_rate,
    avg_score: o.avg_score,
    best_score: o.best_score,
    current_streak: curStreak,
    longest_win_streak: longestWin,
    longest_loss_streak: longestLoss,
    biggest_win_margin: biggestWinMargin,
    biggest_loss_margin: biggestLossMargin,
    by_faction: byFaction.rows,
  });
});

export default router;
