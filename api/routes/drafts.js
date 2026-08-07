// Live game tracker — a game recorded WHILE it is played.
//
// A draft is NOT a result. It lives in its own table and never reaches /games,
// /stats, /ratings or the war map; only POST /:id/submit turns one into a real
// game (11e only), via the same createGame() path as POST /games.
//
// Two phones write to one draft: the owner may patch anything, the invited
// opponent only their own seat. PATCH serialises them with SELECT ... FOR UPDATE
// and hands back a `rev` so a client that patched from a stale base knows to
// re-read.
import { Router } from 'express';
import express from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, withTx } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { broadcast } from '../lib/events.js';
import { computeFinalScores, resolvePlayerTimes } from '../lib/game-scoring.js';
import { createGame, resolvePlayerIdentities, notifyGameLogged } from '../lib/game-write.js';
import { mergeDraftPatch, opponentSeatPatch, validateDraftSubmit } from '../lib/draft.js';
import { UPLOAD_DIR, decodeDataUrl, unlinkQuiet } from './images.js';

const router = Router();

const MAX_PER_DRAFT = 40;

function draftDir(draftId) {
  return path.join(UPLOAD_DIR, 'drafts', String(draftId));
}

function gameDir(gameId) {
  return path.join(UPLOAD_DIR, String(gameId));
}

