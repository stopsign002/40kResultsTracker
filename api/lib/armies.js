// @ts-check
// A player's registered armies (user_armies): validation for the
// replace-the-whole-list write, and the shared ordered read.

import { idParam } from './params.js';

const MAX_ARMIES = 50;
const MAX_NAME_LENGTH = 120;

function reject(message, code) {
  throw Object.assign(new Error(message), { code });
}

/**
 * Validate and normalise the body of PUT /auth/me/armies.
 * Returns clean rows in list order; position is the array index. If the list
 * is non-empty and nothing is flagged primary, the first entry becomes it.
 *
 * @param {unknown} input  the request body's `armies` value
 * @returns {{ factionId: number, name: string|null, isPrimary: boolean }[]}
 */
export function normalizeArmies(input) {
  if (!Array.isArray(input)) reject('armies must be an array', 'bad_armies');
  const list = /** @type {unknown[]} */ (input);
  if (list.length > MAX_ARMIES) reject(`no more than ${MAX_ARMIES} armies`, 'too_many_armies');

  let sawPrimary = false;
  const armies = list.map((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      reject(`army ${i + 1} must be an object`, 'bad_armies');
    }
    const { factionId, name, isPrimary } = /** @type {Record<string, unknown>} */ (entry);
    const fid = idParam(factionId);
    if (!fid) reject(`army ${i + 1} needs a valid factionId`, 'bad_faction');
    let cleanName = null;
    if (name !== undefined && name !== null) {
      if (typeof name !== 'string') reject(`army ${i + 1}: name must be a string`, 'bad_armies');
      const trimmed = /** @type {string} */ (name).trim();
      if (trimmed.length > MAX_NAME_LENGTH) {
        reject(`army ${i + 1}: name must be ${MAX_NAME_LENGTH} characters or fewer`, 'name_too_long');
      }
      cleanName = trimmed || null;
    }
    const primary = isPrimary === true;
    if (primary && sawPrimary) reject('only one army can be primary', 'multiple_primary');
    sawPrimary = sawPrimary || primary;
    return { factionId: /** @type {number} */ (fid), name: cleanName, isPrimary: primary };
  });

  if (armies.length && !sawPrimary) armies[0].isPrimary = true;
  return armies;
}

/**
 * A user's armies in display order, camelCased for the client.
 *
 * @param {{ query: Function }} db  pool or a withTx client
 * @param {number} userId
 * @returns {Promise<{ id: number, factionId: number, name: string|null, isPrimary: boolean, position: number }[]>}
 */
export async function armiesForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT id, faction_id, name, is_primary, position
       FROM user_armies WHERE user_id = $1 ORDER BY position, id`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    factionId: r.faction_id,
    name: r.name,
    isPrimary: r.is_primary,
    position: r.position,
  }));
}
