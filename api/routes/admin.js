import { Router } from 'express';
import { pool, withTx } from '../lib/db.js';
import { hashPassword, requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';
import { previewGuests, promoteAllGuests } from '../lib/adopt-guest.js';
import { archiveGame, restoreItem, purgeItem, removeArchivedFiles } from '../lib/archive.js';
import { idParam } from '../lib/params.js';

const router = Router();

router.use(requireAdmin);

router.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, role, is_active, army_name, created_at, last_login_at
     FROM users ORDER BY created_at`
  );
  res.json(rows);
});

router.post('/users', async (req, res) => {
  const { username, displayName, password, role, armyName } = req.body || {};
  if (!username || !password || !displayName) return res.status(400).json({ error: 'missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be 8+ characters' });
  const r = role === 'admin' ? 'admin' : 'user';
  const hash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, role, is_active, army_name)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING id, username, display_name, role, is_active, army_name, created_at`,
      [username, displayName, hash, r, armyName || null]
    );
    await audit(req, 'user.create', { type: 'user', id: rows[0].id, payload: { username, displayName, role: r } });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'username already exists' });
    throw e;
  }
});

router.patch('/users/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const { displayName, role, isActive, password, armyName } = req.body || {};
  const sets = [];
  const vals = [];
  let i = 1;
  if (displayName !== undefined) { sets.push(`display_name = $${i++}`); vals.push(displayName); }
  if (role !== undefined) { sets.push(`role = $${i++}`); vals.push(role === 'admin' ? 'admin' : 'user'); }
  if (isActive !== undefined) { sets.push(`is_active = $${i++}`); vals.push(!!isActive); }
  if (armyName !== undefined) { sets.push(`army_name = $${i++}`); vals.push(armyName || null); }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'password must be 8+ characters' });
    sets.push(`password_hash = $${i++}`);
    vals.push(await hashPassword(password));
  }
  if (!sets.length) return res.status(400).json({ error: 'no changes' });
  vals.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
     RETURNING id, username, display_name, role, is_active, army_name, created_at`,
    vals
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  // NEVER audit the raw body here: it carries `password` on a reset, and
  // audit_log.payload is JSONB that the admin panel renders verbatim — so the
  // plaintext ended up on screen, in every nightly pg_dumpall, and in the
  // unencrypted offsite backup. Record that it changed, not what it changed to.
  // (POST /admin/users already picks its fields explicitly; this was the gap.)
  const { password: _password, ...audited } = req.body || {};
  await audit(req, 'user.update', {
    type: 'user',
    id,
    payload: { ...audited, ...(password ? { passwordChanged: true } : {}) },
  });
  res.json(rows[0]);
});

// Toggle hide-from-stats on a game (admin-only per spec)
router.patch('/games/:id/visibility', async (req, res) => {
  const id = idParam(req.params.id);
  const { hidden } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE games SET hidden_from_stats = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, hidden_from_stats`,
    [!!hidden, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await audit(req, 'game.visibility', { type: 'game', id, payload: { hidden: !!hidden } });
  broadcast('game.saved', { id, action: 'visibility' });
  res.json(rows[0]);
});

// Delete a game into the recycle bin. The row-set is serialised into
// deleted_items and the originals are hard-deleted (children cascade), so
// nothing that reads `games` needs to learn about deleted rows. The photo files
// are deliberately LEFT on disk — unlinking them here would make a restore come
// back with no pictures. DELETE /admin/deleted/:id is what removes them.
router.delete('/games/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const archived = await withTx((client) => archiveGame(client, id, req));
  if (!archived) return res.status(404).json({ error: 'not found' });
  await audit(req, 'game.delete', { type: 'game', id, payload: { deletedItemId: archived.itemId } });
  broadcast('game.saved', { id, action: 'delete' });
  res.json({ ok: true, id });
});

