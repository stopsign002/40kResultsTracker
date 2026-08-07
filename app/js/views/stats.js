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

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Every chart runs maintainAspectRatio:false inside a .stats-chart box, so the
// proportions come from CSS instead of the canvas element's 300x150 default.
// A category chart therefore gets a row's worth of height per category rather
// than however many pixels the aspect ratio happened to leave it.
const CHART_ROW_PX = 28;
function rowChartHeight(rowCount, chrome) {
  return Math.max(200, rowCount * CHART_ROW_PX + chrome) + 'px';
}

function tableScroll(table) {
  return el('div', { class: 'stats-scroll' }, table);
}

export async function renderStats(_state) {
  const root = el('div', { class: 'fade-in stats-view' });

  const [overview, factionWR, playerWR, factions, firstTurn, secondaryAvg, matchups, trends, calendar] = await Promise.all([
    stats.overview(),
    stats.factionWinRates(),
    stats.playerWinRates(),
    reference.factions(),
    stats.firstTurnImpact(),
    stats.secondaryAverages(),
    stats.factionMatchups(),
    stats.trends(),
    stats.calendar(),
  ]);

  // ── KPI row ─────────────────────────────────────────────
  const kpiRow = el('div', { class: 'kpi-row', style: { marginBottom: '20px' } }, [
    kpi('Total Games', overview.total_games),
    kpi('Active Players', overview.active_players),
    kpi('Tracked Factions', factionWR.length),
    kpi('First-Turn Win %', firstTurnRate(firstTurn)),
  ]);

  // ── Faction win rates ──────────────────────────────────
  // Click-to-filter: clicking a bar jumps to the games list for that faction.
  const factionRows = Math.min(factionWR.length, 18);
  const factionChartCanvas = el('canvas', { id: 'faction-wr-chart' });
  const factionPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Faction Win Rates'),
    el('div', { class: 'stats-hint' }, 'Tap a bar to see those games. Excludes hidden games.'),
    el('div', { class: 'stats-chart', style: { height: rowChartHeight(factionRows, 48) } }, factionChartCanvas),
  ]);

  // ── Player win rates ───────────────────────────────────
  // Names link out to /players/:key profile pages.
  const playerRows = Math.min(playerWR.length, 18);
  const playerCanvas = el('canvas', { id: 'player-wr-chart' });
  const playerPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Player Win Rates'),
    el('div', { class: 'stats-hint' }, 'Tap a name below for full profile + streaks.'),
    el('div', { class: 'stats-chart', style: { height: rowChartHeight(playerRows, 64) } }, playerCanvas),
    buildPlayerLinks(playerWR),
  ]);

  // ── First turn impact ──────────────────────────────────
  const firstTurnCanvas = el('canvas', { id: 'first-turn-chart' });
  const firstTurnPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Going First vs Second'),
    el('div', { class: 'stats-hint' }, 'Win % and avg score depending on turn order'),
    el('div', { class: 'stats-chart' }, firstTurnCanvas),
  ]);

  // ── Faction matchup heatmap ─────────────────────────────
  const matchupPanel = el('div', { class: 'stat-card stats-span' }, [
    el('h3', {}, 'Faction Matchup Matrix'),
    el('div', { class: 'stats-hint spaced' },
      'Row vs column. Green = row faction wins more often, red = loses, grey = small sample. Tap a cell for those games.'),
    buildMatchupHeatmap(matchups, factions),
  ]);

  // ── Calendar heatmap ────────────────────────────────────
  const calendarPanel = el('div', { class: 'stat-card stats-span' }, [
    el('h3', {}, 'Activity Calendar'),
    el('div', { class: 'stats-hint spaced' },
      'Days played in the last year. Pick a day to see what was played on it.'),
    buildCalendarHeatmap(calendar),
  ]);

  // ── Trends over time ────────────────────────────────────
  const trendsCanvas = el('canvas', { id: 'trends-chart' });
  const factionTrendCanvas = el('canvas', { id: 'faction-trend-chart' });
  const trendsPanel = el('div', { class: 'stat-card stats-span' }, [
    el('h3', {}, 'Trends Over Time'),
    el('div', { class: 'stats-hint' }, 'Monthly games played and average final score. Faction popularity below.'),
    el('div', { class: 'stats-chart' }, trendsCanvas),
    el('div', { class: 'stats-chart is-tall is-stacked' }, factionTrendCanvas),
  ]);

  // ── Faction explorer (drilldown) ───────────────────────
  const factionSel = el('select', {}, [
    el('option', { value: '' }, '— Choose a faction —'),
    ...factions.map(f => el('option', { value: f.id }, f.name)),
  ]);
  const drilldownBody = el('div', {},
    el('div', { class: 'muted' }, 'Pick a faction to see its mission, deployment, and detachment breakdown.'));
  factionSel.addEventListener('change', async () => {
    if (!factionSel.value) {
      clear(drilldownBody);
      drilldownBody.appendChild(el('div', { class: 'muted' }, 'Pick a faction.'));
      return;
    }
    clear(drilldownBody);
    drilldownBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    const [mb, db, dwr] = await Promise.all([
      stats.factionMissionBreakdown(factionSel.value),
      stats.factionDeploymentBreakdown(factionSel.value),
      stats.detachmentWinRates(factionSel.value),
    ]);
    clear(drilldownBody);
    drilldownBody.appendChild(el('div', { class: 'stats-cols-2' }, [
      breakdownTable('By Primary Mission', mb, 'primary_mission'),
      breakdownTable('By Deployment Map', db, 'deployment_map'),
    ]));
    drilldownBody.appendChild(el('div', { style: { marginTop: '18px' } },
      detachmentTable(dwr)));
  });
  const drilldownPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Faction Drilldown'),
    el('div', { class: 'form-group', style: { marginBottom: '12px' } }, [
      el('label', {}, 'Faction'),
      factionSel,
    ]),
    drilldownBody,
  ]);

  // ── Head-to-head viewer ─────────────────────────────────
  const h2hPanel = buildHeadToHeadPanel(playerWR);

  // ── Secondary averages ─────────────────────────────────
  const secondaryPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Secondary Averages'),
    tableScroll(el('table', {}, [
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
    ])),
  ]);

  const grid = el('div', { class: 'stats-grid' }, [
    factionPanel, playerPanel, firstTurnPanel, h2hPanel, drilldownPanel, secondaryPanel, calendarPanel, matchupPanel, trendsPanel,
  ]);

  root.appendChild(kpiRow);
  root.appendChild(grid);

  // Wire charts after DOM is in document
  setTimeout(() => {
    drawFactionChart(factionChartCanvas, factionWR);
    drawPlayerChart(playerCanvas, playerWR);
    drawFirstTurnChart(firstTurnCanvas, firstTurn);
    drawTrendsChart(trendsCanvas, trends);
    drawFactionTrendChart(factionTrendCanvas, trends);
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

function buildPlayerLinks(rows) {
  if (!rows.length) return el('div', {});
  return el('div', { class: 'stats-player-links' },
    rows.slice(0, 18).map(r => el('a', {
      class: 'btn small',
      href: '#/players/' + encodeURIComponent(r.player_key),
    }, `${r.player_name} (${r.win_rate}%)`)));
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

function detachmentTable(rows) {
  if (!rows.length) {
    return el('div', {}, [el('h3', {}, 'By Detachment'), el('div', { class: 'muted' }, 'No detachment data yet.')]);
  }
  return el('div', {}, [
    el('h3', {}, 'By Detachment'),
    tableScroll(el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'Detachment'),
        el('th', { style: { textAlign: 'right' } }, 'Games'),
        el('th', { style: { textAlign: 'right' } }, 'W/L/D'),
        el('th', { style: { textAlign: 'right' } }, 'Win %'),
        el('th', { style: { textAlign: 'right' } }, 'Avg'),
      ])),
      el('tbody', {}, rows.map(r => el('tr', {}, [
        el('td', {}, r.detachment),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(r.games)),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${r.wins}/${r.losses}/${r.draws}`),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${r.win_rate}%`),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(r.avg_score)),
      ]))),
    ])),
  ]);
}

