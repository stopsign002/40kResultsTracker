import { stats, seasons } from '../api.js';
import { el, clear } from '../components.js';

// ── Seeded RNG (mulberry32) ──────────────────────────────────────
function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const MAP_SEED = 0xDEAD40; // static — same map for everyone forever
// MAP_SEED, FACTION_HOMES and FACTION_COLOURS are FROZEN. Changing the seed
// reshapes the continent and territory boundaries. FACTION_HOMES anchors are
// no longer drawn as fortress markers — they're internal seed positions that
// keep each faction's territory rooted in a stable region across regens.
// Editing or reordering them still shifts every existing region. Append new
// factions only. See CLAUDE.md "Critical invariants".

const N_TERRITORIES = 120;
const LLOYD_ITERATIONS = 8;

// Map is computed at a FIXED virtual resolution so the territory geometry
// and faction allocation are byte-identical on every device, regardless of
// how wide the user's browser is. The <canvas> is then CSS-scaled for
// display. Changing these reshuffles the entire map for everyone.
const VIRTUAL_W = 1280;
const VIRTUAL_H = 794;

// ── Boimaggedon faction homes ───────────────────────────────────
// Roughly the same regional placement as the old galaxy: Imperials centred,
// Chaos to the west, Tyranids/T'au/Necrons to the east. The continent is
// generated to fit these — each faction's home becomes its nearest land
// territory after Voronoi + Lloyd's relaxation.
const FACTION_HOMES = {
  'Space Marines':       [0.50, 0.48],
  'Adeptus Custodes':    [0.50, 0.50],
  'Imperial Agents':     [0.52, 0.49],
  'Adepta Sororitas':    [0.45, 0.52],
  'Adeptus Mechanicus':  [0.46, 0.46],
  'Astra Militarum':     [0.48, 0.43],
  'Grey Knights':        [0.54, 0.46],
  'Deathwatch':          [0.55, 0.42],
  'Imperial Knights':    [0.43, 0.50],
  'Black Templars':      [0.48, 0.40],
  'Blood Angels':        [0.58, 0.52],
  'Dark Angels':         [0.40, 0.46],
  'Space Wolves':        [0.36, 0.40],
  'Aeldari':             [0.30, 0.42],
  'Drukhari':            [0.28, 0.55],
  'Necrons':             [0.74, 0.60],
  'Orks':                [0.62, 0.36],
  'Tyranids':            [0.86, 0.66],
  'T\'au Empire':        [0.80, 0.56],
  'Genestealer Cults':   [0.66, 0.55],
  'Leagues of Votann':   [0.34, 0.62],
  'Chaos Space Marines': [0.18, 0.50],
  'Chaos Daemons':       [0.20, 0.46],
  'Chaos Knights':       [0.22, 0.55],
  'Death Guard':         [0.16, 0.58],
  'Thousand Sons':       [0.18, 0.42],
  'World Eaters':        [0.21, 0.38],
  'Emperor\'s Children': [0.15, 0.48],
};

// ── Faction colours (40k lore-matched) ──────────────────────────
const FACTION_COLOURS = {
  'Space Marines':       '#004080',
  'Adeptus Custodes':    '#b8860b',
  'Imperial Agents':     '#556b2f',
  'Adepta Sororitas':    '#8b0000',
  'Adeptus Mechanicus':  '#cc2200',
  'Astra Militarum':     '#556832',
  'Grey Knights':        '#8899aa',
  'Deathwatch':          '#333366',
  'Imperial Knights':    '#8b6914',
  'Black Templars':      '#222222',
  'Blood Angels':        '#cc0000',
  'Dark Angels':         '#1a4d2e',
  'Space Wolves':        '#5577aa',
  'Aeldari':             '#cc7700',
  'Drukhari':            '#660088',
  'Necrons':             '#005500',
  'Orks':                '#3a6b00',
  'Tyranids':            '#7b1fa2',
  'T\'au Empire':        '#2e7d7d',
  'Genestealer Cults':   '#880044',
  'Leagues of Votann':   '#8b4513',
  'Chaos Space Marines': '#661100',
  'Chaos Daemons':       '#990044',
  'Chaos Knights':       '#44001a',
  'Death Guard':         '#556b33',
  'Thousand Sons':       '#1a3399',
  'World Eaters':        '#aa2200',
  'Emperor\'s Children': '#cc44aa',
};

const HUD_CYAN  = 'rgba(120, 220, 255, 0.85)';
const HUD_DIM   = 'rgba(120, 220, 255, 0.35)';
const HUD_FAINT = 'rgba(120, 220, 255, 0.10)';
const HUD_AMBER = 'rgba(255, 190, 80, 0.95)';
const HUD_BG    = '#020610';

// ── Faction glyph (single character) shown in the legend panel ──
// One-char emblem per faction used in the faction-key popup. Falls back to
// a dot when a faction isn't mapped.
const FACTION_GLYPH = {
  // Imperium: aquila-cross
  'Space Marines': '⚔', 'Adeptus Custodes': '✠', 'Adeptus Mechanicus': '⚙',
  'Imperial Agents': '⚖', 'Adepta Sororitas': '✠', 'Astra Militarum': '✚',
  'Grey Knights': '✠', 'Deathwatch': '⚔', 'Imperial Knights': '♜',
  'Black Templars': '✠', 'Blood Angels': '♥', 'Dark Angels': '✠',
  'Space Wolves': 'Ψ',
  // Chaos: 8-pointed star (★) and themed god marks
  'Chaos Space Marines': '✪', 'Chaos Daemons': '✪', 'Chaos Knights': '♜',
  'Death Guard': '☣', 'Thousand Sons': 'ψ', 'World Eaters': '☠',
  "Emperor's Children": '♫',
  // Xenos
  'Necrons': '☥', 'Tyranids': '⚷', "T'au Empire": 'Τ',
  'Orks': '☠', 'Aeldari': '◇', 'Drukhari': '◆',
  'Genestealer Cults': '✦', 'Leagues of Votann': '⚒',
};

