import { Router } from 'express';
import { pool } from '../lib/db.js';

const router = Router();

router.get('/factions', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM factions ORDER BY name');
  res.json(rows);
});

router.get('/factions/:id/detachments', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query(
    'SELECT id, name FROM detachments WHERE faction_id = $1 ORDER BY name',
    [id]
  );
  res.json(rows);
});

router.get('/mission-packs', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM mission_packs ORDER BY name');
  res.json(rows);
});

router.get('/mission-packs/:id/details', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [primaries, deployments, rules, secondaries, challengers] = await Promise.all([
    pool.query('SELECT id, name FROM primary_missions WHERE mission_pack_id = $1 ORDER BY name', [id]),
    pool.query('SELECT id, name FROM deployment_maps WHERE mission_pack_id = $1 ORDER BY name', [id]),
    pool.query('SELECT id, name FROM mission_rules WHERE mission_pack_id = $1 ORDER BY name', [id]),
    pool.query('SELECT id, name, card_type FROM secondary_cards WHERE mission_pack_id = $1 ORDER BY card_type, name', [id]),
    pool.query('SELECT id, name FROM challenger_cards WHERE mission_pack_id = $1 ORDER BY name', [id]),
  ]);
  res.json({
    primaryMissions: primaries.rows,
    deploymentMaps: deployments.rows,
    missionRules: rules.rows,
    secondaryCards: secondaries.rows,
    challengerCards: challengers.rows,
  });
});

router.get('/users', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, username, display_name FROM users WHERE is_active = TRUE ORDER BY display_name`
  );
  res.json(rows);
});

export default router;
