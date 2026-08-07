// Unit tests for app/js/army-list.js — the YAAB share-code decoder.
//
// WHY THIS FRONTEND MODULE IS TESTED FROM api/test/:
// army-list.js is a *frontend* file, but it is a dependency-free ES module with
// no DOM access (it only touches Blob / DecompressionStream / atob, all of which
// Node 22 provides globally), and `npm test` runs from api/. Rather than stand up
// a second test runner for app/, it is imported by relative path from here.
// Same reasoning applies to game-rules.test.js next door.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  looksLikeYaabCode,
  extractCode,
  isPlainJson,
  decodeArmyList,
  normaliseArmyList,
} from '../../app/js/army-list.js';

// yaab's own encoder, reproduced verbatim from its storage.js, so every fixture
// below is a genuine round-trip through the real wire format rather than a
// hand-written blob that could quietly stop resembling what yaab emits.
async function encode(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'YAAB1:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const shareUrl = (code) => `https://yaab.thewheeliebois.com/#/?a=${encodeURIComponent(code)}&x=1`;

/* ── v2 compact codes ──────────────────────────────────────────── */

test('a v2 code round-trips its army name, faction, chapter, string detachment and points limit', async () => {
  const code = await encode({
    v: 2,
    n: 'Angels of Death',
    f: 'Space Marines',
    c: 'Blood Angels',
    p: 2000,
    d: 'Gladius Task Force',
    e: [['intercessor-squad', 1, 80]],
  });
  const out = await decodeArmyList(code);
  assert.equal(out, [
    '=== Angels of Death ===',
    'Faction: Space Marines',
    'Chapter: Blood Angels',
    'Detachment: Gladius Task Force',
    'Points Limit: 2000',
    '',
    '1x Intercessor Squad [80 pts]',
    '',
    'Total: 80 / 2000 pts',
  ].join('\n'));
});

test('a v2 code whose detachment slot is an array renders every detachment on one comma-joined line', async () => {
  const code = await encode({
    v: 2,
    n: 'Twin Detachment List',
    f: 'Astra Militarum',
    p: 2000,
    d: ['Combined Regiment', 'Siege Regiment'],
    e: [['leman-russ-battle-tank', 1, 170]],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('Detachment: Combined Regiment, Siege Regiment'), out);
});

test('the chapter line is suppressed when the chapter is identical to the faction', async () => {
  const code = await encode({
    v: 2, n: 'Necron Host', f: 'Necrons', c: 'Necrons', p: 1000,
    e: [['necron-warriors', 1, 100]],
  });
  const out = await decodeArmyList(code);
  assert.ok(!out.includes('Chapter:'), out);
  assert.ok(out.includes('Faction: Necrons'), out);
});

test('a slugged unit id is de-slugged into a display name and the count multiplies into the cost', async () => {
  const code = await encode({
    v: 2, n: 'Counted List', p: 2000,
    e: [['intercessor-squad', 3, 80]],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('3x Intercessor Squad [240 pts]'), out);
  assert.ok(out.includes('Total: 240 / 2000 pts'), out);
});

test('enhancements are rendered under their unit with their own points and are added to the army total', async () => {
  const code = await encode({
    v: 2, n: 'Enhanced', p: 2000,
    e: [['captain-in-terminator-armour', 1, 95, [['Artificer Armour', 15], ['The Honour Vehement', 25]]]],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('1x Captain In Terminator Armour [95 pts]'), out);
  assert.ok(out.includes('  + Artificer Armour [15 pts]'), out);
  assert.ok(out.includes('  + The Honour Vehement [25 pts]'), out);
  // 95 unit + 15 + 25 enhancements
  assert.ok(out.includes('Total: 135 / 2000 pts'), out);
});

test('a Led-By attachment nests the joined leader under its parent unit, indented one level', async () => {
  const code = await encode({
    v: 2, n: 'Led Army', p: 2000,
    e: [
      ['intercessor-squad', 1, 80, null, ['e1', 0]],
      ['captain-in-gravis-armour', 1, 80, null, ['e2', 'e1']],
      ['hellblaster-squad', 1, 115, null, ['e3', 0]],
    ],
  });
  const out = await decodeArmyList(code);
  const body = out.split('\n');
  const unitLines = body.filter((l) => /^\s*\dx /.test(l));
  assert.deepEqual(unitLines, [
    '1x Intercessor Squad [80 pts]',
    '  1x Captain In Gravis Armour [80 pts]',
    '1x Hellblaster Squad [115 pts]',
  ]);
  assert.ok(out.includes('Total: 275 / 2000 pts'), out);
});

test('an entry with a null selectedPts renders with no cost and never emits NaN anywhere in the output', async () => {
  const code = await encode({
    v: 2, n: 'Partly Priced', p: 2000,
    e: [
      ['tactical-squad', 2, null],
      ['intercessor-squad', 1, 80],
    ],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('2x Tactical Squad\n'), out);
  assert.ok(!/NaN/.test(out), `NaN leaked into the rendering:\n${out}`);
  // Only the priced entry contributes.
  assert.ok(out.includes('Total: 80 / 2000 pts'), out);
});

test('the total line is the hand-computed sum of every unit cost times its count plus every enhancement', async () => {
  const code = await encode({
    v: 2, n: 'Sum Check', p: 2000,
    e: [
      ['intercessor-squad', 3, 80, [['Artificer Armour', 15]]],   // 240 + 15
      ['redemptor-dreadnought', 1, 210],                          // 210
      ['scout-squad', 2, 65],                                     // 130
    ],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('Total: 595 / 2000 pts'), out);
});

test('a v2 code with no points limit renders a bare total with no "/ limit" suffix', async () => {
  const code = await encode({ v: 2, n: 'No Limit', e: [['ork-boyz', 1, 90]] });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('Total: 90 pts'), out);
  assert.ok(!out.includes('Points Limit:'), out);
});

/* ── share URLs ────────────────────────────────────────────────── */

test('a YAAB share URL yields the bare code from extractCode and decodes through decodeArmyList', async () => {
  const code = await encode({
    v: 2, n: 'Shared By Link', f: 'Orks', p: 2000,
    e: [['ork-boyz', 2, 90]],
  });
  const url = shareUrl(code);

  assert.equal(extractCode(url), code);
  assert.equal(looksLikeYaabCode(url), true);

  const out = await decodeArmyList(url);
  assert.ok(out.includes('=== Shared By Link ==='), out);
  assert.ok(out.includes('2x Ork Boyz [180 pts]'), out);
});

/* ── legacy shapes ─────────────────────────────────────────────── */

const legacyArmy = {
  name: 'Pre-v2 List',
  pointsLimit: 2000,
  detachmentNames: ['Gladius Task Force'],
  entries: [
    { unitName: 'Intercessor Squad', count: 3, selectedPts: 80, enhancements: [{ name: 'Artificer Armour', pts: 15 }] },
    { unitName: 'Redemptor Dreadnought', count: 1, selectedPts: 210, enhancements: [] },
  ],
};

test('a pre-v2 code carrying a full serialised army decodes through the legacy path', async () => {
  const code = await encode(legacyArmy);
  const out = await decodeArmyList(code);
  assert.equal(out, [
    '=== Pre-v2 List ===',
    'Detachment: Gladius Task Force',
    'Points Limit: 2000',
    '',
    '3x Intercessor Squad [240 pts]',
    '  + Artificer Armour [15 pts]',
    '1x Redemptor Dreadnought [210 pts]',
    '',
    'Total: 465 / 2000 pts',
  ].join('\n'));
});

test('a raw uncompressed JSON paste of the same army decodes without any code prefix', async () => {
  const raw = JSON.stringify(legacyArmy);
  assert.equal(isPlainJson(raw), true);
  assert.equal(looksLikeYaabCode(raw), false);
  const out = await decodeArmyList(raw);
  assert.ok(out.includes('=== Pre-v2 List ==='), out);
  assert.ok(out.includes('Total: 465 / 2000 pts'), out);
});

/* ── forward compatibility ─────────────────────────────────────── */

test('a v3 code that keeps the same tuple shape still decodes, because the decoder accepts v >= 2', async () => {
  const code = await encode({
    v: 3,
    n: 'Future Format',
    f: 'Tyranids',
    p: 2000,
    d: 'Invasion Fleet',
    e: [['termagants', 2, 60, null, null, { wargear: 'devourers' }, 'some-future-slot']],
  });
  const out = await decodeArmyList(code);
  assert.ok(out.includes('=== Future Format ==='), out);
  assert.ok(out.includes('2x Termagants [120 pts]'), out);
});

test('a v3 code whose entry list is not an array of arrays returns null rather than a half-rendered list', async () => {
  const code = await encode({
    v: 3,
    n: 'Reshaped Entries',
    p: 2000,
    e: [{ id: 'termagants', count: 2, pts: 60 }],
  });
  assert.equal(await decodeArmyList(code), null);
});

test('a v3 code whose entry list is not an array at all returns null', async () => {
  const code = await encode({ v: 3, n: 'Object Entries', p: 2000, e: { a: 1 } });
  assert.equal(await decodeArmyList(code), null);
});

/* ── garbage in, safe out ──────────────────────────────────────── */

test('looksLikeYaabCode is false for a hand-typed plain-text army list', () => {
  const typed = 'Captain in Terminator Armour - 95\n3x Intercessor Squad - 240';
  assert.equal(looksLikeYaabCode(typed), false);
  assert.equal(extractCode(typed), null);
});

test('normaliseArmyList keeps a plain-text list verbatim and reports decoded: false', async () => {
  const typed = 'Captain in Terminator Armour - 95\n3x Intercessor Squad - 240';
  assert.deepEqual(await normaliseArmyList(typed), { value: typed, decoded: false });
});

test('a corrupt YAAB1 code is stored exactly as pasted instead of being dropped', async () => {
  const corrupt = 'YAAB1:!!!';
  assert.equal(await decodeArmyList(corrupt), null);
  assert.deepEqual(await normaliseArmyList(corrupt), { value: corrupt, decoded: false });
});

test('a YAAB1 code that inflates to something that is not JSON is stored as pasted', async () => {
  // Valid base64url, valid deflate stream, but the payload is not JSON.
  const stream = new Blob(['not json at all']).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const code = 'YAAB1:' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(await decodeArmyList(code), null);
  assert.deepEqual(await normaliseArmyList(code), { value: code, decoded: false });
});

test('an empty paste normalises to a null value rather than an empty string', async () => {
  assert.deepEqual(await normaliseArmyList(''), { value: null, decoded: false });
  assert.deepEqual(await normaliseArmyList('   '), { value: null, decoded: false });
  assert.deepEqual(await normaliseArmyList(null), { value: null, decoded: false });
  assert.equal(await decodeArmyList(''), null);
});

/* ── what actually gets stored ─────────────────────────────────── */

test('normaliseArmyList on a good code stores readable text with the original code preserved on the last line', async () => {
  const code = await encode({
    v: 2, n: 'Stored List', f: 'Space Marines', p: 2000,
    e: [['intercessor-squad', 3, 80]],
  });
  const rendering = await decodeArmyList(code);
  const { value, decoded } = await normaliseArmyList(code);
  assert.equal(decoded, true);
  assert.ok(value.startsWith('=== Stored List ==='), value);
  assert.ok(value.includes('3x Intercessor Squad [240 pts]'), value);
  assert.equal(value, `${rendering}\n\n${code}`);

  // The last line is what keeps the list re-decodable and re-openable in YAAB.
  const lastLine = value.split('\n').pop();
  assert.equal(lastLine, code);
  assert.equal(await decodeArmyList(lastLine), rendering);
});

test('normaliseArmyList on a share URL stores the bare code, not the URL, on the last line', async () => {
  const code = await encode({ v: 2, n: 'From A Link', p: 2000, e: [['ork-boyz', 1, 90]] });
  const { value, decoded } = await normaliseArmyList(shareUrl(code));
  assert.equal(decoded, true);
  assert.equal(value.split('\n').pop(), code);
});

test('normaliseArmyList on a raw JSON paste stores only the rendering, since there is no code to keep', async () => {
  const { value, decoded } = await normaliseArmyList(JSON.stringify(legacyArmy));
  assert.equal(decoded, true);
  assert.ok(!value.includes('YAAB1:'), value);
  assert.ok(value.endsWith('Total: 465 / 2000 pts'), value);
});

/* ── format-drift canary ───────────────────────────────────────── */

// This decoder is written against a format frozen on YAAB's side. If yaab ever
// bumps its prefix or its payload version, every code pasted here after that
// point silently stops decoding and gets stored as opaque base64 — a failure
// nobody notices until a user complains. When yaab's source happens to be on the
// same machine (it is, on the host; it is NOT inside the test container), read it
// and assert the two anchors we depend on are still there. Skipped, not failed,
// when the sister repo is absent — this is an early-warning canary, not a
// hard dependency.
// YAAB_SOURCE_DIR is set by scripts/test-unit.sh, which mounts the sister repo
// read-only. Falls back to the host layout so the canary also runs when the
// suite is invoked directly on the machine rather than in a container.
const YAAB_STORAGE = process.env.YAAB_SOURCE_DIR
  ? `${process.env.YAAB_SOURCE_DIR}/js/storage.js`
  : '/home/stopsign002/sites/sites/yetanotherarmybuilder/app/js/storage.js';

test("yaab still emits the YAAB1: prefix and v: 2 payloads that this decoder is written against", (t) => {
  if (!existsSync(YAAB_STORAGE)) {
    t.skip(`sister repo not present at ${YAAB_STORAGE} (expected inside the test container)`);
    return;
  }
  const src = readFileSync(YAAB_STORAGE, 'utf8');
  assert.ok(
    src.includes("EXPORT_PREFIX = 'YAAB1:'"),
    'yaab changed its share-code prefix — army-list.js PREFIX must be updated to match',
  );
  assert.ok(
    /\bv:\s*2\b/.test(src),
    'yaab no longer writes v: 2 — check that renderCompact still understands the new payload shape',
  );
});
