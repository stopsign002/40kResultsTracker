// @ts-check
/** @import { GamePayload, PlayerPayload } from '../types.js' */

// The single write path into `games` + `game_players` + their children.
// Both POST /games (routes/games.js) and POST /drafts/:id/submit
// (routes/drafts.js) go through createGame() so a live-tracked game and a
// hand-entered one land identically in the database.
//
// PUT /games/:id keeps its own delete-then-reinsert body in routes/games.js but
// shares the helpers below.
import { pool } from './db.js';
import { FACTION_HOMES, chooseSpareAnchor } from './faction-anchors.js';
import { notify } from './mail.js';

// The five 11e Force Dispositions. Yours vs your opponent's decides the named
// primary mission each of you plays.
export const FORCE_DISPOSITIONS = new Set([
  'Take and Hold', 'Purge the Foe', 'Disruption', 'Reconnaissance', 'Priority Assets',
]);

/**
 * Form takes a free-text name input. If that name (case-insensitive) matches a
 * registered user's display_name, link the player to that user — this is what
 * keeps army_name flowing through to the war map and lets head-to-head /
 * player-winrate stats group correctly. Otherwise the player stays a guest.
 *
 * Matches active OR inactive accounts (active preferred). Inactive accounts are
 * the "dummy" accounts created for promoted guests (lib/adopt-guest.js), so a
 * future game typed with a promoted guest's name re-links to their account
 * instead of spawning a fresh guest row and re-fragmenting their history.
 *
 * @param {PlayerPayload[]} players
 * @returns {Promise<void>}
 */
