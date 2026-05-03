import { pool } from './db.js';

// Append a single audit_log row. Designed to be fire-and-forget — never
// throws; an audit-write failure must not block the actual operation.
//
// Usage from inside a route handler:
//   await audit(req, 'game.create', { type: 'game', id: gameId, payload: { ... } });
//
// `payload` is anything JSON-serialisable; keep it small (a few key fields).
export async function audit(req, action, opts = {}) {
  const { type = null, id = null, payload = null } = opts;
  const actorUserId = req?.session?.userId ?? null;
  const actorUsername = req?.session?.username ?? null;
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, actor_username, action, target_type, target_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorUserId, actorUsername, action, type, id, payload ? JSON.stringify(payload) : null]
    );
  } catch (e) {
    console.error('audit write failed:', action, e.message);
  }
}
