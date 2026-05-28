import { ratings } from '../api.js';
import { el, clear, toast, pill, fmtDate } from '../components.js';

// Admin-only player ranking (Glicko-2) + balanced matchmaking. The nav link and
// route are gated to admins in app.js; this view also refuses non-admins, and
// the API behind it is requireAdmin — so the data is private regardless.

const chartTheme = { text: '#e0e0e0', muted: '#a8a8a8', accent: '#5dade2', grid: '#3a3a44' };

// Distinct, readable line colours for the compare chart (one per player).
const PALETTE = [
  '#5dade2', '#e74c3c', '#2ecc71', '#f39c12', '#bb8fce', '#48c9b0',
  '#f1948a', '#85c1e9', '#f7dc6f', '#7dcea0', '#e59866', '#c39bd3',
  '#76d7c4', '#f0b27a', '#aeb6bf', '#d98880',
];
const colorFor = (i) => PALETTE[i % PALETTE.length];
function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export async function renderRatings(state) {
  if (state.user?.role !== 'admin') {
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Rankings')),
      el('div', { class: 'panel-body' }, 'You do not have permission to view this page.'),
    ]);
  }

  const root = el('div', { class: 'fade-in' });
  let mov = true;
  let board = null;
  let historyChart = null;
  let highlighted = null;       // userId of the highlighted line, or null
  const present = new Set();

  // ── Intro + settings ──────────────────────────────────────────
  const movToggle = el('input', { type: 'checkbox', checked: true });
  movToggle.addEventListener('change', () => { mov = movToggle.checked; load(); });

  const settingsPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Player Rankings')),
    el('div', { class: 'panel-body' }, [
      el('p', { class: 'muted', style: { marginTop: '0' } },
        'Private Glicko-2 ratings (the chess/Lichess system) computed from every logged game. '
        + 'Ratings cross-reference shared opponents, so players who never met are still comparable. '
        + 'The 0–1000 dial centres at 500; "provisional" means too few games to be confident yet.'),
      el('label', { class: 'inline-toggle', style: { display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' } }, [
        movToggle,
        el('span', {}, 'Margin of victory — blowouts move ratings more than nail-biters'),
      ]),
    ]),
  ]);

  // ── Leaderboard ───────────────────────────────────────────────
  const boardBody = el('div', { class: 'panel-body' }, el('div', { class: 'muted' }, 'Loading…'));
  const boardPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Leaderboard')),
    boardBody,
  ]);

  // ── Rating history (all players, click to highlight) ──────────
  const historyChips = el('div', { class: 'btn-group', style: { flexWrap: 'wrap', gap: '6px', marginBottom: '10px' } });
  const historyCanvasWrap = el('div', { style: { position: 'relative', height: '340px' } });
  const historyBody = el('div', { class: 'panel-body' }, el('div', { class: 'muted' }, 'Loading…'));
  const historyPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Rating History'),
      el('span', { class: 'muted', style: { fontSize: '12px' } }, 'click a player to highlight'),
    ]),
    historyBody,
  ]);

  // ── Matchmaker ────────────────────────────────────────────────
  const pickerBody = el('div', { class: 'panel-body' }, el('div', { class: 'muted' }, 'Loading…'));
  const suggestBtn = el('button', { class: 'btn primary' }, 'Suggest balanced matchups');
  const suggestOut = el('div', { class: 'panel-body' });
  const matchPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Balanced Matchmaker'),
    ]),
    el('div', { class: 'panel-body' }, el('p', { class: 'muted', style: { margin: '0' } },
      'Tick who is here tonight, then suggest pairings that keep every game as close (winnable for both sides) as possible — the opposite of best-vs-worst.')),
    pickerBody,
    el('div', { class: 'panel-body', style: { paddingTop: '0' } }, suggestBtn),
    suggestOut,
  ]);

  suggestBtn.addEventListener('click', async () => {
    if (present.size < 2) { toast('Pick at least two players', 'error'); return; }
    clear(suggestOut); suggestOut.appendChild(el('div', { class: 'muted' }, 'Crunching…'));
    try {
      const data = await ratings.suggest([...present], mov);
      renderSuggestions(data.configs);
    } catch (e) {
      clear(suggestOut); suggestOut.appendChild(el('div', { class: 'error-text' }, e.message));
    }
  });

  root.appendChild(settingsPanel);
  root.appendChild(boardPanel);
  root.appendChild(historyPanel);
  root.appendChild(matchPanel);

  await load();
  return root;

  // ── data + render helpers ─────────────────────────────────────
  async function load() {
    clear(boardBody); boardBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    clear(suggestOut);
    highlighted = null;
    try {
      board = await ratings.leaderboard(mov);
      renderBoard();
      renderPicker();
    } catch (e) {
      clear(boardBody); boardBody.appendChild(el('div', { class: 'error-text' }, e.message));
    }
    loadHistory();
  }

  function renderBoard() {
    clear(boardBody);
    if (board.componentCount > 1) {
      boardBody.appendChild(el('div', {
        style: {
          border: '1px solid var(--warning)', borderRadius: 'var(--radius)',
          background: 'rgba(243,156,18,0.08)', color: 'var(--warning)',
          padding: '10px 12px', marginBottom: '12px', fontSize: '13px',
        },
      }, `Heads up: players fall into ${board.componentCount} separate pools that haven't faced shared opponents. Ratings are only directly comparable within a pool.`));
    }
    if (!board.players.length) {
      boardBody.appendChild(el('div', { class: 'muted' }, 'No rated games yet.'));
      return;
    }

    const head = el('thead', {}, el('tr', {}, [
      el('th', {}, '#'),
      el('th', {}, 'Player'),
      el('th', { style: { textAlign: 'right' } }, 'Rating'),
      el('th', { style: { textAlign: 'center' } }, 'W-L-D'),
      el('th', { style: { textAlign: 'right' } }, 'Win%'),
      el('th', { style: { textAlign: 'right' } }, 'Games'),
      el('th', {}, 'Last played'),
    ]));

    const body = el('tbody', {}, board.players.map((p, i) => {
      const nameCell = el('td', {}, [
        el('a', { href: 'javascript:void 0', style: { cursor: 'pointer', textDecoration: 'none', color: 'var(--accent)' },
          onClick: () => setHighlight(highlighted === p.userId ? null : p.userId) }, p.displayName),
        p.armyName ? el('div', { class: 'muted', style: { fontSize: '11px' } }, p.armyName) : null,
        !p.isActive ? el('span', { class: 'pill', style: { marginLeft: '6px', fontSize: '9px' }, title: 'promoted-guest account' }, 'guest') : null,
        (board.componentCount > 1 && !p.inMainPool) ? pill('alt pool', 'loss') : null,
      ]);
      const ratingCell = el('td', { style: { textAlign: 'right' } }, [
        el('span', { class: 'tabular', style: { fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: '700', color: 'var(--accent)' } }, String(p.displayRating)),
        el('span', { class: 'muted tabular', style: { fontSize: '11px', marginLeft: '4px' } }, `±${p.confidence}`),
        p.provisional ? el('div', {}, pill('provisional', 'draw')) : null,
      ]);
      return el('tr', {}, [
        el('td', { class: 'tabular muted' }, String(i + 1)),
        nameCell,
        ratingCell,
        el('td', { class: 'tabular', style: { textAlign: 'center' } }, `${p.wins}-${p.losses}-${p.draws}`),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, `${p.winRate}%`),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(p.games)),
        el('td', { class: 'muted', style: { fontSize: '12px' } }, p.lastPlayed ? fmtDate(p.lastPlayed) : '—'),
      ]);
    }));
    boardBody.appendChild(el('table', {}, [head, body]));
  }

  function renderPicker() {
    clear(pickerBody);
    if (!board.players.length) { pickerBody.appendChild(el('div', { class: 'muted' }, 'No players yet.')); return; }
    const chips = el('div', { class: 'btn-group', style: { flexWrap: 'wrap', gap: '6px' } },
      board.players.map(p => {
        const chip = el('button', { class: 'btn small', type: 'button' },
          `${p.displayName} · ${p.displayRating}`);
        const sync = () => chip.className = present.has(p.userId) ? 'btn small primary' : 'btn small';
        chip.addEventListener('click', () => {
          if (present.has(p.userId)) present.delete(p.userId); else present.add(p.userId);
          sync();
        });
        sync();
        return chip;
      }));
    const tools = el('div', { class: 'btn-group', style: { marginBottom: '8px' } }, [
      el('button', { class: 'btn small', type: 'button', onClick: () => { board.players.forEach(p => present.add(p.userId)); renderPicker(); } }, 'Select all'),
      el('button', { class: 'btn small', type: 'button', onClick: () => { present.clear(); renderPicker(); } }, 'Clear'),
    ]);
    pickerBody.appendChild(tools);
    pickerBody.appendChild(chips);
  }

  function renderSuggestions(configs) {
    clear(suggestOut);
    if (!configs || !configs.length) { suggestOut.appendChild(el('div', { class: 'muted' }, 'No pairing found.')); return; }
    let idx = 0;
    const out = el('div', {});
    const draw = () => {
      clear(out);
      const cfg = configs[idx];
      const header = el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } }, [
        el('span', { class: 'muted', style: { fontSize: '12px' } }, `Option ${idx + 1} of ${configs.length} · total skill gap ${cfg.totalGap}`),
        configs.length > 1 ? el('button', { class: 'btn small', type: 'button', onClick: () => { idx = (idx + 1) % configs.length; draw(); } }, 'Reshuffle ⟳') : null,
      ]);
      out.appendChild(header);
      for (const pr of cfg.pairs) out.appendChild(pairCard(pr));
      if (cfg.bye) out.appendChild(el('div', { class: 'muted', style: { marginTop: '8px', fontSize: '13px' } }, `Sitting out: ${cfg.bye.displayName}`));
    };
    draw();
    suggestOut.appendChild(out);
  }

  function pairCard(pr) {
    const probA = pr.winProbA, probB = Math.round((100 - probA) * 10) / 10;
    const bar = el('div', { style: { display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', margin: '8px 0' } }, [
      el('div', { style: { width: `${probA}%`, background: 'var(--info)' } }),
      el('div', { style: { width: `${probB}%`, background: 'var(--accent-dark)' } }),
    ]);
    return el('div', { class: 'stat-card', style: { marginBottom: '10px', padding: '12px 14px' } }, [
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, [
        el('span', {}, [el('strong', {}, pr.a.displayName), el('span', { class: 'muted tabular', style: { fontSize: '12px', marginLeft: '6px' } }, String(pr.a.displayRating))]),
        el('span', { class: 'muted' }, 'vs'),
        el('span', { style: { textAlign: 'right' } }, [el('span', { class: 'muted tabular', style: { fontSize: '12px', marginRight: '6px' } }, String(pr.b.displayRating)), el('strong', {}, pr.b.displayName)]),
      ]),
      bar,
      el('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12px' } }, [
        el('span', { class: 'tabular', style: { color: 'var(--info)' } }, `${probA}%`),
        el('span', { class: 'muted' }, pr.lastPlayed ? `last met ${fmtDate(pr.lastPlayed)}` : 'never met'),
        el('span', { class: 'tabular muted' }, `${probB}%`),
      ]),
    ]);
  }

  async function loadHistory() {
    clear(historyBody);
    historyBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const data = await ratings.history(mov);
      clear(historyBody);
      if (!data.players.length) { historyBody.appendChild(el('div', { class: 'muted' }, 'No rated games yet.')); return; }
      if (typeof Chart === 'undefined') { historyBody.appendChild(el('div', { class: 'muted' }, 'Chart library unavailable.')); return; }
      clear(historyChips);
      historyBody.appendChild(historyChips);
      historyBody.appendChild(historyCanvasWrap);
      buildHistoryChart(data.players);
      buildHistoryChips(data.players);
    } catch (e) {
      clear(historyBody); historyBody.appendChild(el('div', { class: 'error-text' }, e.message));
    }
  }

  function buildHistoryChart(players) {
    if (historyChart) { historyChart.destroy(); historyChart = null; }
    clear(historyCanvasWrap);
    const canvas = el('canvas');
    historyCanvasWrap.appendChild(canvas);
    // Auto-fit the y-axis to the actual ratings (with padding) so the lines
    // aren't all crushed into the middle of a fixed 0–1000 range.
    const ys = players.flatMap(pl => pl.series.map(s => s.y));
    const lo = ys.length ? Math.min(...ys) : 0;
    const hi = ys.length ? Math.max(...ys) : 1000;
    const pad = Math.max(15, (hi - lo) * 0.15);
    const yMin = Math.max(0, Math.round(lo - pad));
    const yMax = Math.min(1000, Math.round(hi + pad));
    const datasets = players.map((pl, i) => ({
      label: pl.displayName,
      data: pl.series,
      _userId: pl.userId,
      _color: colorFor(i),
      borderColor: colorFor(i),
      backgroundColor: 'transparent',
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      spanGaps: true,
    }));
    historyChart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'nearest', intersect: false },
        onClick: (_evt, els) => {
          if (!els.length) return;
          const uid = historyChart.data.datasets[els[0].datasetIndex]._userId;
          setHighlight(highlighted === uid ? null : uid);
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'month', tooltipFormat: 'PP' },
            ticks: { color: chartTheme.muted },
            grid: { color: chartTheme.grid },
          },
          y: { min: yMin, max: yMax, ticks: { color: chartTheme.muted }, grid: { color: chartTheme.grid } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#22222a', borderColor: chartTheme.accent, borderWidth: 1 },
        },
      },
    });
    styleDatasets();
  }

  function buildHistoryChips(players) {
    clear(historyChips);
    players.forEach((pl, i) => {
      const dot = el('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: colorFor(i), marginRight: '6px' } });
      const chip = el('button', { class: 'btn small', type: 'button', 'data-uid': pl.userId,
        onClick: () => setHighlight(highlighted === pl.userId ? null : pl.userId) }, [dot, pl.displayName]);
      historyChips.appendChild(chip);
    });
    syncChips();
  }

  function setHighlight(uid) {
    highlighted = uid;
    styleDatasets();
    syncChips();
  }

  function styleDatasets() {
    if (!historyChart) return;
    for (const ds of historyChart.data.datasets) {
      if (highlighted == null) {
        ds.borderColor = hexToRgba(ds._color, 0.85);
        ds.borderWidth = 2; ds.pointRadius = 2; ds.order = 1;
      } else if (ds._userId === highlighted) {
        ds.borderColor = ds._color;
        ds.borderWidth = 3.5; ds.pointRadius = 3; ds.order = 0;
      } else {
        ds.borderColor = hexToRgba(ds._color, 0.1);
        ds.borderWidth = 1.5; ds.pointRadius = 0; ds.order = 2;
      }
    }
    historyChart.update('none');
  }

  function syncChips() {
    for (const chip of historyChips.children) {
      const uid = parseInt(chip.getAttribute('data-uid'), 10);
      chip.className = (highlighted === uid) ? 'btn small primary' : 'btn small';
      chip.style.opacity = (highlighted == null || highlighted === uid) ? '1' : '0.5';
    }
  }
}
