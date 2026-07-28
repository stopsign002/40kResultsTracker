import { games, reference, gameImages, mapImages } from '../api.js';
import { el, clear, fmtDate, pill, selectOptions, fmtDuration } from '../components.js';

const filterState = {
  format: '', missionPack: '', primaryMission: '', deploymentMap: '',
  playerKey: '', playerFaction: '', opponentFaction: '', playMedium: '', edition: '',
  dateFrom: '', dateTo: '', includeHidden: 'false', q: '',
};

// On entry, copy any matching query-string params from the URL hash so that
// click-throughs from stats / matchups / faction win-rates pre-populate the
// filter panel.
function applyHashParams() {
  const hash = window.location.hash || '';
  const qIndex = hash.indexOf('?');
  if (qIndex < 0) return;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  for (const k of Object.keys(filterState)) {
    if (params.has(k)) filterState[k] = params.get(k);
  }
}

export async function renderGamesList(state) {
  applyHashParams();
  const root = el('div', { class: 'fade-in' });

  const [factions, missionPacks, players] = await Promise.all([
    reference.factions(),
    reference.missionPacks(),
    reference.players(),
  ]);

  let primaryMissions = [];
  let deploymentMaps = [];
  if (filterState.missionPack) {
    const d = await reference.missionDetails(filterState.missionPack);
    primaryMissions = d.primaryMissions;
    deploymentMaps = d.deploymentMaps;
  }

  const filterSel = (label, key, items, valueKey, labelKey) => {
    const sel = el('select', {}, selectOptions(items, valueKey, labelKey));
    sel.value = filterState[key];
    sel.addEventListener('change', async () => {
      filterState[key] = sel.value;
      if (key === 'missionPack') {
        filterState.primaryMission = '';
        filterState.deploymentMap = '';
      }
      await refresh();
    });
    return el('div', { class: 'form-group' }, [el('label', {}, label), sel]);
  };

  const dateInput = (label, key) => {
    const inp = el('input', { type: 'date', value: filterState[key] });
    inp.addEventListener('change', () => { filterState[key] = inp.value; refresh(); });
    return el('div', { class: 'form-group' }, [el('label', {}, label), inp]);
  };

  const formatSel = (() => {
    const sel = el('select', {}, [
      el('option', { value: '' }, 'Any'),
      ...['matched','crusade','narrative','open','tournament'].map(f => el('option', { value: f }, f)),
    ]);
    sel.value = filterState.format;
    sel.addEventListener('change', () => { filterState.format = sel.value; refresh(); });
    return el('div', { class: 'form-group' }, [el('label', {}, 'Format'), sel]);
  })();

  const mediumSel = (() => {
    const sel = el('select', {}, [
      el('option', { value: '' }, 'Any'),
      el('option', { value: 'physical' }, 'Physical'),
      el('option', { value: 'digital' }, 'Digital (TTS)'),
    ]);
    sel.value = filterState.playMedium;
    sel.addEventListener('change', () => { filterState.playMedium = sel.value; refresh(); });
    return el('div', { class: 'form-group' }, [el('label', {}, 'Medium'), sel]);
  })();

  const editionSel = (() => {
    const sel = el('select', {}, [
      el('option', { value: '' }, 'Any'),
      el('option', { value: '11' }, '11th'),
      el('option', { value: '10' }, '10th'),
    ]);
    sel.value = filterState.edition;
    sel.addEventListener('change', () => { filterState.edition = sel.value; refresh(); });
    return el('div', { class: 'form-group' }, [el('label', {}, 'Edition'), sel]);
  })();

  const includeHiddenSel = (() => {
    const sel = el('select', {}, [
      el('option', { value: 'false' }, 'Visible only'),
      el('option', { value: 'true' }, 'Include hidden'),
    ]);
    sel.value = filterState.includeHidden;
    sel.addEventListener('change', () => { filterState.includeHidden = sel.value; refresh(); });
    return el('div', { class: 'form-group' }, [el('label', {}, 'Visibility'), sel]);
  })();

  // #8 free-text search across notes, army-list paste, tournament name,
  // location, and player names.
  let searchTimer = null;
  const searchInput = el('input', {
    type: 'search',
    placeholder: 'Search notes / army list / players…',
    value: filterState.q,
    autocomplete: 'off',
  });
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filterState.q = searchInput.value;
      refresh();
    }, 250);
  });
  const searchField = el('div', { class: 'form-group', style: { gridColumn: '1 / -1' } }, [
    el('label', {}, 'Search'),
    searchInput,
  ]);

  const filterPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Filters'),
      el('button', { class: 'btn small', onClick: () => {
        Object.keys(filterState).forEach(k => filterState[k] = k === 'includeHidden' ? 'false' : '');
        renderGamesList(state).then(node => {
          const main = document.querySelector('main');
          if (main) { clear(main); main.appendChild(node); }
        });
      } }, 'Reset'),
    ]),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'filters' }, [
        searchField,
        filterSel('Player', 'playerKey', players, 'key', 'label'),
        filterSel('Faction', 'playerFaction', factions),
        filterSel('Vs Faction', 'opponentFaction', factions),
        formatSel,
        editionSel,
        mediumSel,
        filterSel('Mission Pack', 'missionPack', missionPacks),
        filterSel('Primary', 'primaryMission', primaryMissions),
        filterSel('Deployment', 'deploymentMap', deploymentMaps),
        dateInput('From', 'dateFrom'),
        dateInput('To', 'dateTo'),
        state.user?.role === 'admin' ? includeHiddenSel : null,
      ].filter(Boolean)),
    ]),
  ]);

  const tablePanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Games'),
      state.user ? el('a', { class: 'btn primary small', href: '#/games/new' }, 'New Game') : null,
    ].filter(Boolean)),
    el('div', { class: 'panel-body' }, [el('div', { id: 'games-table' }, 'Loading…')]),
  ]);

  root.appendChild(filterPanel);
  root.appendChild(tablePanel);

  async function refresh() {
    const tbl = root.querySelector('#games-table');
    clear(tbl);
    tbl.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    const list = await games.list(filterState);
    clear(tbl);
    tbl.appendChild(buildTable(list));
  }

  // Live update: another browser saves a game → our list re-fetches.
  // The listener self-removes when the view's root is no longer attached
  // (renderShell replaces the page on every navigation), so we don't need
  // to track it in app.js or accumulate listeners across routes.
  const liveHandler = () => {
    if (!document.body.contains(root)) {
      document.removeEventListener('live:game.saved', liveHandler);
      return;
    }
    refresh().catch(() => {});
  };
  document.addEventListener('live:game.saved', liveHandler);

  await refresh();
  return root;
}

