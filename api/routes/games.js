import { Router } from 'express';
import { pool, withTx } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';
import { computeFinalScores, validateGameInput, resolvePlayerTimes } from '../lib/game-scoring.js';
import {
  createGame, resolvePlayerIdentities, resolveGameLookups, insertPlayerChildren,
  joinDetachments, recordBannerFirstSeen, notifyGameLogged, FORCE_DISPOSITIONS,
  SECONDARY_MODES,
} from '../lib/game-write.js';
import { idParam, intParam } from '../lib/params.js';

const router = Router();

// Reads are public so unauthenticated visitors can browse. Writes
// (POST /, PUT /:id) still call requireAuth inline below.

// ── List games with filters ───────────────────────────────────
router.get('/', async (req, res) => {
  const {
    playerUserId, playerKey, playerFaction, opponentFaction, missionPack, primaryMission,
    deploymentMap, format, playMedium, edition, dateFrom, dateTo, includeHidden, q,
    limit = 100, offset = 0,
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (!includeHidden || includeHidden === 'false') {
    where.push(`g.hidden_from_stats = FALSE`);
  }
  if (playMedium === 'physical' || playMedium === 'digital') {
    where.push(`g.play_medium = $${i++}`); params.push(playMedium);
  }
  if (edition === '10' || edition === '11') {
    where.push(`g.edition = $${i++}`); params.push(edition);
  }
  if (q && q.trim()) {
    // Free-text search across notes, army_list_code, tournament_name,
    // and player names (registered or guest). ILIKE is case-insensitive
    // on the trigram-friendly columns we have available.
    where.push(`(
      g.notes ILIKE $${i} OR
      g.tournament_name ILIKE $${i} OR
      g.location ILIKE $${i} OR
      EXISTS (SELECT 1 FROM game_players gp2
              LEFT JOIN users u2 ON u2.id = gp2.user_id
              WHERE gp2.game_id = g.id
              AND (gp2.guest_name ILIKE $${i} OR u2.display_name ILIKE $${i}
                   OR u2.army_name ILIKE $${i} OR gp2.army_list_code ILIKE $${i}))
    )`);
    params.push('%' + q.trim() + '%');
    i++;
  }
  if (format) { where.push(`g.game_format = $${i++}`); params.push(format); }
  if (missionPack) { where.push(`g.mission_pack_id = $${i++}`); params.push(missionPack); }
  if (primaryMission) { where.push(`g.primary_mission_id = $${i++}`); params.push(primaryMission); }
  if (deploymentMap) { where.push(`g.deployment_map_id = $${i++}`); params.push(deploymentMap); }
  if (dateFrom) { where.push(`g.played_at >= $${i++}`); params.push(dateFrom); }
  if (dateTo) { where.push(`g.played_at <= $${i++}`); params.push(dateTo); }
  if (playerUserId) {
    where.push(`EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.user_id = $${i++})`);
    params.push(playerUserId);
  }
  if (playerKey) {
    if (String(playerKey).startsWith('user:')) {
      where.push(`EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.user_id = $${i++})`);
      params.push(parseInt(String(playerKey).slice(5), 10));
    } else if (String(playerKey).startsWith('guest:')) {
      where.push(`EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.guest_name = $${i++})`);
      params.push(String(playerKey).slice(6));
    }
  }
  if (playerFaction) {
    where.push(`EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.faction_id = $${i++})`);
    params.push(playerFaction);
  }
  if (opponentFaction && playerFaction) {
    where.push(`EXISTS (
      SELECT 1 FROM game_players a JOIN game_players b ON a.game_id = b.game_id AND a.seat <> b.seat
      WHERE a.game_id = g.id AND a.faction_id = $${i - 1} AND b.faction_id = $${i++}
    )`);
    params.push(opponentFaction);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // Bounded, not just parsed: LIMIT 'NaN' is a Postgres 22P02, and an
  // unbounded limit is a free full-table dump on a public endpoint.
  params.push(intParam(limit, { min: 1, max: 500, fallback: 100 }));
  params.push(intParam(offset, { min: 0, max: 1000000, fallback: 0 }));

  const sql = `
    SELECT
      g.id, g.played_at, g.game_format, g.points_limit, g.hidden_from_stats,
      g.tournament_name, g.location, g.end_condition, g.play_medium, g.edition,
      mp.name AS mission_pack, pm.name AS primary_mission, dm.name AS deployment_map,
      (SELECT gi.thumb_name FROM game_images gi
        WHERE gi.game_id = g.id
        ORDER BY gi.is_thumbnail DESC, gi.id ASC LIMIT 1) AS thumb_name,
      (SELECT gi.file_name FROM game_images gi
        WHERE gi.game_id = g.id
        ORDER BY gi.is_thumbnail DESC, gi.id ASC LIMIT 1) AS cover_file_name,
      (SELECT gi.thumb_name FROM game_images gi
        WHERE gi.game_id = g.id AND gi.is_map ORDER BY gi.id LIMIT 1) AS map_photo_thumb,
      (SELECT gi.file_name FROM game_images gi
        WHERE gi.game_id = g.id AND gi.is_map ORDER BY gi.id LIMIT 1) AS map_photo_file,
      (SELECT COUNT(*)::int FROM game_images gi WHERE gi.game_id = g.id) AS image_count,
      json_agg(json_build_object(
        'seat', gp.seat,
        'userId', gp.user_id,
        'displayName', COALESCE(u.display_name, gp.guest_name),
        'factionId', gp.faction_id,
        'factionName', f.name,
        'finalScore', gp.final_score,
        'result', gp.result,
        'wentFirst', gp.went_first,
        'primaryMission', COALESCE(gp.primary_mission_name, ppm.name),
        'forceDisposition', gp.force_disposition,
        'timeSeconds', gp.time_seconds
      ) ORDER BY gp.seat) AS players
    FROM games g
    LEFT JOIN mission_packs mp ON mp.id = g.mission_pack_id
    LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
    LEFT JOIN deployment_maps dm ON dm.id = g.deployment_map_id
    LEFT JOIN game_players gp ON gp.game_id = g.id
    LEFT JOIN users u ON u.id = gp.user_id
    LEFT JOIN factions f ON f.id = gp.faction_id
    LEFT JOIN primary_missions ppm ON ppm.id = gp.primary_mission_id
    ${whereSql}
    GROUP BY g.id, mp.name, pm.name, dm.name
    ORDER BY g.played_at DESC, g.id DESC
    LIMIT $${i++} OFFSET $${i}
  `;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

// ── Get single game with full detail ──────────────────────────
router.get('/:id', async (req, res) => {
  const id = idParam(req.params.id);
  if (!id) return res.status(400).json({ error: 'bad game id' });
  const game = await pool.query(
    `SELECT g.*, mp.name AS mission_pack_name, pm.name AS primary_mission_name,
            dm.name AS deployment_map_name, mr.name AS mission_rule_name,
            cu.display_name AS created_by_name
     FROM games g
     LEFT JOIN mission_packs mp ON mp.id = g.mission_pack_id
     LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
     LEFT JOIN deployment_maps dm ON dm.id = g.deployment_map_id
     LEFT JOIN mission_rules mr ON mr.id = g.mission_rule_id
     LEFT JOIN users cu ON cu.id = g.created_by_user_id
     WHERE g.id = $1`,
    [id]
  );
  if (!game.rows[0]) return res.status(404).json({ error: 'not found' });

  const players = await pool.query(
    `SELECT gp.*, COALESCE(u.display_name, gp.guest_name) AS display_name,
            f.name AS faction_name,
            ppm.name AS primary_mission_ref
     FROM game_players gp
     LEFT JOIN users u ON u.id = gp.user_id
     LEFT JOIN factions f ON f.id = gp.faction_id
     LEFT JOIN primary_missions ppm ON ppm.id = gp.primary_mission_id
     WHERE gp.game_id = $1 ORDER BY gp.seat`,
    [id]
  );
  const playerIds = players.rows.map(p => p.id);
  const [rounds, secondaries, challengers, detachments] = await Promise.all([
    playerIds.length
      ? pool.query(`SELECT * FROM game_rounds WHERE game_player_id = ANY($1::int[]) ORDER BY round_number`, [playerIds])
      : { rows: [] },
    playerIds.length
      ? pool.query(`SELECT * FROM player_secondaries WHERE game_player_id = ANY($1::int[]) ORDER BY round_number NULLS LAST, id`, [playerIds])
      : { rows: [] },
    playerIds.length
      ? pool.query(`SELECT * FROM player_challengers WHERE game_player_id = ANY($1::int[]) ORDER BY id`, [playerIds])
      : { rows: [] },
    playerIds.length
      ? pool.query(`SELECT * FROM player_detachments WHERE game_player_id = ANY($1::int[]) ORDER BY sort_order, id`, [playerIds])
      : { rows: [] },
  ]);

  for (const p of players.rows) {
    p.rounds = rounds.rows.filter(r => r.game_player_id === p.id);
    p.secondaries = secondaries.rows.filter(s => s.game_player_id === p.id);
    p.challengers = challengers.rows.filter(c => c.game_player_id === p.id);
    p.detachments = detachments.rows
      .filter(d => d.game_player_id === p.id)
      .map(d => d.detachment_name);
  }
  res.json({ ...game.rows[0], players: players.rows });
});

// ── Create game ───────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    validateGameInput(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await resolvePlayerIdentities(req.body.players);
  computeFinalScores(req.body.players, req.body.edition === '11' ? '11' : '10');
  resolvePlayerTimes(req.body.players);
  const b = req.body;

  try {
    const id = await withTx((client) => createGame(client, b, req.session.userId));
    await audit(req, 'game.create', { type: 'game', id, payload: { playedAt: b.playedAt, players: b.players.map(p => ({ name: p.userId ? `user:${p.userId}` : `guest:${p.guestName}`, factionId: p.factionId })) } });
    broadcast('game.saved', { id, action: 'create' });
    res.json({ id });
    notifyGameLogged(id); // fire-and-forget; runs after the response is sent
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create game' });
  }
});

// ── Update game (any logged-in user) ──────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  const id = idParam(req.params.id);
  try {
    validateGameInput(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await resolvePlayerIdentities(req.body.players);
  computeFinalScores(req.body.players, req.body.edition === '11' ? '11' : '10');
  resolvePlayerTimes(req.body.players);
  const b = req.body;

  try {
    await withTx(async (client) => {
      const exists = await client.query('SELECT id FROM games WHERE id = $1', [id]);
      if (!exists.rows[0]) throw Object.assign(new Error('not found'), { status: 404 });

      await resolveGameLookups(client, b);

      await client.query(
        `UPDATE games SET played_at=$2, game_format=$3, points_limit=$4, mission_pack_id=$5,
                          primary_mission_id=$6, deployment_map_id=$7, mission_rule_id=$8,
                          turn_count=$9, end_condition=$10, tournament_name=$11,
                          tournament_round=$12, tournament_table=$13, location=$14,
                          notes=$15, play_medium=$16, edition=COALESCE($17, edition),
                          updated_at=NOW()
         WHERE id=$1`,
        [
          id, b.playedAt, b.gameFormat || 'matched', b.pointsLimit,
          b.missionPackId ?? null, b.primaryMissionId ?? null, b.deploymentMapId ?? null,
          b.missionRuleId ?? null, b.turnCount ?? null, b.endCondition || 'normal',
          b.tournamentName ?? null, b.tournamentRound ?? null, b.tournamentTable ?? null,
          b.location ?? null, b.notes ?? null,
          b.playMedium === 'digital' ? 'digital' : 'physical',
          // Unlike create (which defaults to 11e), an edit only moves the
          // edition when the payload names one — a client that doesn't send
          // `edition` must not silently re-stamp an existing 10e game as 11e.
          b.edition === '10' || b.edition === '11' ? b.edition : null,
        ]
      );

      // Replace players + children
      const oldPlayers = await client.query('SELECT id FROM game_players WHERE game_id = $1', [id]);
      const oldIds = oldPlayers.rows.map(r => r.id);
      if (oldIds.length) {
        await client.query('DELETE FROM game_rounds WHERE game_player_id = ANY($1::int[])', [oldIds]);
        await client.query('DELETE FROM player_secondaries WHERE game_player_id = ANY($1::int[])', [oldIds]);
        await client.query('DELETE FROM player_challengers WHERE game_player_id = ANY($1::int[])', [oldIds]);
      }
      await client.query('DELETE FROM game_players WHERE game_id = $1', [id]);

      for (let seat = 1; seat <= 2; seat++) {
        const p = b.players[seat - 1];
        const gp = await client.query(
          `INSERT INTO game_players
            (game_id, seat, user_id, guest_name, faction_id, detachment_id,
             detachment_name, army_list_code, went_first, is_attacker, final_score, result,
             primary_mission_id, primary_mission_name, force_disposition, time_seconds,
             time_is_manual, secondary_mode)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           RETURNING id`,
          [
            id, seat, p.userId ?? null, p.guestName ?? null,
            p.factionId ?? null, p.detachmentId ?? null,
            joinDetachments(p),
            p.armyListCode ?? null,
            !!p.wentFirst, p.isAttacker ?? null, p.finalScore || 0, p.result ?? null,
            p.primaryMissionId ?? null,
            (p.primaryMissionName && p.primaryMissionName.trim()) || null,
            FORCE_DISPOSITIONS.has(p.forceDisposition) ? p.forceDisposition : null,
            p.timeSeconds ?? null,
            !!p.timeIsManual,
            SECONDARY_MODES.has(p.secondaryMode) ? p.secondaryMode : 'tactical',
          ]
        );
        await insertPlayerChildren(client, gp.rows[0].id, p);
        await recordBannerFirstSeen(client, p);
      }
    });
    await audit(req, 'game.update', { type: 'game', id });
    broadcast('game.saved', { id, action: 'update' });
    res.json({ id });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'not found' });
    console.error(e);
    res.status(500).json({ error: 'failed to update game' });
  }
});

export default router;
