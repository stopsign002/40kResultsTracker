// @ts-check
// The recycle bin behind Admin → Deleted items.
//
// Deleting a game or a live game archives its whole row-set into
// `deleted_items.payload` (JSONB) and then hard-deletes the originals. It is
// deliberately NOT a `deleted_at` flag on `games`: a soft-delete column would
// have to be honoured by ~20 queries across stats.js, warmap.js, ratings.js,
// the games list and `v_game_player_stats` (which already cannot express the
// digital filter), and missing one leaks a deleted game into the stats or the
// war map. Archiving keeps the live tables meaning exactly what they meant
// before — a row that exists is a real game.
//
// Photo BYTES are never touched here. Only `removeArchivedFiles` unlinks them,
// which is what makes a restore come back with its pictures intact.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, removeGameImageFiles } from '../routes/images.js';

/**
 * @typedef {{ name: string, rows: object[] }} ArchivedTable
 * @typedef {{ version: number, tables: ArchivedTable[], links?: { submittedDrafts?: number[] } }} ArchivePayload
 * @typedef {{ droppedRefs: number, droppedCardIds: number, reassignedOwner: boolean,
 *             orphanedPlayers: number, relinkedDrafts: number,
 *             columns: Record<string, number> }} RepairReport
 */

// Capture/restore order is dependency order: parents before children. The
// payload keeps that order, so restoring is a straight walk of the array.
const GAME_TABLES = [
  'games',
  'game_players',
  'game_rounds',
  'player_secondaries',
  'player_challengers',
  'player_detachments',
  'game_images',
];
const DRAFT_TABLES = ['game_drafts', 'game_draft_images'];

// A payload is JSONB an admin could in principle hand-edit, so the table names
// it carries are checked against this set before they reach an interpolated
// identifier.
const RESTORABLE = new Set([...GAME_TABLES, ...DRAFT_TABLES]);

const LIVE_TABLE = { game: 'games', draft: 'game_drafts' };

const PAYLOAD_VERSION = 1;

// Nullable references out of the archived row-set. The referenced row can be
// deleted while the item sits in the bin, and a restore that dies on a foreign
// key defeats the whole point of a recycle bin — so a dangling link is dropped
// and the row still comes back. Same discipline as dropDanglingCardIds() in
// lib/game-write.js, which exists because a deleted secondary_cards row once
// made a finished game unfileable.
const NULLABLE_FKS = {
  games: [
    ['mission_pack_id', 'mission_packs'],
    ['primary_mission_id', 'primary_missions'],
    ['deployment_map_id', 'deployment_maps'],
    ['mission_rule_id', 'mission_rules'],
    ['season_id', 'seasons'],
  ],
  game_players: [
    ['user_id', 'users'],
    ['faction_id', 'factions'],
    ['detachment_id', 'detachments'],
    ['primary_mission_id', 'primary_missions'],
  ],
  player_secondaries: [['card_id', 'secondary_cards']],
  player_challengers: [['card_id', 'challenger_cards']],
  player_detachments: [['detachment_id', 'detachments']],
  game_images: [['uploaded_by_user_id', 'users']],
  game_drafts: [
    ['opponent_user_id', 'users'],
    ['submitted_game_id', 'games'],
  ],
  game_draft_images: [['uploaded_by_user_id', 'users']],
};

// NOT NULL owner columns: they cannot be nulled, and failing the restore over a
// deleted account is the worst outcome, so they fall back to the restoring
// admin. game_players keeps its own CHECK (user_id OR guest_name), which is why
// its user_id is in the nullable list instead — a player with neither would
// break it, but resolvePlayerIdentities only ever nulls one of the pair.
const REQUIRED_USER_FK = {
  games: 'created_by_user_id',
  game_drafts: 'owner_user_id',
};