// ── Procedural territory naming ──────────────────────────────────────
// Each territory ID gets a deterministic name from MAP_SEED + index.
// Used by the hover tooltip and could be surfaced elsewhere later.
const TERRITORY_PREFIX = [
  'Ironcleft', 'Skull', 'Ash', 'Bone', 'Black', 'Crimson', 'Pale', 'Iron',
  'Ember', 'Glass', 'Frost', 'Cinder', 'Hollow', 'Ruin', 'Storm', 'Salt',
  'Rust', 'Coil', 'Veil', 'Wraith', 'Hex', 'Fang', 'Ivory', 'Brass',
  'Verdant', 'Withered', 'Howling', 'Sunken', 'Forsaken', 'Burning',
  'Shattered', 'Echoing', 'Ancient', 'Untamed',
];
const TERRITORY_SUFFIX = [
  'Hive', 'Plains', 'Reach', 'Wastes', 'Belt', 'Spur', 'Fields', 'Hold',
  'Spire', 'Run', 'Drift', 'March', 'Basin', 'Marches', 'Fastness',
  'Crater', 'Expanse', 'Vale', 'Ridge', 'Shore', 'Causeway', 'Steppe',
  'Reef', 'Hollow', 'Pass', 'Tract', 'Heath', 'Salient', 'Approach',
];

function territoryName(idx, seed = MAP_SEED) {
  const rng = seededRng(seed ^ ((idx + 1) * 2654435761));
  const p = TERRITORY_PREFIX[Math.floor(rng() * TERRITORY_PREFIX.length)];
  const s = TERRITORY_SUFFIX[Math.floor(rng() * TERRITORY_SUFFIX.length)];
  // Append a sector code so duplicate prefix+suffix combos still differ
  const sectorN = Math.floor(rng() * 99) + 1;
  const sectorL = String.fromCharCode(65 + Math.floor(rng() * 26));
  return `${p} ${s} ${sectorN}${sectorL}`;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

function abbreviate(name) {
  return name
    .replace('Adeptus Mechanicus', 'AdMech')
    .replace('Adeptus Custodes', 'Custodes')
    .replace('Adepta Sororitas', 'Sororitas')
    .replace('Astra Militarum', 'Guard')
    .replace('Imperial Knights', 'Knights')
    .replace('Imperial Agents', 'Agents')
    .replace('Black Templars', 'BT')
    .replace('Blood Angels', 'BA')
    .replace('Dark Angels', 'DA')
    .replace('Space Wolves', 'SW')
    .replace('Space Marines', 'Marines')
    .replace('Grey Knights', 'GK')
    .replace('Genestealer Cults', 'GSC')
    .replace('Leagues of Votann', 'Votann')
    .replace('Chaos Space Marines', 'CSM')
    .replace('Chaos Daemons', 'Daemons')
    .replace('Chaos Knights', 'C.Knights')
    .replace('Death Guard', 'DG')
    .replace('Thousand Sons', 'TSons')
    .replace('World Eaters', 'WE')
    .replace('Emperor\'s Children', 'EC')
    .replace('T\'au Empire', 'T\'au');
}

// ── Continent silhouette ────────────────────────────────────────
function generateContinent(W, H, seed) {
  const cx = W / 2, cy = H / 2;
  const baseR = Math.min(W, H) * 0.42;
  const N = 96;
  const rng = seededRng(seed);
  const phases = [rng()*6.28, rng()*6.28, rng()*6.28, rng()*6.28];

  const polygon = [];
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    // Multi-octave noise for organic coastline
    const n = 1
      + Math.sin(angle * 2 + phases[0]) * 0.18
      + Math.sin(angle * 5 + phases[1]) * 0.10
      + Math.sin(angle * 11 + phases[2]) * 0.06
      + Math.sin(angle * 19 + phases[3]) * 0.03;
    // Asymmetric squash so it isn't a circle
    const aspectX = 1.15, aspectY = 0.92;
    polygon.push([
      cx + Math.cos(angle) * baseR * n * aspectX,
      cy + Math.sin(angle) * baseR * n * aspectY,
    ]);
  }
  return polygon;
}

function isInsidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ── Voronoi territories with Lloyd's relaxation ────────────────
function generateTerritories(W, H, polygon, seed = MAP_SEED) {
  const rng = seededRng(seed);
  const sites = [];

  // Poisson-ish disc sampling: reject points too close to existing ones.
  // minDist scales as 1/sqrt(N) so the spacing-to-N relationship stays
  // sane regardless of N_TERRITORIES — at the original tuning of N=50 the
  // factor evaluates to 0.07 of the smaller canvas dimension.
  const cx = W / 2, cy = H / 2;
  const minDist = Math.min(W, H) * 0.07 * Math.sqrt(50 / N_TERRITORIES);
  let attempts = 0;
  while (sites.length < N_TERRITORIES && attempts < 20000) {
    attempts++;
    const x = rng() * W;
    const y = rng() * H;
    if (!isInsidePolygon(x, y, polygon)) continue;
    let ok = true;
    for (const s of sites) {
      const dx = x - s.x, dy = y - s.y;
      if (dx*dx + dy*dy < minDist*minDist) { ok = false; break; }
    }
    if (ok) sites.push({ x, y });
  }
  // Top up if we couldn't reach N (shrink minDist isn't strictly needed at this scale)
  while (sites.length < N_TERRITORIES && attempts < 20000) {
    attempts++;
    const x = rng() * W;
    const y = rng() * H;
    if (isInsidePolygon(x, y, polygon)) sites.push({ x, y });
  }

  const CELL = 4;
  const GW = Math.ceil(W / CELL), GH = Math.ceil(H / CELL);
  const ownership = new Int32Array(GW * GH);

  // Pre-compute land mask once (continent doesn't move)
  const land = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const px = gx * CELL + CELL/2;
      const py = gy * CELL + CELL/2;
      land[gy * GW + gx] = isInsidePolygon(px, py, polygon) ? 1 : 0;
    }
  }

  for (let iter = 0; iter < LLOYD_ITERATIONS; iter++) {
    // Rasterize Voronoi
    for (let gy = 0; gy < GH; gy++) {
      for (let gx = 0; gx < GW; gx++) {
        if (!land[gy * GW + gx]) { ownership[gy * GW + gx] = -1; continue; }
        const px = gx * CELL + CELL/2, py = gy * CELL + CELL/2;
        let best = Infinity, bestIdx = 0;
        for (let s = 0; s < sites.length; s++) {
          const dx = px - sites[s].x, dy = py - sites[s].y;
          const d = dx*dx + dy*dy;
          if (d < best) { best = d; bestIdx = s; }
        }
        ownership[gy * GW + gx] = bestIdx;
      }
    }

    if (iter < LLOYD_ITERATIONS - 1) {
      // Move sites toward the centroid of their cell (relaxation)
      const sums = new Array(sites.length);
      for (let s = 0; s < sites.length; s++) sums[s] = { x: 0, y: 0, n: 0 };
      for (let gy = 0; gy < GH; gy++) {
        for (let gx = 0; gx < GW; gx++) {
          const o = ownership[gy * GW + gx];
          if (o < 0) continue;
          sums[o].x += gx * CELL + CELL/2;
          sums[o].y += gy * CELL + CELL/2;
          sums[o].n++;
        }
      }
      for (let s = 0; s < sites.length; s++) {
        if (sums[s].n > 0) {
          sites[s].x = sums[s].x / sums[s].n;
          sites[s].y = sums[s].y / sums[s].n;
        }
      }
    }
  }

  return { sites, ownership, GW, GH, CELL, land };
}

function buildAdjacency(ownership, GW, GH) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const a = ownership[gy * GW + gx];
      const b = ownership[gy * GW + gx + 1];
      const c = ownership[(gy + 1) * GW + gx];
      if (a >= 0 && b >= 0 && a !== b) { add(a, b); add(b, a); }
      if (a >= 0 && c >= 0 && a !== c) { add(a, c); add(c, a); }
    }
  }
  return adj;
}

// ── Sub-territory subdivision ────────────────────────────────────
// Each parent province is sliced into K=10 sub-cells via a mini Voronoi
// seeded from MAP_SEED ^ parent_id. The parent geometry (and named
// territories) stays exactly as before; the sub-cell mesh is what BFS
// expansion and per-banner ownership operate on, giving fluid war fronts
// while keeping the lore-geographic parent provinces intact.
const SUB_PER_PARENT = 10;

function generateSubTerritories(parentOwnership, parentSites, GW, GH, CELL, seed = MAP_SEED) {
  const NParent = parentSites.length;
  const K = SUB_PER_PARENT;
  const NSub = NParent * K;

  // Collect grid cells per parent (in deterministic gy,gx scan order).
  const cellsByParent = Array.from({ length: NParent }, () => []);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const p = parentOwnership[gy * GW + gx];
      if (p < 0) continue;
      cellsByParent[p].push(gy * GW + gx);
    }
  }

  // For each parent, place K sub-sites via reservoir sampling its cells,
  // then relax twice within the parent so the sub-sites spread evenly.
  const subSites = new Array(NSub);
  const subsInParent = new Array(NParent);
  for (let p = 0; p < NParent; p++) {
    const cells = cellsByParent[p];
    const rng = seededRng(seed ^ ((p + 1) * 2654435761));
    const picks = reservoirSample(cells, K, rng);
    subsInParent[p] = [];
    for (let i = 0; i < picks.length; i++) {
      const cellIdx = picks[i];
      const gx = cellIdx % GW;
      const gy = Math.floor(cellIdx / GW);
      const sid = p * K + i;
      subSites[sid] = { x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2 };
      subsInParent[p].push(sid);
    }
    // Two Lloyd's relaxation passes, constrained to this parent's cells.
    for (let iter = 0; iter < 2; iter++) {
      const sums = subsInParent[p].map(() => ({ x: 0, y: 0, n: 0 }));
      for (const cellIdx of cells) {
        const gx = cellIdx % GW;
        const gy = Math.floor(cellIdx / GW);
        const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
        let best = Infinity, bestLocal = 0;
        for (let i = 0; i < subsInParent[p].length; i++) {
          const sid = subsInParent[p][i];
          const dx = px - subSites[sid].x, dy = py - subSites[sid].y;
          const d = dx * dx + dy * dy;
          if (d < best) { best = d; bestLocal = i; }
        }
        sums[bestLocal].x += px;
        sums[bestLocal].y += py;
        sums[bestLocal].n++;
      }
      for (let i = 0; i < subsInParent[p].length; i++) {
        if (sums[i].n > 0) {
          const sid = subsInParent[p][i];
          subSites[sid].x = sums[i].x / sums[i].n;
          subSites[sid].y = sums[i].y / sums[i].n;
        }
      }
    }
    // If a tiny edge parent had fewer than K cells, subsInParent[p] is short
    // and the trailing subSites slots stay undefined. Callers must check.
  }

  // Sub-ownership grid: for each land cell, pick the nearest sub-site of
  // its parent (sub-cells never cross parent boundaries).
  const subOwnership = new Int32Array(GW * GH);
  const parentOfSub = new Int32Array(NSub);
  for (let p = 0; p < NParent; p++) {
    for (let i = 0; i < K; i++) parentOfSub[p * K + i] = p;
  }
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const p = parentOwnership[gy * GW + gx];
      if (p < 0) { subOwnership[gy * GW + gx] = -1; continue; }
      const px = gx * CELL + CELL / 2, py = gy * CELL + CELL / 2;
      const subs = subsInParent[p];
      let best = Infinity, bestId = subs[0];
      for (const sid of subs) {
        const dx = px - subSites[sid].x, dy = py - subSites[sid].y;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; bestId = sid; }
      }
      subOwnership[gy * GW + gx] = bestId;
    }
  }

  // Sub-adjacency, same grid-edge scan as buildAdjacency.
  const subAdj = new Map();
  const addSub = (a, b) => {
    if (!subAdj.has(a)) subAdj.set(a, new Set());
    subAdj.get(a).add(b);
  };
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const a = subOwnership[gy * GW + gx];
      const b = subOwnership[gy * GW + gx + 1];
      const c = subOwnership[(gy + 1) * GW + gx];
      if (a >= 0 && b >= 0 && a !== b) { addSub(a, b); addSub(b, a); }
      if (a >= 0 && c >= 0 && a !== c) { addSub(a, c); addSub(c, a); }
    }
  }

  return { subSites, subOwnership, parentOfSub, subsInParent, subAdj };
}

