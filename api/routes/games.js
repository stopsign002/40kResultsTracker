import { Router } from 'express';
import { pool, withTx } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { computeFinalScores, validateGameInput } from '../lib/game-scoring.js';

const router = Router();

router.use(requireAuth);

// ── List games with filters ───────────────────────────────────
router.get('/', async (req, res) => {
  const {
    playerUserId, playerFaction, opponentFaction, missionPack, primaryMission,
    deploymentMap, format, dateFrom, dateTo, includeHidden, q,
    limit = 100, offset = 0,
  } = req.query;

  const where = [];
  const params = [];
  let i = 1;

  if (!includeHidden || includeHidden === 'false') {
    where.push(`g.hidden_from_stats = FALSE`);
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
  params.push(parseInt(limit, 10));
  params.push(parseInt(offset, 10));

  const sql = `
    SELECT
      g.id, g.played_at, g.game_format, g.points_limit, g.hidden_from_stats,
      g.tournament_name, g.location, g.end_condition,
      mp.name AS mission_pack, pm.name AS primary_mission, dm.name AS deployment_map,
      json_agg(json_build_object(
        'seat', gp.seat,
        'userId', gp.user_id,
        'displayName', COALESCE(u.display_name, gp.guest_name),
        'factionId', gp.faction_id,
        'factionName', f.name,
        'finalScore', gp.final_score,
        'result', gp.result,
        'wentFirst', gp.went_first
      ) ORDER BY gp.seat) AS players
    FROM games g
    LEFT JOIN mission_packs mp ON mp.id = g.mission_pack_id
    LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
    LEFT JOIN deployment_maps dm ON dm.id = g.deployment_map_id
    LEFT JOIN game_players gp ON gp.game_id = g.id
    LEFT JOIN users u ON u.id = gp.user_id
    LEFT JOIN factions f ON f.id = gp.faction_id
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
  const id = parseInt(req.params.id, 10);
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
            f.name AS faction_name
     FROM game_players gp
     LEFT JOIN users u ON u.id = gp.user_id
     LEFT JOIN factions f ON f.id = gp.faction_id
     WHERE gp.game_id = $1 ORDER BY gp.seat`,
    [id]
  );
  const playerIds = players.rows.map(p => p.id);
  const [rounds, secondaries, challengers] = await Promise.all([
    playerIds.length
      ? pool.query(`SELECT * FROM game_rounds WHERE game_player_id = ANY($1::int[]) ORDER BY round_number`, [playerIds])
      : { rows: [] },
    playerIds.length
      ? pool.query(`SELECT * FROM player_secondaries WHERE game_player_id = ANY($1::int[]) ORDER BY round_number NULLS LAST, id`, [playerIds])
      : { rows: [] },
    playerIds.length
      ? pool.query(`SELECT * FROM player_challengers WHERE game_player_id = ANY($1::int[]) ORDER BY id`, [playerIds])
      : { rows: [] },
  ]);

  for (const p of players.rows) {
    p.rounds = rounds.rows.filter(r => r.game_player_id === p.id);
    p.secondaries = secondaries.rows.filter(s => s.game_player_id === p.id);
    p.challengers = challengers.rows.filter(c => c.game_player_id === p.id);
  }
  res.json({ ...game.rows[0], players: players.rows });
});

// computeFinalScores + validateGameInput live in lib/game-scoring.js so
// the smoke tests can exercise them without spinning up the HTTP stack.