const GAME_CAPTURE = [
  ['games', 'SELECT row_to_json(t) AS j FROM games t WHERE t.id = $1'],
  ['game_players',
   'SELECT row_to_json(t) AS j FROM game_players t WHERE t.game_id = $1 ORDER BY t.id'],
  ['game_rounds',
   `SELECT row_to_json(t) AS j FROM game_rounds t
     WHERE t.game_player_id IN (SELECT id FROM game_players WHERE game_id = $1)
     ORDER BY t.id`],
  ['player_secondaries',
   `SELECT row_to_json(t) AS j FROM player_secondaries t
     WHERE t.game_player_id IN (SELECT id FROM game_players WHERE game_id = $1)
     ORDER BY t.id`],
  ['player_challengers',
   `SELECT row_to_json(t) AS j FROM player_challengers t
     WHERE t.game_player_id IN (SELECT id FROM game_players WHERE game_id = $1)
     ORDER BY t.id`],
  ['player_detachments',
   `SELECT row_to_json(t) AS j FROM player_detachments t
     WHERE t.game_player_id IN (SELECT id FROM game_players WHERE game_id = $1)
     ORDER BY t.id`],
  ['game_images',
   'SELECT row_to_json(t) AS j FROM game_images t WHERE t.game_id = $1 ORDER BY t.id'],
];

const DRAFT_CAPTURE = [
  ['game_drafts', 'SELECT row_to_json(t) AS j FROM game_drafts t WHERE t.id = $1'],
  ['game_draft_images',
   'SELECT row_to_json(t) AS j FROM game_draft_images t WHERE t.draft_id = $1 ORDER BY t.id'],
];

// row_to_json, not the raw driver rows: it renders DATE as '2026-07-19' and
// TIMESTAMPTZ with an explicit offset, so a restore can't be shifted a day by
// the session timezone the way a JS Date round-tripped through JSON would.
async function capture(client, plan, id) {
  /** @type {ArchivedTable[]} */
  const tables = [];
  for (const [name, sql] of plan) {
    const { rows } = await client.query(sql, [id]);
    tables.push({ name, rows: rows.map((r) => r.j) });
  }
  return /** @type {ArchivePayload} */ ({ version: PAYLOAD_VERSION, tables });
}

function actor(req) {
  return {
    userId: req?.session?.userId ?? null,
    name: req?.session?.displayName ?? req?.session?.username ?? null,
  };
}

async function writeArchiveRow(client, kind, originalId, label, payload, req) {
  const who = actor(req);
  // ON CONFLICT can only fire if an archive row survived for an id that is
  // live again — the live row is the newer truth, so it wins.
  const { rows } = await client.query(
    `INSERT INTO deleted_items (kind, original_id, label, payload, deleted_by_user_id, deleted_by_name)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kind, original_id) DO UPDATE
       SET label = EXCLUDED.label, payload = EXCLUDED.payload,
           deleted_by_user_id = EXCLUDED.deleted_by_user_id,
           deleted_by_name = EXCLUDED.deleted_by_name,
           deleted_at = NOW()
     RETURNING id`,
    [kind, originalId, label, JSON.stringify(payload), who.userId, who.name]
  );
  return rows[0].id;
}

function versusLabel(names, suffix, fallback) {
  const [a, b] = names;
  return a && b ? `${a} vs ${b} · ${suffix}` : fallback;
}

async function gameLabel(client, gameId, gameRow) {
  const { rows } = await client.query(
    `SELECT COALESCE(u.display_name, gp.guest_name) AS name
       FROM game_players gp
       LEFT JOIN users u ON u.id = gp.user_id
      WHERE gp.game_id = $1
      ORDER BY gp.seat`,
    [gameId]
  );
  const playedAt = String(gameRow?.played_at ?? '').slice(0, 10);
  return versusLabel(rows.map((r) => r.name), playedAt || 'game', `Game #${gameId}`);
}

async function draftLabel(client, draftId, draftRow) {
  const { rows } = await client.query(
    `SELECT ow.display_name AS owner_name, op.display_name AS opponent_name
       FROM game_drafts d
       LEFT JOIN users ow ON ow.id = d.owner_user_id
       LEFT JOIN users op ON op.id = d.opponent_user_id
      WHERE d.id = $1`,
    [draftId]
  );
  const players = Array.isArray(draftRow?.payload?.players) ? draftRow.payload.players : [];
  const seatFallback = [rows[0]?.owner_name ?? null, rows[0]?.opponent_name ?? null];
  const names = [0, 1].map((i) => players[i]?.guestName || seatFallback[i] || null);
  return versusLabel(names, 'live game', `Live game #${draftId}`);
}

