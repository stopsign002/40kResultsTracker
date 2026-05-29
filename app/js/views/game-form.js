import { games, reference } from '../api.js';
import { el, clear, toast, selectOptions, confirmModal } from '../components.js';

const ROUNDS = [1, 2, 3, 4, 5];

let comboSeq = 0;
function comboField(items, currentId, currentName, onChange, opts = {}) {
  const listId = `combo-${++comboSeq}`;
  const initial = currentName ?? (currentId != null ? (items.find(i => i.id == currentId)?.name ?? '') : '');
  const inp = el('input', {
    type: 'text',
    list: listId,
    value: initial,
    placeholder: opts.placeholder ?? 'Pick or type',
    autocomplete: 'off',
    style: opts.style || null,
  });
  const datalist = el('datalist', { id: listId },
    items.map(i => el('option', { value: i.name }, ''))
  );
  let lastResolved = initial;
  const resolve = () => {
    const v = (inp.value || '').trim();
    if (v === lastResolved) return;
    lastResolved = v;
    if (!v) return onChange(null, null);
    const match = items.find(i => i.name.toLowerCase() === v.toLowerCase());
    if (match) onChange(match.id, match.name);
    else onChange(null, v);
  };
  inp.addEventListener('change', resolve);
  return el('span', { style: { display: 'inline-block', width: '100%' } }, [inp, datalist]);
}