// ── Recycle bin ───────────────────────────────────────────────
// `canRestore` is false when the archived id is occupied in the live table
// again, which would make the re-insert collide on the primary key.
router.get('/deleted', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT d.id, d.kind, d.original_id, d.label, d.deleted_by_name, d.deleted_at,
            CASE d.kind
              WHEN 'game'  THEN NOT EXISTS (SELECT 1 FROM games g       WHERE g.id  = d.original_id)
              WHEN 'draft' THEN NOT EXISTS (SELECT 1 FROM game_drafts gd WHERE gd.id = d.original_id)
              ELSE FALSE
            END AS "canRestore"
       FROM deleted_items d
      ORDER BY d.deleted_at DESC, d.id DESC`
  );
  res.json(rows);
});

// `repaired` reports what the FK scrub had to change to make the restore
// possible — a card, faction or account that vanished while the item sat in the
// bin. Restoring a subtly different game silently would be worse than failing.
router.post('/deleted/:id/restore', async (req, res) => {
  const id = idParam(req.params.id);
  const restored = await withTx((client) => restoreItem(client, id, req));
  if (!restored) return res.status(404).json({ error: 'not found' });
  await audit(req, 'deleted.restore', {
    type: restored.kind === 'game' ? 'game' : 'game_draft',
    id: restored.restoredId,
    payload: { deletedItemId: id, repaired: restored.repaired },
  });
  if (restored.kind === 'game') {
    broadcast('game.saved', { id: restored.restoredId, action: 'restore' });
  } else {
    // The draft comes back with the rev it was archived at; receivers drop any
    // event that isn't newer than what they hold, so send the real value.
    const { rows } = await pool.query('SELECT rev FROM game_drafts WHERE id = $1', [restored.restoredId]);
    broadcast('draft.updated', { id: restored.restoredId, rev: rows[0]?.rev ?? null, by: null });
  }
  res.json({
    ok: true, kind: restored.kind, restoredId: restored.restoredId, repaired: restored.repaired,
  });
});

// Permanent — this is the only path that unlinks the photo bytes, and it does
// so only once the row is actually gone (see purgeItem).
router.delete('/deleted/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const purged = await withTx((client) => purgeItem(client, id));
  if (!purged) return res.status(404).json({ error: 'not found' });
  await removeArchivedFiles(purged);
  await audit(req, 'deleted.purge', {
    type: purged.kind === 'game' ? 'game' : 'game_draft',
    id: purged.originalId,
    payload: { deletedItemId: id },
  });
  res.json({ ok: true });
});

// Preview which guests a promotion run would create vs link (read-only).
router.get('/guests/preview', async (_req, res) => {
  res.json(await previewGuests());
});

// Promote every free-text guest into a real (inactive) user account so they
// become first-class players for ratings etc. Idempotent + transactional;
// preserves war-map territory via banner_first_seen migration. See
// lib/adopt-guest.js and CLAUDE.md pitfall #8.
router.post('/promote-guests', async (req, res) => {
  const result = await withTx((client) => promoteAllGuests(client));
  await audit(req, 'guests.promote', {
    type: 'user', id: null,
    payload: { created: result.created.length, linked: result.linked.length },
  });
  if (result.created.length || result.linked.length) broadcast('game.saved', { action: 'promote-guests' });
  res.json(result);
});

/* ── Detachment library ───────────────────────────────────────────────────
 * A detachment typed into a game is promoted into `detachments` on save (see
 * promoteDetachments in lib/game-write.js), so the library is a real, editable
 * table rather than something inferred from game history. These routes are how
 * a typo gets fixed once instead of game by game.
 *
 * Names are the key, not ids: the listing also surfaces names that only exist
 * in historical games (rows written before promotion existed), and those have
 * no library row to point an id at.
 */

// Recompute the derived game_players.detachment_name display string from the
// authoritative child rows, for one faction. Cheap, and it means a rename never
// has to reason about which games it touched.
const RESYNC_DISPLAY = `
  UPDATE game_players gp
  SET detachment_name = sub.joined
  FROM (
    SELECT pd.game_player_id, STRING_AGG(pd.detachment_name, ', ' ORDER BY pd.sort_order, pd.id) AS joined
    FROM player_detachments pd
    GROUP BY pd.game_player_id
  ) sub
  WHERE gp.id = sub.game_player_id
    AND gp.faction_id = $1
    AND gp.detachment_name IS DISTINCT FROM sub.joined
`;

function detachmentName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  return name && name.length <= 120 ? name : null;
}

// Every distinct detachment for a faction: the library rows, plus any name that
// only ever appeared in a game, each with how many player-seats used it.
router.get('/detachments', async (req, res) => {
  const factionId = idParam(req.query.factionId);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  const { rows } = await pool.query(`
    WITH lib AS (
      SELECT id, name FROM detachments WHERE faction_id = $1
    ), used AS (
      SELECT TRIM(pd.detachment_name) AS name, COUNT(*)::int AS games
      FROM player_detachments pd
      JOIN game_players gp ON gp.id = pd.game_player_id
      WHERE gp.faction_id = $1 AND TRIM(pd.detachment_name) <> ''
      GROUP BY TRIM(pd.detachment_name)
    )
    SELECT COALESCE(lib.name, used.name) AS name,
           lib.id,
           COALESCE(used.games, 0) AS games,
           (lib.id IS NOT NULL) AS in_library
    FROM lib
    FULL OUTER JOIN used ON LOWER(lib.name) = LOWER(used.name)
    ORDER BY COALESCE(lib.name, used.name)
  `, [factionId]);
  res.json(rows.map((r) => ({
    id: r.id, name: r.name, games: r.games, inLibrary: r.in_library,
  })));
});

router.post('/detachments', async (req, res) => {
  const factionId = idParam(req.body?.factionId);
  const name = detachmentName(req.body?.name);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const { rows } = await pool.query(
    `INSERT INTO detachments (faction_id, name)
     SELECT $1::int, $2::text
     WHERE NOT EXISTS (
       SELECT 1 FROM detachments WHERE faction_id = $1::int AND LOWER(name) = LOWER($2::text)
     )
     RETURNING id, name`,
    [factionId, name]
  );
  if (!rows.length) return res.status(409).json({ error: 'that detachment is already in the library' });
  await audit(req, 'detachment.create', { type: 'detachment', id: rows[0].id, payload: { factionId, name } });
  res.status(201).json(rows[0]);
});

// Rename across the library AND every game that used the old name. Renaming
// onto a name that already exists is a merge — that's the point, it's how two
// spellings of one detachment get reconciled.
router.patch('/detachments', async (req, res) => {
  const factionId = idParam(req.body?.factionId);
  const from = detachmentName(req.body?.from);
  const to = detachmentName(req.body?.to);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  if (from.toLowerCase() === to.toLowerCase() && from === to) {
    return res.status(400).json({ error: 'that is already the name' });
  }

  const result = await withTx(async (client) => {
    const games = await client.query(
      `UPDATE player_detachments pd
       SET detachment_name = $3
       FROM game_players gp
       WHERE gp.id = pd.game_player_id
         AND gp.faction_id = $1
         AND LOWER(TRIM(pd.detachment_name)) = LOWER($2)`,
      [factionId, from, to]
    );

    // A player who fielded both spellings now has the same name twice; keep the
    // earliest row so the joined display string doesn't read "Gladius, Gladius".
    await client.query(
      `DELETE FROM player_detachments pd
       USING player_detachments keep, game_players gp
       WHERE gp.id = pd.game_player_id
         AND gp.faction_id = $1
         AND keep.game_player_id = pd.game_player_id
         AND LOWER(TRIM(keep.detachment_name)) = LOWER(TRIM(pd.detachment_name))
         AND (keep.sort_order, keep.id) < (pd.sort_order, pd.id)`,
      [factionId]
    );

    await client.query(RESYNC_DISPLAY, [factionId]);

    // The library side: if `to` already has a row, the `from` row is redundant.
    const target = await client.query(
      `SELECT id FROM detachments WHERE faction_id = $1 AND LOWER(name) = LOWER($2)`,
      [factionId, to]
    );
    const source = await client.query(
      `SELECT id FROM detachments WHERE faction_id = $1 AND LOWER(name) = LOWER($2)`,
      [factionId, from]
    );
    let merged = false;
    if (target.rows.length && source.rows.length && target.rows[0].id !== source.rows[0].id) {
      await client.query('DELETE FROM detachments WHERE id = $1', [source.rows[0].id]);
      merged = true;
    } else if (source.rows.length) {
      await client.query('UPDATE detachments SET name = $2 WHERE id = $1', [source.rows[0].id, to]);
    } else if (!target.rows.length) {
      await client.query('INSERT INTO detachments (faction_id, name) VALUES ($1, $2)', [factionId, to]);
    }
    return { seatsUpdated: games.rowCount, merged };
  });

  await audit(req, 'detachment.rename', {
    type: 'detachment', id: null,
    payload: { factionId, from, to, seatsUpdated: result.seatsUpdated, merged: result.merged },
  });
  if (result.seatsUpdated) broadcast('game.saved', { action: 'detachment-rename' });
  res.json({ ok: true, ...result });
});

// Drop a library entry. Refuses while games still use the name — deleting it
// there would either rewrite history or leave the name resurrecting itself
// through the autocomplete UNION. Rename/merge it first.
router.delete('/detachments', async (req, res) => {
  const factionId = idParam(req.query.factionId);
  const name = detachmentName(req.query.name);
  if (!factionId) return res.status(400).json({ error: 'factionId required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const used = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM player_detachments pd
     JOIN game_players gp ON gp.id = pd.game_player_id
     WHERE gp.faction_id = $1 AND LOWER(TRIM(pd.detachment_name)) = LOWER($2)`,
    [factionId, name]
  );
  if (used.rows[0].n > 0) {
    return res.status(409).json({
      error: `${used.rows[0].n} recorded game${used.rows[0].n === 1 ? '' : 's'} still use this detachment — rename it into the correct one instead`,
      code: 'in_use',
    });
  }
  const { rowCount } = await pool.query(
    'DELETE FROM detachments WHERE faction_id = $1 AND LOWER(name) = LOWER($2)',
    [factionId, name]
  );
  if (!rowCount) return res.status(404).json({ error: 'not in the library' });
  await audit(req, 'detachment.delete', { type: 'detachment', id: null, payload: { factionId, name } });
  res.json({ ok: true });
});

// Recent audit-log entries — admin viewer.
router.get('/audit', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const { rows } = await pool.query(
    `SELECT id, actor_user_id, actor_username, action, target_type, target_id, payload, created_at
     FROM audit_log
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  res.json(rows);
});

export default router;
