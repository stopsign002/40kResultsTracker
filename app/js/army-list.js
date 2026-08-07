// Army lists attached to a game player. Stored verbatim in
// game_players.army_list_code, which the games-list free-text search already
// covers. The point of keeping them is the complaint that GW's own app throws
// your list away the moment the game ends.
//
// Three things can land in the paste box: a plain-text list out of any builder,
// a share code from the sister site YAAB (yaab.thewheeliebois.com), or a YAAB
// share URL. Plain text is kept as-is; the other two are decoded to readable
// text so the saved list is searchable and legible without YAAB.
//
// Format (frozen contract on yaab's side — see its app/CLAUDE.md "Don't break"):
//   YAAB1:<base64url(deflate-raw(JSON))>
//   v2 JSON: { v:2, n:name, f:faction?, c:chapter?, p:pointsLimit,
//              d:detachment|[detachments]?,
//              e:[[unitId, count, selectedPts?, [[enhName,enhPts],…]?,
//                  [entryId,parentEntryId]?, wargear?], …] }
// Pre-v2 codes carry a full serialised army whose entries already have
// unitName, so they decode without any of the tuple handling.
//
// Unit ids are 40kdc slugs ("captain-in-terminator-armour"), so de-slugging
// gives a correct display name without pulling in yaab's 10MB data bundle.
// A handful read slightly off ("Arco Flagellants" vs "Arco-flagellants");
// that is deliberate — a cosmetic miss beats a multi-megabyte dependency.

const PREFIX = 'YAAB1:';

export function looksLikeYaabCode(text) {
  return !!extractCode(text);
}

// Pulls the bare code out of a raw paste, a share URL (?a=YAAB1:…) or neither.
export function extractCode(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith(PREFIX)) return raw.replace(/\s+/g, '');
  const at = raw.indexOf('?a=');
  if (at >= 0) {
    let tail = raw.slice(at + 3);
    const amp = tail.indexOf('&');
    if (amp >= 0) tail = tail.slice(0, amp);
    try { tail = decodeURIComponent(tail); } catch { /* already decoded */ }
    tail = tail.trim();
    if (tail.startsWith(PREFIX)) return tail.replace(/\s+/g, '');
  }
  return null;
}

export function isPlainJson(text) {
  return String(text || '').trim().startsWith('{');
}

// Readable text, or null when we can't make sense of it. Callers fall back to
// storing the raw paste — never to storing nothing.
export async function decodeArmyList(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  if (isPlainJson(raw)) {
    try { return renderLegacy(JSON.parse(raw)); } catch { return null; }
  }

  const code = extractCode(raw);
  if (!code) return null;

  let data;
  try {
    data = JSON.parse(await inflateRaw(base64UrlToBytes(code.slice(PREFIX.length))));
  } catch {
    return null;
  }
  // `v >= 2` rather than `v === 2`, deliberately. Every extension yaab has
  // shipped so far (multi-detachment, Led-By attachments, wargear picks) was
  // additive — new positional slots on the end, old codes byte-identical — so a
  // future v3 will most likely still decode down the same path, and a partial
  // read beats none. If it doesn't, renderCompact returns null and the caller
  // stores the code verbatim, which is the whole safety net.
  if (data && typeof data.v === 'number' && data.v >= 2) return renderCompact(data);
  if (data && data.name && Array.isArray(data.entries)) return renderLegacy(data);
  return null;
}

/* ── The wire format ──────────────────────────────────────────── */

