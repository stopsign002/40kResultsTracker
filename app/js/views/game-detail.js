import { games, admin, gameImages } from '../api.js';
import { openLightbox } from '../lightbox.js';
import { extractImagesFromZip, isZipFile } from '../zip.js';
import { shrink } from '../images.js';
import { el, fmtDate, pill, toast, confirmModal, fmtDuration } from '../components.js';
import { missionLink } from '../mission-cards.js';

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
  // Both photo panels read the same list — the terrain shot is one of the
  // game's photos, flagged is_map — so tagging or deleting in one has to
  // repaint the other.
  const gallery = await makeGallery(g.id);
  const mapPanel = buildMapPanel(state, g, gallery);
  if (mapPanel) root.appendChild(mapPanel);
  root.appendChild(buildPhotosPanel(state, g, gallery));
  if (progression) root.appendChild(progression);
  if (notes) root.appendChild(notes);
  return root;
}

// Longest edge of the stored full-size image and of the list thumbnail. The
// browser does the resizing (see shrink() in images.js), so the server never needs an image
// library and a 12MP phone photo never crosses the wire at full size.
// 2048 keeps a photo sharp when opened full-screen; at q0.82 that is typically
// 400-900KB, well inside the upload route's 12mb body limit.
const FULL_MAX_PX = 2048;
const THUMB_MAX_PX = 400;
const JPEG_QUALITY = 0.82;

// One list of the game's photos, shared by the two panels that render it.
// Either can change it (upload, tag, delete), so a repaint has to reach both.
async function makeGallery(gameId) {
  const gallery = {
    images: [],
    painters: [],
    async reload() {
      try {
        gallery.images = await gameImages.list(gameId);
      } catch { /* panels still render, just empty */ }
      gallery.repaint();
    },
    repaint() {
      gallery.painters.forEach(paint => paint());
    },
  };
  try {
    gallery.images = await gameImages.list(gameId);
  } catch { /* panels still render, just empty */ }
  return gallery;
}

// The shot of the terrain THIS game was played on. It is one of the game's own
// photos, flagged is_map — a table is dressed for one game, so the picture is
// never shared with other games on the same named layout. GW's own layout
// diagrams are copyrighted, so nothing is bundled or fetched either.
function buildMapPanel(state, g, gallery) {
  if (!g.deployment_map_id) return null;
  const name = g.deployment_map_name || 'Terrain layout';
  const body = el('div', { class: 'panel-body' });

  const fileInput = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
  const status = el('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '8px' } }, '');
  const uploadBtn = el('button', { class: 'btn small' }, 'Add picture');

  const mapShot = () => gallery.images.find(x => x.is_map) || null;

  function paint() {
    const img = mapShot();
    body.textContent = '';
    uploadBtn.textContent = img ? 'Replace' : 'Add picture';
    if (img) {
      const thumb = el('img', {
        class: 'map-image',
        src: gameImages.url(g.id, img.thumb_name),
        alt: name,
        loading: 'lazy',
      });
      const opener = el('button', { class: 'photo-open map-open', type: 'button', 'aria-label': `Open ${name}` }, thumb);
      opener.addEventListener('click', () => openLightbox({
        items: [{ full: gameImages.url(g.id, img.file_name), thumb: gameImages.url(g.id, img.thumb_name), caption: name }],
        startIndex: 0,
        thumbFor: () => thumb,
      }));
      body.appendChild(opener);
    } else {
      body.appendChild(el('div', { class: 'muted', style: { fontSize: '13px' } },
        state.user
          ? `No picture of the terrain for this game yet — add a shot of the table you played on.`
          : `No picture of the terrain for this game.`));
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = (fileInput.files || [])[0];
    fileInput.value = '';
    if (!file) return;
    status.textContent = 'Uploading…';
    try {
      const [full, thumb] = await Promise.all([
        shrink(file, FULL_MAX_PX, JPEG_QUALITY),
        shrink(file, THUMB_MAX_PX, JPEG_QUALITY),
      ]);
      // Replacing demotes the previous shot rather than deleting it — it stays
      // on the game as an ordinary photo, just untagged.
      await gameImages.upload(g.id, {
        dataUrl: full.dataUrl,
        thumbDataUrl: thumb.dataUrl,
        width: full.width,
        height: full.height,
        isMap: true,
      });
      await gallery.reload();
      toast('Terrain photo saved');
    } catch (e) {
      toast(e.message, 'error');
    }
    status.textContent = '';
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  gallery.painters.push(paint);
  paint();

  return el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, `Terrain Layout — ${name}`),
      state.user ? el('div', {}, [uploadBtn, status, fileInput]) : null,
    ].filter(Boolean)),
    body,
  ]);
}