export async function renderGameForm(state, gameId) {
  const root = el('div', { class: 'fade-in' }, el('div', {}, 'Loading…'));

  const [factions, missionPacks, playerNames] = await Promise.all([
    reference.factions(),
    reference.missionPacks(),
    reference.playerNames(),
  ]);

  // Load existing game if editing
  const editing = !!gameId;
  let existing = null;
  if (editing) {
    existing = await games.get(gameId);
  }

  // Working draft state.
  // For NEW games, attempt to restore an in-flight draft from localStorage
  // if one was abandoned recently — saves friends from losing entry mid-fill.
  // Edit mode never restores from localStorage; it always loads from the DB.
  let draft = makeDraft(existing);
  const DRAFT_KEY = 'tg40k:newGameDraft';
  if (!editing) {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        const hoursOld = (Date.now() - (saved.savedAt || 0)) / 36e5;
        if (hoursOld < 24 && hasMeaningfulData(saved.draft)) {
          const restore = await confirmModal({
            title: 'Restore unsaved game?',
            body: `You started entering a game ${formatAge(saved.savedAt)} and didn't save. Restore it?`,
            confirmLabel: 'Restore',
            cancelLabel: 'Discard',
          });
          if (restore) draft = saved.draft;
          else localStorage.removeItem(DRAFT_KEY);
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch { /* localStorage unavailable or corrupted: ignore */ }
  }
  // Persist on every structural rerender. Saving on keystroke would be
  // expensive; saving on rerender catches every meaningful change.
  function persistDraft() {
    if (editing) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), draft }));
    } catch { /* quota / disabled: silently drop */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  let missionDetails = { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] };
  if (draft.missionPackId) {
    missionDetails = await reference.missionDetails(draft.missionPackId);
  }

  // Prefetch detachments per faction selected
  const detachmentsByFaction = {};
  for (const p of draft.players) {
    if (p.factionId && !detachmentsByFaction[p.factionId]) {
      detachmentsByFaction[p.factionId] = await reference.detachments(p.factionId);
    }
  }

  function rerender() {
    persistDraft();
    clear(root);
    root.appendChild(buildForm());
  }

  function buildForm() {
    return el('div', {}, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-header' }, [
          el('h2', {}, editing ? `Edit Game #${gameId}` : 'New Game'),
        ]),
        el('div', { class: 'panel-body' }, [buildMetaSection(), buildPlayersSection(), buildSubmit()]),
      ]),
    ]);
  }

  function buildMetaSection() {
    const dateInput = el('input', { type: 'date', value: draft.playedAt });
    dateInput.addEventListener('change', () => { draft.playedAt = dateInput.value; });

    const formatSel = el('select', {}, ['matched','crusade','narrative','open','tournament'].map(f =>
      el('option', { value: f, selected: draft.gameFormat === f ? '' : null }, f.charAt(0).toUpperCase() + f.slice(1))
    ));
    formatSel.addEventListener('change', () => { draft.gameFormat = formatSel.value; });

    const pointsInput = el('input', { type: 'number', min: '0', step: '5', value: draft.pointsLimit ?? 2000 });
    pointsInput.addEventListener('change', () => { draft.pointsLimit = parseInt(pointsInput.value, 10) || 0; });

    const turnInput = el('input', { type: 'number', min: '0', max: '5', value: draft.turnCount ?? '' });
    turnInput.addEventListener('change', () => { draft.turnCount = turnInput.value === '' ? null : parseInt(turnInput.value, 10); });

    const endSel = el('select', {}, [
      el('option', { value: 'normal' }, 'Played to time/round'),
      el('option', { value: 'concession' }, 'Concession'),
      el('option', { value: 'tabled' }, 'Tabled'),
    ]);
    endSel.value = draft.endCondition || 'normal';
    endSel.addEventListener('change', () => { draft.endCondition = endSel.value; });

    const packSel = el('select', {}, selectOptions(missionPacks));
    packSel.value = draft.missionPackId || '';
    packSel.addEventListener('change', async () => {
      const newId = packSel.value ? parseInt(packSel.value, 10) : null;
      draft.missionPackId = newId;
      draft.primaryMissionId = null;
      draft.primaryMissionName = null;
      draft.deploymentMapId = null;
      draft.deploymentMapName = null;
      draft.missionRuleId = null;
      draft.missionRuleName = null;
      // Clear secondaries/challengers since they belong to a different pack
      for (const p of draft.players) { p.secondaries = []; p.challengers = []; }
      missionDetails = newId ? await reference.missionDetails(newId) : { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] };
      rerender();
    });

    const primarySel = comboField(missionDetails.primaryMissions, draft.primaryMissionId, draft.primaryMissionName,
      (id, name) => { draft.primaryMissionId = id; draft.primaryMissionName = id ? null : name; },
      { placeholder: 'Pick or type' });

    const deploySel = comboField(missionDetails.deploymentMaps, draft.deploymentMapId, draft.deploymentMapName,
      (id, name) => { draft.deploymentMapId = id; draft.deploymentMapName = id ? null : name; },
      { placeholder: 'Pick or type' });

    const ruleSel = comboField(missionDetails.missionRules, draft.missionRuleId, draft.missionRuleName,
      (id, name) => { draft.missionRuleId = id; draft.missionRuleName = id ? null : name; },
      { placeholder: 'None' });

    const tournNameInput = el('input', { type: 'text', placeholder: 'optional', value: draft.tournamentName ?? '' });
    tournNameInput.addEventListener('input', () => { draft.tournamentName = tournNameInput.value || null; });
    const tournRoundInput = el('input', { type: 'number', min: '0', value: draft.tournamentRound ?? '' });
    tournRoundInput.addEventListener('change', () => { draft.tournamentRound = tournRoundInput.value === '' ? null : parseInt(tournRoundInput.value, 10); });
    const tournTableInput = el('input', { type: 'number', min: '0', value: draft.tournamentTable ?? '' });
    tournTableInput.addEventListener('change', () => { draft.tournamentTable = tournTableInput.value === '' ? null : parseInt(tournTableInput.value, 10); });

    const mediumSel = el('select', {}, [
      el('option', { value: 'physical' }, 'Physical (tabletop)'),
      el('option', { value: 'digital' }, 'Digital (Tabletop Simulator)'),
    ]);
    mediumSel.value = draft.playMedium || 'physical';
    mediumSel.addEventListener('change', () => { draft.playMedium = mediumSel.value; });

    const locationInput = el('input', { type: 'text', placeholder: 'optional', value: draft.location ?? '' });
    locationInput.addEventListener('input', () => { draft.location = locationInput.value || null; });

    const notesArea = el('textarea', { placeholder: 'Battle report, key moments, terrain notes…' }, draft.notes || '');
    notesArea.addEventListener('input', () => { draft.notes = notesArea.value || null; });

    return el('div', {}, [
      el('div', { class: 'form-row cols-4' }, [
        field('Date', dateInput),
        field('Format', formatSel),
        field('Points', pointsInput),
        field('Turns played', turnInput),
      ]),
      el('div', { class: 'form-row cols-4' }, [
        field('Mission Pack', packSel),
        field('Primary Mission', primarySel),
        field('Deployment Map', deploySel),
        field('Mission Rule', ruleSel),
      ]),
      el('div', { class: 'form-row cols-4' }, [
        field('End Condition', endSel),
        field('Tournament Name', tournNameInput),
        field('Round', tournRoundInput),
        field('Table', tournTableInput),
      ]),
      el('div', { class: 'form-row cols-2' }, [
        field('Play Medium', mediumSel),
        field('Location', locationInput),
      ]),
      el('div', { class: 'form-row' }, [field('Notes', notesArea)]),
    ]);
  }

  function buildPlayersSection() {
    return el('div', { class: 'players-grid' }, draft.players.map((p, idx) => buildPlayerPanel(p, idx)));
  }

  function buildPlayerPanel(p, idx) {
    const datalistId = `player-names-${idx}`;
    const nameInput = el('input', {
      type: 'text',
      placeholder: 'Player name',
      value: p.guestName ?? '',
      list: datalistId,
      autocomplete: 'off',
    });
    nameInput.addEventListener('input', () => { p.guestName = nameInput.value || null; });
    const datalist = el('datalist', { id: datalistId },
      (playerNames || []).map(n => el('option', { value: n }, ''))
    );

    const factionSel = el('select', {}, selectOptions(factions));
    factionSel.value = p.factionId || '';
    factionSel.addEventListener('change', async () => {
      p.factionId = factionSel.value ? parseInt(factionSel.value, 10) : null;
      // Faction changed → keep whatever detachment text the user typed; new
      // datalist will reflect the new faction's seeded detachments.
      if (p.factionId && !detachmentsByFaction[p.factionId]) {
        detachmentsByFaction[p.factionId] = await reference.detachments(p.factionId);
      }
      rerender();
    });

    const detachmentListId = `detachments-${idx}`;
    const detachmentInput = el('input', {
      type: 'text',
      placeholder: p.factionId ? 'Detachment' : 'Pick a faction first',
      value: p.detachmentName ?? '',
      list: detachmentListId,
      autocomplete: 'off',
    });
    detachmentInput.addEventListener('input', () => {
      p.detachmentName = detachmentInput.value || null;
    });
    const detachmentDatalist = el('datalist', { id: detachmentListId },
      (detachmentsByFaction[p.factionId] || []).map(d => el('option', { value: d.name }, ''))
    );

    const wentFirstChk = el('input', { type: 'checkbox' });
    wentFirstChk.checked = !!p.wentFirst;
    wentFirstChk.addEventListener('change', () => {
      p.wentFirst = wentFirstChk.checked;
      // Mutually exclusive between the two players
      if (p.wentFirst) {
        const other = draft.players[1 - idx];
        other.wentFirst = false;
      }
      rerender();
    });

    const winnerChk = el('input', { type: 'checkbox' });
    winnerChk.checked = !!p.manualWinner;
    winnerChk.addEventListener('change', () => {
      p.manualWinner = winnerChk.checked;
    });

    const armyListArea = el('textarea', { placeholder: 'Paste YAAB code or army list text…' }, p.armyListCode || '');
    armyListArea.addEventListener('input', () => { p.armyListCode = armyListArea.value || null; });

    return el('div', { class: 'player-panel' }, [
      el('h2', {}, `Player ${idx + 1}`),
      el('div', { class: 'player-meta tabular' }, [
        el('span', {}, `Score: ${calcTotal(p)}`),
        ' · ',
        el('span', {}, p.wentFirst ? 'Went 1st' : '2nd'),
      ]),
      el('div', { class: 'form-row' }, [
        el('div', { class: 'form-group' }, [el('label', {}, 'Name'), nameInput, datalist]),
      ]),
      el('div', { class: 'form-row cols-2' }, [
        field('Faction', factionSel),
        el('div', { class: 'form-group' }, [
          el('label', {}, 'Detachment'),
          detachmentInput,
          detachmentDatalist,
        ]),
      ]),
      el('div', { class: 'form-row cols-2' }, [
        field('Went First', wentFirstChk, true),
        field('Winner', winnerChk, true),
      ]),
      el('div', { class: 'form-row' }, [field('Army List', armyListArea)]),
      buildRoundsTable(p),
      buildPerRoundSecondaries(p),
    ]);
  }

  function buildRoundsTable(p) {
    const rows = ROUNDS.map(rn => {
      const r = p.rounds.find(x => x.roundNumber === rn) || { roundNumber: rn, primaryScore: 0, secondaryScore: 0 };
      if (!p.rounds.find(x => x.roundNumber === rn)) p.rounds.push(r);
      const primary = el('input', { type: 'number', min: '0', max: '20', value: r.primaryScore });
      primary.addEventListener('change', () => { r.primaryScore = parseInt(primary.value, 10) || 0; });
      return el('tr', {}, [
        el('td', { style: { textAlign: 'center', color: 'var(--text-muted)' } }, `R${rn}`),
        el('td', {}, primary),
      ]);
    });

    return el('div', {}, [
      el('h3', { style: { marginTop: '14px' } }, 'Primary Scoring'),
      el('table', { class: 'round-entry-table' }, [
        el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, 'Primary')])),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  // Combined per-round scoring: 2 secondary slots + 1 optional challenger slot per round
  function buildPerRoundSecondaries(p) {
    const hasSecondaries = missionDetails.secondaryCards.length > 0;
    const hasChallengers = missionDetails.challengerCards.length > 0;

    if (!hasSecondaries && !hasChallengers) {
      return el('div', {}, [
        el('h3', { style: { marginTop: '18px' } }, 'Secondary & Challenger Scoring'),
        el('div', { class: 'muted', style: { fontSize: '12px' } },
          draft.missionPackId ? 'No cards defined for this mission pack.' : 'Choose a mission pack to score secondaries.'),
      ]);
    }

    function buildSecSlot(player, rn, entry) {
      const scoreInp = el('input', {
        type: 'number', min: '0', max: '15',
        value: entry?.score ?? 0,
        style: { width: '70px', textAlign: 'center' },
      });
      const cardSel = comboField(missionDetails.secondaryCards, entry?.cardId, entry?.cardId ? null : (entry?.cardName === 'Unspecified' ? null : (entry?.cardName ?? null)),
        (id, name) => {
          if (!id && !name) {
            if (entry) {
              if (entry.score > 0) { entry.cardId = null; entry.cardName = 'Unspecified'; }
              else { const i = player.secondaries.indexOf(entry); if (i >= 0) player.secondaries.splice(i, 1); }
            }
            rerender();
          } else if (entry) {
            entry.cardId = id; entry.cardName = name;
          } else {
            player.secondaries.push({ cardId: id, cardName: name, roundNumber: rn, score: parseInt(scoreInp.value, 10) || 0 });
            rerender();
          }
        }, { placeholder: '—' });
      scoreInp.addEventListener('change', () => {
        const v = parseInt(scoreInp.value, 10) || 0;
        if (entry) {
          entry.score = v;
          if (v === 0 && (!entry.cardName || entry.cardName === 'Unspecified')) {
            const i = player.secondaries.indexOf(entry);
            if (i >= 0) player.secondaries.splice(i, 1);
            rerender();
          }
        } else if (v > 0) {
          player.secondaries.push({ cardId: null, cardName: 'Unspecified', roundNumber: rn, score: v });
          rerender();
        }
      });
      return el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 70px', gap: '4px' } }, [cardSel, scoreInp]);
    }

    function buildChalSlot(player, rn) {
      const entry = player.challengers.find(c => c.roundNumber === rn);
      const scoreInp = el('input', {
        type: 'number', min: '0', max: '20',
        value: entry?.score ?? 0,
        style: { width: '70px', textAlign: 'center' },
      });
      const cardSel = comboField(missionDetails.challengerCards, entry?.cardId, entry?.cardId ? null : (entry?.cardName === 'Unspecified' ? null : (entry?.cardName ?? null)),
        (id, name) => {
          if (!id && !name) {
            if (entry) {
              if (entry.score > 0) { entry.cardId = null; entry.cardName = 'Unspecified'; }
              else { const i = player.challengers.indexOf(entry); if (i >= 0) player.challengers.splice(i, 1); }
            }
            rerender();
          } else if (entry) {
            entry.cardId = id; entry.cardName = name;
          } else {
            player.challengers.push({ cardId: id, cardName: name, roundNumber: rn, completed: true, score: parseInt(scoreInp.value, 10) || 0 });
            rerender();
          }
        }, { placeholder: '—' });
      scoreInp.addEventListener('change', () => {
        const v = parseInt(scoreInp.value, 10) || 0;
        if (entry) {
          entry.score = v;
          if (v === 0 && (!entry.cardName || entry.cardName === 'Unspecified')) {
            const i = player.challengers.indexOf(entry);
            if (i >= 0) player.challengers.splice(i, 1);
            rerender();
          }
        } else if (v > 0) {
          player.challengers.push({ cardId: null, cardName: 'Unspecified', roundNumber: rn, completed: true, score: v });
          rerender();
        }
      });
      return el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 70px', gap: '4px' } }, [cardSel, scoreInp]);
    }

    const colCount = hasChallengers ? '48px 1fr 1fr 1fr' : '48px 1fr 1fr';
    const headerCells = [
      el('div', {}),
      el('div', { class: 'dim', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: '4px' } }, 'Secondary 1'),
      el('div', { class: 'dim', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: '4px' } }, 'Secondary 2'),
    ];
    if (hasChallengers) headerCells.push(
      el('div', { class: 'dim', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', paddingBottom: '4px', color: 'var(--warning)' } }, 'Challenger')
    );

    const rows = ROUNDS.map(rn => {
      const existing = p.secondaries.filter(s => s.roundNumber === rn);
      const cells = [
        el('div', { style: { color: 'var(--text-muted)', fontSize: '13px', paddingTop: '8px' } }, `R${rn}`),
        buildSecSlot(p, rn, existing[0] || null),
        buildSecSlot(p, rn, existing[1] || null),
      ];
      if (hasChallengers) cells.push(buildChalSlot(p, rn));
      return el('div', { style: { display: 'grid', gridTemplateColumns: colCount, gap: '6px', marginBottom: '4px', alignItems: 'start' } }, cells);
    });

    return el('div', {}, [
      el('h3', { style: { marginTop: '18px' } }, 'Secondary & Challenger Scoring'),
      el('div', { style: { display: 'grid', gridTemplateColumns: colCount, gap: '6px', marginBottom: '2px' } }, headerCells),
      ...rows,
    ]);
  }

  function buildSubmit() {
    const errEl = el('div', { class: 'error-text' }, '');
    const submit = el('button', { class: 'btn primary' }, editing ? 'Save Changes' : 'Save Game');
    submit.addEventListener('click', async () => {
      errEl.textContent = '';
      try {
        // Snapshot for undo. On EDIT the snapshot is the current server state.
        // On NEW it's just "delete the game we created" via admin (admin only)
        // OR a no-op for non-admins (we only fire toast saying it saved).
        const previousSnapshot = editing ? await games.get(gameId) : null;
        const wasEditing = editing;
        const payload = serializeDraft(draft);
        if (editing) await games.update(gameId, payload);
        else {
          const created = await games.create(payload);
          gameId = created.id;
        }
        clearDraft();
        if (wasEditing && previousSnapshot) {
          showUndoToast(`Game saved · `, async () => {
            try {
              await games.update(previousSnapshot.id, restorePayload(previousSnapshot));
              toast('Reverted to previous version');
              window.__nav('/games/' + previousSnapshot.id);
            } catch (e) { toast('Undo failed: ' + e.message, 'error'); }
          });
        } else {
          toast('Game saved');
        }
        window.__nav('/games/' + gameId);
      } catch (e) {
        errEl.textContent = e.message || 'Failed to save';
      }
    });

    const cancel = el('button', { class: 'btn', onClick: () => window.__nav(editing ? '/games/' + gameId : '/games') }, 'Cancel');

    const discardDraft = !editing && hasMeaningfulData(draft) ? el('button', {
      class: 'btn small',
      type: 'button',
      onClick: async () => {
        const ok = await confirmModal({
          title: 'Discard draft?',
          body: 'Throw away the current entry and start fresh.',
          confirmLabel: 'Discard',
        });
        if (!ok) return;
        clearDraft();
        location.reload();
      },
    }, 'Discard draft') : null;

    return el('div', { style: { marginTop: '20px' } }, [
      errEl,
      el('div', { class: 'btn-group' }, [submit, cancel, discardDraft].filter(Boolean)),
    ]);
  }

  rerender();
  return root;
}

