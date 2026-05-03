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

  const [overview, factionWR, playerWR, factions, firstTurn, secondaryAvg, matchups, trends] = await Promise.all([
    stats.overview(),
    stats.factionWinRates(),
    stats.playerWinRates(),
    reference.factions(),
    stats.firstTurnImpact(),
    stats.secondaryAverages(),
    stats.factionMatchups(),
    stats.trends(),
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
  const factionChartCanvas = el('canvas', { id: 'faction-wr-chart', height: '260' });
  const factionPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Faction Win Rates'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } },
      'Click a bar to see those games. Excludes hidden games.'),
    factionChartCanvas,
  ]);

  // ── Player win rates ───────────────────────────────────
  // Names link out to /players/:key profile pages.
  const playerCanvas = el('canvas', { id: 'player-wr-chart', height: '260' });
  const playerPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Player Win Rates'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } },
      'Click a name below for full profile + streaks.'),
    playerCanvas,
    buildPlayerLinks(playerWR),
  ]);

  // ── First turn impact ──────────────────────────────────
  const firstTurnCanvas = el('canvas', { id: 'first-turn-chart', height: '220' });
  const firstTurnPanel = el('div', { class: 'stat-card' }, [
    el('h3', {}, 'Going First vs Second'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } },
      'Win % and avg score depending on turn order'),
    firstTurnCanvas,
  ]);

  // ── Faction matchup heatmap ─────────────────────────────
  const matchupPanel = el('div', { class: 'stat-card', style: { gridColumn: '1 / -1' } }, [
    el('h3', {}, 'Faction Matchup Matrix'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '12px' } },
      'Row vs column. Green = row faction wins more often, red = loses, grey = small sample. Hover a cell for details.'),
    buildMatchupHeatmap(matchups, factions),
  ]);

  // ── Trends over time ────────────────────────────────────
  const trendsCanvas = el('canvas', { id: 'trends-chart', height: '220' });
  const factionTrendCanvas = el('canvas', { id: 'faction-trend-chart', height: '220' });
  const trendsPanel = el('div', { class: 'stat-card', style: { gridColumn: '1 / -1' } }, [
    el('h3', {}, 'Trends Over Time'),
    el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '8px' } },
      'Monthly games played and average final score. Faction popularity below.'),
    trendsCanvas,
    el('div', { style: { marginTop: '20px' } }, factionTrendCanvas),
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
    drilldownBody.appendChild(el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px' } }, [
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
    factionPanel, playerPanel, firstTurnPanel, h2hPanel, drilldownPanel, secondaryPanel, matchupPanel, trendsPanel,
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
  return el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' } },
    rows.slice(0, 18).map(r => el('a', {
      class: 'btn small',
      href: '#/players/' + encodeURIComponent(r.player_key),
      style: { fontSize: '11px', textTransform: 'none', letterSpacing: '0' },
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
    el('table', {}, [
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
    ]),
  ]);
}

// ── Faction matchup heatmap (#1) ─────────────────────────────
// Cells coloured by win % from row's perspective; alpha by sample size.
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

  const cellSize = 28;
  const labelW = 110;

  const wrapper = el('div', { style: { overflowX: 'auto', maxWidth: '100%' } });
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
      body.appendChild(el('table', {}, [
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
      ]));
    } catch (e) {
      clear(body);
      body.appendChild(el('div', { class: 'error-text' }, `Failed: ${e.message}`));
    }
  }
  selA.addEventListener('change', load);
  selB.addEventListener('change', load);

  return el('div', { class: 'stat-card', style: { gridColumn: '1 / -1' } }, [
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
      onClick: (_e, items) => {
        if (!items.length) return;
        const r = top[items[0].index];
        if (r) window.__nav('/players/' + encodeURIComponent(r.player_key));
      },
      onHover: (e, items) => {
        e.native.target.style.cursor = items.length ? 'pointer' : 'default';
      },
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
      animation: { duration: 700 },
      scales: {
        x: { ticks: { color: chartTheme.text } },
        y: { type: 'linear', position: 'left', beginAtZero: true, ticks: { color: chartTheme.muted } },
        y2: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: chartTheme.muted } },
      },
      plugins: {
        legend: { labels: { color: chartTheme.text } },
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
      animation: { duration: 700 },
      scales: {
        x: { stacked: true, ticks: { color: chartTheme.text } },
        y: { stacked: true, beginAtZero: true, ticks: { color: chartTheme.muted } },
      },
      plugins: {
        legend: { labels: { color: chartTheme.text, font: { size: 10 } } },
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
