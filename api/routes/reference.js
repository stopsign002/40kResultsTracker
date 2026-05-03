import { Router } from 'express';
import { pool } from '../lib/db.js';

const router = Router();

router.get('/factions', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name FROM factions ORDER BY name');
  res.json(rows);
});

router.get('/factions/:id/detachments', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  // Union the seeded detachments with any free-text detachment_name strings
  // that have ever been entered for this faction in a game. Once Joe types
  // "Custom Crusade" once, everyone else sees it as an autocomplete suggestion.
  const { rows } = await pool.query(`
    SELECT name FROM (
      SELECT name FROM detachments WHERE faction_id = $1
      UNION
      SELECT TRIM(gp.detachment_name) AS name
      FROM game_players gp
      WHERE gp.faction_id = $1
        AND gp.detachment_name IS NOT NULL
        AND TRIM(gp.detachment_name) <> ''
    ) names
    ORDER BY name
  `, [id]);
  // Same shape as before — id is omitted (no longer meaningful for free-text)
  // but the client only uses .name from the datalist anyway.
  res.json(rows.map((r, idx) => ({ id: idx + 1, name: r.name })));
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

// Distinct player names ever entered (for autocomplete in the form)
router.get('/player-names', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT name FROM (
       SELECT display_name AS name FROM users WHERE is_active = TRUE AND display_name IS NOT NULL
       UNION
       SELECT guest_name AS name FROM game_players WHERE guest_name IS NOT NULL AND guest_name <> ''
     ) names
     ORDER BY name`
  );
  res.json(rows.map(r => r.name));
});

export default router;