// ── Faction matchup heatmap (#1) ─────────────────────────────
// Two presentations of the same numbers. The N×N grid is the desktop view;
// below 700px CSS swaps in the per-faction list, because 29 columns of 28px
// cells cannot be read — or hit — on a phone, and the grid's only affordance
// for "what is this cell" is a title tooltip, which touch never shows.
function buildMatchupHeatmap(matchups, factions) {
  if (!matchups.length) return el('div', { class: 'muted' }, 'No matchup data yet.');

  // Index matchups by (faction_a, faction_b)
  const idx = new Map();
  for (const m of matchups) {
    idx.set(`${m.faction_a}::${m.faction_b}`, m);
  }
  // Only include factions that have at least one game
  const activeIds = new Set();
  for (const m of matchups) { activeIds.add(m.faction_a); activeIds.add(m.faction_b); }
  const active = factions.filter(f => activeIds.has(f.id));

  return el('div', {}, [
    buildMatchupGrid(active, idx),
    buildMatchupList(active, idx, matchups),
  ]);
}

function buildMatchupGrid(active, idx) {
  const cellSize = 28;
  const labelW = 110;

  const wrapper = el('div', { class: 'stats-matchup-grid stats-scroll' });
  const grid = el('table', {
    style: {
      borderCollapse: 'separate',
      borderSpacing: '1px',
      fontSize: '10px',
      fontFamily: 'monospace',
    },
  });

  // Header row: column faction names rotated
  const thead = el('thead', {}, el('tr', {}, [
    el('th', { style: { width: labelW + 'px' } }),
    ...active.map(f => el('th', {
      style: {
        width: cellSize + 'px',
        height: '60px',
        verticalAlign: 'bottom',
        padding: '0',
      },
    }, el('div', {
      style: {
        writingMode: 'vertical-rl',
        transform: 'rotate(180deg)',
        textAlign: 'left',
        fontSize: '10px',
        color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      },
    }, f.name))),
  ]));

  const tbody = el('tbody', {}, active.map(rowFaction => el('tr', {},
    [
      el('td', {
        style: {
          width: labelW + 'px',
          paddingRight: '6px',
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          textAlign: 'right',
          fontSize: '10px',
        },
      }, rowFaction.name),
      ...active.map(colFaction => {
        const m = idx.get(`${rowFaction.id}::${colFaction.id}`);
        if (!m || !m.games) {
          return el('td', {
            title: rowFaction.id === colFaction.id ? 'mirror match' : 'no games',
            style: {
              width: cellSize + 'px', height: cellSize + 'px',
              background: 'var(--panel-alt)',
              border: '1px solid var(--border)',
            },
          });
        }
        const winPct = (m.wins / m.games) * 100;
        const alpha = Math.min(1, m.games / 5); // saturated at 5+ games
        const bg = matchupColor(winPct, alpha);
        return el('td', {
          title: `${rowFaction.name} vs ${colFaction.name}: ${m.wins}/${m.games} (${Math.round(winPct)}%)`,
          style: {
            width: cellSize + 'px', height: cellSize + 'px',
            background: bg,
            border: '1px solid var(--border)',
            textAlign: 'center',
            color: alpha > 0.6 ? '#fff' : 'var(--text-muted)',
            fontWeight: '600',
            cursor: 'pointer',
          },
          onClick: () => {
            window.__nav(`/games?playerFaction=${rowFaction.id}&opponentFaction=${colFaction.id}`);
          },
        }, String(m.games));
      }),
    ],
  )));

  grid.appendChild(thead);
  grid.appendChild(tbody);
  wrapper.appendChild(grid);
  return wrapper;
}

