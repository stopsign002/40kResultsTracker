import { games, admin } from '../api.js';
import { el, fmtDate, pill, toast, confirmModal } from '../components.js';

export async function renderGameDetail(state, gameId) {
  const root = el('div', { class: 'fade-in' });
  const g = await games.get(gameId);

  const header = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, `Game #${g.id}`),
      el('div', { class: 'btn-group' }, [
        state.user?.role === 'admin' ? el('button', {
          class: 'btn small',
          onClick: async () => {
            try {
              await admin.setVisibility(g.id, !g.hidden_from_stats);
              toast(g.hidden_from_stats ? 'Game made visible' : 'Game hidden from stats');
              window.__nav('/games/' + g.id);
              setTimeout(() => location.reload(), 100);
            } catch (e) { toast(e.message, 'error'); }
          }
        }, g.hidden_from_stats ? 'Unhide' : 'Hide from stats') : null,
        state.user?.role === 'admin' ? el('button', {
          class: 'btn small danger',
          onClick: async () => {
            const ok = await confirmModal({
              title: 'Delete game?',
              body: `Permanently remove Game #${g.id} and all its rounds, secondaries and challenger entries. This cannot be undone — for normal data hygiene use "Hide from stats" instead.`,
              danger: true,
              confirmLabel: 'Delete forever',
            });
            if (!ok) return;
            try {
              await admin.deleteGame(g.id);
              toast('Game deleted');
              window.__nav('/games');
            } catch (e) { toast(e.message, 'error'); }
          },
        }, 'Delete') : null,
        state.user ? el('a', { class: 'btn primary small', href: `#/games/${g.id}/edit` }, 'Edit') : null,
      ].filter(Boolean)),
    ]),
    el('div', { class: 'panel-body' }, [buildMeta(g)]),
  ]);

  const players = el('div', { class: 'players-grid' }, g.players.map(p => buildPlayerCard(p, g)));

  const progression = buildProgressionPanel(g);

  const notes = g.notes ? el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Notes')),
    el('div', { class: 'panel-body' }, el('pre', { style: { whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0 } }, g.notes)),
  ]) : null;

  root.appendChild(header);
  root.appendChild(players);
  if (progression) root.appendChild(progression);
  if (notes) root.appendChild(notes);
  return root;
}

// Per-seat line colours for the progression chart.
const PROGRESSION_COLOURS = ['#5dade2', '#f39c12'];

// Cumulative per-round score line chart — shows how each player's total
// climbed round by round so you can read the shape of the game.
function buildProgressionPanel(g) {
  const hasRoundData = (g.players || []).some(p =>
    (p.rounds || []).some(r => (r.primary_score || 0) + (r.secondary_score || 0) > 0));
  if (!hasRoundData || typeof Chart === 'undefined') return null;

  const canvas = el('canvas', { height: '260' });
  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Score Progression')),
    el('div', { class: 'panel-body' }, canvas),
  ]);
  requestAnimationFrame(() => drawProgression(canvas, g));
  return panel;
}

function drawProgression(canvas, g) {
  let maxRound = 0;
  for (const p of g.players || []) {
    for (const r of p.rounds || []) {
      if (r.round_number > maxRound) maxRound = r.round_number;
    }
  }
  if (maxRound < 1) maxRound = 5;

  const rounds = [];
  for (let n = 1; n <= maxRound; n++) rounds.push(n);
  const labels = ['Start', ...rounds.map(n => `R${n}`)];

  const datasets = (g.players || []).map((p, idx) => {
    let cum = 0;
    const data = rounds.map(rn => {
      const r = (p.rounds || []).find(x => x.round_number === rn);
      if (r) cum += (r.primary_score || 0) + (r.secondary_score || 0);
      return cum;
    });
    const colour = PROGRESSION_COLOURS[idx % PROGRESSION_COLOURS.length];
    return {
      label: p.display_name || p.guest_name || `Player ${idx + 1}`,
      data: [0, ...data],
      borderColor: colour,
      backgroundColor: colour,
      pointRadius: 3,
      tension: 0.25,
      fill: false,
    };
  });

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#a8a8a8' }, grid: { color: '#3a3a44' } },
        y: {
          beginAtZero: true,
          ticks: { color: '#a8a8a8' },
          grid: { color: '#3a3a44' },
          title: { display: true, text: 'Cumulative score', color: '#a8a8a8' },
        },
      },
      plugins: {
        legend: { labels: { color: '#e0e0e0' } },
        tooltip: { backgroundColor: '#22222a', borderColor: '#ffffff', borderWidth: 1 },
      },
    },
  });
}

