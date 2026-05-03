import { Router } from 'express';
import { pool } from '../lib/db.js';
import { hashPassword, requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

router.use(requireAdmin);

router.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, display_name, role, is_active, army_name, created_at
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
  const id = parseInt(req.params.id, 10);
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
  await audit(req, 'user.update', { type: 'user', id, payload: req.body });
  res.json(rows[0]);
});

// Toggle hide-from-stats on a game (admin-only per spec)
router.patch('/games/:id/visibility', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { hidden } = req.body || {};
  const { rows } = await pool.query(
    `UPDATE games SET hidden_from_stats = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, hidden_from_stats`,
    [!!hidden, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  await audit(req, 'game.visibility', { type: 'game', id, payload: { hidden: !!hidden } });
  res.json(rows[0]);
});

// Hard delete a game and all its children. Admin-only, no soft-delete fallback.
// game_players → game_rounds / player_secondaries / player_challengers cascade
// from `ON DELETE CASCADE` already in the schema.
router.delete('/games/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rowCount } = await pool.query('DELETE FROM games WHERE id = $1', [id]);
  if (!rowCount) return res.status(404).json({ error: 'not found' });
  await audit(req, 'game.delete', { type: 'game', id });
  res.json({ ok: true, id });
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