// ── Thumbnail hover preview ──────────────────────────────────
// Shows an enlarged copy of the row thumbnail beside the cursor. Appended to
// <body> because .panel is overflow:hidden and would clip anything grown
// inside the table. Reuses the already-loaded 400px thumb file, so it needs no
// extra request and pops up instantly.
const HOVER_DELAY_MS = 130;
// Breathing room left around the preview so it never looks jammed against an
// edge. The preview otherwise grows until it hits whichever viewport dimension
// runs out first.
const PREVIEW_CUSHION_PX = 28;
// The tile's own padding + border, which sit outside the <img> box.
const PREVIEW_CHROME_PX = 10;

// Largest image box that fits the window with the cushion (and the tile's own
// chrome) subtracted. Floors guard against a comically small window rather than
// producing a negative box.
function previewBounds() {
  const spare = PREVIEW_CUSHION_PX * 2 + PREVIEW_CHROME_PX;
  return {
    w: Math.max(160, window.innerWidth - spare),
    h: Math.max(120, window.innerHeight - spare),
  };
}

let previewEl = null;
let previewTimer = null;

function hidePreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
  if (previewEl) { previewEl.remove(); previewEl = null; }
}

// `src` is the small thumb (already cached, shows instantly); `fullSrc` is the
// full-resolution file, fetched only once someone actually lingers, and swapped
// in when it arrives so a large preview isn't a blown-up 400px thumbnail.
function showPreview(anchor, src, fullSrc) {
  const probe = new Image();
  probe.src = src;

  const place = () => {
    // The anchor can be gone by now (list refreshed, or the pointer left
    // during decode) — bail rather than positioning against a stale rect.
    if (!document.body.contains(anchor)) return;
    const nw = probe.naturalWidth || 4;
    const nh = probe.naturalHeight || 3;
    // Fit-to-box on BOTH axes, so a panorama is limited by width and a portrait
    // shot by height — whichever runs out first. Upscaling past the thumb's own
    // 400px is fine: the full-resolution file swaps in below.
    const bounds = previewBounds();
    const scale = Math.min(bounds.w / nw, bounds.h / nh);
    const w = Math.round(nw * scale);
    const h = Math.round(nh * scale);

    const imgEl = el('img', { src, alt: '', width: String(w), height: String(h) });
    const box = el('div', { class: 'thumb-preview' }, imgEl);
    document.body.appendChild(box);

    if (fullSrc && fullSrc !== src) {
      const hi = new Image();
      hi.src = fullSrc;
      hi.addEventListener('load', () => {
        if (document.body.contains(box)) imgEl.src = fullSrc;
      }, { once: true });
    }

    const r = anchor.getBoundingClientRect();
    const pad = PREVIEW_CUSHION_PX;
    const gap = 12;

    // Prefer sitting beside the row. Once the preview is most of the screen
    // there is no "beside" left, so fall back to centring it rather than
    // shoving it against an edge.
    let left;
    let origin;
    if (r.right + gap + w + pad <= window.innerWidth) {
      left = r.right + gap;
      origin = 'left center';
    } else if (r.left - gap - w >= pad) {
      left = r.left - gap - w;
      origin = 'right center';
    } else {
      left = Math.round((window.innerWidth - w) / 2);
      origin = 'center center';
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

    // Vertically centred on the row, then clamped into the cushion; a preview
    // taller than the window simply pins to the top of it.
    let top = r.top + r.height / 2 - h / 2;
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));

    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
    box.style.transformOrigin = origin;
    previewEl = box;
    requestAnimationFrame(() => box.classList.add('is-in'));
  };

  if (probe.complete) place();
  else probe.addEventListener('load', place, { once: true });
}

