import { Router } from 'express';
import { pool } from '../lib/db.js';
import { verifyPassword, hashPassword, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing credentials' });
  const { rows } = await pool.query(
    'SELECT id, username, display_name, password_hash, role, is_active FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );
  const u = rows[0];
  if (!u || !u.is_active) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  req.session.userId = u.id;
  req.session.username = u.username;
  req.session.displayName = u.display_name;
  req.session.role = u.role;
  await audit(req, 'auth.login', { type: 'user', id: u.id });
  res.json({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'unauthorized' });
  // Pull fresh fields (army_name) rather than relying on stale session
  const { rows } = await pool.query(
    'SELECT id, username, display_name, role, army_name FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
  const u = rows[0];
  res.json({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    armyName: u.army_name,
  });
});

// Self-serve update of profile fields the user can edit themselves.
// Currently just army_name; extendable to display_name, etc.
router.patch('/me', requireAuth, async (req, res) => {
  const { armyName } = req.body || {};
  if (armyName !== undefined && typeof armyName !== 'string') {
    return res.status(400).json({ error: 'armyName must be a string' });
  }
  const { rows } = await pool.query(
    `UPDATE users SET army_name = $1 WHERE id = $2
     RETURNING id, username, display_name, role, army_name`,
    [armyName ? armyName.trim() || null : null, req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  const u = rows[0];
  res.json({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    armyName: u.army_name,
  });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'missing fields' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'password must be 8+ characters' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'user not found' });
  const ok = await verifyPassword(currentPassword, rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: 'wrong current password' });
  const hash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.userId]);
  await audit(req, 'auth.change_password', { type: 'user', id: req.session.userId });
  res.json({ ok: true });
});

export default router;