function field(label, control, inline) {
  if (inline) {
    return el('div', { class: 'form-group' }, [
      el('label', {}, label),
      el('div', { style: { padding: '8px 0' } }, control),
    ]);
  }
  return el('div', { class: 'form-group' }, [el('label', {}, label), control]);
}

function calcTotal(p) {
  return (p.rounds || []).reduce((s, r) => s + (r.primaryScore || 0) + (r.secondaryScore || 0), 0);
}

function updateTotal(p) {
  // No-op visually; total displays on next rerender
}

function makeDraft(existing) {
  if (!existing) {
    return {
      playedAt: new Date().toISOString().slice(0, 10),
      gameFormat: 'matched',
      pointsLimit: 2000,
      missionPackId: null,
      primaryMissionId: null,
      primaryMissionName: null,
      deploymentMapId: null,
      deploymentMapName: null,
      missionRuleId: null,
      missionRuleName: null,
      turnCount: null,
      endCondition: 'normal',
      tournamentName: null,
      tournamentRound: null,
      tournamentTable: null,
      location: null,
      notes: null,
      playMedium: 'physical',
      players: [emptyPlayer(), emptyPlayer()],
    };
  }
  return {
    playedAt: existing.played_at?.slice(0, 10),
    gameFormat: existing.game_format,
    pointsLimit: existing.points_limit,
    missionPackId: existing.mission_pack_id,
    primaryMissionId: existing.primary_mission_id,
    primaryMissionName: null,
    deploymentMapId: existing.deployment_map_id,
    deploymentMapName: null,
    missionRuleId: existing.mission_rule_id,
    missionRuleName: null,
    turnCount: existing.turn_count,
    endCondition: existing.end_condition,
    tournamentName: existing.tournament_name,
    tournamentRound: existing.tournament_round,
    tournamentTable: existing.tournament_table,
    location: existing.location,
    notes: existing.notes,
    playMedium: existing.play_medium || 'physical',
    players: existing.players.map(p => ({
      userId: p.user_id,
      guestName: p.guest_name || (p.display_name && p.user_id ? p.display_name : null),
      factionId: p.faction_id,
      detachmentId: p.detachment_id,
      detachmentName: p.detachment_name,
      armyListCode: p.army_list_code,
      wentFirst: p.went_first,
      isAttacker: p.is_attacker,
      finalScore: p.final_score,
      result: p.result,
      manualWinner: p.result === 'win',
      rounds: (p.rounds || []).map(r => ({
        roundNumber: r.round_number,
        primaryScore: r.primary_score,
        secondaryScore: r.secondary_score,
        cpRemaining: r.cp_remaining,
      })),
      secondaries: (p.secondaries || []).map(s => ({
        cardId: s.card_id, cardName: s.card_name, roundNumber: s.round_number,
        score: s.score, wasDiscarded: s.was_discarded,
      })),
      challengers: (p.challengers || []).map(c => ({
        cardId: c.card_id, cardName: c.card_name, roundNumber: c.round_number,
        completed: c.completed, score: c.score,
      })),
    })),
  };
}