function attachHoverPreview(imgEl, src, fullSrc) {
  // Touch devices fire synthetic hover on tap, which would leave a preview
  // stranded over the page while navigating.
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  imgEl.addEventListener('mouseenter', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => showPreview(imgEl, src, fullSrc), HOVER_DELAY_MS);
  });
  imgEl.addEventListener('mouseleave', hidePreview);
}

// A preview anchored to a rect that just moved would float in the wrong place.
window.addEventListener('scroll', hidePreview, { passive: true, capture: true });
window.addEventListener('resize', hidePreview, { passive: true });

// 10e has one mission for the game; 11e gives each player their own (decided by
// the Force Disposition pairing), so there's nothing to show in a single slot —
// render it as the matchup instead. Falls back to whichever side is known so a
// half-filled game still says something useful rather than just '—'.
function missionLabel(g, p1, p2) {
  if (g.edition !== '11') return g.primary_mission || '—';
  const a = p1?.primaryMission;
  const b = p2?.primaryMission;
  if (a && b) return `${a} vs ${b}`;
  return a || b || '—';
}

function previewThumb({ src, fullSrc, alt, cls }) {
  const im = el('img', { class: `list-thumb ${cls || ''}`.trim(), src, alt: alt || '', loading: 'lazy' });
  attachHoverPreview(im, src, fullSrc);
  return im;
}

// Two thumbnails per row: the game's cover photo, and a picture of the terrain
// layout it was played on. Either can be absent.
// Chess-clock time per player, mirroring the "A vs B" name order above it. Only
// rendered when someone actually clocked the game — an untimed game shows
// nothing rather than a row of dashes.
function clockLine(p1, p2) {
  const a = p1?.timeSeconds;
  const b = p2?.timeSeconds;
  if (a == null && b == null) return null;
  const dash = '—';
  return el('div', { class: 'dim tabular', style: { fontSize: '11px' } },
    `\u23F1 ${fmtDuration(a) ?? dash} vs ${fmtDuration(b) ?? dash}`);
}