function buildMatchupList(active, idx, matchups) {
  const totals = new Map();
  for (const m of matchups) totals.set(m.faction_a, (totals.get(m.faction_a) || 0) + m.games);

  const sel = el('select', {}, active.map(f => el('option', { value: f.id }, f.name)));
  const busiest = active.slice().sort((a, b) => (totals.get(b.id) || 0) - (totals.get(a.id) || 0))[0];
  if (busiest) sel.value = String(busiest.id);

  const list = el('div', { class: 'stats-matchup-list' });

  function refresh() {
    const rowId = parseInt(sel.value, 10);
    clear(list);
    const rows = active
      .map(col => ({ col, m: idx.get(`${rowId}::${col.id}`) }))
      .filter(r => r.m && r.m.games)
      .sort((a, b) => b.m.games - a.m.games || (b.m.wins / b.m.games) - (a.m.wins / a.m.games));
    if (!rows.length) {
      list.appendChild(el('div', { class: 'muted' }, 'No recorded matchups for this faction yet.'));
      return;
    }
    for (const { col, m } of rows) {
      const winPct = (m.wins / m.games) * 100;
      list.appendChild(el('button', {
        class: 'stats-matchup-row',
        type: 'button',
        onClick: () => window.__nav(`/games?playerFaction=${rowId}&opponentFaction=${col.id}`),
      }, [
        el('span', { class: 'stats-matchup-name' }, `vs ${col.name}`),
        el('span', { class: 'stats-matchup-meter' },
          el('i', { style: { width: Math.round(winPct) + '%', background: matchupColor(winPct, 1) } })),
        el('span', { class: 'stats-matchup-num tabular' }, `${Math.round(winPct)}% · ${m.games}g`),
      ]));
    }
  }
  sel.addEventListener('change', refresh);
  refresh();

  return el('div', { class: 'stats-matchup-mobile' }, [
    el('div', { class: 'form-group' }, [el('label', {}, 'Faction'), sel]),
    list,
  ]);
}

