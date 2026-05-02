import { stats } from '../api.js';
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

// ── Hardcoded faction home fortresses ───────────────────────────
// Positions are [x, y] in 0..1 space, placed lore-accurately on a
// generalised 40k map (Segmentums approximated left-to-right).
// These are fixed forever — do not change or the whole map shifts.
const FACTION_HOMES = {
  'Space Marines':       [0.50, 0.48], // Terra / Segmentum Solar
  'Adeptus Custodes':    [0.50, 0.50], // Terra
  'Imperial Agents':     [0.50, 0.49],
  'Adepta Sororitas':    [0.45, 0.52],
  'Adeptus Mechanicus':  [0.46, 0.48], // Mars
  'Astra Militarum':     [0.48, 0.45],
  'Grey Knights':        [0.52, 0.46], // Titan (Segmentum Solar)
  'Deathwatch':          [0.53, 0.44],
  'Imperial Knights':    [0.44, 0.50],
  'Black Templars':      [0.47, 0.44],
  'Blood Angels':        [0.55, 0.52], // Baal
  'Dark Angels':         [0.41, 0.46], // Caliban / The Rock
  'Space Wolves':        [0.38, 0.38], // Fenris (Segmentum Obscurus)
  'Aeldari':             [0.30, 0.42], // Craftworlds (Segmentum Obscurus rim)
  'Drukhari':            [0.29, 0.55], // Commorragh (Webway)
  'Necrons':             [0.72, 0.60], // Segmentum Ultima — Tomb worlds
  'Orks':                [0.60, 0.38], // Charadon / Octarius
  'Tyranids':            [0.85, 0.65], // Eastern Fringe — galactic east
  'T\'au Empire':        [0.78, 0.55], // Eastern Fringe — Tau sept worlds
  'Genestealer Cults':   [0.65, 0.55], // Scattered, centred Ultima
  'Leagues of Votann':   [0.35, 0.62], // Galactic core fringes
  'Chaos Space Marines': [0.20, 0.50], // Eye of Terror
  'Chaos Daemons':       [0.20, 0.48],
  'Chaos Knights':       [0.22, 0.52],
  'Death Guard':         [0.18, 0.56], // Plague Planet / Eye of Terror
  'Thousand Sons':       [0.19, 0.44], // Planet of Sorcerers
  'World Eaters':        [0.21, 0.40], // Eye of Terror
  'Emperor\'s Children': [0.17, 0.48], // Eye of Terror
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

// ── Pixel art units — 8×8 sprite bitmaps ────────────────────────
// Each unit is an 8×8 grid; 1 = faction colour, 2 = lighter accent, 0 = transparent
// Facing RIGHT by default; flipped for LEFT-side border troops.
const SPRITE_MARINE = [
  [0,0,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,0],
  [0,1,2,1,1,2,1,0],
  [0,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,0],
  [0,1,0,1,1,0,1,0],
  [0,1,0,0,0,0,1,0],
];

const SPRITE_BOLT = [
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,2,2,0,0,0],
  [0,0,2,2,2,2,0,0],
  [0,0,2,2,2,2,0,0],
  [0,0,0,2,2,0,0,0],
  [0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0],
];

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return [r, g, b];
}

function lighten(hex, amount = 60) {
  const [r,g,b] = hexToRgb(hex);
  return `rgb(${Math.min(255,r+amount)},${Math.min(255,g+amount)},${Math.min(255,b+amount)})`;
}

// ── Main render ──────────────────────────────────────────────────
export async function renderWarmap(_state) {
  const root = el('div', { class: 'fade-in' });

  const titleEl = el('div', { style: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    textTransform: 'uppercase',
    letterSpacing: '0.14em',
    textAlign: 'center',
    marginBottom: '4px',
    color: 'var(--accent)',
  } }, 'Theatre of War');
  const subtitleEl = el('div', { style: {
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '13px',
    marginBottom: '16px',
    letterSpacing: '0.04em',
  } }, 'Territory is earned through blood and battle. Home fortresses stand eternal.');

  const loadingEl = el('div', { class: 'muted', style: { textAlign: 'center', padding: '40px' } }, 'Calculating theatre of war…');
  const canvasWrapper = el('div', { style: {
    position: 'relative',
    background: 'var(--panel-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    overflow: 'hidden',
    display: 'flex',
    justifyContent: 'center',
  } }, loadingEl);

  const legendEl = el('div', { style: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    justifyContent: 'center',
    marginTop: '14px',
    padding: '12px',
    background: 'var(--panel-bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
  } });

  root.appendChild(titleEl);
  root.appendChild(subtitleEl);
  root.appendChild(canvasWrapper);
  root.appendChild(legendEl);

  // Fetch data then render
  const factionData = await stats.warmap();

  clear(loadingEl.parentNode === canvasWrapper ? canvasWrapper : canvasWrapper);

  if (!factionData.length) {
    canvasWrapper.appendChild(el('div', { class: 'muted', style: { padding: '60px', textAlign: 'center' } },
      'No games recorded yet. Play some games to claim territory.'));
    return root;
  }

  const canvas = el('canvas', { id: 'warmap-canvas' });
  canvasWrapper.appendChild(canvas);

  // Build legend
  for (const f of factionData) {
    const col = FACTION_COLOURS[f.faction] || '#666';
    legendEl.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' } }, [
      el('div', { style: { width: '14px', height: '14px', background: col, border: '1px solid var(--border-light)', borderRadius: '2px', flexShrink: '0' } }),
      el('div', { class: 'tabular' }, `${f.faction} ${f.wins}W/${f.losses}L (${f.win_rate}%)`),
    ]));
  }

  // Draw after layout so canvas has dimensions
  requestAnimationFrame(() => {
    const W = Math.min(1200, canvasWrapper.clientWidth || 960);
    const H = Math.round(W * 0.58);
    canvas.width = W;
    canvas.height = H;
    canvas.style.display = 'block';
    drawMap(canvas, factionData, W, H);
  });

  return root;
}