// Deliberately NOT lib/draft.js's roundOrNull, which clamps: a photo tagged
// with a nonsense round just loses its tag, whereas a score has to land
// somewhere. Named apart so the two can't be confused at a glance.
function imageRoundOrNull(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

// Always length 2, nulls preserved, so the client can index by seat.
function playerNames(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  return [0, 1].map((i) => players[i]?.guestName ?? null);
}

function playerFactionIds(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  return [0, 1].map((i) => players[i]?.factionId ?? null);
}

function viewerSeatOf(row, userId) {
  if (userId && row.owner_user_id === userId) return 1;
  if (userId && row.opponent_user_id === userId) return 2;
  return null;
}

async function loadDraft(id) {
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(
    `SELECT d.*, ow.display_name AS owner_name, op.display_name AS opponent_name
       FROM game_drafts d
       LEFT JOIN users ow ON ow.id = d.owner_user_id
       LEFT JOIN users op ON op.id = d.opponent_user_id
      WHERE d.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function listImages(draftId) {
  const { rows } = await pool.query(
    `SELECT i.*, u.display_name AS uploaded_by_name
       FROM game_draft_images i
       LEFT JOIN users u ON u.id = i.uploaded_by_user_id
      WHERE i.draft_id = $1
      ORDER BY i.round_number NULLS LAST, i.id ASC`,
    [draftId]
  );
  return rows;
}

// ── My open drafts ────────────────────────────────────────────
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const userId = req.session.userId;
    const { rows } = await pool.query(
      `SELECT d.id, d.owner_user_id, d.opponent_user_id, d.current_step, d.rev,
              d.created_at, d.updated_at, d.payload,
              ow.display_name AS owner_name, op.display_name AS opponent_name
         FROM game_drafts d
         LEFT JOIN users ow ON ow.id = d.owner_user_id
         LEFT JOIN users op ON op.id = d.opponent_user_id
        WHERE d.submitted_game_id IS NULL
          AND (d.owner_user_id = $1 OR d.opponent_user_id = $1)
        ORDER BY d.updated_at DESC, d.id DESC`,
      [userId]
    );
    res.json(rows.map((r) => ({
      id: r.id,
      current_step: r.current_step,
      rev: r.rev,
      created_at: r.created_at,
      updated_at: r.updated_at,
      submitted_game_id: null,
      owner_user_id: r.owner_user_id,
      opponent_user_id: r.opponent_user_id,
      owner_name: r.owner_name,
      opponent_name: r.opponent_name,
      isOwner: r.owner_user_id === userId,
      viewerSeat: viewerSeatOf(r, userId),
      playedAt: r.payload?.playedAt ?? null,
      pointsLimit: r.payload?.pointsLimit ?? null,
      playerNames: playerNames(r.payload),
      playerFactionIds: playerFactionIds(r.payload),
    })));
  } catch (e) { next(e); }
});

// ── Create ────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body : {};
    const currentStep = typeof payload.currentStep === 'string' ? payload.currentStep : 'setup';
    const shareToken = crypto.randomBytes(16).toString('base64url');
    const { rows } = await pool.query(
      `INSERT INTO game_drafts (owner_user_id, share_token, payload, current_step)
       VALUES ($1, $2, $3, $4)
       RETURNING id, share_token, rev`,
      [req.session.userId, shareToken, payload, currentStep]
    );
    audit(req, 'draft.create', { type: 'game_draft', id: rows[0].id });
    res.status(201).json({ id: rows[0].id, shareToken: rows[0].share_token, rev: rows[0].rev });
  } catch (e) { next(e); }
});

// ── Read one ──────────────────────────────────────────────────
// Reachable with a session (owner or opponent) OR with the invite token, so a
// friend can open the link and see the game before claiming their seat.
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });

    const userId = req.session?.userId ?? null;
    const seat = viewerSeatOf(row, userId);
    const hasToken = typeof req.query.token === 'string' && req.query.token === row.share_token;
    if (!seat && !hasToken) {
      return res.status(userId ? 403 : 401).json({ error: 'not your game' });
    }
    const isOwner = seat === 1;

    res.json({
      id: row.id,
      owner_user_id: row.owner_user_id,
      opponent_user_id: row.opponent_user_id,
      owner_name: row.owner_name,
      opponent_name: row.opponent_name,
      share_token: isOwner ? row.share_token : null,
      current_step: row.current_step,
      rev: row.rev,
      payload: row.payload,
      submitted_game_id: row.submitted_game_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      viewerSeat: seat,
      isOwner,
      images: await listImages(row.id),
    });
  } catch (e) { next(e); }
});

// ── Autosave ──────────────────────────────────────────────────
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad draft id' });
    const { baseRev, clientId, patch, currentStep } = req.body || {};
    const userId = req.session.userId;

    const result = await withTx(async (client) => {
      const row = (await client.query(
        'SELECT * FROM game_drafts WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw Object.assign(new Error('draft not found'), { status: 404 });

      const seat = viewerSeatOf(row, userId);
      if (!seat) throw Object.assign(new Error('not your game'), { status: 403 });
      if (row.submitted_game_id != null) {
        throw Object.assign(new Error('this game has already been submitted'), { status: 409 });
      }

      let nextPayload;
      let nextStep = typeof currentStep === 'string' ? currentStep : null;
      if (seat === 1) {
        nextPayload = mergeDraftPatch(row.payload, patch);
      } else {
        if (currentStep != null) {
          throw Object.assign(new Error('only the game owner can move the game on'), { status: 403 });
        }
        const seatPatch = opponentSeatPatch(patch);
        if (seatPatch == null) {
          throw Object.assign(new Error('you can only edit your own side of this game'), { status: 403 });
        }
        nextPayload = mergeDraftPatch(row.payload, { players: { 1: seatPatch } });
        nextStep = null;
      }

      const updated = (await client.query(
        `UPDATE game_drafts
            SET payload = $2, current_step = COALESCE($3, current_step),
                rev = rev + 1, updated_at = NOW()
          WHERE id = $1
        RETURNING rev`,
        [id, nextPayload, nextStep]
      )).rows[0];
      return { rev: updated.rev, priorRev: row.rev };
    });

    // GET /events is public and unfiltered — this payload carries no draft
    // content, only enough for the other phone to decide to re-read.
    broadcast('draft.updated', { id, rev: result.rev, by: clientId ?? null });
    res.json({
      rev: result.rev,
      stale: baseRev != null && baseRev !== result.priorRev,
    });
  } catch (e) { next(e); }
});

// ── Claim the opponent seat ───────────────────────────────────
router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = req.session.userId;
    const token = req.body?.token;

    const out = await withTx(async (client) => {
      const row = (await client.query(
        'SELECT * FROM game_drafts WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw Object.assign(new Error('draft not found'), { status: 404 });
      if (typeof token !== 'string' || token !== row.share_token) {
        throw Object.assign(new Error('that invite link is not valid'), { status: 403 });
      }
      if (row.owner_user_id === userId) {
        throw Object.assign(new Error('you already own this game'), { status: 400 });
      }
      if (row.opponent_user_id != null && row.opponent_user_id !== userId) {
        throw Object.assign(new Error('someone else has already joined this game'), { status: 409 });
      }
      if (row.opponent_user_id === userId) return row;
      return (await client.query(
        'UPDATE game_drafts SET opponent_user_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
        [id, userId]
      )).rows[0];
    });

    audit(req, 'draft.join', { type: 'game_draft', id });
    broadcast('draft.updated', { id, rev: out.rev, by: null });
    res.json({ id: out.id, viewerSeat: 2, isOwner: false, rev: out.rev });
  } catch (e) { next(e); }
});

// ── Invite a registered user into the opponent seat ───────────
// The owner picking a known account is the normal path; the share link is the
// fallback for someone who is signed in on a device the owner can't pick from.
router.post('/:id/invite', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const userId = parseInt(req.body?.userId, 10);

    const out = await withTx(async (client) => {
      const row = (await client.query(
        'SELECT * FROM game_drafts WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw Object.assign(new Error('draft not found'), { status: 404 });
      if (row.owner_user_id !== req.session.userId) {
        throw Object.assign(new Error('only the game owner can invite an opponent'), { status: 403 });
      }
      if (!Number.isInteger(userId)) {
        throw Object.assign(new Error('pick a player to invite'), { status: 400 });
      }
      if (userId === row.owner_user_id) {
        throw Object.assign(new Error('you cannot invite yourself'), { status: 400 });
      }
      if (row.opponent_user_id != null && row.opponent_user_id !== userId) {
        throw Object.assign(new Error('someone else has already joined this game'), { status: 409 });
      }
      const user = (await client.query(
        'SELECT id FROM users WHERE id = $1 AND is_active = TRUE', [userId])).rows[0];
      if (!user) throw Object.assign(new Error('that player was not found'), { status: 404 });

      return (await client.query(
        `UPDATE game_drafts SET opponent_user_id = $2, updated_at = NOW()
          WHERE id = $1 RETURNING rev, opponent_user_id`,
        [id, userId]
      )).rows[0];
    });

    audit(req, 'draft.invite', { type: 'game_draft', id, payload: { opponentUserId: out.opponent_user_id } });
    broadcast('draft.updated', { id, rev: out.rev, by: null });
    res.json({ ok: true, opponentUserId: out.opponent_user_id });
  } catch (e) { next(e); }
});

router.delete('/:id/invite', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });
    if (row.owner_user_id !== req.session.userId) {
      return res.status(403).json({ error: 'only the game owner can clear the opponent' });
    }
    const updated = (await pool.query(
      `UPDATE game_drafts SET opponent_user_id = NULL, updated_at = NOW()
        WHERE id = $1 RETURNING rev`, [id])).rows[0];
    audit(req, 'draft.uninvite', { type: 'game_draft', id });
    broadcast('draft.updated', { id, rev: updated.rev, by: null });
    res.json({ ok: true, opponentUserId: null });
  } catch (e) { next(e); }
});

// ── Finish: turn the draft into a real game ───────────────────
router.post('/:id/submit', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    // The already-submitted check and the INSERT have to be one atomic step.
    // Read it outside the transaction and two taps that land together both see
    // submitted_game_id IS NULL and both create a game — the button disabling
    // itself is a UI convenience, not a guarantee. FOR UPDATE makes the second
    // caller wait and then lose on the 409, same as PATCH/join/invite.
    const { gameId, rev } = await withTx(async (client) => {
      const row = (await client.query(
        'SELECT * FROM game_drafts WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) throw Object.assign(new Error('draft not found'), { status: 404 });
      if (row.owner_user_id !== req.session.userId) {
        throw Object.assign(new Error('only the game owner can finish this game'), { status: 403 });
      }
      if (row.submitted_game_id != null) {
        throw Object.assign(new Error('this game has already been submitted'), { status: 409 });
      }

      const body = { ...row.payload, edition: '11' };
      try {
        validateDraftSubmit(body);
      } catch (e) {
        throw Object.assign(e, { status: 400 });
      }

      await resolvePlayerIdentities(body.players);
      computeFinalScores(body.players, '11');
      resolvePlayerTimes(body.players);

      const newId = await createGame(client, body, row.owner_user_id);
      await client.query(
        'UPDATE game_drafts SET submitted_game_id = $2, updated_at = NOW() WHERE id = $1',
        [id, newId]);
      return { gameId: newId, rev: row.rev };
    });

    await audit(req, 'draft.submit', {
      type: 'game', id: gameId, payload: { draftId: id },
    });
    broadcast('game.saved', { id: gameId, action: 'create' });
    notifyGameLogged(gameId);

    // After the commit on purpose: the game is the thing that matters, and a
    // filesystem hiccup must not roll back a finished game.
    await relinkDraftImages(id, gameId);
    broadcast('draft.updated', { id, rev, by: null });

    res.json({ gameId });
  } catch (e) { next(e); }
});

// Move the mid-game photos onto the finished game. Best-effort per file: the
// game already exists and is the thing that matters, so a missing byte must not
// fail the submit. Rows that move successfully are dropped from the draft.
async function relinkDraftImages(draftId, gameId) {
  const { rows } = await pool.query(
    'SELECT * FROM game_draft_images WHERE draft_id = $1 ORDER BY round_number NULLS LAST, id ASC',
    [draftId]
  );
  if (!rows.length) return;
  const from = draftDir(draftId);
  const to = gameDir(gameId);
  await fs.mkdir(to, { recursive: true });

  let first = true;
  for (const img of rows) {
    try {
      await fs.rename(path.join(from, img.file_name), path.join(to, img.file_name));
      if (img.thumb_name) {
        await fs.rename(path.join(from, img.thumb_name), path.join(to, img.thumb_name));
      }
      await pool.query(
        `INSERT INTO game_images
           (game_id, uploaded_by_user_id, file_name, thumb_name, caption, is_thumbnail, width, height, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [gameId, img.uploaded_by_user_id, img.file_name, img.thumb_name ?? img.file_name,
         img.caption, first, img.width, img.height, img.bytes]
      );
      await pool.query('DELETE FROM game_draft_images WHERE id = $1', [img.id]);
      first = false;
    } catch (e) {
      console.error('[drafts] failed to relink image', img.id, e.message);
    }
  }
  await fs.rm(from, { recursive: true, force: true }).catch(() => {});
}

