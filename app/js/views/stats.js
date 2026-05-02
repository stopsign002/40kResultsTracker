import { stats, reference } from '../api.js';
import { el, clear } from '../components.js';

const chartTheme = {
  text: '#e0e0e0',
  muted: '#a8a8a8',
  border: '#3a3a44',
  panel: '#22222a',
  accent: '#ffffff',
  success: '#2ecc71',
  warning: '#f39c12',
  danger: '#e74c3c',
  info: '#5dade2',
};

if (typeof Chart !== 'undefined') {
  Chart.defaults.color = chartTheme.text;
  Chart.defaults.borderColor = chartTheme.border;
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif';
}

export async function renderStats(_state) {
  const root = el('div', { class: 'fade-in' });

  const [overview, factionWR, playerWR, factions, firstTurn, secondaryAvg] = await Promise.all([
    stats.overview(),
    stats.factionWinRates(),
    stats.playerWinRates(),
    reference.factions(),
    stats.firstTurnImpact(),
    stats.secondaryAverages(),
  ]);

  // ── KPI row ─────────────────────────────────────────────
  const kpiRow = el('div', { class: 'kpi-row', style: { marginBottom: '20px' } }, [
    kpi('Total Games', overview.total_games),
    kpi('Active Players', overview.active_players),
    kpi('Tracked Factions', factionWR.length),
    kpi('First-Turn Win %', firstTurnRate(firstTurn)),
  ]);

  // ── Faction win rates chart + bar list ─────────────────
  const factionChartCanvas = el('canvas', { id: 'faction-wr-chart', height: '260' });
  const factionPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Faction Win Rates'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } }, 'Win % across all tracked games (excludes hidden)'),
    factionChartCanvas,
  ]);

  // ── Player win rates ───────────────────────────────────
  const playerCanvas = el('canvas', { id: 'player-wr-chart', height: '260' });
  const playerPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Player Win Rates'),
    playerCanvas,
  ]);

  // ── First turn impact ──────────────────────────────────
  const firstTurnCanvas = el('canvas', { id: 'first-turn-chart', height: '220' });
  const firstTurnPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Going First vs Second'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } }, 'Win % and avg score depending on turn order'),
    firstTurnCanvas,
  ]);

  // ── Faction explorer (drilldown) ───────────────────────
  const factionSel = el('select', {}, [
    el('option', { value: '' }, '— Choose a faction —'),
    ...factions.map(f => el('option', { value: f.id }, f.name)),
  ]);
  const drilldownBody = el('div', {}, el('div', { class: 'muted' }, 'Pick a faction to see its mission and deployment breakdown.'));
  factionSel.addEventListener('change', async () => {
    if (!factionSel.value) { clear(drilldownBody); drilldownBody.appendChild(el('div', { class: 'muted' }, 'Pick a faction.')); return; }
    clear(drilldownBody);
    drilldownBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    const [mb, db] = await Promise.all([
      stats.factionMissionBreakdown(factionSel.value),
      stats.factionDeploymentBreakdown(factionSel.value),
    ]);
    clear(drilldownBody);
    drilldownBody.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' } }, [
      breakdownTable('By Primary Mission', mb, 'primary_mission'),
      breakdownTable('By Deployment Map', db, 'deployment_map'),
    ]));
  });
  const drilldownPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Faction Drilldown'),
    el('div', { class: 'form-group', style: { marginBottom: '12px' } }, [
      el('label', {}, 'Faction'),
      factionSel,
    ]),
    drilldownBody,
  ]);

  // ── Secondary averages ─────────────────────────────────
  const secondaryPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Secondary Averages'),
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'Card'),
        el('th', { style: { textAlign: 'right' } }, 'Picks'),
        el('th', { style: { textAlign: 'right' } }, 'Avg'),
        el('th', { style: { textAlign: 'right' } }, 'Best'),
      ])),
      el('tbody', {}, secondaryAvg.slice(0, 30).map(s => el('tr', {}, [
        el('td', {}, s.card_name),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(s.picks)),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(s.avg_score)),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(s.max_score ?? '–')),
      ]))),
    ]),
  ]);

  const grid = el('div', { class: 'stats-grid' }, [
    factionPanel, playerPanel, firstTurnPanel, drilldownPanel, secondaryPanel,
  ]);

  root.appendChild(kpiRow);
  root.appendChild(grid);

  // Wire charts after DOM is in document
  setTimeout(() => {
    drawFactionChart(factionChartCanvas, factionWR);
    drawPlayerChart(playerCanvas, playerWR);
    drawFirstTurnChart(firstTurnCanvas, firstTurn);
  }, 30);

  return root;
}