function buildPhotosPanel(state, g, gallery) {
  const grid = el('div', { class: 'photo-grid' });
  const fileInput = el('input', {
    // .zip because Google Photos bundles a multi-photo download into one.
    type: 'file', accept: 'image/*,.zip,application/zip', multiple: true,
    style: { display: 'none' },
  });
  const uploadBtn = el('button', { class: 'btn small primary' }, 'Add photos');
  const status = el('span', { class: 'muted', style: { fontSize: '12px', marginLeft: '8px' } }, '');

  const canEdit = (img) => state.user &&
    (state.user.role === 'admin' || img.uploaded_by_user_id === state.user.id);

  // Rebuilt by paint(); the lightbox needs the live element per index so it can
  // zoom back into whichever photo you cycled to, not the one you opened.
  let thumbEls = [];

  function paint() {
    grid.textContent = '';
    thumbEls = [];
    const images = gallery.images;
    if (!images.length) {
      grid.appendChild(el('div', { class: 'muted', style: { fontSize: '13px' } },
        state.user ? 'No photos yet.' : 'No photos.'));
      return;
    }
    images.forEach((img, i) => {
      const thumb = el('img', {
        class: 'photo-thumb',
        src: gameImages.url(g.id, img.thumb_name),
        alt: img.caption || 'Game photo',
        loading: 'lazy',
      });
      thumbEls[i] = thumb;
      const opener = el('button', {
        class: 'photo-open',
        type: 'button',
        'aria-label': `Open photo ${i + 1} of ${images.length}`,
      }, thumb);
      opener.addEventListener('click', () => {
        openLightbox({
          items: images.map(x => ({
            full: gameImages.url(g.id, x.file_name),
            thumb: gameImages.url(g.id, x.thumb_name),
            caption: x.caption || '',
          })),
          startIndex: i,
          thumbFor: (idx) => thumbEls[idx] || null,
        });
      });
      // Over the image, bottom-right — inside the opener so it anchors to the
      // photo rather than to the tile (which is taller than the photo).
      if (img.caption) {
        opener.appendChild(
          el('span', { class: 'photo-badge is-round', title: img.caption }, img.caption));
      }
      const tile = el('figure', { class: 'photo-tile' }, [
        opener,
        img.is_thumbnail ? el('span', { class: 'photo-badge' }, 'COVER') : null,
        img.is_map ? el('span', { class: 'photo-badge is-map' }, 'MAP') : null,
        state.user ? el('div', { class: 'photo-actions' }, [
          img.is_thumbnail ? null : el('button', {
            class: 'btn small',
            title: 'Use as the thumbnail in the games list',
            onClick: async () => {
              try {
                await gameImages.update(g.id, img.id, { isThumbnail: true });
                gallery.images = images.map(x => ({ ...x, is_thumbnail: x.id === img.id }));
                gallery.repaint();
                toast('Cover photo set');
              } catch (e) { toast(e.message, 'error'); }
            },
          }, 'Cover'),
          el('button', {
            class: `btn small${img.is_map ? ' primary' : ''}`,
            title: 'Use as the terrain-layout photo for this game',
            onClick: async () => {
              const next = !img.is_map;
              try {
                await gameImages.update(g.id, img.id, { isMap: next });
                gallery.images = images.map(x => ({ ...x, is_map: next && x.id === img.id }));
                gallery.repaint();
                toast(next ? 'Map photo set' : 'Map photo cleared');
              } catch (e) { toast(e.message, 'error'); }
            },
          }, img.is_map ? 'Map ✓' : 'Map'),
          canEdit(img) ? el('button', {
            class: 'btn small danger',
            onClick: async () => {
              const ok = await confirmModal({
                title: 'Delete photo?',
                body: 'This removes the image file for good.',
                danger: true,
                confirmLabel: 'Delete',
              });
              if (!ok) return;
              try {
                await gameImages.remove(g.id, img.id);
                await gallery.reload();
                toast('Photo deleted');
              } catch (e) { toast(e.message, 'error'); }
            },
          }, 'Delete') : null,
        ].filter(Boolean)) : null,
      ].filter(Boolean));
      grid.appendChild(tile);
    });
  }

  uploadBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!picked.length) return;
    uploadBtn.disabled = true;

    // Expand any zips up front so the progress count reflects the real number
    // of photos, not "1 of 1" for an archive holding thirty.
    const files = [];
    for (const f of picked) {
      if (!isZipFile(f)) { files.push(f); continue; }
      status.textContent = `Unpacking ${f.name}…`;
      try {
        const found = await extractImagesFromZip(f);
        if (!found.length) toast(`${f.name}: no pictures in that zip`, 'error');
        files.push(...found);
      } catch (e) {
        toast(`${f.name}: ${e.message}`, 'error');
      }
    }
    if (!files.length) {
      uploadBtn.disabled = false;
      status.textContent = '';
      return;
    }

    let done = 0;
    for (const file of files) {
      status.textContent = `Uploading ${done + 1} of ${files.length}…`;
      try {
        const [full, thumb] = await Promise.all([
          shrink(file, FULL_MAX_PX, JPEG_QUALITY),
          shrink(file, THUMB_MAX_PX, JPEG_QUALITY),
        ]);
        await gameImages.upload(g.id, {
          dataUrl: full.dataUrl,
          thumbDataUrl: thumb.dataUrl,
          width: full.width,
          height: full.height,
        });
        done++;
      } catch (e) {
        toast(`${file.name}: ${e.message}`, 'error');
      }
    }
    uploadBtn.disabled = false;
    status.textContent = '';
    await gallery.reload();
    if (done) toast(done === 1 ? 'Photo added' : `${done} photos added`);
  });

  gallery.painters.push(paint);
  paint();

  return el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Photos'),
      state.user ? el('div', {}, [uploadBtn, status, fileInput]) : null,
    ].filter(Boolean)),
    el('div', { class: 'panel-body' }, grid),
  ]);
}