/**
 * Archive a finished game and hard-delete it. Children (`game_players` and
 * everything hanging off it, plus `game_images`) cascade; every primary key is
 * preserved in the payload so a restore is byte-identical. Photo files are
 * deliberately left on disk — only {@link removeArchivedFiles} unlinks them.
 *
 * Call inside `withTx`.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|null} gameId
 * @param {{ session?: { userId?: number, username?: string, displayName?: string } }} [req]
 * @returns {Promise<{ itemId: number, label: string }|null>} null when no such game
 */
export async function archiveGame(client, gameId, req) {
  if (!Number.isInteger(gameId)) return null;
  const payload = await capture(client, GAME_CAPTURE, gameId);
  const gameRow = payload.tables[0].rows[0];
  if (!gameRow) return null;

  // games.id is ON DELETE SET NULL from game_drafts.submitted_game_id, so the
  // delete below silently un-points every draft that produced this game. That
  // pointer is what links a finished live game to its result, so remember which
  // drafts to re-point on restore.
  const linked = await client.query(
    'SELECT id FROM game_drafts WHERE submitted_game_id = $1', [gameId]);
  payload.links = { submittedDrafts: linked.rows.map((r) => r.id) };

  const label = await gameLabel(client, /** @type {number} */ (gameId), gameRow);
  const itemId = await writeArchiveRow(client, 'game', gameId, label, payload, req);
  await client.query('DELETE FROM games WHERE id = $1', [gameId]);
  return { itemId, label };
}

/**
 * Archive an in-progress live game and hard-delete it. `game_draft_images`
 * cascades. The `UPLOAD_DIR/drafts/<id>/` directory is deliberately left in
 * place so a restored draft still has its mid-game photos.
 *
 * Call inside `withTx`.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|null} draftId
 * @param {{ session?: { userId?: number, username?: string, displayName?: string } }} [req]
 * @returns {Promise<{ itemId: number, label: string }|null>} null when no such draft
 */
export async function archiveDraft(client, draftId, req) {
  if (!Number.isInteger(draftId)) return null;
  const payload = await capture(client, DRAFT_CAPTURE, draftId);
  const draftRow = payload.tables[0].rows[0];
  if (!draftRow) return null;

  const label = await draftLabel(client, /** @type {number} */ (draftId), draftRow);
  const itemId = await writeArchiveRow(client, 'draft', draftId, label, payload, req);
  await client.query('DELETE FROM game_drafts WHERE id = $1', [draftId]);
  return { itemId, label };
}

/**
 * Is the archived id occupied in the live table again? Restoring over it would
 * violate the primary key, so the admin list disables the button instead.
 *
 * @param {import('pg').PoolClient} client
 * @param {'game'|'draft'} kind
 * @param {number} originalId
 * @returns {Promise<boolean>}
 */
export async function isOccupied(client, kind, originalId) {
  const table = LIVE_TABLE[kind];
  if (!table) return true;
  const { rowCount } = await client.query(`SELECT 1 FROM ${table} WHERE id = $1`, [originalId]);
  return rowCount > 0;
}

async function columnTypes(client, table, cache) {
  if (cache.has(table)) return cache.get(table);
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const map = new Map(rows.map((r) => [r.column_name, r.data_type]));
  cache.set(table, map);
  return map;
}

