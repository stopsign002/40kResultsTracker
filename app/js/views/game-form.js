import { games, reference } from '../api.js';
import { el, clear, toast, selectOptions } from '../components.js';

const ROUNDS = [1, 2, 3, 4, 5];

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

  // Working draft state
  const draft = makeDraft(existing);

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
      draft.deploymentMapId = null;
      draft.missionRuleId = null;
      // Clear secondaries/challengers since they belong to a different pack
      for (const p of draft.players) { p.secondaries = []; p.challengers = []; }
      missionDetails = newId ? await reference.missionDetails(newId) : { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] };
      rerender();
    });

    const primarySel = el('select', {}, selectOptions(missionDetails.primaryMissions));
    primarySel.value = draft.primaryMissionId || '';
    primarySel.addEventListener('change', () => { draft.primaryMissionId = primarySel.value ? parseInt(primarySel.value, 10) : null; });

    const deploySel = el('select', {}, selectOptions(missionDetails.deploymentMaps));
    deploySel.value = draft.deploymentMapId || '';
    deploySel.addEventListener('change', () => { draft.deploymentMapId = deploySel.value ? parseInt(deploySel.value, 10) : null; });

    const ruleSel = el('select', {}, [
      el('option', { value: '' }, 'None'),
      ...missionDetails.missionRules.map(r => el('option', { value: r.id }, r.name)),
    ]);
    ruleSel.value = draft.missionRuleId || '';
    ruleSel.addEventListener('change', () => { draft.missionRuleId = ruleSel.value ? parseInt(ruleSel.value, 10) : null; });

    const tournNameInput = el('input', { type: 'text', placeholder: 'optional', value: draft.tournamentName ?? '' });
    tournNameInput.addEventListener('input', () => { draft.tournamentName = tournNameInput.value || null; });
    const tournRoundInput = el('input', { type: 'number', min: '0', value: draft.tournamentRound ?? '' });
    tournRoundInput.addEventListener('change', () => { draft.tournamentRound = tournRoundInput.value === '' ? null : parseInt(tournRoundInput.value, 10); });
    const tournTableInput = el('input', { type: 'number', min: '0', value: draft.tournamentTable ?? '' });
    tournTableInput.addEventListener('change', () => { draft.tournamentTable = tournTableInput.value === '' ? null : parseInt(tournTableInput.value, 10); });

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
      el('div', { class: 'form-row' }, [field('Location', locationInput)]),
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

    function secOptions(selectedId) {
      return [
        el('option', { value: '' }, '—'),
        ...missionDetails.secondaryCards.map(c =>
          el('option', { value: c.id, selected: selectedId == c.id ? '' : null }, c.name)
        ),
      ];
    }

    function chalOptions(selectedId) {
      return [
        el('option', { value: '' }, '—'),
        ...missionDetails.challengerCards.map(c =>
          el('option', { value: c.id, selected: selectedId == c.id ? '' : null }, c.name)
        ),
      ];
    }

    function buildSecSlot(player, rn, entry) {
      const cardSel = el('select', {}, secOptions(entry?.cardId));
      const scoreInp = el('input', {
        type: 'number', min: '0', max: '15',
        value: entry?.score ?? 0,
        style: { width: '70px', textAlign: 'center' },
      });
      cardSel.addEventListener('change', () => {
        if (!cardSel.value) {
          if (entry) { const i = player.secondaries.indexOf(entry); if (i >= 0) player.secondaries.splice(i, 1); }
          rerender();
        } else {
          const card = missionDetails.secondaryCards.find(c => c.id == cardSel.value);
          if (entry) { entry.cardId = card.id; entry.cardName = card.name; }
          else { player.secondaries.push({ cardId: card.id, cardName: card.name, roundNumber: rn, score: parseInt(scoreInp.value, 10) || 0 }); }
          rerender();
        }
      });
      scoreInp.addEventListener('change', () => {
        const v = parseInt(scoreInp.value, 10) || 0;
        if (entry) { entry.score = v; }
        else if (cardSel.value) {
          const card = missionDetails.secondaryCards.find(c => c.id == cardSel.value);
          player.secondaries.push({ cardId: card.id, cardName: card.name, roundNumber: rn, score: v });
          rerender();
        }
      });
      return el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 70px', gap: '4px' } }, [cardSel, scoreInp]);
    }

    function buildChalSlot(player, rn) {
      const entry = player.challengers.find(c => c.roundNumber === rn);
      const cardSel = el('select', {}, chalOptions(entry?.cardId));
      const scoreInp = el('input', {
        type: 'number', min: '0', max: '20',
        value: entry?.score ?? 0,
        style: { width: '70px', textAlign: 'center' },
      });
      cardSel.addEventListener('change', () => {
        if (!cardSel.value) {
          if (entry) { const i = player.challengers.indexOf(entry); if (i >= 0) player.challengers.splice(i, 1); }
          rerender();
        } else {
          const card = missionDetails.challengerCards.find(c => c.id == cardSel.value);
          if (entry) { entry.cardId = card.id; entry.cardName = card.name; }
          else { player.challengers.push({ cardId: card.id, cardName: card.name, roundNumber: rn, completed: true, score: parseInt(scoreInp.value, 10) || 0 }); }
          rerender();
        }
      });
      scoreInp.addEventListener('change', () => {
        const v = parseInt(scoreInp.value, 10) || 0;
        if (entry) { entry.score = v; }
        else if (cardSel.value) {
          const card = missionDetails.challengerCards.find(c => c.id == cardSel.value);
          player.challengers.push({ cardId: card.id, cardName: card.name, roundNumber: rn, completed: true, score: v });
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
        const payload = serializeDraft(draft);
        if (editing) await games.update(gameId, payload);
        else {
          const created = await games.create(payload);
          gameId = created.id;
        }
        toast('Game saved');
        window.__nav('/games/' + gameId);
      } catch (e) {
        errEl.textContent = e.message || 'Failed to save';
      }
    });

    const cancel = el('button', { class: 'btn', onClick: () => window.__nav(editing ? '/games/' + gameId : '/games') }, 'Cancel');

    return el('div', { style: { marginTop: '20px' } }, [
      errEl,
      el('div', { class: 'btn-group' }, [submit, cancel]),
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
      deploymentMapId: null,
      missionRuleId: null,
      turnCount: null,
      endCondition: 'normal',
      tournamentName: null,
      tournamentRound: null,
      tournamentTable: null,
      location: null,
      notes: null,
      players: [emptyPlayer(), emptyPlayer()],
    };
  }
  return {
    playedAt: existing.played_at?.slice(0, 10),
    gameFormat: existing.game_format,
    pointsLimit: existing.points_limit,
    missionPackId: existing.mission_pack_id,
    primaryMissionId: existing.primary_mission_id,
    deploymentMapId: existing.deployment_map_id,
    missionRuleId: existing.mission_rule_id,
    turnCount: existing.turn_count,
    endCondition: existing.end_condition,
    tournamentName: existing.tournament_name,
    tournamentRound: existing.tournament_round,
    tournamentTable: existing.tournament_table,
    location: existing.location,
    notes: existing.notes,
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
    deploymentMapId: d.deploymentMapId,
    missionRuleId: d.missionRuleId,
    turnCount: d.turnCount,
    endCondition: d.endCondition,
    tournamentName: d.tournamentName,
    tournamentRound: d.tournamentRound,
    tournamentTable: d.tournamentTable,
    location: d.location,
    notes: d.notes,
    players: d.players.map(p => ({
      ...p,
      // Strip empty secondaries and challengers (no card chosen)
      secondaries: (p.secondaries || []).filter(s => s.cardId && s.cardName),
      challengers: (p.challengers || []).filter(c => c.cardId && c.cardName),
    })),
  };
}
