// @ts-check
import { Router } from 'express';
import { pool } from '../lib/db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';

const router = Router();

// Public to logged-in users — every view that picks a season needs the list
router.get('/', requireAuth, async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.map_seed::text AS map_seed, s.started_at, s.ended_at, s.is_active,
      (SELECT COUNT(*)::int FROM games g WHERE g.season_id = s.id) AS games
    FROM seasons s
    ORDER BY s.started_at
  `);
  res.json(rows);
});

// Start a new season. Closes the current active season and creates a new
// one with the supplied (or generated) map seed. Admin-only.
router.post('/', requireAdmin, async (req, res) => {
  const { name, mapSeed } = req.body || {};
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
  // Generate a new seed if one isn't supplied. 32-bit positive int.
  const seed = mapSeed != null && Number.isFinite(Number(mapSeed))
    ? BigInt(Math.floor(Number(mapSeed)))
    : BigInt(Math.floor(Math.random() * 0xFFFFFFFF));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE seasons SET is_active = FALSE, ended_at = NOW() WHERE is_active = TRUE`);
    const { rows } = await client.query(`
      INSERT INTO seasons (name, map_seed, is_active)
      VALUES ($1, $2::bigint, TRUE)
      RETURNING id, name, map_seed::text AS map_seed, started_at, ended_at, is_active
    `, [name, seed.toString()]);
    await client.query('COMMIT');
    await audit(req, 'season.start', { type: 'season', id: rows[0].id, payload: { name, mapSeed: seed.toString() } });
    broadcast('season.changed', { id: rows[0].id });
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export default router;
