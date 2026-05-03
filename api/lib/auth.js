// @ts-check
import bcrypt from 'bcrypt';
import { pool } from './db.js';

const SALT_ROUNDS = 12;

/** @param {string} plain @returns {Promise<string>} */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** @param {string} plain @param {string} hash @returns {Promise<boolean>} */
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function ensureBootstrapAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('No users exist and ADMIN_PASSWORD not set — skipping bootstrap admin.');
    return;
  }
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (username, display_name, password_hash, role, is_active)
     VALUES ($1, $1, $2, 'admin', TRUE)`,
    [username, hash]
  );
  console.log(`Bootstrapped admin user "${username}".`);
}

export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'unauthorized' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