function kpi(label, value) {
  return el('div', { class: 'kpi' }, [
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value ?? '0')),
  ]);
}

function firstTurnRate(rows) {
  const r = rows.find(x => x.went_first);
  return r ? `${r.win_rate}%` : '—';
}

function breakdownTable(title, rows, key) {
  if (!rows.length) {
    return el('div', {}, [el('h3', {}, title), el('div', { class: 'muted' }, 'No data yet.')]);
  }
  const node = el('div', {}, [
    el('h3', {}, title),
    el('div', {}, rows.map(r => el('div', { class: 'bar-row' }, [
      el('div', { class: 'label' }, r[key] || '—'),
      el('div', { class: 'bar-wrap' }, el('div', { class: 'bar', style: { width: '0%' } })),
      el('div', { class: 'num' }, `${r.win_rate}% (${r.games})`),
    ]))),
  ]);
  setTimeout(() => {
    node.querySelectorAll('.bar').forEach((bar, i) => {
      bar.style.width = `${rows[i].win_rate}%`;
    });
  }, 60);
  return node;
}

function drawFactionChart(canvas, rows) {
  if (!rows.length) return;
  const top = rows.slice(0, 18);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top.map(r => r.faction),
      datasets: [{
        label: 'Win %',
        data: top.map(r => r.win_rate),
        backgroundColor: top.map(r => colorFor(r.win_rate)),
        borderColor: chartTheme.border,
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true,
      indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      scales: {
        x: { min: 0, max: 100, grid: { color: chartTheme.border }, ticks: { color: chartTheme.muted, callback: (v) => v + '%' } },
        y: { grid: { color: chartTheme.border }, ticks: { color: chartTheme.text } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: chartTheme.panel,
          borderColor: chartTheme.accent, borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const r = top[ctx.dataIndex];
              return `${r.win_rate}% (${r.wins}-${r.losses}-${r.draws} in ${r.games})`;
            },
          },
        },
      },
    },
  });
}

function drawPlayerChart(canvas, rows) {
  if (!rows.length) return;
  const top = rows.slice(0, 18);
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top.map(r => r.player_name),
      datasets: [
        { label: 'Wins', data: top.map(r => r.wins), backgroundColor: chartTheme.success },
        { label: 'Losses', data: top.map(r => r.losses), backgroundColor: chartTheme.danger },
        { label: 'Draws', data: top.map(r => r.draws), backgroundColor: chartTheme.warning },
      ],
    },
    options: {
      responsive: true,
      animation: { duration: 900, easing: 'easeOutQuart' },
      scales: {
        x: { stacked: true, grid: { color: chartTheme.border }, ticks: { color: chartTheme.text } },
        y: { stacked: true, grid: { color: chartTheme.border }, ticks: { color: chartTheme.muted } },
      },
      plugins: {
        legend: { labels: { color: chartTheme.text } },
        tooltip: { backgroundColor: chartTheme.panel, borderColor: chartTheme.accent, borderWidth: 1 },
      },
    },
  });
}

function drawFirstTurnChart(canvas, rows) {
  if (!rows.length) return;
  const labels = rows.map(r => r.went_first ? 'Went First' : 'Went Second');
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Win %', data: rows.map(r => r.win_rate), backgroundColor: chartTheme.info, yAxisID: 'y' },
        { label: 'Avg Score', data: rows.map(r => parseFloat(r.avg_score)), backgroundColor: chartTheme.warning, yAxisID: 'y2' },
      ],
    },
    options: {
      responsive: true,
      animation: { duration: 900, easing: 'easeOutQuart' },
      scales: {
        x: { ticks: { color: chartTheme.text } },
        y: { type: 'linear', position: 'left', min: 0, max: 100, ticks: { color: chartTheme.muted, callback: v => v + '%' } },
        y2: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: chartTheme.muted } },
      },
      plugins: {
        legend: { labels: { color: chartTheme.text } },
        tooltip: { backgroundColor: chartTheme.panel, borderColor: chartTheme.accent, borderWidth: 1 },
      },
    },
  });
}

function colorFor(pct) {
  if (pct >= 60) return chartTheme.success;
  if (pct >= 45) return chartTheme.info;
  if (pct >= 35) return chartTheme.warning;
  return chartTheme.danger;
}
