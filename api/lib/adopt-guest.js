// @ts-check
// Promotes free-text guest players into real (but inactive) user accounts so
// every player is a first-class entity for ratings and future features. This
// is the helper CLAUDE.md pitfall #8 anticipated.
//
// Safe by construction: idempotent (a second run finds no unlinked guests),
// transactional (caller wraps in withTx), and war-map-stable — it copies each
// guest's banner_first_seen rows onto the new user key so the Theatre of War's
// seed-claim order (and therefore every territory shape) is preserved.
import { pool } from './db.js';
import { hashPassword } from './auth.js';
import crypto from 'crypto';

const GUEST_GROUPS_SQL = `
  SELECT LOWER(guest_name) AS lname, MIN(guest_name) AS sample, COUNT(*)::int AS rows
  FROM game_players
  WHERE user_id IS NULL AND guest_name IS NOT NULL AND TRIM(guest_name) <> ''
  GROUP BY LOWER(guest_name)
  ORDER BY sample
`;

/**
 * Read-only: what a promotion run would do, without doing it.
 * @returns {Promise<{ groups: Array<{name:string, rows:number, action:'link'|'create'}>, toCreate:number, toLink:number }>}
 */
export async function previewGuests() {
  const { rows } = await pool.query(`
    WITH g AS (${GUEST_GROUPS_SQL})
    SELECT g.sample AS name, g.rows,
           EXISTS (SELECT 1 FROM users u WHERE LOWER(u.display_name) = g.lname) AS will_link
    FROM g ORDER BY g.sample
  `);
  const groups = rows.map(r => ({ name: r.name, rows: r.rows, action: r.will_link ? 'link' : 'create' }));
  return {
    groups,
    toCreate: groups.filter(g => g.action === 'create').length,
    toLink: groups.filter(g => g.action === 'link').length,
  };
}

function slugify(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return base || 'guest';
}

async function uniqueUsername(client, name) {
  const base = slugify(name);
  let candidate = base;
  let n = 1;
  // usernames are UNIQUE; probe until a free one is found.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { rows } = await client.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [candidate]);
    if (!rows[0]) return candidate;
    n++;
    candidate = `${base}-${n}`;
  }
}

/**
 * Promote every unlinked guest. Pass a transaction client (use withTx).
 * @param {import('pg').PoolClient} client
 * @returns {Promise<{ created: Array<{id:number, displayName:string, username:string}>, linked: Array<{id:number, displayName:string}> }>}
 */
export async function promoteAllGuests(client) {
  const { rows: groups } = await client.query(GUEST_GROUPS_SQL);
  const created = [];
  const linked = [];

  for (const grp of groups) {
    const lname = grp.lname;
    const display = grp.sample;

    // Link to an existing user if the name matches (prefer an active one).
    const existing = await client.query(
      `SELECT id, display_name FROM users WHERE LOWER(display_name) = $1
       ORDER BY is_active DESC, id ASC LIMIT 1`,
      [lname]
    );

    let userId;
    if (existing.rows[0]) {
      userId = existing.rows[0].id;
      linked.push({ id: userId, displayName: existing.rows[0].display_name });
    } else {
      const username = await uniqueUsername(client, display);
      const hash = await hashPassword(crypto.randomBytes(24).toString('hex'));
      const ins = await client.query(
        `INSERT INTO users (username, display_name, password_hash, role, is_active)
         VALUES ($1, $2, $3, 'user', FALSE)
         RETURNING id`,
        [username, display, hash]
      );
      userId = ins.rows[0].id;
      created.push({ id: userId, displayName: display, username });
    }

    // Preserve the war map: carry each guest banner's first_seen_at + anchor to
    // the user key, earliest-first per faction. Without this the seed-claim
    // order shifts and territories visibly move.
    await client.query(
      `INSERT INTO banner_first_seen (player_key, faction_id, first_seen_at, anchor_x, anchor_y)
       SELECT DISTINCT ON (b.faction_id)
              'user:' || $1::text, b.faction_id, b.first_seen_at, b.anchor_x, b.anchor_y
       FROM banner_first_seen b
       JOIN game_players gp ON ('guest:' || gp.guest_name) = b.player_key
       WHERE LOWER(gp.guest_name) = $2 AND gp.user_id IS NULL
       ORDER BY b.faction_id, b.first_seen_at ASC
       ON CONFLICT (player_key, faction_id) DO NOTHING`,
      [userId, lname]
    );

    await client.query(
      `UPDATE game_players SET user_id = $1, guest_name = NULL
       WHERE user_id IS NULL AND LOWER(guest_name) = $2`,
      [userId, lname]
    );
  }

  return { created, linked };
}
