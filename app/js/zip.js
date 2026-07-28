// Minimal ZIP reader, used because Google Photos hands you a .zip whenever you
// download more than one picture at a time.
//
// No library and no server-side unzip: the browser's own DecompressionStream
// does the inflating, so there's no bundled implementation and the bytes never
// leave the machine un-downscaled. Only what a photo zip actually contains is
// supported — STORED (method 0) and DEFLATE (method 8) entries in a classic,
// non-Zip64 archive. Anything else is skipped rather than failing the batch,
// so one odd entry can't cost you the other 30 photos.

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

const IMAGE_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function isZipFile(file) {
  return /\.zip$/i.test(file?.name || '') ||
    file?.type === 'application/zip' ||
    file?.type === 'application/x-zip-compressed';
}

/**
 * @param {File|Blob} file
 * @returns {Promise<File[]>} images found inside, name-sorted
 */
export async function extractImagesFromZip(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error("that doesn't look like a zip file");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = [];

  for (let i = 0; i < count; i++) {
    if (ptr + 46 > view.byteLength || view.getUint32(ptr, true) !== CEN_SIG) break;

    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const path = new TextDecoder().decode(new Uint8Array(buf, ptr + 46, nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    const mime = imageMime(path);
    if (!mime) continue;
    if (method !== 0 && method !== 8) continue;

    // The local header repeats the name and extra fields, and their lengths can
    // legitimately differ from the central directory's — so the offset of the
    // actual data has to come from the local header, not from here.
    if (localOffset + 30 > view.byteLength) continue;
    if (view.getUint32(localOffset, true) !== LOC_SIG) continue;
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    if (start + compressedSize > view.byteLength) continue;

    const raw = new Uint8Array(buf, start, compressedSize);
    let bytes;
    try {
      bytes = method === 0 ? raw : await inflateRaw(raw);
    } catch {
      continue;
    }
    out.push(new File([bytes], baseName(path), { type: mime }));
  }

  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('this browser cannot unzip files');
  }
  const stream = new Blob([bytes]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Scans backwards for the end-of-central-directory signature. It sits at the
// very end unless the archive carries a trailing comment, which can be up to
// 64KB — hence the bounded backwards walk rather than a fixed offset.
function findEndOfCentralDirectory(view) {
  const maxBack = Math.min(view.byteLength, 0xffff + 22);
  for (let back = 22; back <= maxBack; back++) {
    const at = view.byteLength - back;
    if (at < 0) break;
    if (view.getUint32(at, true) === EOCD_SIG) return at;
  }
  return -1;
}

function baseName(path) {
  return path.split('/').pop();
}

// Directories, macOS resource-fork junk and dot-files are all real entries in a
// zip; none of them are pictures.
function imageMime(path) {
  if (!path || path.endsWith('/')) return null;
  if (path === '__MACOSX' || path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) return null;
  const base = baseName(path);
  if (!base || base.startsWith('.')) return null;
  const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
  return IMAGE_MIME[ext] || null;
}
