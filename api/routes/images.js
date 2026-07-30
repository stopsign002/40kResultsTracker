// @ts-check
// Photos attached to a game.
//
// The browser downscales and re-encodes before upload (see uploadImages() in
// app/js/views/game-detail.js) and posts two JPEG data URLs: a ~2048px "full"
// and a ~400px "thumb". Doing it client-side keeps a native image library
// (sharp/imagemagick) out of the container and means a 12MP phone photo never
// crosses the wire at full size.
//
// Bytes go to disk under UPLOAD_DIR/<game_id>/ and are served as static files
// by Caddy at /uploads/<game_id>/<file> — the API is not in the read path.
import { Router } from 'express';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

export const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';

// Checked against the *decoded* buffer, so this is 8MB of actual image. A
// 2048px JPEG at q0.82 is typically 400-900KB — still an order of magnitude of
// headroom, so raising the client's longest edge from 1600 to 2048 did not make
// this tight. The ceiling is here so a hand-rolled request can't stream an
// arbitrary blob onto the disk. The tighter of the two limits is the route's
// 12mb JSON body cap below: base64 inflates by ~33%, so an 8MB image arrives as
// ~10.7MB of payload and only just fits.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_PER_GAME = 40;
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

/** Decode a `data:image/jpeg;base64,...` URL into a buffer + extension. */
function decodeDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw Object.assign(new Error('image data required'), { status: 400 });
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw Object.assign(new Error('expected a base64 data URL'), { status: 400 });
  const ext = ALLOWED[m[1]];
  if (!ext) throw Object.assign(new Error(`unsupported image type: ${m[1]}`), { status: 415 });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw Object.assign(new Error('empty image'), { status: 400 });
  if (buf.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('image too large'), { status: 413 });
  return { buf, ext };
}

function gameDir(gameId) {
  return path.join(UPLOAD_DIR, String(gameId));
}

// Best-effort unlink: a missing file must not block the DB row from going away,
// or a half-failed upload would be undeletable through the UI.
async function unlinkQuiet(p) {
  try { await fs.unlink(p); } catch { /* already gone */ }
}

// ── List a game's images (public, matching the rest of the read surface) ──
router.get('/:gameId/images', async (req, res) => {
  const gameId = parseInt(req.params.gameId, 10);
  if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'bad game id' });
  const { rows } = await pool.query(
    `SELECT gi.id, gi.game_id, gi.file_name, gi.thumb_name, gi.caption,
            gi.is_thumbnail, gi.is_map, gi.width, gi.height, gi.bytes, gi.created_at,
            gi.uploaded_by_user_id, u.display_name AS uploaded_by_name
       FROM game_images gi
       LEFT JOIN users u ON u.id = gi.uploaded_by_user_id
      WHERE gi.game_id = $1
      ORDER BY gi.is_thumbnail DESC, gi.id ASC`,
    [gameId]
  );
  res.json(rows);
});