export async function resolvePlayerIdentities(players) {
  for (const p of players) {
    if (p.userId || !p.guestName) continue;
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE LOWER(display_name) = LOWER($1)
       ORDER BY is_active DESC, id ASC
       LIMIT 1`,
      [p.guestName.trim()]
    );
    if (rows[0]) {
      p.userId = rows[0].id;
      p.guestName = null;
    }
  }
}

/**
 * First-seen timestamp per (player, faction) banner — locked in on first
 * save and never updated. The war map sorts banners by this to give each
 * banner a stable home fortress that doesn't move when games are added,
 * hidden, edited, or backdated. See CLAUDE.md "Theatre of War internals".
 *
 * @param {import('pg').PoolClient} client
 * @param {PlayerPayload} p
 */
export async function recordBannerFirstSeen(client, p) {
  if (!p.factionId) return;
  if (!p.userId && !p.guestName) return;
  const playerKey = p.userId ? `user:${p.userId}` : `guest:${p.guestName}`;

  // Skip the anchor work if this banner already exists.
  const existing = await client.query(
    `SELECT 1 FROM banner_first_seen WHERE player_key = $1 AND faction_id = $2`,
    [playerKey, p.factionId]
  );
  if (existing.rows[0]) return;

  // Look at every banner already on the map (any faction). If there are
  // any, this new banner picks the spare anchor maximally far from all of
  // them so newcomers spawn in fresh territory instead of crammed in next
  // to existing players. Only the very first banner of the season (no
  // neighbours yet) falls back to its FACTION_HOMES lore anchor.
  const allClaims = await client.query(
    `SELECT b.anchor_x, b.anchor_y, f.name AS faction
       FROM banner_first_seen b
       JOIN factions f ON f.id = b.faction_id`
  );
  let anchorX = null, anchorY = null;
  if (allClaims.rows.length > 0) {
    const claimed = allClaims.rows.map(r => {
      if (r.anchor_x != null) return [Number(r.anchor_x), Number(r.anchor_y)];
      return FACTION_HOMES[r.faction] ?? [0.5, 0.5];
    });
    [anchorX, anchorY] = chooseSpareAnchor(claimed);
  }

  await client.query(
    `INSERT INTO banner_first_seen (player_key, faction_id, anchor_x, anchor_y)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (player_key, faction_id) DO NOTHING`,
    [playerKey, p.factionId, anchorX, anchorY]
  );
}

async function resolveLookupId(client, table, packId, name) {
  if (!name || !packId) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  const found = await client.query(
    `SELECT id FROM ${table} WHERE mission_pack_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [packId, trimmed]
  );
  if (found.rows[0]) return found.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO ${table} (mission_pack_id, name) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [packId, trimmed]
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const again = await client.query(
    `SELECT id FROM ${table} WHERE mission_pack_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [packId, trimmed]
  );
  return again.rows[0]?.id ?? null;
}

async function resolveCardId(client, table, packId, cardType, name) {
  if (!name || !packId) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  const found = await client.query(
    `SELECT id FROM ${table} WHERE mission_pack_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [packId, trimmed]
  );
  if (found.rows[0]) return found.rows[0].id;
  const sql = cardType
    ? `INSERT INTO ${table} (mission_pack_id, name, card_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id`
    : `INSERT INTO ${table} (mission_pack_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`;
  const params = cardType ? [packId, trimmed, cardType] : [packId, trimmed];
  const inserted = await client.query(sql, params);
  if (inserted.rows[0]) return inserted.rows[0].id;
  const again = await client.query(
    `SELECT id FROM ${table} WHERE mission_pack_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [packId, trimmed]
  );
  return again.rows[0]?.id ?? null;
}

/**
 * Fills in the id for every free-text name in the payload, inserting the
 * reference row when it doesn't exist yet. Mutates `b` in place.
 *
 * @param {import('pg').PoolClient} client
 * @param {Partial<GamePayload>} b
 */
export async function resolveGameLookups(client, b) {
  if (!b.missionPackId) return;
  if (!b.primaryMissionId && b.primaryMissionName) {
    b.primaryMissionId = await resolveLookupId(client, 'primary_missions', b.missionPackId, b.primaryMissionName);
  }
  if (!b.deploymentMapId && b.deploymentMapName) {
    b.deploymentMapId = await resolveLookupId(client, 'deployment_maps', b.missionPackId, b.deploymentMapName);
  }
  if (!b.missionRuleId && b.missionRuleName) {
    b.missionRuleId = await resolveLookupId(client, 'mission_rules', b.missionPackId, b.missionRuleName);
  }
  for (const p of b.players || []) {
    if (!p.primaryMissionId && p.primaryMissionName) {
      p.primaryMissionId = await resolveLookupId(client, 'primary_missions', b.missionPackId, p.primaryMissionName);
    }
    for (const s of p.secondaries || []) {
      if (!s.cardId && s.cardName) {
        s.cardId = await resolveCardId(client, 'secondary_cards', b.missionPackId, 'tactical', s.cardName);
      }
    }
    for (const c of p.challengers || []) {
      if (!c.cardId && c.cardName) {
        c.cardId = await resolveCardId(client, 'challenger_cards', b.missionPackId, null, c.cardName);
      }
    }
  }
}

/**
 * 11e allows more than one detachment per player. The list is authoritative
 * (player_detachments); `detachment_name` on game_players is the joined display
 * string kept for the list/detail views and older queries.
 *
 * @param {PlayerPayload} p
 * @returns {string[]}
 */
export function detachmentList(p) {
  const raw = Array.isArray(p.detachments) && p.detachments.length
    ? p.detachments
    : [p.detachmentName];
  const seen = new Set();
  const out = [];
  for (const d of raw) {
    const name = typeof d === 'string' ? d.trim() : (d && d.name ? String(d.name).trim() : '');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * @param {PlayerPayload} p
 * @returns {string|null}
 */
export function joinDetachments(p) {
  const list = detachmentList(p);
  return list.length ? list.join(', ') : null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {number} gamePlayerId
 * @param {PlayerPayload} p
 */
export async function insertPlayerChildren(client, gamePlayerId, p) {
  const detachments = detachmentList(p);
  for (let i = 0; i < detachments.length; i++) {
    await client.query(
      `INSERT INTO player_detachments (game_player_id, detachment_name, sort_order)
       VALUES ($1, $2, $3)`,
      [gamePlayerId, detachments[i], i]
    );
  }
  for (const r of p.rounds || []) {
    await client.query(
      `INSERT INTO game_rounds (game_player_id, round_number, primary_score, secondary_score, cp_remaining, time_seconds)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [gamePlayerId, r.roundNumber, r.primaryScore || 0, r.secondaryScore || 0,
       r.cpRemaining ?? null, r.timeSeconds ?? null]
    );
  }
  for (const s of p.secondaries || []) {
    await client.query(
      `INSERT INTO player_secondaries (game_player_id, round_number, drawn_round, card_id, card_name, score, was_discarded)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [gamePlayerId, s.roundNumber ?? null, s.drawnRound ?? null, s.cardId ?? null, s.cardName, s.score || 0, !!s.wasDiscarded]
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

/**
 * INSERT one finished game and both of its seats. Call inside withTx().
 *
 * The caller owns the rest of the pipeline: validateGameInput /
 * validateDraftSubmit, resolvePlayerIdentities, computeFinalScores,
 * resolvePlayerTimes before; audit, broadcast and notifyGameLogged after.
 *
 * @param {import('pg').PoolClient} client
 * @param {Partial<GamePayload>} body   camelCase payload; mutated by the lookup resolution
 * @param {number|null} actorUserId     goes into games.created_by_user_id
 * @returns {Promise<number>} the new game id
 */
export async function createGame(client, body, actorUserId) {
  const b = body;
  await resolveGameLookups(client, b);
  // Attach to the currently-active season. NULL is allowed but should
  // only happen for installs that ran with the schema before seasons.
  const activeSeason = await client.query(`SELECT id FROM seasons WHERE is_active = TRUE LIMIT 1`);
  const seasonId = activeSeason.rows[0]?.id ?? null;
  const g = await client.query(
    `INSERT INTO games
      (created_by_user_id, played_at, game_format, points_limit, mission_pack_id,
       primary_mission_id, deployment_map_id, mission_rule_id, turn_count,
       end_condition, tournament_name, tournament_round, tournament_table, location, notes, season_id, play_medium, edition)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING id`,
    [
      actorUserId, b.playedAt, b.gameFormat || 'matched', b.pointsLimit,
      b.missionPackId ?? null, b.primaryMissionId ?? null, b.deploymentMapId ?? null,
      b.missionRuleId ?? null, b.turnCount ?? null, b.endCondition || 'normal',
      b.tournamentName ?? null, b.tournamentRound ?? null, b.tournamentTable ?? null,
      b.location ?? null, b.notes ?? null, seasonId,
      b.playMedium === 'digital' ? 'digital' : 'physical',
      b.edition === '10' ? '10' : '11',
    ]
  );
  const gameId = g.rows[0].id;

  for (let seat = 1; seat <= 2; seat++) {
    const p = b.players[seat - 1];
    const gp = await client.query(
      `INSERT INTO game_players
        (game_id, seat, user_id, guest_name, faction_id, detachment_id,
         detachment_name, army_list_code, went_first, is_attacker, final_score, result,
         primary_mission_id, primary_mission_name, force_disposition, time_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        gameId, seat, p.userId ?? null, p.guestName ?? null,
        p.factionId ?? null, p.detachmentId ?? null,
        joinDetachments(p),
        p.armyListCode ?? null,
        !!p.wentFirst, p.isAttacker ?? null, p.finalScore || 0, p.result ?? null,
        p.primaryMissionId ?? null,
        (p.primaryMissionName && p.primaryMissionName.trim()) || null,
        FORCE_DISPOSITIONS.has(p.forceDisposition) ? p.forceDisposition : null,
        p.timeSeconds ?? null,
      ]
    );
    await insertPlayerChildren(client, gp.rows[0].id, p);
    await recordBannerFirstSeen(client, p);
  }
  return gameId;
}