function reservoirSample(arr, k, rng) {
  if (arr.length <= k) return arr.slice();
  const out = arr.slice(0, k);
  for (let i = k; i < arr.length; i++) {
    const j = Math.floor(rng() * (i + 1));
    if (j < k) out[j] = arr[i];
  }
  return out;
}

// ── Faction-to-territory assignment ─────────────────────────────
// units = [{ player_key, player_name, army_name, faction_id, faction,
//   games, wins, losses, draws, territory_score, first_seen_at }]
// Each unique (player, faction) combo is a separate banner: Joe's Necrons
// and Jane's Necrons hold different territories with their own home.
function unitKey(u) { return `${u.player_key}::${u.faction_id}`; }


function assignTerritories(subSites, parentOfSub, subsInParent, units, W, H, parentAdj, subAdj) {
  // Sort units in a fully deterministic order: first_seen_at ASC, then by
  // unitKey codepoint. Every comparison and iteration below MUST be
  // locale-independent and must not rely on Object key iteration order.
  const sorted = [...units].sort((a, b) => {
    const ta = String(a.first_seen_at || '');
    const tb = String(b.first_seen_at || '');
    if (ta < tb) return -1;
    if (ta > tb) return 1;
    const ka = unitKey(a), kb = unitKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });

  const NSub = subSites.length;

  // Step 1: pick a seed sub-cell per banner — closest unclaimed sub-site to
  // the banner's anchor, claimed in first_seen_at order. Determines the
  // banner's home parent province.
  const takenSub = new Set();
  const seedOf = {};
  for (const u of sorted) {
    const fallback = FACTION_HOMES[u.faction] || [0.5, 0.5];
    const hx = u.anchor_x != null ? Number(u.anchor_x) : fallback[0];
    const hy = u.anchor_y != null ? Number(u.anchor_y) : fallback[1];
    const tx = hx * W, ty = hy * H;
    let best = Infinity, bestId = -1;
    for (let s = 0; s < NSub; s++) {
      const site = subSites[s];
      if (!site) continue;
      if (takenSub.has(s)) continue;
      const dx = site.x - tx, dy = site.y - ty;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bestId = s; }
    }
    if (bestId >= 0) { seedOf[unitKey(u)] = bestId; takenSub.add(bestId); }
  }

  // Step 2: per-banner target sub-cell count, proportional to territory_score.
  const totalScore = units.reduce((s, u) => s + (u.territory_score || 0.001), 0) || 1;
  const target = {};
  for (const u of sorted) {
    target[unitKey(u)] = Math.max(1, Math.round((u.territory_score || 0.001) / totalScore * NSub));
  }

  // Step 3: parent-priority round-robin expansion. Each banner claims one
  // sub-cell per turn, preferring to finish the parent province they're
  // currently filling before opening a new one. The result: clusters of
  // fully-owned provinces (organic shape, inherited from the parent Voronoi)
  // plus a partial conquest on the war front, instead of disk-shaped regions.
  const owner = new Array(NSub).fill(null);
  const claimed = {};
  const pendingParents = {};
  const pendingSeen = {};
  const claimedParents = {};
  const activeIdx = {};

  for (const u of sorted) {
    const k = unitKey(u);
    const sid = seedOf[k];
    if (sid === undefined) continue;
    const homeParent = parentOfSub[sid];
    owner[sid] = k;
    claimed[k] = 1;
    pendingParents[k] = [homeParent];
    pendingSeen[k] = new Set([homeParent]);
    claimedParents[k] = new Set([homeParent]);
    activeIdx[k] = 0;
  }

  const MAX_OUTER = NSub * 4;
  let progress = true;
  let iters = 0;
  while (progress && iters++ < MAX_OUTER) {
    progress = false;
    for (const u of sorted) {
      const k = unitKey(u);
      if ((claimed[k] || 0) >= target[k]) continue;

      let nextSub = -1;
      let parentList = pendingParents[k];
      let idx = activeIdx[k];

      // Try to claim a sub-cell of the active parent (or a later pending
      // parent if the active is exhausted). Sub-cell must be adjacent to
      // one of our existing claims so growth stays contiguous.
      while (idx < parentList.length) {
        const activeP = parentList[idx];
        const subs = subsInParent[activeP] || [];
        for (const sid of subs) {
          if (owner[sid] !== null) continue;
          const nbrs = subAdj.get(sid);
          if (!nbrs) continue;
          let touchesOurs = false;
          for (const nb of nbrs) {
            if (owner[nb] === k) { touchesOurs = true; break; }
          }
          if (touchesOurs) { nextSub = sid; break; }
        }
        if (nextSub >= 0) break;
        idx++;
      }

      if (nextSub < 0) {
        // Pending parents exhausted: discover newly-adjacent parents and
        // re-try next turn. Loop the parent adjacency from every parent
        // we've claimed any sub-cell of.
        let added = false;
        for (const cp of claimedParents[k]) {
          const pNbrs = parentAdj.get(cp);
          if (!pNbrs) continue;
          for (const pn of pNbrs) {
            if (pendingSeen[k].has(pn)) continue;
            parentList.push(pn);
            pendingSeen[k].add(pn);
            added = true;
          }
        }
        if (added) progress = true;
        continue;
      }

      owner[nextSub] = k;
      claimed[k] = (claimed[k] || 0) + 1;
      claimedParents[k].add(parentOfSub[nextSub]);
      activeIdx[k] = idx;
      progress = true;
    }
  }

  // Step 4: fill any unclaimed land via adjacency adoption — covers pockets
  // BFS couldn't reach (rare, but possible if a parent is isolated from all
  // banners' frontiers).
  let changed = true;
  while (changed) {
    changed = false;
    for (let sid = 0; sid < NSub; sid++) {
      if (owner[sid] !== null) continue;
      const nbrs = subAdj.get(sid);
      if (!nbrs) continue;
      for (const nb of nbrs) {
        if (owner[nb] !== null) {
          owner[sid] = owner[nb];
          changed = true;
          break;
        }
      }
    }
  }

  return { owner };
}