// ── Upload one image ──────────────────────────────────────────
// Bigger body limit than the app-wide 256kb, scoped to just this route.
router.post('/:gameId/images', requireAuth, express.json({ limit: '12mb' }), async (req, res, next) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'bad game id' });

    const game = await pool.query('SELECT id FROM games WHERE id = $1', [gameId]);
    if (!game.rows[0]) return res.status(404).json({ error: 'game not found' });

    const count = await pool.query('SELECT COUNT(*)::int AS n FROM game_images WHERE game_id = $1', [gameId]);
    if (count.rows[0].n >= MAX_PER_GAME) {
      return res.status(409).json({ error: `a game can hold at most ${MAX_PER_GAME} photos` });
    }

    const full = decodeDataUrl(req.body?.dataUrl);
    const thumb = decodeDataUrl(req.body?.thumbDataUrl ?? req.body?.dataUrl);

    const dir = gameDir(gameId);
    await fs.mkdir(dir, { recursive: true });
    const stem = crypto.randomUUID();
    const fileName = `${stem}${full.ext}`;
    const thumbName = `${stem}_t${thumb.ext}`;
    await fs.writeFile(path.join(dir, fileName), full.buf);
    try {
      await fs.writeFile(path.join(dir, thumbName), thumb.buf);
    } catch (e) {
      await unlinkQuiet(path.join(dir, fileName));
      throw e;
    }

    // First photo on a game becomes its list thumbnail automatically.
    const existing = await pool.query(
      'SELECT 1 FROM game_images WHERE game_id = $1 AND is_thumbnail LIMIT 1', [gameId]);
    const isThumb = existing.rowCount === 0;

    const width = Number.isInteger(req.body?.width) ? req.body.width : null;
    const height = Number.isInteger(req.body?.height) ? req.body.height : null;
    const caption = (req.body?.caption || '').trim() || null;

    let row;
    try {
      row = (await pool.query(
        `INSERT INTO game_images
           (game_id, uploaded_by_user_id, file_name, thumb_name, caption, is_thumbnail, width, height, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [gameId, req.session.userId, fileName, thumbName, caption, isThumb, width, height, full.buf.length]
      )).rows[0];
    } catch (e) {
      await unlinkQuiet(path.join(dir, fileName));
      await unlinkQuiet(path.join(dir, thumbName));
      throw e;
    }

    audit(req, 'game.image.upload', { type: 'game', id: gameId, payload: { imageId: row.id, bytes: full.buf.length } });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

// ── Set the list thumbnail / edit the caption ─────────────────
router.patch('/:gameId/images/:imageId', requireAuth, async (req, res, next) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    const imageId = parseInt(req.params.imageId, 10);
    const img = await pool.query('SELECT * FROM game_images WHERE id = $1 AND game_id = $2', [imageId, gameId]);
    if (!img.rows[0]) return res.status(404).json({ error: 'image not found' });

    if (req.body?.isThumbnail === true) {
      // Clear then set, in one statement pair — the partial unique index would
      // reject the set if a previous winner were still flagged.
      await pool.query('UPDATE game_images SET is_thumbnail = FALSE WHERE game_id = $1 AND is_thumbnail', [gameId]);
      await pool.query('UPDATE game_images SET is_thumbnail = TRUE WHERE id = $1', [imageId]);
    }
    if (typeof req.body?.isMap === 'boolean') {
      // Clear-then-set, same as the cover: the partial unique index rejects a
      // second winner while the previous one is still flagged.
      await pool.query('UPDATE game_images SET is_map = FALSE WHERE game_id = $1 AND is_map', [gameId]);
      if (req.body.isMap) {
        await pool.query('UPDATE game_images SET is_map = TRUE WHERE id = $1', [imageId]);
      }
    }
    if (typeof req.body?.caption === 'string') {
      await pool.query('UPDATE game_images SET caption = $2 WHERE id = $1',
        [imageId, req.body.caption.trim() || null]);
    }

    const out = await pool.query('SELECT * FROM game_images WHERE id = $1', [imageId]);
    audit(req, 'game.image.update', { type: 'game', id: gameId, payload: { imageId } });
    res.json(out.rows[0]);
  } catch (e) { next(e); }
});

// ── Delete ────────────────────────────────────────────────────
// Unlike games (which are permanent by spec), a photo is just an attachment —
// the uploader or an admin can remove one.
router.delete('/:gameId/images/:imageId', requireAuth, async (req, res, next) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    const imageId = parseInt(req.params.imageId, 10);
    const img = (await pool.query(
      'SELECT * FROM game_images WHERE id = $1 AND game_id = $2', [imageId, gameId])).rows[0];
    if (!img) return res.status(404).json({ error: 'image not found' });

    const isOwner = img.uploaded_by_user_id === req.session.userId;
    if (!isOwner && req.session.role !== 'admin') {
      return res.status(403).json({ error: 'only the uploader or an admin can delete this photo' });
    }

    await pool.query('DELETE FROM game_images WHERE id = $1', [imageId]);
    const dir = gameDir(gameId);
    await unlinkQuiet(path.join(dir, img.file_name));
    await unlinkQuiet(path.join(dir, img.thumb_name));

    // Losing the thumbnail shouldn't leave the game with none — promote the
    // oldest survivor so the games list keeps showing a picture.
    if (img.is_thumbnail) {
      await pool.query(
        `UPDATE game_images SET is_thumbnail = TRUE
          WHERE id = (SELECT id FROM game_images WHERE game_id = $1 ORDER BY id ASC LIMIT 1)`,
        [gameId]
      );
    }

    audit(req, 'game.image.delete', { type: 'game', id: gameId, payload: { imageId } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Called by the admin hard-delete so a removed game doesn't leave its photo
// files orphaned on the volume — the DB rows go via ON DELETE CASCADE, but
// nothing else would ever unlink the bytes.
export async function removeGameImageFiles(gameId) {
  try {
    await fs.rm(gameDir(gameId), { recursive: true, force: true });
  } catch (e) {
    console.error('[images] failed to remove files for game', gameId, e.message);
  }
}

// ── Terrain-layout pictures ───────────────────────────────────
// One image per deployment_map row (e.g. "Layout A"), so it's uploaded once and
// then shown on every game played on that layout. Same client-side downscale
// and base64 contract as game photos; files land in UPLOAD_DIR/maps/.
//
// Deliberately user-supplied: GW's own layout diagrams are copyrighted, so the
// app never ships or fetches them — you photograph your table or draw your own.
export const mapRouter = Router();

const MAPS_DIR = () => path.join(UPLOAD_DIR, 'maps');

mapRouter.post('/:mapId/image', requireAuth, express.json({ limit: '12mb' }), async (req, res, next) => {
  try {
    const mapId = parseInt(req.params.mapId, 10);
    if (!Number.isInteger(mapId)) return res.status(400).json({ error: 'bad map id' });
    const existing = (await pool.query(
      'SELECT id, image_name, image_thumb_name FROM deployment_maps WHERE id = $1', [mapId])).rows[0];
    if (!existing) return res.status(404).json({ error: 'layout not found' });

    const full = decodeDataUrl(req.body?.dataUrl);
    const thumb = decodeDataUrl(req.body?.thumbDataUrl ?? req.body?.dataUrl);

    const dir = MAPS_DIR();
    await fs.mkdir(dir, { recursive: true });
    const stem = crypto.randomUUID();
    const fileName = `${stem}${full.ext}`;
    const thumbName = `${stem}_t${thumb.ext}`;
    await fs.writeFile(path.join(dir, fileName), full.buf);
    await fs.writeFile(path.join(dir, thumbName), thumb.buf);

    const row = (await pool.query(
      `UPDATE deployment_maps SET image_name = $2, image_thumb_name = $3
        WHERE id = $1 RETURNING id, name, image_name, image_thumb_name`,
      [mapId, fileName, thumbName]
    )).rows[0];

    // Replacing an image orphans the old files; drop them once the row points
    // at the new pair, so a failed write can never leave the map imageless.
    if (existing.image_name) await unlinkQuiet(path.join(dir, existing.image_name));
    if (existing.image_thumb_name) await unlinkQuiet(path.join(dir, existing.image_thumb_name));

    audit(req, 'map.image.upload', { type: 'deployment_map', id: mapId, payload: { bytes: full.buf.length } });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

mapRouter.delete('/:mapId/image', requireAuth, async (req, res, next) => {
  try {
    const mapId = parseInt(req.params.mapId, 10);
    const row = (await pool.query(
      'SELECT id, image_name, image_thumb_name FROM deployment_maps WHERE id = $1', [mapId])).rows[0];
    if (!row) return res.status(404).json({ error: 'layout not found' });
    await pool.query(
      'UPDATE deployment_maps SET image_name = NULL, image_thumb_name = NULL WHERE id = $1', [mapId]);
    const dir = MAPS_DIR();
    if (row.image_name) await unlinkQuiet(path.join(dir, row.image_name));
    if (row.image_thumb_name) await unlinkQuiet(path.join(dir, row.image_thumb_name));
    audit(req, 'map.image.delete', { type: 'deployment_map', id: mapId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