function emptyPlayer() {
  return {
    userId: null, guestName: null,
    factionId: null, detachmentId: null, detachmentName: null,
    armyListCode: null, wentFirst: false, isAttacker: null,
    manualWinner: false,
    rounds: ROUNDS.map(n => ({ roundNumber: n, primaryScore: 0, secondaryScore: 0 })),
    secondaries: [], challengers: [],
  };
}

function serializeDraft(d) {
  return {
    playedAt: d.playedAt,
    gameFormat: d.gameFormat,
    pointsLimit: d.pointsLimit,
    missionPackId: d.missionPackId,
    primaryMissionId: d.primaryMissionId,
    primaryMissionName: d.primaryMissionName ?? null,
    deploymentMapId: d.deploymentMapId,
    deploymentMapName: d.deploymentMapName ?? null,
    missionRuleId: d.missionRuleId,
    missionRuleName: d.missionRuleName ?? null,
    turnCount: d.turnCount,
    endCondition: d.endCondition,
    tournamentName: d.tournamentName,
    tournamentRound: d.tournamentRound,
    tournamentTable: d.tournamentTable,
    location: d.location,
    notes: d.notes,
    playMedium: d.playMedium || 'physical',
    players: d.players.map(p => ({
      ...p,
      secondaries: (p.secondaries || []).filter(s => s.cardName),
      challengers: (p.challengers || []).filter(c => c.cardName),
    })),
  };
}