// ── Render ──────────────────────────────────────────────────────
export async function renderWarmap(_state) {
  const root = el('div', { class: 'fade-in' });

  // ── Title block: BOIMAGGEDON / Theatre of War ────────────────
  const titleWrap = el('div', { style: {
    textAlign: 'center',
    marginBottom: '14px',
    padding: '14px 12px 12px',
    background: 'linear-gradient(180deg, rgba(120,220,255,0.05), transparent)',
    border: '1px solid rgba(120,220,255,0.15)',
    borderRadius: 'var(--radius-lg)',
  } }, [
    el('div', { style: {
      fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
      fontWeight: '700',
      fontSize: '34px',
      letterSpacing: '0.32em',
      color: '#aef0ff',
      textShadow: '0 0 12px rgba(120,220,255,0.6), 0 0 30px rgba(120,220,255,0.25)',
      lineHeight: '1',
    } }, 'BOIMAGGEDON'),
    el('div', { style: {
      fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
      fontSize: '11px',
      letterSpacing: '0.5em',
      color: 'rgba(255, 190, 80, 0.85)',
      marginTop: '8px',
      textTransform: 'uppercase',
    } }, '// theatre of war //'),
  ]);

  const loadingEl = el('div', { class: 'muted', style: { textAlign: 'center', padding: '60px', fontFamily: 'monospace', letterSpacing: '0.1em' } }, '> CALIBRATING TACTICAL DISPLAY');

  const canvasWrapper = el('div', { style: {
    position: 'relative',
    background: HUD_BG,
    border: '1px solid rgba(120,220,255,0.25)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
    boxShadow: '0 0 40px rgba(120,220,255,0.05) inset',
    width: '100%',
    maxWidth: VIRTUAL_W + 'px',
    margin: '0 auto',
  } }, loadingEl);

  // Season picker — only shown if more than one season exists. The picker
  // updates the hash query string and re-routes; the view rebuilds with
  // the new season filter. Crude but avoids restructuring the render
  // pipeline mid-flight.
  let allSeasons = [];
  try { allSeasons = await seasons.list(); } catch { /* endpoint missing pre-deploy: ignore */ }
  const hashQ = new URLSearchParams((window.location.hash.split('?')[1]) || '');
  const requestedSeasonId = hashQ.get('season') ? parseInt(hashQ.get('season'), 10) : null;
  const activeSeason = allSeasons.find(s => s.is_active) || allSeasons[allSeasons.length - 1];
  const selectedSeasonId = requestedSeasonId || activeSeason?.id || null;

  let seasonPicker = null;
  if (allSeasons.length > 1) {
    const sel = el('select', { style: { marginLeft: '8px' } },
      allSeasons.map(s => el('option', {
        value: s.id,
        selected: s.id === selectedSeasonId ? '' : null,
      }, `${s.name}${s.is_active ? '  (active)' : '  (archived)'}  · ${s.games}g`)));
    sel.addEventListener('change', () => {
      const newId = parseInt(sel.value, 10);
      const isActiveChoice = allSeasons.find(s => s.id === newId)?.is_active;
      window.location.hash = isActiveChoice ? '#/war' : '#/war?season=' + newId;
    });
    seasonPicker = el('div', { style: {
      textAlign: 'center', marginBottom: '8px', color: 'var(--text-muted)',
      fontFamily: 'monospace', fontSize: '12px',
    } }, [
      el('label', { style: { display: 'inline', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '10px' } }, 'Season:'),
      sel,
    ]);
  }

  root.appendChild(titleWrap);
  if (seasonPicker) root.appendChild(seasonPicker);
  root.appendChild(canvasWrapper);

  const units = await stats.warmap(selectedSeasonId);

  clear(canvasWrapper);

  if (!units.length) {
    canvasWrapper.appendChild(el('div', {
      class: 'muted',
      style: {
        padding: '80px',
        textAlign: 'center',
        fontFamily: 'monospace',
        letterSpacing: '0.1em',
        color: 'rgba(120,220,255,0.6)',
      },
    }, '> NO ENGAGEMENTS REGISTERED. AWAITING FIRST CONTACT.'));
    return root;
  }

  const canvas = el('canvas', { id: 'warmap-canvas' });
  canvasWrapper.appendChild(canvas);

  // Tooltip floats above the canvas on pointer move (#14). It's positioned
  // absolutely within canvasWrapper, which is `position: relative` (already
  // set in the wrapper style). Kept hidden until first hover.
  const tooltip = el('div', { class: 'warmap-tooltip', style: { display: 'none' } });
  canvasWrapper.appendChild(tooltip);

  // Legend toggle (#17): a small "?" button bottom-left of the canvas
  // that pops a panel mapping faction abbreviations → full names.
  const legendBtn = el('button', { type: 'button', class: 'warmap-legend-toggle', title: 'Faction key' }, '?');
  const legendPanel = el('div', { class: 'warmap-legend-panel', style: { display: 'none' } });
  canvasWrapper.appendChild(legendBtn);
  canvasWrapper.appendChild(legendPanel);

  // Always compute at the fixed virtual resolution; CSS scales the rendered
  // bitmap to fit the container. Two devices with different widths still
  // see byte-identical territory geometry and faction allocation.
  canvas.width = VIRTUAL_W;
  canvas.height = VIRTUAL_H;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = 'auto';
  canvas.style.maxWidth = VIRTUAL_W + 'px';

  // Per-season seed: use the picked season's map_seed if available, else
  // fall back to the canonical MAP_SEED. The seed is a BIGINT in the DB so
  // it arrives as a string; convert to a Number for the JS RNG (truncates
  // to 32 bits via `>>> 0` inside seededRng).
  const seasonObj = allSeasons.find(s => s.id === selectedSeasonId);
  const renderSeed = seasonObj?.map_seed ? Number(seasonObj.map_seed) : MAP_SEED;

  let mapState = null;
  requestAnimationFrame(() => {
    mapState = drawTacticalMap(canvas, units, VIRTUAL_W, VIRTUAL_H, renderSeed);
    populateLegend(legendPanel, mapState);
  });

  // ── Hover tooltip ──────────────────────────────────────────
  canvas.addEventListener('mousemove', (e) => {
    if (!mapState) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sy = (e.clientY - rect.top) * (canvas.height / rect.height);
    const gx = Math.floor(sx / mapState.CELL);
    const gy = Math.floor(sy / mapState.CELL);
    const sid = mapState.subOwnership[gy * mapState.GW + gx];
    if (sid == null || sid < 0) {
      tooltip.style.display = 'none';
      return;
    }
    const pid = mapState.parentOfSub[sid];
    const ownerKey = mapState.owner[sid];
    const u = ownerKey ? mapState.unitMeta[ownerKey] : null;
    const tcount = ownerKey ? (mapState.territoryCount[ownerKey] || 0) : 0;
    const name = territoryName(pid, renderSeed);
    const provOwners = mapState.provinceOwners[pid];
    const contested = provOwners && provOwners.size > 1;
    const lines = [
      `<div class="t-title">${escapeHtml(name)}</div>`,
      u
        ? `<div class="t-banner">${escapeHtml(u.army_name || u.player_name)}</div>
           <div class="t-faction">${escapeHtml(u.faction)}</div>
           <div class="t-record">${u.wins}W · ${u.losses}L · ${u.draws}D · ${u.win_rate}%</div>
           <div class="t-record">${tcount} ${tcount === 1 ? 'territory' : 'territories'}</div>`
        : `<div class="t-banner muted">Unclaimed</div>`,
      contested ? `<div class="t-record" style="color: rgba(255, 190, 80, 0.9)">· contested (${provOwners.size} banners)</div>` : '',
    ].join('');
    tooltip.innerHTML = lines;
    // Show first so we can measure dimensions, then place. The wrapper has
    // overflow:hidden, so anchor below-right by default but flip to the
    // opposite side of the cursor if that would clip on a narrow viewport.
    tooltip.style.display = 'block';
    const wrapperRect = canvasWrapper.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const margin = 4;
    const gap = 12;
    const localX = e.clientX - wrapperRect.left;
    const localY = e.clientY - wrapperRect.top;
    let tx = localX + gap;
    if (tx + tipRect.width > wrapperRect.width - margin) {
      tx = localX - tipRect.width - gap;
    }
    if (tx < margin) tx = margin;
    let ty = localY + gap;
    if (ty + tipRect.height > wrapperRect.height - margin) {
      ty = localY - tipRect.height - gap;
    }
    if (ty < margin) ty = margin;
    tooltip.style.left = tx + 'px';
    tooltip.style.top = ty + 'px';
  });
  canvas.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });

  // ── Legend toggle ──────────────────────────────────────────
  legendBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    legendPanel.style.display = legendPanel.style.display === 'none' ? 'block' : 'none';
  });
  document.addEventListener('click', (e) => {
    if (!canvasWrapper.contains(e.target)) legendPanel.style.display = 'none';
  });

  return root;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function populateLegend(panel, mapState) {
  if (!mapState) return;
  // Distinct factions present + their full → abbrev mapping
  const factions = [...new Set(Object.values(mapState.unitMeta).map(u => u.faction))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0);
  panel.innerHTML = '<div class="legend-title">Faction Key</div>';
  for (const f of factions) {
    const col = FACTION_COLOURS[f] || '#888';
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `
      <div class="legend-swatch" style="background:${col};box-shadow:0 0 4px ${col}"></div>
      <div class="legend-glyph">${FACTION_GLYPH[f] || '•'}</div>
      <div class="legend-abbrev">${escapeHtml(abbreviate(f))}</div>
      <div class="legend-name">${escapeHtml(f)}</div>
    `;
    panel.appendChild(row);
  }
}

