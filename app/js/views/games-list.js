import { games, reference } from '../api.js';
import { el, clear, fmtDate, pill, selectOptions } from '../components.js';

const filterState = {
  format: '', missionPack: '', primaryMission: '', deploymentMap: '',
  playerUserId: '', playerFaction: '', opponentFaction: '',
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

  const [factions, missionPacks, users] = await Promise.all([
    reference.factions(),
    reference.missionPacks(),
    reference.users(),
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
        filterSel('Player', 'playerUserId', users, 'id', 'display_name'),
        filterSel('Faction', 'playerFaction', factions),
        filterSel('Vs Faction', 'opponentFaction', factions),
        formatSel,
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
      el('a', { class: 'btn primary small', href: '#/games/new' }, 'New Game'),
    ]),
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

function buildTable(list) {
  if (!list.length) return el('div', { class: 'muted' }, 'No games match these filters.');
  const head = el('thead', {}, el('tr', {}, [
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
      el('td', {}, fmtDate(g.played_at)),
      el('td', {}, [
        playersText,
        winner ? el('div', { class: 'dim', style: { fontSize: '11px' } }, `Won: ${winner.displayName}`) : null,
      ].filter(Boolean)),
      el('td', { class: 'muted' }, factions),
      el('td', {}, [
        g.primary_mission || '—',
        g.deployment_map ? el('div', { class: 'dim', style: { fontSize: '11px' } }, g.deployment_map) : null,
      ].filter(Boolean)),
      el('td', { class: 'tabular', style: { textAlign: 'right' } }, score),
      el('td', {}, [
        pill(g.game_format, ''),
        g.hidden_from_stats ? ' ' : null,
        g.hidden_from_stats ? pill('Hidden', 'hidden') : null,
      ].filter(Boolean)),
      el('td', {}, el('a', { class: 'btn small', href: '#/games/' + g.id, onClick: (e) => e.stopPropagation() }, 'View')),
    ]);
    return tr;
  }));
  return el('table', {}, [head, body]);
}