// Only columns the table still has are written, so a migration that ADDED a
// column since the archive was taken restores it at its default instead of
// failing the whole transaction.
async function insertRow(client, table, row, cache) {
  const types = await columnTypes(client, table, cache);
  const cols = Object.keys(row).filter((c) => types.has(c));
  if (!cols.length) return;
  const values = cols.map((c) => {
    const v = row[c];
    const t = types.get(c);
    // node-pg would render a plain array as a Postgres array literal, and a
    // JSONB column wants JSON either way.
    if ((t === 'json' || t === 'jsonb') && v !== null && typeof v === 'object') {
      return JSON.stringify(v);
    }
    return v;
  });
  const placeholders = cols.map((_c, i) => `$${i + 1}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
    values
  );
}

async function liveIds(client, table, ids) {
  if (!ids.length) return new Set();
  const { rows } = await client.query(
    `SELECT id FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
  return new Set(rows.map((r) => r.id));
}

function distinctIds(rows, column) {
  return [...new Set(rows.map((r) => r[column]).filter((v) => Number.isInteger(v)))];
}

// A game can outlive every account that played it — users are deactivated
// rather than deleted today, but nothing stops a delete, and NOT NULL owner
// columns have nowhere to degrade to.
async function fallbackUserId(client, req) {
  const actorId = req?.session?.userId ?? null;
  if (Number.isInteger(actorId)) {
    const { rowCount } = await client.query('SELECT 1 FROM users WHERE id = $1', [actorId]);
    if (rowCount) return actorId;
  }
  const { rows } = await client.query(
    `SELECT id FROM users ORDER BY (role = 'admin') DESC, id ASC LIMIT 1`);
  if (rows[0]) return rows[0].id;
  throw Object.assign(
    new Error('cannot restore: there is no user account left to own this game'),
    { status: 409 }
  );
}

// Reconcile every reference against what exists NOW, before a single INSERT.
// The longer an item sits in the bin the likelier a card, faction or account it
// points at has been removed, and a restore that 500s on a foreign key is the
// one failure a recycle bin must not have.
async function scrubForeignKeys(client, tables, req) {
  /** @type {RepairReport} */
  const repaired = {
    droppedRefs: 0, droppedCardIds: 0, reassignedOwner: false,
    orphanedPlayers: 0, relinkedDrafts: 0, columns: {},
  };
  let owner = null;

  for (const { name, rows } of tables) {
    if (!Array.isArray(rows) || !rows.length) continue;

    for (const [column, refTable] of NULLABLE_FKS[name] || []) {
      const ids = distinctIds(rows, column);
      if (!ids.length) continue;
      const live = await liveIds(client, refTable, ids);
      let dropped = 0;
      for (const row of rows) {
        const previous = row[column];
        if (!Number.isInteger(previous) || live.has(previous)) continue;
        row[column] = null;
        dropped++;
        // game_players carries CHECK (user_id IS NOT NULL OR guest_name IS NOT
        // NULL), so nulling a deleted account's id would make the row
        // unrestorable. Demote the seat to a named guest instead of silently
        // reattributing the game to somebody who did not play it.
        if (name === 'game_players' && column === 'user_id' && !row.guest_name) {
          row.guest_name = `Deleted player #${previous}`;
          repaired.orphanedPlayers++;
        }
      }
      if (dropped) {
        repaired.droppedRefs += dropped;
        if (column === 'card_id') repaired.droppedCardIds += dropped;
        repaired.columns[`${name}.${column}`] = dropped;
      }
    }

    const ownerColumn = REQUIRED_USER_FK[name];
    if (!ownerColumn) continue;
    const live = await liveIds(client, 'users', distinctIds(rows, ownerColumn));
    const orphans = rows.filter((row) => !live.has(row[ownerColumn]));
    if (!orphans.length) continue;
    owner ??= await fallbackUserId(client, req);
    for (const row of orphans) row[ownerColumn] = owner;
    repaired.reassignedOwner = true;
    repaired.columns[`${name}.${ownerColumn}`] = orphans.length;
  }
  return repaired;
}

// Rows come back with their ORIGINAL ids, which leaves each SERIAL sequence
// behind the values now in the table — the next ordinary insert would collide
// on the primary key. Push every touched sequence past its table's max.
async function resyncSequence(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${table}', 'id'),
                   GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${table}), 1))`
  );
}

/**
 * Put an archived game or live game back, with every primary key it had, then
 * drop the archive row. The photo files were never deleted, so the restored
 * `game_images` / `game_draft_images` rows point at bytes that are still there.
 *
 * Every foreign key is reconciled against the live tables first: a dangling
 * nullable reference is dropped (the denormalised `card_name` etc. still
 * displays), and a NOT NULL owner whose account is gone falls back to the
 * restoring admin. `repaired` reports exactly what changed — a subtly different
 * game restored silently is worse than one that says so.
 *
 * Call inside `withTx`.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|null} itemId
 * @param {{ session?: { userId?: number } }} [req] the restoring admin, used as the owner fallback
 * @returns {Promise<{ kind: 'game'|'draft', restoredId: number, repaired: RepairReport }|null>}
 *   null when the archive row is gone
 * @throws {Error & { status: number }} 409 when the original id is live again
 */
export async function restoreItem(client, itemId, req) {
  if (!Number.isInteger(itemId)) return null;
  const item = (await client.query(
    'SELECT * FROM deleted_items WHERE id = $1 FOR UPDATE', [itemId])).rows[0];
  if (!item) return null;

  if (await isOccupied(client, item.kind, item.original_id)) {
    throw Object.assign(
      new Error('something else already uses that id — this one cannot be restored'),
      { status: 409 }
    );
  }

  const tables = (Array.isArray(item.payload?.tables) ? item.payload.tables : [])
    .filter(({ name, rows }) => {
      if (!RESTORABLE.has(name)) {
        throw Object.assign(new Error(`cannot restore unknown table "${name}"`), { status: 500 });
      }
      return Array.isArray(rows) && rows.length;
    });

  const repaired = await scrubForeignKeys(client, tables, req);

  const cache = new Map();
  for (const { name, rows } of tables) {
    for (const row of rows) await insertRow(client, name, row, cache);
  }
  for (const { name } of tables) await resyncSequence(client, name);

  const submittedDrafts = item.payload?.links?.submittedDrafts;
  if (item.kind === 'game' && Array.isArray(submittedDrafts) && submittedDrafts.length) {
    const { rowCount } = await client.query(
      `UPDATE game_drafts SET submitted_game_id = $1
        WHERE id = ANY($2::int[]) AND submitted_at IS NOT NULL AND submitted_game_id IS NULL`,
      [item.original_id, submittedDrafts]
    );
    repaired.relinkedDrafts = rowCount;
  }

  await client.query('DELETE FROM deleted_items WHERE id = $1', [itemId]);
  return { kind: item.kind, restoredId: item.original_id, repaired };
}

/**
 * Permanent deletion, DB side: drop the archive row. Call inside `withTx`, then
 * hand the result to {@link removeArchivedFiles} once the transaction has
 * committed — unlinking inside it would let a failed COMMIT leave a live
 * archive row pointing at bytes that are already gone. A leftover file is
 * recoverable; a row with no files is not.
 *
 * @param {import('pg').PoolClient} client
 * @param {number|null} itemId
 * @returns {Promise<{ kind: 'game'|'draft', originalId: number, occupied: boolean }|null>}
 *   null when the archive row is gone
 */
export async function purgeItem(client, itemId) {
  if (!Number.isInteger(itemId)) return null;
  const item = (await client.query(
    'DELETE FROM deleted_items WHERE id = $1 RETURNING kind, original_id', [itemId])).rows[0];
  if (!item) return null;
  return {
    kind: item.kind,
    originalId: item.original_id,
    occupied: await isOccupied(client, item.kind, item.original_id),
  };
}

/**
 * Unlink the photo bytes a purged archive row owned. Run AFTER the purge
 * transaction commits. Skipped when the id is live again — the directory then
 * belongs to THAT game, and purging the bin must never take a live game's
 * photos.
 *
 * @param {{ kind: 'game'|'draft', originalId: number, occupied?: boolean }} purged
 * @returns {Promise<void>}
 */
export async function removeArchivedFiles(purged) {
  if (!purged || purged.occupied) return;
  if (purged.kind === 'game') {
    await removeGameImageFiles(purged.originalId);
    return;
  }
  const dir = path.join(UPLOAD_DIR, 'drafts', String(purged.originalId));
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