function drawTacticalMap(canvas, units, W, H, seed = MAP_SEED) {
  const ctx = canvas.getContext('2d');

  // ── Step 0: backdrop with vignette + grid ───────────────────
  drawBackdrop(ctx, W, H);

  // ── Step 1: continent + parent territories + sub-cells ──────
  const polygon = generateContinent(W, H, seed);
  const { sites: parentSites, ownership: parentOwnership, GW, GH, CELL } =
    generateTerritories(W, H, polygon, seed);
  const parentAdj = buildAdjacency(parentOwnership, GW, GH);
  const { subSites, subOwnership, parentOfSub, subsInParent, subAdj } =
    generateSubTerritories(parentOwnership, parentSites, GW, GH, CELL, seed);
  const { owner } = assignTerritories(subSites, parentOfSub, subsInParent,
    units, W, H, parentAdj, subAdj);

  // Lookup tables: unitKey -> { faction, label }
  const unitMeta = {};
  for (const u of units) unitMeta[unitKey(u)] = u;

  // Per-parent sub-cell ownership tally → majority owner per province (used
  // for the "territories" count and for the contested-province tooltip note).
  const NParent = parentSites.length;
  const provinceMajority = new Array(NParent).fill(null);
  const provinceOwners = new Array(NParent);
  for (let p = 0; p < NParent; p++) {
    const counts = new Map();
    for (const sid of subsInParent[p]) {
      const o = owner[sid];
      if (!o) continue;
      counts.set(o, (counts.get(o) || 0) + 1);
    }
    provinceOwners[p] = counts;
    let bestOwner = null, bestCount = -1;
    for (const [k, c] of counts) {
      if (c > bestCount) { bestCount = c; bestOwner = k; }
    }
    provinceMajority[p] = bestOwner;
  }
  const territoryCount = {};
  for (const k of provinceMajority) if (k) territoryCount[k] = (territoryCount[k] || 0) + 1;

  // ── Step 2: paint territories ────────────────────────────────
  paintTerritories(ctx, subOwnership, owner, unitMeta, GW, GH, CELL, W, H);

  // ── Step 3: territory borders + coastline ────────────────────
  drawCoastline(ctx, polygon);
  drawBorders(ctx, parentOwnership, subOwnership, owner, GW, GH, CELL);

  // ── Step 4: banner labels at each region's densest sub-cell ──
  drawLabels(ctx, subSites, units, owner, subAdj);

  // ── Step 5: HUD chrome ───────────────────────────────────────
  drawScanlines(ctx, W, H);
  drawCornerBrackets(ctx, W, H);
  drawCompass(ctx, 50, H - 60);
  drawReadout(ctx, W, H, units, NParent);

  return {
    parentOwnership, subOwnership, owner, parentOfSub, provinceOwners,
    unitMeta, territoryCount, GW, GH, CELL, subSites,
  };
}