// ── Abandon ───────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });
    if (row.owner_user_id !== req.session.userId) {
      return res.status(403).json({ error: 'only the game owner can delete this game' });
    }
    await pool.query('DELETE FROM game_drafts WHERE id = $1', [id]);
    await fs.rm(draftDir(id), { recursive: true, force: true }).catch(() => {});
    audit(req, 'draft.delete', { type: 'game_draft', id });
    broadcast('draft.updated', { id, rev: row.rev, by: null });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Mid-game photos ───────────────────────────────────────────
router.get('/:id/images', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });
    if (!viewerSeatOf(row, req.session.userId)) {
      return res.status(403).json({ error: 'not your game' });
    }
    res.json(await listImages(id));
  } catch (e) { next(e); }
});

// Bigger body limit than the app-wide 256kb. server.js must also skip this path
// in IMAGE_UPLOAD_PATH or the global parser 413s before we get here.
router.post('/:id/images', requireAuth, express.json({ limit: '12mb' }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });
    if (!viewerSeatOf(row, req.session.userId)) {
      return res.status(403).json({ error: 'not your game' });
    }
    if (row.submitted_game_id != null) {
      return res.status(409).json({ error: 'this game has already been submitted' });
    }
    const count = await pool.query(
      'SELECT COUNT(*)::int AS n FROM game_draft_images WHERE draft_id = $1', [id]);
    if (count.rows[0].n >= MAX_PER_DRAFT) {
      return res.status(409).json({ error: `a game can hold at most ${MAX_PER_DRAFT} photos` });
    }

    const full = decodeDataUrl(req.body?.dataUrl);
    const thumb = decodeDataUrl(req.body?.thumbDataUrl ?? req.body?.dataUrl);

    const dir = draftDir(id);
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

    let created;
    try {
      created = (await pool.query(
        `INSERT INTO game_draft_images
           (draft_id, uploaded_by_user_id, file_name, thumb_name, caption, round_number, width, height, bytes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          id, req.session.userId, fileName, thumbName,
          (req.body?.caption || '').trim() || null,
          imageRoundOrNull(req.body?.roundNumber),
          Number.isInteger(req.body?.width) ? req.body.width : null,
          Number.isInteger(req.body?.height) ? req.body.height : null,
          full.buf.length,
        ]
      )).rows[0];
    } catch (e) {
      await unlinkQuiet(path.join(dir, fileName));
      await unlinkQuiet(path.join(dir, thumbName));
      throw e;
    }

    audit(req, 'draft.image.upload', { type: 'game_draft', id, payload: { imageId: created.id } });
    broadcast('draft.updated', { id, rev: row.rev, by: req.body?.clientId ?? null });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

router.delete('/:id/images/:imageId', requireAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const imageId = parseInt(req.params.imageId, 10);
    const row = await loadDraft(id);
    if (!row) return res.status(404).json({ error: 'draft not found' });
    const img = (await pool.query(
      'SELECT * FROM game_draft_images WHERE id = $1 AND draft_id = $2', [imageId, id])).rows[0];
    if (!img) return res.status(404).json({ error: 'photo not found' });

    const userId = req.session.userId;
    if (img.uploaded_by_user_id !== userId && row.owner_user_id !== userId) {
      return res.status(403).json({ error: 'only the uploader or the game owner can delete this photo' });
    }

    await pool.query('DELETE FROM game_draft_images WHERE id = $1', [imageId]);
    const dir = draftDir(id);
    await unlinkQuiet(path.join(dir, img.file_name));
    if (img.thumb_name) await unlinkQuiet(path.join(dir, img.thumb_name));

    audit(req, 'draft.image.delete', { type: 'game_draft', id, payload: { imageId } });
    broadcast('draft.updated', { id, rev: row.rev, by: null });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