// "Has the user actually entered anything worth saving?" — used to decide
// whether to offer draft restore on form load and a Discard-draft button.
function hasMeaningfulData(d) {
  if (!d || !d.players) return false;
  if (d.players.some(p => p.guestName || p.factionId)) return true;
  if (d.players.some(p => (p.rounds || []).some(r => r.primaryScore))) return true;
  if (d.notes || d.location || d.tournamentName) return true;
  return false;
}

function formatAge(ts) {
  if (!ts) return 'a while ago';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return 'over a day ago';
}

// Convert a server `games.get(id)` response back into the camelCase
// payload shape that PUT /games/:id expects, so we can re-save the
// pre-edit snapshot when the user hits Undo.
function restorePayload(g) {
  return {
    playedAt: g.played_at?.slice(0, 10),
    gameFormat: g.game_format,
    pointsLimit: g.points_limit,
    missionPackId: g.mission_pack_id,
    primaryMissionId: g.primary_mission_id,
    deploymentMapId: g.deployment_map_id,
    missionRuleId: g.mission_rule_id,
    turnCount: g.turn_count,
    endCondition: g.end_condition,
    tournamentName: g.tournament_name,
    tournamentRound: g.tournament_round,
    tournamentTable: g.tournament_table,
    location: g.location,
    notes: g.notes,
    playMedium: g.play_medium || 'physical',
    players: g.players.map(p => ({
      userId: p.user_id,
      guestName: p.guest_name,
      factionId: p.faction_id,
      detachmentId: p.detachment_id,
      detachmentName: p.detachment_name,
      armyListCode: p.army_list_code,
      wentFirst: p.went_first,
      isAttacker: p.is_attacker,
      finalScore: p.final_score,
      result: p.result,
      manualWinner: p.result === 'win',
      rounds: (p.rounds || []).map(r => ({
        roundNumber: r.round_number,
        primaryScore: r.primary_score,
        secondaryScore: r.secondary_score,
        cpRemaining: r.cp_remaining,
      })),
      secondaries: (p.secondaries || []).map(s => ({
        cardId: s.card_id, cardName: s.card_name, roundNumber: s.round_number,
        score: s.score, wasDiscarded: s.was_discarded,
      })),
      challengers: (p.challengers || []).map(c => ({
        cardId: c.card_id, cardName: c.card_name, roundNumber: c.round_number,
        completed: c.completed, score: c.score,
      })),
    })),
  };
}

// Action toast: shows a message with an "Undo" button for ~12 seconds.
// Reuses the same #toast div as toast(); replaces its contents with an
// inline form. Click anywhere else and it dismisses normally.
function showUndoToast(message, onUndo) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = message;
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  btn.style.cssText = 'background: var(--accent); color: var(--accent-on); border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: var(--font-display); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; margin-left: 10px;';
  btn.addEventListener('click', () => {
    t.classList.remove('show');
    onUndo();
  });
  t.appendChild(span);
  t.appendChild(btn);
  t.classList.remove('error');
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); t.textContent = ''; }, 12000);
}
