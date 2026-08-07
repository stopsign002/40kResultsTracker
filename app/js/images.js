// Browser-side image downscaling, shared by every view that uploads a photo
// (game photos and terrain-layout pictures in views/game-detail.js). Callers
// produce a ~2048px full plus a ~400px thumb and post both as base64 data URLs,
// which keeps a native image library out of the container and stops a 12MP
// phone photo crossing the wire whole.

// Decode -> downscale -> re-encode as JPEG. `imageOrientation: 'from-image'`
// matters: without it, portrait phone photos (which carry their rotation in
// EXIF) come out sideways once re-encoded from a canvas.
export async function shrink(file, maxDim, quality) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
}
