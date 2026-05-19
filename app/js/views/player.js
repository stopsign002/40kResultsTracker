import { stats } from '../api.js';
import { el, clear, pill } from '../components.js';

export async function renderPlayer(_state, playerKey) {
  const root = el('div', { class: 'fade-in' });
  let data;
  try {
    data = await stats.player(playerKey);
  } catch (e) {
    root.appendChild(el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Player')),
      el('div', { class: 'panel-body muted' }, e.status === 404 ? 'Player not found.' : `Failed to load: ${e.message}`),
    ]));
    return root;
  }

  const displayName = data.army_name || data.player_name;
  const subtitle = data.army_name ? `aka ${data.player_name}` : '';

  const header = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Player Profile'),
      el('a', { class: 'btn small', href: '#/stats' }, '← Back to Stats'),
    ]),
    el('div', { class: 'panel-body' }, [
      el('h1', { style: { marginBottom: '4px' } }, displayName),
      subtitle ? el('div', { class: 'muted', style: { marginBottom: '14px' } }, subtitle) : null,
      buildKpiRow(data),
    ].filter(Boolean)),
  ]);

  const factionPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'By Faction'),
    buildFactionTable(data.by_faction),
  ]);

  const recordsPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Records'),
    buildRecordsList(data),
  ]);

  const grid = el('div', { class: 'stats-grid' }, [factionPanel, recordsPanel]);

  root.appendChild(header);
  root.appendChild(grid);
  return root;
}

function buildKpiRow(d) {
  const streakLabel = d.current_streak > 0
    ? `W${d.current_streak}`
    : d.current_streak < 0 ? `L${Math.abs(d.current_streak)}` : '–';
  const streakClass = d.current_streak > 0 ? 'win' : d.current_streak < 0 ? 'loss' : '';
  return el('div', { class: 'kpi-row' }, [
    kpi('Games', d.games),
    kpi('Win Rate', d.games ? `${d.win_rate}%` : '–'),
    kpi('W / L / D', `${d.wins}/${d.losses}/${d.draws}`),
    kpi('Avg Score', d.avg_score ?? '–'),
    kpi('Current Streak', streakLabel, streakClass),
  ]);
}

function kpi(label, value, kindClass = '') {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'label' }, label),
    el('div', { class: `value ${kindClass}` }, String(value ?? '–')),
  ]);
}

function buildFactionTable(rows) {
  if (!rows.length) return el('div', { class: 'muted' }, 'No faction games yet.');
  return el('table', {}, [
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Faction'),
      el('th', { style: { textAlign: 'right' } }, 'Games'),
      el('th', { style: { textAlign: 'right' } }, 'W/L/D'),
      el('th', { style: { textAlign: 'right' } }, 'Win %'),
    ])),
    el('tbody', {}, rows.map(r => el('tr', {
      class: 'row-link',
      onClick: () => { window.__nav('/games?playerFaction=' + r.faction_id); },
    }, [
      el('td', {}, r.faction),
      el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(r.games)),
      el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${r.wins}/${r.losses}/${r.draws}`),
      el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${r.win_rate}%`),
    ]))),
  ]);
}

function buildRecordsList(d) {
  const rows = [
    ['Best score', d.best_score ?? '–'],
    ['Longest win streak', d.longest_win_streak || 0],
    ['Longest loss streak', d.longest_loss_streak || 0],
    ['Biggest single-game margin (won by)', d.biggest_win_margin || 0],
    ['Biggest single-game margin (lost by)', d.biggest_loss_margin || 0],
  ];
  return el('div', {}, rows.map(([k, v]) => el('div', { class: 'bar-row', style: { borderBottom: '1px solid var(--border)', paddingBottom: '6px' } }, [
    el('div', { class: 'label', style: { width: '70%' } }, k),
    el('div', { class: 'tabular', style: { fontWeight: '700', color: 'var(--accent)' } }, String(v)),
  ])));
}