function thumbCell(g) {
  const tiles = [];
  if (g.thumb_name) {
    tiles.push(el('span', { class: 'list-thumb-wrap' }, [
      previewThumb({
        src: gameImages.url(g.id, g.thumb_name),
        fullSrc: g.cover_file_name ? gameImages.url(g.id, g.cover_file_name) : null,
        alt: 'Game photo',
      }),
      g.image_count > 1 ? el('span', { class: 'list-thumb-count' }, String(g.image_count)) : null,
    ].filter(Boolean)));
  }
  // A photo tagged MAP on this game wins; otherwise fall back to the picture
  // attached to the layout itself, which is shared by every game played on it.
  const mapSrc = g.map_photo_thumb
    ? { src: gameImages.url(g.id, g.map_photo_thumb),
        full: g.map_photo_file ? gameImages.url(g.id, g.map_photo_file) : null }
    : (g.map_thumb_name
        ? { src: mapImages.url(g.map_thumb_name),
            full: g.map_image_name ? mapImages.url(g.map_image_name) : null }
        : null);

  if (mapSrc) {
    tiles.push(el('span', { class: 'list-thumb-wrap', title: g.deployment_map || 'Terrain layout' }, [
      previewThumb({
        src: mapSrc.src,
        fullSrc: mapSrc.full,
        alt: g.deployment_map || 'Terrain layout',
        cls: 'is-map',
      }),
      el('span', { class: 'list-thumb-tag' }, 'MAP'),
    ]));
  }
  if (!tiles.length) return el('span', { class: 'list-thumb placeholder' }, '');
  return el('span', { class: 'list-thumb-cell' }, tiles);
}

function buildTable(list) {
  if (!list.length) return el('div', { class: 'muted' }, 'No games match these filters.');
  const head = el('thead', {}, el('tr', {}, [
    el('th', { style: { width: '104px' } }, ''),
    el('th', {}, 'Date'),
    el('th', {}, 'Players'),
    el('th', {}, 'Factions'),
    el('th', {}, 'Mission'),
    el('th', { style: { textAlign: 'right' } }, 'Score'),
    el('th', {}, 'Format'),
    el('th', {}, ''),
  ]));
  const body = el('tbody', {}, list.map(g => {
    const players = (g.players || []);
    const p1 = players[0] || {};
    const p2 = players[1] || {};
    const playersText = `${p1.displayName || '?'} vs ${p2.displayName || '?'}`;
    const factions = `${p1.factionName || '—'} / ${p2.factionName || '—'}`;
    const score = `${p1.finalScore ?? '–'} – ${p2.finalScore ?? '–'}`;
    const winner = p1.result === 'win' ? p1 : p2.result === 'win' ? p2 : null;
    const tr = el('tr', { class: 'row-link', onClick: () => window.__nav('/games/' + g.id) }, [
      el('td', {}, thumbCell(g)),
      el('td', {}, fmtDate(g.played_at)),
      el('td', {}, [
        playersText,
        clockLine(p1, p2),
        winner ? el('div', { class: 'dim', style: { fontSize: '11px' } }, `Won: ${winner.displayName}`) : null,
      ].filter(Boolean)),
      el('td', { class: 'muted' }, factions),
      el('td', {}, [
        missionLabel(g, p1, p2),
        g.deployment_map ? el('div', { class: 'dim', style: { fontSize: '11px' } }, g.deployment_map) : null,
      ].filter(Boolean)),
      el('td', { class: 'tabular', style: { textAlign: 'right' } }, score),
      el('td', {}, [
        pill(g.game_format, ''),
        ' ',
        pill(g.edition === '11' ? '11e' : '10e', ''),
        g.play_medium === 'digital' ? ' ' : null,
        g.play_medium === 'digital' ? pill('Digital', '') : null,
        g.hidden_from_stats ? ' ' : null,
        g.hidden_from_stats ? pill('Hidden', 'hidden') : null,
      ].filter(Boolean)),
      el('td', {}, el('a', { class: 'btn small', href: '#/games/' + g.id, onClick: (e) => e.stopPropagation() }, 'View')),
    ]);
    return tr;
  }));
  return el('table', {}, [head, body]);
}
