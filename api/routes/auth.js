import { Router } from 'express';
import { pool, withTx } from '../lib/db.js';
import { verifyPassword, hashPassword, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { normalizeArmies, armiesForUser } from '../lib/armies.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  // Type, not just truthiness: bcrypt.compare rejects on a non-string, and an
  // unhandled rejection used to take the whole process down.
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'missing credentials' });
  }
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
  // Stamped only on a real password auth, not on session resume — a returning
  // user with a live 30-day cookie never reaches this route.
  pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id])
    .catch((e) => console.error('last_login_at update failed:', e.message));
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
    'SELECT id, username, display_name, role, army_name, prompt_round_photo FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (!rows[0]) return res.status(401).json({ error: 'unauthorized' });
  res.json({ ...publicUser(rows[0]), armies: await armiesForUser(pool, req.session.userId) });
});

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    armyName: u.army_name,
    promptRoundPhoto: u.prompt_round_photo,
  };
}

// Self-serve update of profile fields the user can edit themselves.
// army_name plus the live tracker's between-rounds photo prompt.
// Omitted = untouched, so a partial update (the photo-prompt toggle) can never
// wipe another field; an explicit '' clears army_name to NULL.
router.patch('/me', requireAuth, async (req, res) => {
  const { armyName, promptRoundPhoto } = req.body || {};
  if (armyName !== undefined && typeof armyName !== 'string') {
    return res.status(400).json({ error: 'armyName must be a string' });
  }
  const sets = [];
  const vals = [];
  if (armyName !== undefined) {
    sets.push(`army_name = $${vals.length + 1}`);
    vals.push(armyName.trim() || null);
  }
  if (typeof promptRoundPhoto === 'boolean') {
    sets.push(`prompt_round_photo = $${vals.length + 1}`);
    vals.push(promptRoundPhoto);
  }
  const returning = 'id, username, display_name, role, army_name, prompt_round_photo';
  const { rows } = sets.length
    ? await pool.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length + 1} RETURNING ${returning}`,
        [...vals, req.session.userId]
      )
    : await pool.query(`SELECT ${returning} FROM users WHERE id = $1`, [req.session.userId]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(publicUser(rows[0]));
});

// Replace the user's whole registered-army list — the same delete-then-reinsert
// contract as PUT /games/:id, so add/remove/reorder/rename/set-primary are all
// this one write. Nothing FKs into user_armies, so replacing loses nothing.
router.put('/me/armies', requireAuth, async (req, res) => {
  let armies;
  try {
    armies = normalizeArmies((req.body || {}).armies);
  } catch (e) {
    return res.status(400).json({ error: e.message, code: e.code });
  }
  const factionIds = [...new Set(armies.map((a) => a.factionId))];
  const saved = await withTx(async (client) => {
    if (factionIds.length) {
      const { rows } = await client.query('SELECT id FROM factions WHERE id = ANY($1)', [factionIds]);
      if (rows.length !== factionIds.length) {
        const known = new Set(rows.map((r) => r.id));
        const missing = factionIds.filter((id) => !known.has(id));
        throw Object.assign(new Error(`unknown faction id ${missing[0]}`), { status: 400, code: 'bad_faction' });
      }
    }
    await client.query('DELETE FROM user_armies WHERE user_id = $1', [req.session.userId]);
    for (let i = 0; i < armies.length; i++) {
      const a = armies[i];
      await client.query(
        `INSERT INTO user_armies (user_id, faction_id, name, is_primary, position)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.session.userId, a.factionId, a.name, a.isPrimary, i]
      );
    }
    return armiesForUser(client, req.session.userId);
  });
  await audit(req, 'auth.update_armies', {
    type: 'user',
    id: req.session.userId,
    payload: { count: saved.length, factionIds },
  });
  res.json({ armies: saved });
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