// Form takes a free-text name input. If that name (case-insensitive) matches a
// registered user's display_name, link the player to that user — this is what
// keeps army_name flowing through to the war map and lets head-to-head /
// player-winrate stats group correctly. Otherwise the player stays a guest.
async function resolvePlayerIdentities(players) {
  for (const p of players) {
    if (p.userId || !p.guestName) continue;
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(display_name) = LOWER($1) AND is_active = TRUE
       LIMIT 1`,
      [p.guestName.trim()]
    );
    if (rows[0]) {
      p.userId = rows[0].id;
      p.guestName = null;
    }
  }
}

// First-seen timestamp per (player, faction) banner — locked in on first
// save and never updated. The war map sorts banners by this to give each
// banner a stable home fortress that doesn't move when games are added,
// hidden, edited, or backdated. See CLAUDE.md "Theatre of War internals".
async function recordBannerFirstSeen(client, p) {
  if (!p.factionId) return;
  if (!p.userId && !p.guestName) return;
  const playerKey = p.userId ? `user:${p.userId}` : `guest:${p.guestName}`;
  await client.query(
    `INSERT INTO banner_first_seen (player_key, faction_id)
     VALUES ($1, $2)
     ON CONFLICT (player_key, faction_id) DO NOTHING`,
    [playerKey, p.factionId]
  );
}

async function insertPlayerChildren(client, gamePlayerId, p) {
  for (const r of p.rounds || []) {
    await client.query(
      `INSERT INTO game_rounds (game_player_id, round_number, primary_score, secondary_score, cp_remaining)
       VALUES ($1, $2, $3, $4, $5)`,
      [gamePlayerId, r.roundNumber, r.primaryScore || 0, r.secondaryScore || 0, r.cpRemaining ?? null]
    );
  }
  for (const s of p.secondaries || []) {
    await client.query(
      `INSERT INTO player_secondaries (game_player_id, round_number, card_id, card_name, score, was_discarded)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [gamePlayerId, s.roundNumber ?? null, s.cardId ?? null, s.cardName, s.score || 0, !!s.wasDiscarded]
    );
  }
  for (const c of p.challengers || []) {
    await client.query(
      `INSERT INTO player_challengers (game_player_id, card_id, card_name, round_number, completed, score)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [gamePlayerId, c.cardId ?? null, c.cardName, c.roundNumber ?? null, !!c.completed, c.score || 0]
    );
  }
}

// ── Create game ───────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    validateGameInput(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await resolvePlayerIdentities(req.body.players);
  computeFinalScores(req.body.players);
  const b = req.body;

  try {
    const id = await withTx(async (client) => {
      const g = await client.query(
        `INSERT INTO games
          (created_by_user_id, played_at, game_format, points_limit, mission_pack_id,
           primary_mission_id, deployment_map_id, mission_rule_id, turn_count,
           end_condition, tournament_name, tournament_round, tournament_table, location, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id`,
        [
          req.session.userId, b.playedAt, b.gameFormat || 'matched', b.pointsLimit,
          b.missionPackId ?? null, b.primaryMissionId ?? null, b.deploymentMapId ?? null,
          b.missionRuleId ?? null, b.turnCount ?? null, b.endCondition || 'normal',
          b.tournamentName ?? null, b.tournamentRound ?? null, b.tournamentTable ?? null,
          b.location ?? null, b.notes ?? null,
        ]
      );
      const gameId = g.rows[0].id;

      for (let seat = 1; seat <= 2; seat++) {
        const p = b.players[seat - 1];
        const gp = await client.query(
          `INSERT INTO game_players
            (game_id, seat, user_id, guest_name, faction_id, detachment_id,
             detachment_name, army_list_code, went_first, is_attacker, final_score, result)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            gameId, seat, p.userId ?? null, p.guestName ?? null,
            p.factionId ?? null, p.detachmentId ?? null,
            (p.detachmentName && p.detachmentName.trim()) || null,
            p.armyListCode ?? null,
            !!p.wentFirst, p.isAttacker ?? null, p.finalScore || 0, p.result ?? null,
          ]
        );
        await insertPlayerChildren(client, gp.rows[0].id, p);
        await recordBannerFirstSeen(client, p);
      }
      return gameId;
    });
    await audit(req, 'game.create', { type: 'game', id, payload: { playedAt: b.playedAt, players: b.players.map(p => ({ name: p.userId ? `user:${p.userId}` : `guest:${p.guestName}`, factionId: p.factionId })) } });
    res.json({ id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed to create game', detail: e.message });
  }
});

// ── Update game (any logged-in user) ──────────────────────────
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    validateGameInput(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  await resolvePlayerIdentities(req.body.players);
  computeFinalScores(req.body.players);
  const b = req.body;

  try {
    await withTx(async (client) => {
      const exists = await client.query('SELECT id FROM games WHERE id = $1', [id]);
      if (!exists.rows[0]) throw Object.assign(new Error('not found'), { status: 404 });

      await client.query(
        `UPDATE games SET played_at=$2, game_format=$3, points_limit=$4, mission_pack_id=$5,
                          primary_mission_id=$6, deployment_map_id=$7, mission_rule_id=$8,
                          turn_count=$9, end_condition=$10, tournament_name=$11,
                          tournament_round=$12, tournament_table=$13, location=$14,
                          notes=$15, updated_at=NOW()
         WHERE id=$1`,
        [
          id, b.playedAt, b.gameFormat || 'matched', b.pointsLimit,
          b.missionPackId ?? null, b.primaryMissionId ?? null, b.deploymentMapId ?? null,
          b.missionRuleId ?? null, b.turnCount ?? null, b.endCondition || 'normal',
          b.tournamentName ?? null, b.tournamentRound ?? null, b.tournamentTable ?? null,
          b.location ?? null, b.notes ?? null,
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
             detachment_name, army_list_code, went_first, is_attacker, final_score, result)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            id, seat, p.userId ?? null, p.guestName ?? null,
            p.factionId ?? null, p.detachmentId ?? null,
            (p.detachmentName && p.detachmentName.trim()) || null,
            p.armyListCode ?? null,
            !!p.wentFirst, p.isAttacker ?? null, p.finalScore || 0, p.result ?? null,
          ]
        );
        await insertPlayerChildren(client, gp.rows[0].id, p);
        await recordBannerFirstSeen(client, p);
      }
    });
    await audit(req, 'game.update', { type: 'game', id });
    res.json({ id });
  } catch (e) {
    if (e.status === 404) return res.status(404).json({ error: 'not found' });
    console.error(e);
    res.status(500).json({ error: 'failed to update game', detail: e.message });
  }
});

export default router;