function buildMeta(g) {
  const cells = [
    ['Date', fmtDate(g.played_at)],
    ['Format', g.game_format],
    ['Points', g.points_limit],
    ['Mission Pack', g.mission_pack_name || '—'],
    ['Primary Mission', g.primary_mission_name || '—'],
    ['Deployment', g.deployment_map_name || '—'],
    ['Mission Rule', g.mission_rule_name || '—'],
    ['Turns Played', g.turn_count ?? '—'],
    ['End Condition', g.end_condition],
    ['Tournament', g.tournament_name || '—'],
    g.tournament_round ? ['Round', g.tournament_round] : null,
    g.tournament_table ? ['Table', g.tournament_table] : null,
    g.location ? ['Location', g.location] : null,
    ['Logged by', g.created_by_name || '—'],
    g.hidden_from_stats ? ['Visibility', 'HIDDEN'] : null,
  ].filter(Boolean);

  return el('div', { class: 'form-row cols-4' }, cells.map(([k, v]) =>
    el('div', { class: 'form-group' }, [
      el('label', {}, k),
      el('div', { class: 'tabular', style: { padding: '6px 0' } }, String(v)),
    ])
  ));
}

function buildPlayerCard(p, g) {
  const isWinner = p.result === 'win';
  const totalRoundScore = (p.rounds || []).reduce((s, r) => s + r.primary_score + r.secondary_score, 0);

  const roundRows = [1,2,3,4,5].map(rn => {
    const r = (p.rounds || []).find(x => x.round_number === rn) || { primary_score: 0, secondary_score: 0 };
    return el('div', { class: 'round-grid' }, [
      el('div', { class: 'cell', style: { textAlign: 'center', color: 'var(--text-muted)' } }, `R${rn}`),
      el('div', { class: 'cell tabular' }, `Pri: ${r.primary_score}`),
      el('div', { class: 'cell tabular' }, `Sec: ${r.secondary_score}`),
    ]);
  });

  const secondaries = (p.secondaries || []).length ? el('div', {}, [
    el('h3', { style: { marginTop: '14px' } }, 'Secondaries'),
    el('table', {}, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Card'), el('th', {}, 'Round'), el('th', { style: { textAlign: 'right' } }, 'Score')])),
      el('tbody', {}, (p.secondaries || []).map(s => el('tr', {}, [
        el('td', {}, s.card_name),
        el('td', { class: 'muted' }, s.round_number ? `R${s.round_number}` : 'Fixed'),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(s.score)),
      ]))),
    ]),
  ]) : null;

  const challengers = (p.challengers || []).length ? el('div', {}, [
    el('h3', { style: { marginTop: '14px' } }, 'Challengers'),
    el('table', {}, [
      el('thead', {}, el('tr', {}, [el('th', {}, 'Card'), el('th', {}, 'Done?'), el('th', { style: { textAlign: 'right' } }, 'Score')])),
      el('tbody', {}, (p.challengers || []).map(c => el('tr', {}, [
        el('td', {}, c.card_name),
        el('td', {}, c.completed ? '✓' : '—'),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(c.score)),
      ]))),
    ]),
  ]) : null;

  const armyList = p.army_list_code ? el('div', {}, [
    el('h3', { style: { marginTop: '14px' } }, 'Army List'),
    el('pre', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '11px', background: 'var(--bg)', padding: '8px', borderRadius: '4px' } }, p.army_list_code),
  ]) : null;

  return el('div', { class: 'player-panel' }, [
    el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, [
      el('h2', {}, p.display_name || 'Player'),
      el('div', { class: 'score-big' }, String(p.final_score ?? totalRoundScore)),
    ]),
    el('div', { class: 'player-meta' }, [
      pill(p.result || '—', p.result),
      ' ',
      p.went_first ? pill('Went 1st', 'first') : pill('Went 2nd', ''),
    ]),
    el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, [
      [p.faction_name, p.detachment_name].filter(Boolean).join(' — ') || 'Faction unknown',
    ]),
    el('h3', {}, 'Rounds'),
    el('div', {}, roundRows),
    secondaries,
    challengers,
    armyList,
  ]);
}
