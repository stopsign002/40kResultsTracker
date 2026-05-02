import { Router } from 'express';
import { pool } from '../lib/db.js';
import { verifyPassword, hashPassword, requireAuth } from '../lib/auth.js';

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
  res.json({ id: u.id, username: u.username, displayName: u.display_name, role: u.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'unauthorized' });
  res.json({
    id: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
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
  res.json({ ok: true });
});

export default router;