function matchupColor(winPct, alpha) {
  // Red (lose) → grey (50/50) → green (win), interpolated
  let r, g, b;
  if (winPct >= 50) {
    const t = (winPct - 50) / 50;
    r = Math.round(120 + (46 - 120) * t);
    g = Math.round(120 + (204 - 120) * t);
    b = Math.round(120 + (113 - 120) * t);
  } else {
    const t = (50 - winPct) / 50;
    r = Math.round(120 + (231 - 120) * t);
    g = Math.round(120 + (76 - 120) * t);
    b = Math.round(120 + (60 - 120) * t);
  }
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

// ── Head-to-head viewer (#2) ─────────────────────────────────
function buildHeadToHeadPanel(playerWR) {
  // Only include user-keyed players (head-to-head endpoint takes user IDs)
  const users = playerWR.filter(p => String(p.player_key).startsWith('user:'))
    .map(p => ({
      id: parseInt(String(p.player_key).slice(5), 10),
      name: p.player_name,
    }));

  const selA = el('select', {}, [
    el('option', { value: '' }, '— Player A —'),
    ...users.map(u => el('option', { value: u.id }, u.name)),
  ]);
  const selB = el('select', {}, [
    el('option', { value: '' }, '— Player B —'),
    ...users.map(u => el('option', { value: u.id }, u.name)),
  ]);

  const body = el('div', {}, el('div', { class: 'muted' }, 'Pick two players to see their head-to-head record.'));

  async function load() {
    if (!selA.value || !selB.value || selA.value === selB.value) {
      clear(body);
      body.appendChild(el('div', { class: 'muted' }, 'Pick two different players.'));
      return;
    }
    clear(body);
    body.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const games = await stats.headToHead(selA.value, selB.value);
      clear(body);
      if (!games.length) {
        body.appendChild(el('div', { class: 'muted' }, 'No games on record between these two yet.'));
        return;
      }
      const winsA = games.filter(g => g.result_a === 'win').length;
      const winsB = games.filter(g => g.result_b === 'win').length;
      const draws = games.filter(g => g.result_a === 'draw').length;
      const nameA = users.find(u => u.id == selA.value)?.name || '?';
      const nameB = users.find(u => u.id == selB.value)?.name || '?';
      body.appendChild(el('div', { class: 'kpi-row', style: { marginBottom: '14px' } }, [
        kpi(nameA, winsA),
        kpi('Draws', draws),
        kpi(nameB, winsB),
      ]));
      body.appendChild(tableScroll(el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, 'Date'),
          el('th', {}, 'Mission'),
          el('th', {}, `${nameA} faction`),
          el('th', { style: { textAlign: 'right' } }, 'Score'),
          el('th', {}, `${nameB} faction`),
          el('th', {}, 'Winner'),
        ])),
        el('tbody', {}, games.map(g => el('tr', {
          class: 'row-link',
          onClick: () => window.__nav('/games/' + g.id),
        }, [
          el('td', {}, String(g.played_at).slice(0, 10)),
          el('td', { class: 'muted' }, g.primary_mission || '—'),
          el('td', {}, g.faction_a || '—'),
          el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${g.score_a} – ${g.score_b}`),
          el('td', {}, g.faction_b || '—'),
          el('td', {}, g.result_a === 'win' ? nameA : g.result_b === 'win' ? nameB : 'Draw'),
        ]))),
      ])));
    } catch (e) {
      clear(body);
      body.appendChild(el('div', { class: 'error-text' }, `Failed: ${e.message}`));
    }
  }
  selA.addEventListener('change', load);
  selB.addEventListener('change', load);

  return el('div', { class: 'stat-card stats-span' }, [
    el('h3', {}, 'Head-to-Head'),
    el('div', { class: 'form-row cols-2', style: { marginBottom: '12px' } }, [
      el('div', { class: 'form-group' }, [el('label', {}, 'Player A'), selA]),
      el('div', { class: 'form-group' }, [el('label', {}, 'Player B'), selB]),
    ]),
    body,
  ]);
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
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      onClick: (_e, items) => {
        // #32 — click a bar to filter games to that faction
        if (!items.length) return;
        const r = top[items[0].index];
        if (r) window.__nav('/games?playerFaction=' + r.faction_id);
      },
      onHover: (e, items) => {
        e.native.target.style.cursor = items.length ? 'pointer' : 'default';
      },
      scales: {
        x: {
          min: 0, max: 100,
          grid: { color: chartTheme.border },
          ticks: { color: chartTheme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 5, callback: (v) => v + '%' },
        },
        y: { grid: { color: chartTheme.border }, ticks: { color: chartTheme.text, autoSkip: false, crossAlign: 'far' } },
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

// Horizontal on every width: 18 player names on a category x-axis are illegible
// at phone width and merely cramped on a desktop card. The stacked W/L/D
// composition reads the same either way.
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
      maintainAspectRatio: false,
      indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      onClick: (_e, items) => {
        if (!items.length) return;
        const r = top[items[0].index];
        if (r) window.__nav('/players/' + encodeURIComponent(r.player_key));
      },
      onHover: (e, items) => {
        e.native.target.style.cursor = items.length ? 'pointer' : 'default';
      },
      scales: {
        x: {
          stacked: true, beginAtZero: true,
          grid: { color: chartTheme.border },
          ticks: { color: chartTheme.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, precision: 0 },
        },
        y: { stacked: true, grid: { color: chartTheme.border }, ticks: { color: chartTheme.text, autoSkip: false, crossAlign: 'far' } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTheme.text, boxWidth: 12, boxHeight: 12, padding: 10 } },
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
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart' },
      scales: {
        x: { ticks: { color: chartTheme.text, maxRotation: 0 } },
        y: { type: 'linear', position: 'left', min: 0, max: 100, ticks: { color: chartTheme.muted, maxTicksLimit: 5, callback: v => v + '%' } },
        y2: { type: 'linear', position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, ticks: { color: chartTheme.muted, maxTicksLimit: 5 } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTheme.text, boxWidth: 12, boxHeight: 12, padding: 10 } },
        tooltip: { backgroundColor: chartTheme.panel, borderColor: chartTheme.accent, borderWidth: 1 },
      },
    },
  });
}

function drawTrendsChart(canvas, trends) {
  const months = trends.monthlyGames.map(r => r.month);
  if (!months.length) return;
  // Align avg-score to months from monthlyGames
  const avgByMonth = new Map(trends.monthlyAvgScore.map(r => [r.month, parseFloat(r.avg_score)]));
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Games',
          data: trends.monthlyGames.map(r => r.games),
          borderColor: chartTheme.info,
          backgroundColor: 'rgba(93, 173, 226, 0.15)',
          yAxisID: 'y',
          tension: 0.25,
          fill: true,
        },
        {
          label: 'Avg Score',
          data: months.map(m => avgByMonth.get(m) ?? null),
          borderColor: chartTheme.warning,
          backgroundColor: 'transparent',
          yAxisID: 'y2',
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      scales: {
        x: { ticks: { color: chartTheme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { type: 'linear', position: 'left', beginAtZero: true, ticks: { color: chartTheme.muted, maxTicksLimit: 6, precision: 0 } },
        y2: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: chartTheme.muted, maxTicksLimit: 6 } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTheme.text, boxWidth: 12, boxHeight: 12, padding: 10 } },
        tooltip: { backgroundColor: chartTheme.panel, borderColor: chartTheme.accent, borderWidth: 1 },
      },
    },
  });
}

function drawFactionTrendChart(canvas, trends) {
  const series = trends.factionPopularity || [];
  if (!series.length) return;
  const months = [...new Set(series.map(r => r.month))].sort();
  const factionNames = [...new Set(series.map(r => r.faction))];
  const palette = ['#cc0000', '#004080', '#005500', '#cc7700', '#7b1fa2', '#2e7d7d', '#b8860b', '#aa2200'];
  const datasets = factionNames.map((name, i) => {
    const byMonth = new Map(series.filter(r => r.faction === name).map(r => [r.month, r.games]));
    return {
      label: name,
      data: months.map(m => byMonth.get(m) || 0),
      backgroundColor: palette[i % palette.length],
      borderColor: palette[i % palette.length],
      stack: 'pop',
    };
  });
  new Chart(canvas, {
    type: 'bar',
    data: { labels: months, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 700 },
      scales: {
        x: { stacked: true, ticks: { color: chartTheme.text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { stacked: true, beginAtZero: true, ticks: { color: chartTheme.muted, maxTicksLimit: 6, precision: 0 } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTheme.text, font: { size: 11 }, boxWidth: 10, boxHeight: 10, padding: 8 } },
        tooltip: { backgroundColor: chartTheme.panel, borderColor: chartTheme.accent, borderWidth: 1 },
        title: { display: true, text: 'Faction Popularity by Month (top 8)', color: chartTheme.text, font: { size: 13 } },
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

// ── Calendar heatmap (#9) ─────────────────────────────────
// GitHub-style: 7 rows (days of week, Sun → Sat), N columns (one per week
// in the requested range). Each cell shaded by game count for that day.
//
// A day cell is far too small to be a safe tap target and its title tooltip is
// invisible on touch, so tapping one no longer navigates — it selects, and the
// readout underneath carries the full-size button that does. The strip also
// starts scrolled to the present, which is the end a reader cares about.
function monthOf(dateStr) {
  return parseInt(dateStr.slice(5, 7), 10) - 1;
}

function buildCalendarHeatmap(data) {
  const days = data.days || 365;
  const rangeEnd = new Date(data.range_end || new Date().toISOString().slice(0, 10));
  // Snap to the most recent Saturday so the columns line up cleanly
  const end = new Date(rangeEnd);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (days + end.getDay()));

  const counts = new Map(data.rows.map(r => [r.date, r.games]));
  const maxCount = Math.max(1, ...data.rows.map(r => r.games));

  // Build columns
  const weeks = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      week.push({ date: dateStr, games: counts.get(dateStr) || 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  function shade(games) {
    if (!games) return '#22222a';
    const t = Math.min(1, games / maxCount);
    // Cyan ramp from dim to saturated
    const r = Math.round(40 + (120 - 40) * t);
    const g = Math.round(80 + (220 - 80) * t);
    const b = Math.round(120 + (255 - 120) * t);
    return `rgb(${r},${g},${b})`;
  }

  const readout = el('div', { class: 'stats-cal-readout' });
  let selectedCell = null;
  function select(day, cell) {
    if (selectedCell) selectedCell.classList.remove('is-selected');
    selectedCell = cell || null;
    if (selectedCell) selectedCell.classList.add('is-selected');
    clear(readout);
    if (!day) {
      readout.appendChild(el('span', { class: 'muted' }, 'Pick a lit day to see the games played on it.'));
      return;
    }
    readout.appendChild(el('span', { class: 'tabular' }, day.date));
    readout.appendChild(el('span', { class: 'muted' }, `${day.games} game${day.games === 1 ? '' : 's'}`));
    readout.appendChild(el('button', {
      class: 'btn small',
      type: 'button',
      onClick: () => window.__nav(`/games?dateFrom=${day.date}&dateTo=${day.date}`),
    }, 'View games'));
  }
  select(null, null);

  const dowLabels = el('div', { class: 'stats-cal-dow' },
    ['', 'Mon', '', 'Wed', '', 'Fri', ''].map(d => el('div', {}, d)));

  let lastLabelCol = -99;
  const monthRow = el('div', { class: 'stats-cal-months' }, weeks.map((week, i) => {
    const m = monthOf(week[0].date);
    const prev = i > 0 ? monthOf(weeks[i - 1][0].date) : -1;
    const show = m !== prev && i - lastLabelCol >= 3;
    if (show) lastLabelCol = i;
    return el('div', { class: 'stats-cal-month' }, show ? MONTH_NAMES[m] : '');
  }));

  const weeksContainer = el('div', { class: 'stats-cal-weeks' },
    weeks.map(week => el('div', { class: 'stats-cal-week' },
      week.map(day => {
        const label = `${day.date}: ${day.games} game${day.games === 1 ? '' : 's'}`;
        if (!day.games) {
          return el('div', { class: 'stats-cal-day', title: label, style: { background: shade(0) } });
        }
        const cell = el('button', {
          class: 'stats-cal-day',
          type: 'button',
          title: label,
          'aria-label': label,
          style: { background: shade(day.games) },
          onClick: () => select(day, cell),
        });
        return cell;
      }))));

  const scroller = el('div', { class: 'stats-cal-scroll stats-scroll' }, [monthRow, weeksContainer]);
  setTimeout(() => { scroller.scrollLeft = scroller.scrollWidth; }, 60);

  const legend = el('div', { class: 'stats-cal-legend' }, [
    el('span', {}, 'Less'),
    ...[0, 0.25, 0.5, 0.75, 1].map(t => el('div', {
      class: 'stats-cal-swatch',
      style: { background: shade(Math.round(t * maxCount)) },
    })),
    el('span', {}, 'More'),
  ]);

  return el('div', { class: 'stats-cal-panel' }, [
    el('div', { class: 'stats-cal' }, [dowLabels, scroller]),
    legend,
    readout,
  ]);
}