/**
 * Fire-and-forget "new game logged" email. Queries a compact summary then
 * hands off to the mailer; any failure is logged, never surfaced to the API.
 *
 * @param {number} id
 */
export async function notifyGameLogged(id) {
  try {
    const players = (await pool.query(
      `SELECT gp.seat,
              COALESCE(u.display_name, gp.guest_name) AS player,
              f.name AS faction, gp.final_score, gp.result
         FROM game_players gp
         LEFT JOIN users u    ON u.id = gp.user_id
         LEFT JOIN factions f ON f.id = gp.faction_id
        WHERE gp.game_id = $1
        ORDER BY gp.seat`, [id])).rows;
    if (players.length < 2) return;
    const g = (await pool.query(
      `SELECT g.played_at::text AS played_at, pm.name AS mission, mp.name AS pack
         FROM games g
         LEFT JOIN primary_missions pm ON pm.id = g.primary_mission_id
         LEFT JOIN mission_packs    mp ON mp.id = g.mission_pack_id
        WHERE g.id = $1`, [id])).rows[0] || {};
    const [p1, p2] = players;
    const line = (p) => `  ${p.player || '—'} (${p.faction || '?'}) — ${p.final_score ?? 0}${p.result ? ' [' + p.result.toUpperCase() + ']' : ''}`;
    const winner = players.find((p) => p.result === 'win');
    const subject = `[40k] New game: ${p1.player || 'P1'} vs ${p2.player || 'P2'}`;
    const text =
`A new game was logged on the 40k tracker.

${line(p1)}
${line(p2)}

Mission: ${g.mission || '—'}${g.pack ? ' (' + g.pack + ')' : ''}
Date: ${(g.played_at || '').slice(0, 10)}
${winner ? 'Winner: ' + winner.player : 'Result: draw'}

View: https://40k.thewheeliebois.com/#/games/${id}`;
    notify(subject, text);
  } catch (e) {
    console.error('[notifyGameLogged] failed:', e.message);
  }
}