function base64UrlToBytes(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Raw DEFLATE, no zlib header — matches yaab's CompressionStream('deflate-raw').
// Unsupported on older Safari, in which case the caller keeps the raw paste.
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('no DecompressionStream');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

/* ── Rendering ────────────────────────────────────────────────── */

function renderCompact(data) {
  // If a future format reshapes `e` into something we can't walk, produce
  // nothing rather than a header with no units under it — the caller then keeps
  // the raw code, which stays decodable once this function is taught the new
  // shape. Never half-render: a wrong list is worse than an opaque one.
  if (!Array.isArray(data.e) || !data.e.every((t) => Array.isArray(t) && t.length)) return null;
  const lines = [];
  if (data.n) lines.push(`=== ${data.n} ===`);
  if (data.f) lines.push(`Faction: ${data.f}`);
  if (data.c && data.c !== data.f) lines.push(`Chapter: ${data.c}`);
  const dets = Array.isArray(data.d) ? data.d : (data.d ? [data.d] : []);
  if (dets.length) lines.push(`Detachment: ${dets.join(', ')}`);
  if (data.p) lines.push(`Points Limit: ${data.p}`);
  lines.push('');

  const entries = Array.isArray(data.e) ? data.e : [];
  // Slot 4 is [entryId, parentEntryId|0] and only appears on armies that use
  // Led-By attachments, so leaders nest under the unit they joined.
  const childrenOf = new Map();
  const roots = [];
  const byId = new Map();
  entries.forEach((t, i) => {
    const pair = Array.isArray(t[4]) ? t[4] : null;
    const id = pair ? pair[0] : null;
    if (id) byId.set(id, i);
  });
  entries.forEach((t, i) => {
    const pair = Array.isArray(t[4]) ? t[4] : null;
    const parent = pair && pair[1] ? pair[1] : null;
    if (parent && byId.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(i);
    } else {
      roots.push(i);
    }
  });

  let total = 0;
  const emit = (idx, depth) => {
    const t = entries[idx] || [];
    const count = t[1] || 1;
    const pts = typeof t[2] === 'number' ? t[2] : null;
    const enhs = Array.isArray(t[3]) ? t[3] : [];
    const enhPts = enhs.reduce((sum, e) => sum + (Number(e?.[1]) || 0), 0);
    if (pts != null) total += pts * count;
    total += enhPts;

    const pad = '  '.repeat(depth);
    const cost = pts != null ? ` [${pts * count} pts]` : '';
    lines.push(`${pad}${count}x ${deslug(t[0])}${cost}`);
    for (const e of enhs) {
      lines.push(`${pad}  + ${e?.[0] ?? 'Enhancement'}${e?.[1] ? ` [${e[1]} pts]` : ''}`);
    }
    const pair = Array.isArray(t[4]) ? t[4] : null;
    const id = pair ? pair[0] : null;
    for (const child of (id && childrenOf.get(id)) || []) emit(child, depth + 1);
  };
  roots.forEach((i) => emit(i, 0));

  if (total) {
    lines.push('');
    lines.push(data.p ? `Total: ${total} / ${data.p} pts` : `Total: ${total} pts`);
  }
  return lines.join('\n');
}

// Pre-v2 codes and raw .json pastes already carry display names.
function renderLegacy(data) {
  if (!data || !Array.isArray(data.entries)) return null;
  const lines = [];
  if (data.name) lines.push(`=== ${data.name} ===`);
  const dets = Array.isArray(data.detachmentNames) ? data.detachmentNames : [];
  if (dets.length) lines.push(`Detachment: ${dets.join(', ')}`);
  if (data.pointsLimit) lines.push(`Points Limit: ${data.pointsLimit}`);
  lines.push('');
  let total = 0;
  for (const e of data.entries) {
    const count = e.count || 1;
    const pts = typeof e.selectedPts === 'number' ? e.selectedPts : null;
    if (pts != null) total += pts * count;
    const name = e.unitName || deslug(e.unitId) || 'Unit';
    lines.push(`${count}x ${name}${pts != null ? ` [${pts * count} pts]` : ''}`);
    for (const enh of e.enhancements || []) {
      total += Number(enh?.pts) || 0;
      lines.push(`  + ${enh?.name ?? 'Enhancement'}${enh?.pts ? ` [${enh.pts} pts]` : ''}`);
    }
  }
  if (total) {
    lines.push('');
    lines.push(data.pointsLimit ? `Total: ${total} / ${data.pointsLimit} pts` : `Total: ${total} pts`);
  }
  return lines.join('\n');
}

function deslug(id) {
  if (!id) return '';
  return String(id)
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// What gets stored: the readable rendering, with the original code kept on the
// last line so the list can still be reopened in YAAB and so re-decoding stays
// possible. One TEXT column, and the games-list free-text search now matches
// unit names instead of base64.
export async function normaliseArmyList(text) {
  const raw = String(text || '').trim();
  if (!raw) return { value: null, decoded: false };
  const decoded = await decodeArmyList(raw);
  if (!decoded) return { value: raw, decoded: false };
  const code = extractCode(raw);
  return { value: code ? `${decoded}\n\n${code}` : decoded, decoded: true };
}