function drawMap(canvas, factionData, W, H) {
  const ctx = canvas.getContext('2d');
  const rng = seededRng(MAP_SEED);

  // ── Step 1: generate ALL faction seed points (home) including those
  //   without games. They shape the map so future factions don't displace
  //   existing territories when they first play.
  const allFactionNames = Object.keys(FACTION_HOMES);
  const activeFactions = new Set(factionData.map(f => f.faction));

  // Map fraction-space [0,1] → canvas pixels
  const toX = v => Math.round(v * W);
  const toY = v => Math.round(v * H);

  // Build site list: home + jitter points proportional to territory score
  const sites = []; // { x, y, faction, isHome }

  // For inactive factions, add their home as a "ghost" site so it holds space
  for (const name of allFactionNames) {
    const [hx, hy] = FACTION_HOMES[name];
    sites.push({ x: toX(hx), y: toY(hy), faction: name, isHome: true });
  }

  // For active factions, scatter extra seed points proportional to territory_score
  for (const f of factionData) {
    const factionRng = seededRng(MAP_SEED ^ hashStr(f.faction));
    const extras = Math.round(f.territory_score * 12); // 0–12 extra points
    for (let i = 0; i < extras; i++) {
      const angle = factionRng() * Math.PI * 2;
      const dist = factionRng() * 0.25; // spread up to 25% of map
      const [hx, hy] = FACTION_HOMES[f.faction];
      sites.push({
        x: Math.max(0, Math.min(W, toX(hx + Math.cos(angle) * dist))),
        y: Math.max(0, Math.min(H, toY(hy + Math.sin(angle) * dist))),
        faction: f.faction,
        isHome: false,
      });
    }
  }

  // ── Step 2: Voronoi — for each pixel, find nearest site ────────
  // At this canvas size doing per-pixel would be too slow; use a grid approach.
  const CELL = 4; // sample every 4px
  const GW = Math.ceil(W / CELL);
  const GH = Math.ceil(H / CELL);
  const ownership = new Array(GW * GH);

  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const px = gx * CELL + CELL / 2;
      const py = gy * CELL + CELL / 2;
      let best = Infinity, bestIdx = 0;
      for (let s = 0; s < sites.length; s++) {
        const dx = px - sites[s].x, dy = py - sites[s].y;
        const d = dx*dx + dy*dy;
        if (d < best) { best = d; bestIdx = s; }
      }
      ownership[gy * GW + gx] = sites[bestIdx].faction;
    }
  }

  // ── Step 3: draw territories ────────────────────────────────────
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;

  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const faction = ownership[gy * GW + gx];
      // Only colour tiles for active factions; inactive = dark bg
      const col = activeFactions.has(faction) ? (FACTION_COLOURS[faction] || '#333333') : '#1a1a20';
      const [r, g, b] = hexToRgb(col);
      // Add subtle grid noise
      const noiseRng = seededRng((gx * 7919 + gy * 104729) ^ MAP_SEED);
      const n = (noiseRng() * 16 - 8) | 0;
      for (let dy = 0; dy < CELL; dy++) {
        for (let dx = 0; dx < CELL; dx++) {
          const px = gx * CELL + dx, py = gy * CELL + dy;
          if (px >= W || py >= H) continue;
          const i = (py * W + px) * 4;
          data[i]   = Math.max(0, Math.min(255, r + n));
          data[i+1] = Math.max(0, Math.min(255, g + n));
          data[i+2] = Math.max(0, Math.min(255, b + n));
          data[i+3] = 255;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);

  // ── Step 4: draw territory borders ─────────────────────────────
  ctx.lineWidth = 2;
  for (let gy = 0; gy < GH - 1; gy++) {
    for (let gx = 0; gx < GW - 1; gx++) {
      const here = ownership[gy * GW + gx];
      const right = ownership[gy * GW + (gx+1)];
      const below = ownership[(gy+1) * GW + gx];
      if (here !== right || here !== below) {
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        if (here !== right) {
          ctx.moveTo((gx+1)*CELL, gy*CELL);
          ctx.lineTo((gx+1)*CELL, (gy+1)*CELL);
        }
        if (here !== below) {
          ctx.moveTo(gx*CELL, (gy+1)*CELL);
          ctx.lineTo((gx+1)*CELL, (gy+1)*CELL);
        }
        ctx.stroke();
      }
    }
  }

  // ── Step 5: draw home fortresses for active factions ───────────
  for (const f of factionData) {
    const [hx, hy] = FACTION_HOMES[f.faction] || [rng(), rng()];
    const px = toX(hx), py = toY(hy);
    const col = FACTION_COLOURS[f.faction] || '#888';
    drawFortress(ctx, px, py, col);
  }

  // ── Step 6: draw pixel unit skirmishes at borders ───────────────
  drawBorderSkirmishes(ctx, ownership, sites, factionData, GW, GH, CELL, W, H);

  // ── Step 7: faction name labels ──────────────────────────────────
  ctx.font = 'bold 10px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of factionData) {
    const [hx, hy] = FACTION_HOMES[f.faction] || [0.5, 0.5];
    const px = toX(hx), py = toY(hy);
    const label = f.faction.replace('Emperor\'s Children', 'Emp. Children').replace('Adeptus Mechanicus', 'Ad. Mech').replace('Genestealer Cults', 'GSC').replace('Chaos Space Marines', 'CSM').replace('Leagues of Votann', 'LoV');
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillText(label, px+1, py + 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, px, py + 21);
  }
}

