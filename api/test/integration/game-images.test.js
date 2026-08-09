// The terrain shot on a game's own photos.
//
// A terrain picture is of the table THAT game was played on, so `is_map` lives
// on game_images and there is no shared per-layout picture. `POST` accepts the
// flag (game detail's Terrain Layout panel uploads with it, the way the live
// tracker's Setup step does), and it has to survive the partial unique index
// `(game_id) WHERE is_map` — the insert therefore lands unflagged and the flag
// is set afterwards, demoting whatever held it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUser, login, anon, reference, playablePayload, TINY_JPEG, cleanup, closePool,
} from './_harness.js';

let user, gameId;

const mapShots = (images) => images.filter((im) => im.is_map);

async function listImages() {
  const res = await anon().get(`/games/${gameId}/images`);
  assert.equal(res.status, 200);
  return res.data;
}

test('setup', async () => {
  const u = await createUser({ label: 'img' });
  user = await login(u);
  const { factions } = await reference();
  const res = await user.post('/games', playablePayload({ factionId: factions[0].id }));
  assert.equal(res.status, 200, JSON.stringify(res.data));
  gameId = res.data.id;
});

test('a plain upload is not the terrain shot', async () => {
  const res = await user.post(`/games/${gameId}/images`, { dataUrl: TINY_JPEG });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.is_map, false);
  // First photo on a game still becomes the cover.
  assert.equal(res.data.is_thumbnail, true);
  assert.equal(mapShots(await listImages()).length, 0);
});

test('uploading with isMap tags it at source', async () => {
  const res = await user.post(`/games/${gameId}/images`,
    { dataUrl: TINY_JPEG, isMap: true, caption: 'ZZ terrain' });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.is_map, true);

  const flagged = mapShots(await listImages());
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, res.data.id);
});

test('re-shooting the table demotes the previous shot rather than failing', async () => {
  const before = mapShots(await listImages())[0];
  const res = await user.post(`/games/${gameId}/images`, { dataUrl: TINY_JPEG, isMap: true });
  assert.equal(res.status, 201, JSON.stringify(res.data));

  const images = await listImages();
  const flagged = mapShots(images);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, res.data.id);
  // Demoted, not deleted — it stays on the game as an ordinary photo.
  assert.ok(images.some((im) => im.id === before.id && !im.is_map));
});

test('the shot belongs to this game only', async () => {
  const { factions } = await reference();
  const other = await user.post('/games', playablePayload({ factionId: factions[0].id }));
  assert.equal(other.status, 200, JSON.stringify(other.data));

  const res = await anon().get(`/games/${other.data.id}/images`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, []);
});

test('cleanup', async () => {
  await cleanup();
  await closePool();
});