// Per-seat line colours for the progression chart.
const PROGRESSION_COLOURS = ['#5dade2', '#f39c12'];

// Cumulative per-round score line chart — shows how each player's total
// climbed round by round so you can read the shape of the game.
function buildProgressionPanel(g) {
  const hasRoundData = (g.players || []).some(p =>
    (p.rounds || []).some(r => (r.primary_score || 0) + (r.secondary_score || 0) > 0));
  if (!hasRoundData || typeof Chart === 'undefined') return null;

  const canvas = el('canvas', {});
  const chartBox = el('div', { style: { position: 'relative', height: '280px' } }, canvas);
  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Score Progression')),
    el('div', { class: 'panel-body' }, chartBox),
  ]);
  requestAnimationFrame(() => drawProgression(canvas, g));
  return panel;
}

function drawProgression(canvas, g) {
  // Prefer the recorded turn count so a game that ended early (e.g. 4
  // rounds) stops the chart at R4 instead of trailing an empty R5. Fall back
  // to the last round that actually has scores so empty trailing rounds drop.
  let maxRound = Number(g.turn_count);
  if (!Number.isFinite(maxRound) || maxRound < 1 || maxRound > 5) {
    maxRound = 0;
    for (const p of g.players || []) {
      for (const r of p.rounds || []) {
        if ((r.primary_score || 0) + (r.secondary_score || 0) > 0 && r.round_number > maxRound) {
          maxRound = r.round_number;
        }
      }
    }
    if (maxRound < 1) maxRound = 5;
  }

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
      maintainAspectRatio: false,
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
    g.edition === '11' ? null : ['Primary Mission', g.primary_mission_name || '—'],
    ['Deployment', g.deployment_map_name || '—'],
    ['Mission Rule', g.mission_rule_name || '—'],
    ['Turns Played', g.turn_count ?? '—'],
    ['End Condition', g.end_condition],
    ['Edition', g.edition === '11' ? '11th' : '10th'],
    ['Play Medium', g.play_medium === 'digital' ? 'Digital (TTS)' : 'Physical'],
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

// The total normally IS the sum of the round clocks. When it was set by hand
// it can legitimately differ from them, so say so rather than leaving two
// numbers on screen that don't add up.
function clockPill(p) {
  const node = pill(`⏱ ${fmtDuration(p.time_seconds)}`, '');
  if (p.time_is_manual) {
    const rounds = (p.rounds || [])
      .filter(r => r.time_seconds != null)
      .reduce((sum, r) => sum + r.time_seconds, 0);
    node.title = rounds
      ? `Total set by hand. The round clocks below sum to ${fmtDuration(rounds)}.`
      : 'Total set by hand.';
  }
  return node;
}

function buildPlayerCard(p, g) {
  const isWinner = p.result === 'win';
  const totalRoundScore = (p.rounds || []).reduce((s, r) => s + r.primary_score + r.secondary_score, 0);

  // A game logged as nothing but a final score has an all-zero rounds grid,
  // which reads as "they scored nothing" rather than "nobody wrote it down".
  const hasRoundDetail = (p.rounds || []).some(
    r => (r.primary_score || 0) > 0 || (r.secondary_score || 0) > 0);

  const roundRows = [1,2,3,4,5].map(rn => {
    const r = (p.rounds || []).find(x => x.round_number === rn) || { primary_score: 0, secondary_score: 0 };
    return el('div', { class: 'round-grid' }, [
      el('div', { class: 'cell', style: { textAlign: 'center', color: 'var(--text-muted)' } }, `R${rn}`),
      el('div', { class: 'cell tabular' }, `Pri: ${r.primary_score}`),
      el('div', { class: 'cell tabular' }, `Sec: ${r.secondary_score}`),
      r.time_seconds != null
        ? el('div', { class: 'cell tabular muted' }, `⏱ ${fmtDuration(r.time_seconds)}`)
        : null,
    ].filter(Boolean));
  });

  const is11 = g.edition === '11';

  // Entry is alphabetical (easy to find a card); review is chronological (easy
  // to read the game back). 11e only — in 10e a card is drawn and scored in the
  // same round, so there's no separate draw order to sort by.
  // Fixed missions are chosen at setup, never drawn, and can score in several
  // rounds — so they read back grouped by card, then by the round each entry
  // scored, rather than by a draw order that doesn't exist for them.
  const isFixed = p.secondary_mode === 'fixed';
  const orderedSecondaries = !is11
    ? (p.secondaries || [])
    : isFixed
      ? (p.secondaries || []).slice().sort((a, b) =>
          ((a.card_name || '') < (b.card_name || '') ? -1 : (a.card_name || '') > (b.card_name || '') ? 1 : 0) ||
          (a.round_number ?? 99) - (b.round_number ?? 99))
      : (p.secondaries || []).slice().sort((a, b) =>
          (a.drawn_round ?? 99) - (b.drawn_round ?? 99) ||
          (a.round_number ?? 99) - (b.round_number ?? 99) ||
          ((a.card_name || '') < (b.card_name || '') ? -1 : 1));

  const secondaries = orderedSecondaries.length ? el('div', {}, [
    el('h3', { style: { marginTop: '14px' } }, [
      'Secondaries',
      is11 ? ' ' : null,
      is11 ? el('span', { class: 'dim', style: { fontSize: '12px', fontWeight: 'normal' } },
        isFixed ? 'Fixed' : 'Tactical') : null,
    ].filter(Boolean)),
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', {}, 'Card'),
        is11 && !isFixed ? el('th', {}, 'Drawn') : null,
        el('th', {}, is11 ? 'Scored' : 'Round'),
        el('th', { style: { textAlign: 'right' } }, 'Score'),
      ].filter(Boolean))),
      el('tbody', {}, orderedSecondaries.map(s => el('tr', {}, [
        // 10e decks aren't in the 11e card data, so don't offer a link that
        // could only ever answer "no rules text on file".
        el('td', {}, (is11 && missionLink('secondary', s.card_name,
          { mode: isFixed ? 'fixed' : 'tactical' })) || s.card_name),
        is11 && !isFixed ? el('td', { class: 'muted' }, s.drawn_round ? `R${s.drawn_round}` : '—') : null,
        el('td', { class: 'muted' },
          s.round_number ? `R${s.round_number}` : (is11 ? 'Never' : 'Fixed')),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(s.score)),
      ].filter(Boolean)))),
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

  // Collapsed by default: a full list is 20+ lines and would push the scoring
  // breakdown off the screen, but the whole reason it's stored is that GW's app
  // throws it away, so it has to be one tap from the game.
  // `overflow-wrap` rather than `break-all` — the pasted text is unit names now,
  // not base64, and mid-word breaks make it unreadable.
  const armyList = p.army_list_code ? el('details', { style: { marginTop: '14px' } }, [
    el('summary', { class: 'detail-summary' }, 'Army List'),
    el('pre', {
      tabindex: '0',
      role: 'region',
      'aria-label': 'Army list',
      style: {
        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px',
        background: 'var(--bg)', padding: '10px', borderRadius: '4px',
        marginTop: '8px', maxHeight: '420px', overflowY: 'auto',
      },
    }, p.army_list_code),
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
      p.time_seconds != null ? ' ' : null,
      p.time_seconds != null ? clockPill(p) : null,
    ].filter(Boolean)),
    el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, [
      [
        p.faction_name,
        (p.detachments && p.detachments.length ? p.detachments.join(', ') : p.detachment_name),
      ].filter(Boolean).join(' — ') || 'Faction unknown',
    ]),
    is11 ? el('div', { class: 'muted', style: { fontSize: '13px', marginBottom: '8px' } }, [
      `${p.force_disposition ? p.force_disposition + ' · ' : ''}Primary: `,
      missionLink('primary', p.primary_mission_name || p.primary_mission_ref) || '—',
    ]) : null,
    hasRoundDetail ? el('h3', {}, 'Rounds') : null,
    hasRoundDetail ? el('div', {}, roundRows) : null,
    hasRoundDetail ? null : el('div', { class: 'muted', style: { fontSize: '13px' } },
      'Final score only — no round breakdown was recorded.'),
    secondaries,
    challengers,
    armyList,
  ].filter(Boolean));
}