function drawFortress(ctx, cx, cy, col) {
  const S = 10; // half-size
  // Outer wall
  ctx.fillStyle = '#222';
  ctx.fillRect(cx - S, cy - S, S*2, S*2);
  ctx.fillStyle = col;
  ctx.fillRect(cx - S + 2, cy - S + 2, S*2 - 4, S*2 - 4);
  // Battlements (pixel art)
  ctx.fillStyle = '#111';
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(cx - S + 1 + i * 6, cy - S - 4, 4, 4);
    ctx.fillRect(cx - S + 1 + i * 6, cy + S, 4, 4);
  }
  // Keep (inner tower)
  ctx.fillStyle = lighten(col, 30);
  ctx.fillRect(cx - 4, cy - 4, 8, 8);
  // White dot — the unconquerable beacon
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Gold ring
  ctx.strokeStyle = '#ffd700';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, S + 2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawBorderSkirmishes(ctx, ownership, sites, factionData, GW, GH, CELL, W, H) {
  // Find border cells between two different active factions
  const active = new Set(factionData.map(f => f.faction));
  const borders = [];
  for (let gy = 1; gy < GH - 2; gy++) {
    for (let gx = 1; gx < GW - 2; gx++) {
      const here = ownership[gy * GW + gx];
      const right = ownership[gy * GW + (gx+1)];
      if (here !== right && active.has(here) && active.has(right)) {
        borders.push({ gx, gy, leftFaction: here, rightFaction: right });
      }
    }
  }

  if (!borders.length) return;

  // Seed-consistent selection — pick ~20 evenly distributed border fights
  const step = Math.max(1, Math.floor(borders.length / 20));
  const fights = borders.filter((_, i) => i % step === 0).slice(0, 24);

  const SCALE = 2; // each pixel art pixel = 2 canvas pixels
  const SZ = 8 * SCALE;

  for (const { gx, gy, leftFaction, rightFaction } of fights) {
    const bx = gx * CELL;
    const by = gy * CELL;

    const lCol = FACTION_COLOURS[leftFaction] || '#888';
    const rCol = FACTION_COLOURS[rightFaction] || '#888';

    // Left unit faces right
    drawSprite(ctx, SPRITE_MARINE, bx - SZ - 2, by - SZ/2, SCALE, lCol, false);
    // Right unit faces left (mirrored)
    drawSprite(ctx, SPRITE_MARINE, bx + 4, by - SZ/2, SCALE, rCol, true);
    // Bolt between them
    drawSprite(ctx, SPRITE_BOLT, bx - SZ/2, by - SZ/2, SCALE, lCol, false);
  }
}

function drawSprite(ctx, sprite, ox, oy, scale, col, flipX) {
  const [r, g, b] = hexToRgb(col);
  const lr = Math.min(255, r + 80), lg = Math.min(255, g + 80), lb = Math.min(255, b + 80);
  const H = sprite.length, W = sprite[0].length;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = sprite[y][flipX ? W - 1 - x : x];
      if (!v) continue;
      if (v === 1) ctx.fillStyle = `rgb(${r},${g},${b})`;
      else         ctx.fillStyle = `rgb(${lr},${lg},${lb})`;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b9) | 0;
  return h >>> 0;
}