function drawBackdrop(ctx, W, H) {
  // Deep navy with a gentle radial darken — the gradient extends past the
  // canvas corners so the perimeter doesn't fade hard to near-black, which
  // previously made the edges read as a thick dark border framing the grid.
  const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H) * 1.1);
  bg.addColorStop(0, '#0a1828');
  bg.addColorStop(1, '#061222');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Faint coordinate grid
  ctx.strokeStyle = HUD_FAINT;
  ctx.lineWidth = 1;
  const STEP = 50;
  for (let x = 0; x <= W; x += STEP) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += STEP) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
  }
}

function paintTerritories(ctx, ownership, owner, unitMeta, GW, GH, CELL, W, H) {
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const o = ownership[gy * GW + gx];
      if (o < 0) continue; // ocean stays as backdrop
      const ownerKey = owner[o];
      let r, g, b, a;
      if (!ownerKey) {
        // Unclaimed land — neutral steel
        r = 60; g = 75; b = 90; a = 0.55;
      } else {
        const u = unitMeta[ownerKey];
        const hex = (u && FACTION_COLOURS[u.faction]) || '#666';
        [r, g, b] = hexToRgb(hex);
        a = 0.72;
      }
      for (let dy = 0; dy < CELL; dy++) {
        for (let dx = 0; dx < CELL; dx++) {
          const px = gx * CELL + dx, py = gy * CELL + dy;
          if (px >= W || py >= H) continue;
          const i = (py * W + px) * 4;
          data[i]   = Math.round(data[i]   * (1 - a) + r * a);
          data[i+1] = Math.round(data[i+1] * (1 - a) + g * a);
          data[i+2] = Math.round(data[i+2] * (1 - a) + b * a);
          data[i+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawCoastline(ctx, polygon) {
  // Outer glow
  ctx.save();
  ctx.strokeStyle = HUD_CYAN;
  ctx.lineWidth = 1.5;
  ctx.shadowColor = 'rgba(120, 220, 255, 0.9)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(polygon[0][0], polygon[0][1]);
  for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0], polygon[i][1]);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawBorders(ctx, parentOwnership, subOwnership, owner, GW, GH, CELL) {
  // Three tiers:
  //  - Same parent + same banner: no line (interior of a uniformly-held province).
  //  - Different parent + same banner: faint cyan province grid line.
  //  - Same parent + different banner: medium amber contested-province line.
  //  - Different parent + different banner: bold amber war front.
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const i = gy * GW + gx;
      const pa = parentOwnership[i];
      const pb = parentOwnership[i + 1];
      const pc = parentOwnership[i + GW];
      const sa = subOwnership[i];
      const sb = subOwnership[i + 1];
      const sc = subOwnership[i + GW];

      if (pa >= 0 && pb >= 0 && sa !== sb) {
        const sameParent = pa === pb;
        const sameBanner = owner[sa] === owner[sb] && owner[sa] !== null;
        if (!(sameParent && sameBanner)) {
          drawSegment(ctx, (gx + 1) * CELL, gy * CELL, (gx + 1) * CELL, (gy + 1) * CELL,
            sameParent, sameBanner);
        }
      }
      if (pa >= 0 && pc >= 0 && sa !== sc) {
        const sameParent = pa === pc;
        const sameBanner = owner[sa] === owner[sc] && owner[sa] !== null;
        if (!(sameParent && sameBanner)) {
          drawSegment(ctx, gx * CELL, (gy + 1) * CELL, (gx + 1) * CELL, (gy + 1) * CELL,
            sameParent, sameBanner);
        }
      }
    }
  }
}

function drawSegment(ctx, x1, y1, x2, y2, sameParent, sameBanner) {
  if (sameBanner) {
    // Province grid line — visible but quiet so it reads as geography.
    ctx.strokeStyle = 'rgba(120, 220, 255, 0.22)';
    ctx.lineWidth = 0.5;
  } else if (sameParent) {
    // Contested province — banner boundary inside a single province.
    ctx.strokeStyle = 'rgba(255, 190, 80, 0.65)';
    ctx.lineWidth = 1.0;
  } else {
    // Cross-province war front.
    ctx.strokeStyle = HUD_AMBER;
    ctx.lineWidth = 1.6;
  }
  ctx.beginPath();
  ctx.moveTo(x1 + 0.5, y1 + 0.5);
  ctx.lineTo(x2 + 0.5, y2 + 0.5);
  ctx.stroke();
}

function drawLabels(ctx, sites, units, owner, adj) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Place each banner's label on its densest cell — the owned cell with
  // the highest "neighbourhood weight" inside its own region. Density is
  // measured as Σ 1/(1+hop) over every other same-owner cell reachable
  // through same-owner cells only. That naturally favours the centre of
  // the largest cluster, ignores thin tendrils, and steers clear of
  // coasts (since coastal cells have fewer nearby same-owner cells).
  for (const u of units) {
    const k = unitKey(u);
    const tid = findDensestCell(k, owner, adj);
    if (tid < 0) continue;
    const cx = sites[tid].x;
    const cy = sites[tid].y;
    const primary = u.army_name || u.player_name;
    const secondary = abbreviate(u.faction);

    ctx.font = '700 12px "Consolas", "Monaco", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(primary, cx + 1, cy - 5);
    ctx.fillStyle = 'rgba(255, 230, 160, 0.95)';
    ctx.fillText(primary, cx, cy - 6);

    ctx.font = '500 9px "Consolas", "Monaco", monospace';
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(secondary, cx + 1, cy + 7);
    ctx.fillStyle = 'rgba(180, 220, 255, 0.85)';
    ctx.fillText(secondary, cx, cy + 6);
  }
  ctx.restore();
}

