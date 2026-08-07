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