// For each k-owned cell, BFS through the k-region only, weighting each
// other k-cell at hop distance d by 1/(1+d). The cell with the highest
// total weight is the densest spot in the region. For ties, the lowest
// tid wins (deterministic).
function findDensestCell(k, owner, adj) {
  let bestId = -1;
  let bestScore = -1;
  for (let c = 0; c < owner.length; c++) {
    if (owner[c] !== k) continue;
    const dist = new Map();
    dist.set(c, 0);
    let frontier = [c];
    while (frontier.length) {
      const next = [];
      for (const cell of frontier) {
        const d = dist.get(cell);
        const nbrs = adj.get(cell);
        if (!nbrs) continue;
        for (const nb of nbrs) {
          if (dist.has(nb)) continue;
          if (owner[nb] !== k) continue;
          dist.set(nb, d + 1);
          next.push(nb);
        }
      }
      frontier = next;
    }
    let score = 0;
    for (const d of dist.values()) score += 1 / (1 + d);
    if (score > bestScore) {
      bestScore = score;
      bestId = c;
    }
  }
  return bestId;
}

function drawScanlines(ctx, W, H) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

function drawCornerBrackets(ctx, W, H) {
  ctx.save();
  ctx.strokeStyle = HUD_CYAN;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(120,220,255,0.6)';
  ctx.shadowBlur = 4;
  const sz = 22, m = 12;
  // TL
  ctx.beginPath(); ctx.moveTo(m, m + sz); ctx.lineTo(m, m); ctx.lineTo(m + sz, m); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(W - m - sz, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + sz); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(m, H - m - sz); ctx.lineTo(m, H - m); ctx.lineTo(m + sz, H - m); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(W - m - sz, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - sz); ctx.stroke();
  ctx.restore();
}

function drawCompass(ctx, cx, cy) {
  ctx.save();
  ctx.strokeStyle = HUD_CYAN;
  ctx.fillStyle = HUD_CYAN;
  ctx.lineWidth = 1;
  ctx.font = '600 9px "Consolas", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const r = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Tick marks
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r - 3);
    const y1 = cy + Math.sin(a) * (r - 3);
    const x2 = cx + Math.cos(a) * r;
    const y2 = cy + Math.sin(a) * r;
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  // N marker
  ctx.beginPath();
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - r - 4);
  ctx.stroke();
  ctx.fillText('N', cx, cy - r - 10);
  // Centre cross
  ctx.beginPath();
  ctx.moveTo(cx - 3, cy); ctx.lineTo(cx + 3, cy);
  ctx.moveTo(cx, cy - 3); ctx.lineTo(cx, cy + 3);
  ctx.stroke();
  ctx.restore();
}

function drawReadout(ctx, W, H, units, territoryCount) {
  ctx.save();
  ctx.font = '600 10px "Consolas", monospace';
  ctx.textAlign = 'right';
  ctx.fillStyle = HUD_CYAN;
  const factionsActive = new Set(units.map(u => u.faction)).size;
  const playersActive = new Set(units.map(u => u.player_key)).size;
  const lines = [
    `> WORLD: BOIMAGGEDON`,
    `> THEATRES: ${territoryCount}`,
    `> BANNERS: ${units.length}`,
    `> FACTIONS: ${factionsActive}`,
    `> PLAYERS: ${playersActive}`,
    `> STATUS: ${'●'} ENGAGED`,
  ];
  // Stack upward from the bottom margin so every line stays on-canvas
  // regardless of how many entries the readout grows to.
  const lineH = 13;
  const bottomMargin = 14;
  let y = H - bottomMargin - (lines.length - 1) * lineH;
  for (const line of lines) {
    ctx.fillText(line, W - 24, y);
    y += lineH;
  }
  ctx.restore();
}
