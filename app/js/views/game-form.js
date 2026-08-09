import { games, reference } from '../api.js';
import { el, clear, toast, selectOptions, confirmModal, fmtDuration } from '../components.js';
import { looksLikeYaabCode, normaliseArmyList } from '../army-list.js';
import { missionLink, fixedSecondaryOptions } from '../mission-cards.js';
import {
  ROUNDS, DEFAULT_EDITION, MATCHED_PLAY_LAYOUTS, E11_PRIMARY_CAP, E11_SECONDARY_CAP,
  E11_PRIMARY_ROUND_CAP, E11_SECONDARY_ROUND_CAP, secondaryRoundHeadroom,
  FORCE_DISPOSITIONS, PRIMARY_MATRIX, parseDuration,
  secondaryMode, isFixedMode, foldCardName, fixedCardTotal, fixedCardHeadroom,
  FIXED_SECONDARY_COUNT, E11_FIXED_CARD_CAP,
  sumPrimary, sumSecondaries, sumSecondaryPoints, capLabel, calcTotal,
} from '../game-rules.js';

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

  // Which secondaries may be taken Fixed comes from the mission-card deck, not
  // the DB — see fixedSecondaryOptions(). 11e only, and lazily: a 10e write-up
  // has no Fixed missions and shouldn't pay for 51KB of card data.
  let fixedOptions = [];
  if ((draft.edition || DEFAULT_EDITION) === '11') {
    fixedOptions = await fixedSecondaryOptions().catch(() => []);
  }

  // Prefetch detachments per faction selected
  const detachmentsByFaction = {};
  for (const p of draft.players) {
    if (p.factionId && !detachmentsByFaction[p.factionId]) {
      detachmentsByFaction[p.factionId] = await reference.detachments(p.factionId);
    }
  }

  const is11 = () => (draft.edition || DEFAULT_EDITION) === '11';

  // Once both dispositions are known the pairing dictates both primaries, so
  // fill them in. Still editable afterwards — this is a shortcut, not a lock.
  function applyPrimaryMatrix() {
    const [a, b] = draft.players;
    if (!a || !b) return;
    const setFor = (me, opp) => {
      const name = PRIMARY_MATRIX[me.forceDisposition]?.[opp.forceDisposition];
      if (!name) return;
      const match = (missionDetails.primaryMissions || [])
        .find(m => (m.name || '').toLowerCase() === name.toLowerCase());
      me.primaryMissionId = match ? match.id : null;
      me.primaryMissionName = match ? null : name;
    };
    setFor(a, b);
    setFor(b, a);
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
      draft.mapMode = null;
      draft.missionRuleId = null;
      draft.missionRuleName = null;
      // Clear secondaries/challengers since they belong to a different pack.
      // 11e per-player primaries are pack-scoped too, so they go with them.
      for (const p of draft.players) {
        p.secondaries = [];
        p.challengers = [];
        p.primaryMissionId = null;
        p.primaryMissionName = null;
      }
      missionDetails = newId ? await reference.missionDetails(newId) : { primaryMissions: [], deploymentMaps: [], missionRules: [], secondaryCards: [], challengerCards: [] };
      rerender();
    });

    const primarySel = comboField(missionDetails.primaryMissions, draft.primaryMissionId, draft.primaryMissionName,
      (id, name) => { draft.primaryMissionId = id; draft.primaryMissionName = id ? null : name; },
      { placeholder: 'Pick or type' });

    const deploySel = comboField(missionDetails.deploymentMaps, draft.deploymentMapId, draft.deploymentMapName,
      (id, name) => { draft.deploymentMapId = id; draft.deploymentMapName = id ? null : name; },
      { placeholder: 'Pick or type' });

    // 11e: the map is one of GW's three recommended matched-play terrain
    // layouts, or a table you laid out yourself. It's stored in the SAME
    // deployment_map slot as 10e — 'Layout A' just becomes a deployment_maps
    // row for the pack — so the games-list filter, /stats/faction-deployment-
    // breakdown and the detail view all keep working untouched.
    function buildMapField() {
      if (!is11()) return field('Deployment Map', deploySel);

      const currentName = draft.deploymentMapName
        ?? (draft.deploymentMapId != null
            ? ((missionDetails.deploymentMaps || []).find(d => d.id == draft.deploymentMapId)?.name ?? null)
            : null);

      const setMap = (name) => {
        const clean = (name || '').trim();
        const match = (missionDetails.deploymentMaps || [])
          .find(d => (d.name || '').toLowerCase() === clean.toLowerCase());
        draft.deploymentMapId = match ? match.id : null;
        draft.deploymentMapName = match ? null : (clean || null);
      };

      // The chosen mode is remembered on the draft rather than re-derived from
      // the value every render, or picking Custom and not yet typing anything
      // would snap straight back to Matched Play.
      if (!draft.mapMode) {
        draft.mapMode = (currentName && !MATCHED_PLAY_LAYOUTS.includes(currentName))
          ? 'custom'
          : 'matched';
      }

      const modeSel = el('select', {}, [
        el('option', { value: 'matched' }, 'Matched Play Maps'),
        el('option', { value: 'custom' }, 'Custom'),
      ]);
      modeSel.value = draft.mapMode;
      modeSel.addEventListener('change', () => {
        draft.mapMode = modeSel.value;
        setMap(null);
        rerender();
      });

      let picker;
      if (draft.mapMode === 'matched') {
        picker = el('select', {}, [
          el('option', { value: '' }, '— Select layout —'),
          ...MATCHED_PLAY_LAYOUTS.map(n => el('option', { value: n }, n)),
        ]);
        picker.value = MATCHED_PLAY_LAYOUTS.includes(currentName) ? currentName : '';
        picker.addEventListener('change', () => setMap(picker.value));
      } else {
        // Suggest only layouts people have actually named, not the stock three.
        const customSeen = (missionDetails.deploymentMaps || [])
          .filter(d => !MATCHED_PLAY_LAYOUTS.includes(d.name));
        picker = comboField(customSeen, draft.deploymentMapId, draft.deploymentMapName,
          (id, name) => { draft.deploymentMapId = id; draft.deploymentMapName = id ? null : name; },
          { placeholder: 'Name your layout' });
      }

      return el('div', { class: 'form-group' }, [
        el('label', {}, 'Terrain Layout'),
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', alignItems: 'center' } },
          [modeSel, picker]),
      ]);
    }

    const ruleSel = comboField(missionDetails.missionRules, draft.missionRuleId, draft.missionRuleName,
      (id, name) => { draft.missionRuleId = id; draft.missionRuleName = id ? null : name; },
      { placeholder: 'None' });

    const tournNameInput = el('input', { type: 'text', placeholder: 'optional', value: draft.tournamentName ?? '' });
    tournNameInput.addEventListener('input', () => { draft.tournamentName = tournNameInput.value || null; });
    const tournRoundInput = el('input', { type: 'number', min: '0', value: draft.tournamentRound ?? '' });
    tournRoundInput.addEventListener('change', () => { draft.tournamentRound = tournRoundInput.value === '' ? null : parseInt(tournRoundInput.value, 10); });
    const tournTableInput = el('input', { type: 'number', min: '0', value: draft.tournamentTable ?? '' });
    tournTableInput.addEventListener('change', () => { draft.tournamentTable = tournTableInput.value === '' ? null : parseInt(tournTableInput.value, 10); });

    const editionSel = el('select', {}, [
      el('option', { value: '11' }, '11th Edition'),
      el('option', { value: '10' }, '10th Edition'),
    ]);
    editionSel.value = draft.edition || DEFAULT_EDITION;
    // Structural: 11e moves the primary mission per-player and swaps the whole
    // secondary section, so the form has to be rebuilt.
    editionSel.addEventListener('change', async () => {
      draft.edition = editionSel.value;
      // Switching a 10e write-up to 11e is the one path that reaches the Fixed
      // picker without having paid for the card data at load.
      if (draft.edition === '11' && !fixedOptions.length) {
        fixedOptions = await fixedSecondaryOptions().catch(() => []);
      }
      rerender();
    });

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
      is11()
        ? el('div', { class: 'form-row cols-3' }, [
            field('Mission Pack', packSel),
            buildMapField(),
            field('Mission Rule', ruleSel),
          ])
        : el('div', { class: 'form-row cols-4' }, [
            field('Mission Pack', packSel),
            field('Primary Mission', primarySel),
            buildMapField(),
            field('Mission Rule', ruleSel),
          ]),
      el('div', { class: 'form-row cols-4' }, [
        field('End Condition', endSel),
        field('Tournament Name', tournNameInput),
        field('Round', tournRoundInput),
        field('Table', tournTableInput),
      ]),
      el('div', { class: 'form-row cols-3' }, [
        field('Edition', editionSel),
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

    const dispositionSel = el('select', {}, [
      el('option', { value: '' }, '— Select —'),
      ...FORCE_DISPOSITIONS.map(d => el('option', { value: d }, d)),
    ]);
    dispositionSel.value = p.forceDisposition || '';
    dispositionSel.addEventListener('change', () => {
      p.forceDisposition = dispositionSel.value || null;
      applyPrimaryMatrix();
      rerender();
    });

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
    // A YAAB share code is expanded to readable text on blur, so what gets
    // stored is legible and the games-list free-text search matches unit names
    // rather than base64. Anything else is kept exactly as pasted.
    armyListArea.addEventListener('change', async () => {
      const before = armyListArea.value;
      if (!looksLikeYaabCode(before) && !before.trim().startsWith('{')) return;
      const { value } = await normaliseArmyList(before);
      if (armyListArea.value !== before) return;
      armyListArea.value = value || before;
      p.armyListCode = armyListArea.value || null;
    });

    return el('div', { class: 'player-panel' }, [
      el('h2', {}, `Player ${idx + 1}`),
      el('div', { class: 'player-meta tabular' }, [
        el('span', { 'data-player-total': String(idx) }, `Score: ${calcTotal(p, draft.edition)}`),
        ' · ',
        el('span', {}, p.wentFirst ? 'Went 1st' : '2nd'),
      ]),
      el('div', { class: 'form-row' }, [
        el('div', { class: 'form-group' }, [el('label', {}, 'Name'), nameInput, datalist]),
      ]),
      el('div', { class: 'form-row cols-2' }, [
        field('Faction', factionSel),
        buildDetachments(p, idx),
      ]),
      is11()
        ? el('div', { class: 'form-row cols-2' }, [
            field('Force Disposition', dispositionSel),
            el('div', { class: 'form-group' }, [
              el('label', {}, 'Primary Mission'),
              comboField(missionDetails.primaryMissions, p.primaryMissionId, p.primaryMissionName,
                (id, name) => { p.primaryMissionId = id; p.primaryMissionName = id ? null : name; },
                { placeholder: draft.missionPackId ? 'Pick or type' : 'Choose a mission pack first' }),
              el('div', { class: 'dim', style: { fontSize: '11px', marginTop: '4px' } }, [
                bothDispositionsSet()
                  ? 'Set from the disposition pairing — override if needed.'
                  : 'Set both players\' dispositions to fill this in automatically.',
                ...(primaryNameFor(p) ? [' ', missionLink('primary', primaryNameFor(p))] : []),
              ]),
            ]),
          ])
        : null,
      el('div', { class: 'form-row cols-3' }, [
        field('Went First', wentFirstChk, true),
        field('Winner', winnerChk, true),
        buildTotalTime(p, idx),
      ]),
      el('div', { class: 'form-row' }, [field('Army List', armyListArea)]),
      scoreMode(p) === 'final' ? null : buildRoundsTable(p),
      buildScoreModeToggle(p),
      scoreMode(p) === 'final' ? buildFinalScoreOnly(p, idx) : null,
      scoreMode(p) === 'cards' && is11() ? buildSecondaryMode(p) : null,
      scoreMode(p) === 'cards'
        ? (is11()
            ? (isFixedMode(p) ? buildFixedSecondaries(p) : buildHeldSecondaries(p))
            : buildPerRoundSecondaries(p))
        : null,
    ].filter(Boolean));
  }

  // Three rungs of "how much did anyone actually write down":
  //   cards  — which secondary scored, and when
  //   rounds — per-round primary/secondary totals only
  //   final  — nothing but the final score
  // Derived from the data on load rather than stored, so an old game opens in
  // whichever mode matches what it actually holds.
  function scoreMode(p) {
    if (!p.scoreMode) {
      const hasCards = (p.secondaries || []).length > 0;
      const hasRounds = (p.rounds || []).some(
        r => (r.primaryScore || 0) > 0 || (r.secondaryScore || 0) > 0);
      if (hasCards) p.scoreMode = 'cards';
      else if (hasRounds) p.scoreMode = 'rounds';
      else if ((p.finalScore || 0) > 0) p.scoreMode = 'final';
      else p.scoreMode = 'cards';
    }
    return p.scoreMode;
  }

  async function setScoreMode(p, mode) {
    const from = scoreMode(p);
    if (mode === from) return;

    const cardsWithData = (p.secondaries || []).filter(
      s => s.drawnRound != null || s.roundNumber != null || (s.score || 0) > 0);
    const roundsWithData = (p.rounds || []).filter(
      r => (r.primaryScore || 0) > 0 || (r.secondaryScore || 0) > 0);

    // Anything being coarsened loses detail; say so once rather than silently.
    const losing = mode === 'final'
      ? cardsWithData.length + roundsWithData.length
      : (mode === 'rounds' ? cardsWithData.length : 0);
    if (losing) {
      const ok = await confirmModal({
        title: mode === 'final' ? 'Switch to final score only?' : 'Switch to round totals?',
        body: mode === 'final'
          ? 'The per-round breakdown for this player will be cleared. The total carries over, but the round-by-round detail is lost.'
          : 'The cards recorded for this player will be replaced by per-round totals. The points carry over, but which card scored them is lost.',
        confirmLabel: 'Switch',
      });
      if (!ok) { rerender(); return; }
    }

    if (mode === 'rounds') {
      // Carry the numbers across so nothing has to be re-typed.
      for (const r of p.rounds || []) {
        r.secondaryScore = (p.secondaries || [])
          .filter(x => x.roundNumber === r.roundNumber)
          .reduce((sum, x) => sum + (x.score || 0), 0);
      }
      p.secondaries = [];
    } else if (mode === 'final') {
      p.finalScore = calcTotal(p, draft.edition);
      p.secondaries = [];
      for (const r of p.rounds || []) { r.primaryScore = 0; r.secondaryScore = 0; }
    } else {
      // Card scoring re-derives the per-round figure, so stale manual totals
      // would be overwritten on save anyway — clear them now so the live
      // readout matches what will be stored.
      for (const r of p.rounds || []) r.secondaryScore = 0;
    }
    p.scoreMode = mode;
    rerender();
  }

  const bothDispositionsSet = () =>
    draft.players.every(pl => !!pl.forceDisposition);

  // A player's primary, whether it resolved to a seeded row or was typed.
  const primaryNameFor = (p) => {
    if (p.primaryMissionName) return p.primaryMissionName;
    const m = (missionDetails.primaryMissions || []).find(x => x.id === p.primaryMissionId);
    return m ? m.name : null;
  };

  // 11e allows more than one detachment per player, so this is a list of
  // inputs rather than one field. Always renders at least one row; empties are
  // stripped at serialize time.
  function buildDetachments(p, idx) {
    if (!Array.isArray(p.detachments)) {
      p.detachments = p.detachmentName ? [p.detachmentName] : [];
    }
    if (!p.detachments.length) p.detachments.push('');

    const listId = `detachments-${idx}`;
    const datalist = el('datalist', { id: listId },
      (detachmentsByFaction[p.factionId] || []).map(d => el('option', { value: d.name }, ''))
    );

    const syncJoined = () => {
      p.detachmentName = p.detachments.map(d => (d || '').trim()).filter(Boolean).join(', ') || null;
    };

    const rows = p.detachments.map((name, di) => {
      const inp = el('input', {
        type: 'text',
        placeholder: p.factionId ? 'Detachment' : 'Pick a faction first',
        value: name ?? '',
        list: listId,
        autocomplete: 'off',
      });
      inp.addEventListener('input', () => { p.detachments[di] = inp.value; syncJoined(); });

      const remove = p.detachments.length > 1
        ? el('button', { class: 'btn small', type: 'button', title: 'Remove detachment' }, '×')
        : null;
      if (remove) {
        remove.addEventListener('click', () => {
          p.detachments.splice(di, 1);
          syncJoined();
          rerender();
        });
      }

      return el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: remove ? '1fr 30px' : '1fr',
          gap: '6px',
          marginBottom: '4px',
        },
      }, [inp, remove].filter(Boolean));
    });

    const add = el('button', { class: 'btn small', type: 'button' }, '+ Add detachment');
    add.addEventListener('click', () => { p.detachments.push(''); rerender(); });

    return el('div', { class: 'form-group' }, [
      el('label', {}, p.detachments.length > 1 ? 'Detachments' : 'Detachment'),
      ...rows,
      datalist,
      add,
    ]);
  }

  const roundsAreClocked = (p) => (p.rounds || []).some(r => r.timeSeconds != null);
  const roundsTotal = (p) => (p.rounds || []).reduce((sum, r) => sum + (r.timeSeconds || 0), 0);

  // Total chess-clock time. Derived from the rounds by default, so the headline
  // can never contradict the per-round breakdown — the same rule the server
  // applies in resolvePlayerTimes(). "Edit" opts this player out: the typed
  // total then outranks the rounds, which stay on the record as whatever the
  // clock actually saw. Without that escape hatch a live-tracked game, which
  // arrives with every round clocked, had no editable total at all.
  function buildTotalTime(p, idx) {
    const group = el('div', { class: 'form-group' });

    function paint() {
      clear(group);
      const clocked = roundsAreClocked(p);
      const derived = clocked && !p.timeIsManual;

      const inp = el('input', {
        type: 'text', inputmode: 'numeric',
        placeholder: derived ? '' : 'e.g. 1:12:30',
        value: fmtDuration(derived ? roundsTotal(p) : p.timeSeconds) ?? '',
        readonly: derived ? '' : null,
        'data-time-total': String(idx),
        style: derived ? { opacity: '0.7' } : null,
      });
      if (!derived) {
        inp.addEventListener('change', () => {
          p.timeSeconds = parseDuration(inp.value);
          inp.value = fmtDuration(p.timeSeconds) ?? '';
        });
      }

      const toggle = clocked
        ? el('button', {
            class: 'btn small', type: 'button',
            title: p.timeIsManual
              ? 'Go back to the sum of the round clocks'
              : 'Set the total by hand, leaving the round clocks as they are',
            onClick: () => {
              p.timeIsManual = !p.timeIsManual;
              if (p.timeIsManual) p.timeSeconds = roundsTotal(p);
              paint();
              const box = group.querySelector('input');
              if (p.timeIsManual && box) box.focus();
            },
          }, p.timeIsManual ? 'Use round times' : 'Edit')
        : null;

      const children = [
        el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
        }, [
          el('label', { style: { margin: '0' } },
            derived ? 'Total Time (from rounds)'
              : clocked ? 'Total Time (set by hand)' : 'Total Time'),
          toggle,
        ].filter(Boolean)),
        inp,
      ];
      if (p.timeIsManual) {
        children.push(el('div', {
          class: 'dim', style: { fontSize: '11px', marginTop: '4px' },
          'data-time-rounds': String(idx),
        }, roundsHint(p)));
      }
      children.forEach(c => group.appendChild(c));
    }

    paint();
    return group;
  }

  const roundsHint = (p) =>
    `Round clocks sum to ${fmtDuration(roundsTotal(p)) ?? '0:00'} and stay on the record.`;

  function buildScoreModeToggle(p) {
    const sel = el('select', { style: { width: 'auto' } }, [
      el('option', { value: 'cards' }, 'Track each secondary'),
      el('option', { value: 'rounds' }, 'Round totals only'),
      el('option', { value: 'final' }, 'Final score only'),
    ]);
    sel.value = scoreMode(p);
    sel.addEventListener('change', () => { setScoreMode(p, sel.value); });

    const hint = {
      rounds: 'Enter what scored each round in the Secondary column above.',
      final: 'For games where nobody kept a breakdown.',
    }[scoreMode(p)];

    return el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', flexWrap: 'wrap' },
    }, [
      el('span', { class: 'dim', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' } },
        'Score detail'),
      sel,
      hint ? el('span', { class: 'muted', style: { fontSize: '11px' } }, hint) : null,
    ].filter(Boolean));
  }

  // Sole input in 'final' mode. The rounds table and card grid are hidden, so
  // this number IS the record and the server stores it verbatim.
  function buildFinalScoreOnly(p, idx) {
    const inp = el('input', {
      type: 'number', min: '0', max: String(is11() ? 90 : 100), step: '1', inputmode: 'numeric',
      value: p.finalScore ?? 0,
      style: { maxWidth: '140px', fontSize: '18px', textAlign: 'center' },
    });
    inp.addEventListener('input', () => {
      p.finalScore = parseInt(inp.value, 10) || 0;
      refreshTotals();
    });
    return el('div', { class: 'form-group', style: { marginTop: '10px' } }, [
      el('label', {}, `Final Score (max ${is11() ? 90 : 100})`),
      inp,
    ]);
  }

  function buildRoundsTable(p) {
    const roundTotals = scoreMode(p) === 'rounds';
    const rows = ROUNDS.map(rn => {
      const r = p.rounds.find(x => x.roundNumber === rn) || { roundNumber: rn, primaryScore: 0, secondaryScore: 0 };
      if (!p.rounds.find(x => x.roundNumber === rn)) p.rounds.push(r);
      // 11e caps each half at 15 VP per battle round on top of the 45 per game.
      // 10e is left on its old ceiling deliberately — its packs score
      // differently and these are historical games being written up, so a wrong
      // cap here would block a legitimate entry with no way around it.
      const primaryMax = is11() ? E11_PRIMARY_ROUND_CAP : 20;
      const primary = el('input', {
        type: 'number', min: '0', max: String(primaryMax), step: '1', inputmode: 'numeric',
        value: r.primaryScore,
      });
      primary.addEventListener('change', () => {
        // Clamped rather than merely `max`-hinted: a number input's max is
        // advisory on typed input, and every phone keyboard ignores it.
        const asked = parseInt(primary.value, 10) || 0;
        r.primaryScore = Math.max(0, Math.min(primaryMax, asked));
        if (r.primaryScore !== asked) {
          toast(`Round ${rn} primary capped at ${primaryMax}`);
        }
        primary.value = String(r.primaryScore);
        refreshTotals();
      });
      const cells = [
        el('td', { style: { textAlign: 'center', color: 'var(--text-muted)' } }, `R${rn}`),
        el('td', {}, primary),
      ];
      if (roundTotals) {
        const secMax = is11() ? E11_SECONDARY_ROUND_CAP : 45;
        const sec = el('input', {
          type: 'number', min: '0', max: String(secMax), step: '1', inputmode: 'numeric',
          value: r.secondaryScore || 0,
        });
        // Lenient on `input` so typing "1" on the way to "12" isn't fought,
        // clamped on `change` (blur) like every other field in this form.
        sec.addEventListener('input', () => {
          r.secondaryScore = parseInt(sec.value, 10) || 0;
          refreshTotals();
        });
        sec.addEventListener('change', () => {
          const asked = parseInt(sec.value, 10) || 0;
          r.secondaryScore = Math.max(0, Math.min(secMax, asked));
          if (r.secondaryScore !== asked) {
            toast(`Round ${rn} secondary capped at ${secMax}`);
          }
          sec.value = String(r.secondaryScore);
          refreshTotals();
        });
        cells.push(el('td', {}, sec));
      }

      const time = el('input', {
        type: 'text', inputmode: 'numeric', placeholder: '–',
        value: fmtDuration(r.timeSeconds) ?? '',
        style: { textAlign: 'center' },
      });
      time.addEventListener('change', () => {
        r.timeSeconds = parseDuration(time.value);
        time.value = fmtDuration(r.timeSeconds) ?? '';
        refreshTotals();
      });
      cells.push(el('td', {}, time));

      return el('tr', {}, cells);
    });

    return el('div', {}, [
      el('h3', { style: { marginTop: '14px' } }, [
        'Primary Scoring ',
        is11() ? el('span', {
          'data-pri-total': String(draft.players.indexOf(p)),
          class: 'dim tabular',
          style: { fontSize: '12px', fontWeight: 'normal' },
        }, capLabel(sumPrimary(p), E11_PRIMARY_CAP)) : null,
      ].filter(Boolean)),
      el('table', { class: 'round-entry-table' }, [
        el('thead', {}, el('tr', {}, [
          el('th', {}, ''),
          el('th', {}, 'Primary'),
          roundTotals ? el('th', {}, 'Secondary') : null,
          el('th', { title: 'Chess clock — m:ss, or a plain number of minutes' }, 'Time'),
        ].filter(Boolean))),
        el('tbody', {}, rows),
      ]),
    ]);
  }

  // Score readouts are refreshed in place rather than by rerender(): these fire
  // from `change` on inputs, and a rebuild there steals focus from whatever the
  // user clicked into next (see CLAUDE.md pitfall #2).
  function refreshTotals() {
    draft.players.forEach((pl, i) => {
      const tot = root.querySelector(`[data-player-total="${i}"]`);
      if (tot) tot.textContent = `Score: ${calcTotal(pl, draft.edition)}`;
      const sec = root.querySelector(`[data-sec-total="${i}"]`);
      if (sec) sec.textContent = capLabel(sumSecondaryPoints(pl), E11_SECONDARY_CAP);
      const pri = root.querySelector(`[data-pri-total="${i}"]`);
      if (pri) pri.textContent = capLabel(sumPrimary(pl), E11_PRIMARY_CAP);
      const t = root.querySelector(`[data-time-total="${i}"]`);
      if (t && roundsAreClocked(pl) && !pl.timeIsManual) {
        t.value = fmtDuration(roundsTotal(pl)) ?? '';
      }
      const hint = root.querySelector(`[data-time-rounds="${i}"]`);
      if (hint) hint.textContent = roundsHint(pl);
    });
  }

  // 11e: the whole deck is laid out as fillable rows (mirroring the War
  // Journal app) so entry is "fill in the ones that came up" rather than
  // "remember every card name and type it". A row only becomes a stored
  // secondary once it has a drawn round, a scored round or a score — untouched
  // rows never reach the payload.
  /* ── Tactical vs Fixed (11e) ──────────────────────────────── */

  // The choice is made at setup, per player and in secret, so the two seats can
  // differ. Fixed missions are never drawn and never discarded — they sit
  // face-up and can score in EVERY battle round, which is why the entry grid
  // below is card x round rather than the one-row-per-card deck Tactical uses.
  const fixedPicks = (p) => {
    const seen = new Map();
    for (const s of p.secondaries || []) {
      const key = foldCardName(s.cardName);
      if (key && !seen.has(key)) seen.set(key, s.cardName);
    }
    return [...seen.values()];
  };

  const cardIdFor = (name) => {
    const want = foldCardName(name);
    return (missionDetails.secondaryCards || [])
      .find(c => foldCardName(c.name) === want)?.id ?? null;
  };

  function setFixedScore(p, name, roundNumber, vp) {
    const list = p.secondaries || (p.secondaries = []);
    const want = foldCardName(name);
    const forCard = () => list.filter(s => foldCardName(s.cardName) === want);
    let e = list.find(s => foldCardName(s.cardName) === want && s.roundNumber === roundNumber);
    if (vp > 0) {
      if (!e) {
        e = list.find(s => foldCardName(s.cardName) === want && s.roundNumber == null);
        if (e) e.roundNumber = roundNumber;
        else {
          e = { cardId: cardIdFor(name), cardName: name, drawnRound: null, roundNumber, score: 0 };
          list.push(e);
        }
      }
      e.score = vp;
    } else if (e) {
      list.splice(list.indexOf(e), 1);
    }
    // Zeroing every round must not un-choose the mission.
    if (!forCard().length) {
      list.push({ cardId: cardIdFor(name), cardName: name, drawnRound: null, roundNumber: null, score: 0 });
    }
  }

  function buildSecondaryMode(p) {
    const mode = secondaryMode(p);
    const sel = el('select', { style: { width: 'auto' } }, [
      el('option', { value: 'tactical' }, 'Tactical — drawn each round'),
      el('option', { value: 'fixed' }, `Fixed — ${FIXED_SECONDARY_COUNT} chosen at setup`),
    ]);
    sel.value = mode;
    sel.addEventListener('change', async () => {
      const next = sel.value;
      if (next === mode) return;
      if ((p.secondaries || []).length) {
        const ok = await confirmModal({
          title: next === 'fixed' ? 'Switch to Fixed?' : 'Switch to Tactical?',
          body: `That clears the ${(p.secondaries || []).length} secondary card(s) already recorded for this player.`,
          confirmLabel: 'Switch',
        });
        if (!ok) { sel.value = mode; return; }
      }
      p.secondaryMode = next;
      p.secondaries = [];
      rerender();
    });

    return el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px', flexWrap: 'wrap' },
    }, [
      el('span', { class: 'dim', style: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' } },
        'Secondaries'),
      sel,
    ]);
  }

  function buildFixedSecondaries(p) {
    if (!fixedOptions.length) {
      return el('div', { class: 'muted', style: { marginTop: '10px' } },
        'Could not load the Fixed Mission list.');
    }
    const picked = fixedPicks(p);
    const short = FIXED_SECONDARY_COUNT - picked.length;

    // Only four of the eighteen may be taken Fixed. Over the limit is allowed
    // rather than blocked — this form writes up games that already happened.
    const chooser = el('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
      fixedOptions.map(card => {
        const on = picked.some(n => foldCardName(n) === foldCardName(card.name));
        const b = el('button', { class: `btn small ${on ? 'primary' : ''}`.trim(), type: 'button' },
          `${on ? '✓ ' : ''}${card.name}`);
        b.addEventListener('click', () => {
          if (on) {
            const key = foldCardName(card.name);
            p.secondaries = (p.secondaries || []).filter(s => foldCardName(s.cardName) !== key);
          } else {
            setFixedScore(p, card.name, null, 0);
          }
          rerender();
        });
        return b;
      }));

    const rows = picked.map(name => {
      const cells = [el('td', {}, missionLink('secondary', name, { mode: 'fixed' }) || name)];
      for (const rn of ROUNDS) {
        const entry = (p.secondaries || [])
          .find(s => foldCardName(s.cardName) === foldCardName(name) && s.roundNumber === rn);
        const inp = el('input', {
          type: 'number', min: '0', max: String(E11_FIXED_CARD_CAP), step: '1', inputmode: 'numeric',
          value: entry ? String(entry.score || 0) : '',
          placeholder: '–',
          style: { textAlign: 'center' },
        });
        inp.addEventListener('change', () => {
          const asked = Math.max(0, parseInt(inp.value, 10) || 0);
          // Two ceilings at once: 15 VP of secondary per round across all cards,
          // and 20 VP per Fixed card across the battle. The entry being edited
          // is excluded from both, or re-saving it at its own number would
          // ratchet the value down a little every time.
          const here = (p.secondaries || [])
            .find(s => foldCardName(s.cardName) === foldCardName(name) && s.roundNumber === rn) || null;
          const headroom = Math.min(
            secondaryRoundHeadroom(p, rn, here),
            fixedCardHeadroom(p, name, here),
          );
          const scored = Math.min(asked, headroom);
          if (scored < asked) toast(`${name} capped at ${scored} in round ${rn}`);
          setFixedScore(p, name, rn, scored);
          inp.value = scored > 0 ? String(scored) : '';
          refreshTotals();
          refreshFixedTotals(p);
        });
        cells.push(el('td', {}, inp));
      }
      cells.push(el('td', {
        class: 'dim tabular',
        style: { textAlign: 'center', fontSize: '12px' },
        'data-fixed-total': foldCardName(name),
      }, `${fixedCardTotal(p, name)} / ${E11_FIXED_CARD_CAP}`));
      return el('tr', {}, cells);
    });

    return el('div', {}, [
      el('h3', { style: { marginTop: '14px' } }, 'Fixed Missions'),
      el('div', { class: 'dim', style: { fontSize: '11px' } },
        short > 0
          ? `Pick ${short} more — ${FIXED_SECONDARY_COUNT} Fixed Missions, scoring in any round, up to ${E11_FIXED_CARD_CAP} VP from each.`
          : `${picked.length} chosen${picked.length > FIXED_SECONDARY_COUNT ? ` — the rules allow ${FIXED_SECONDARY_COUNT}` : ''}. Each scores in any round, up to ${E11_FIXED_CARD_CAP} VP over the battle.`),
      chooser,
      rows.length
        ? el('table', { class: 'round-entry-table', style: { marginTop: '10px' } }, [
            el('thead', {}, el('tr', {}, [
              el('th', {}, 'Mission'),
              ...ROUNDS.map(rn => el('th', {}, `R${rn}`)),
              el('th', {}, 'Total'),
            ])),
            el('tbody', {}, rows),
          ])
        : null,
    ].filter(Boolean));
  }

  function refreshFixedTotals(p) {
    for (const name of fixedPicks(p)) {
      const cell = root.querySelector(`[data-fixed-total="${foldCardName(name)}"]`);
      if (cell) cell.textContent = `${fixedCardTotal(p, name)} / ${E11_FIXED_CARD_CAP}`;
    }
  }

  function buildHeldSecondaries(p) {
    const idx = draft.players.indexOf(p);
    const COLS = '1fr 88px 88px 64px 30px';
    // Alphabetical, explicitly: the API orders by (card_type, name), which is
    // only alphabetical while every card shares a type. Entry is "find the card
    // that came up", so a stable A-Z beats deck order. Codepoint compare on the
    // lowercased name — deterministic, and correct for these ASCII names.
    const deck = (missionDetails.secondaryCards || []).slice().sort((a, b) => {
      const x = (a.name || '').toLowerCase();
      const y = (b.name || '').toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    const deckNames = new Set(deck.map(c => (c.name || '').toLowerCase()));

    const findEntry = (card) => (p.secondaries || []).find(s =>
      (s.cardId != null && card.id != null && s.cardId === card.id) ||
      (s.cardName && s.cardName.toLowerCase() === (card.name || '').toLowerCase()));

    const ensure = (card) => {
      let e = findEntry(card);
      if (!e) {
        e = { cardId: card.id ?? null, cardName: card.name, drawnRound: null, roundNumber: null, score: 0 };
        p.secondaries.push(e);
      }
      return e;
    };

    const isBlank = (e) => e.drawnRound == null && e.roundNumber == null && !(e.score > 0);

    const prune = (e) => {
      if (e && isBlank(e)) {
        const i = p.secondaries.indexOf(e);
        if (i >= 0) p.secondaries.splice(i, 1);
      }
    };

    // Plain number boxes rather than <select>s: entry is type-tab-type-tab-type
    // down a row, which a dropdown breaks. Blank means "not applicable" — a
    // card never drawn, or drawn but never scored.
    const roundInput = (selected) => el('input', {
      type: 'number', min: '1', max: '5', step: '1', inputmode: 'numeric',
      value: selected == null ? '' : String(selected),
      style: { width: '100%', textAlign: 'center' },
    });

    // Lenient while typing, clamped on blur, so a stray "7" becomes 5 visibly
    // instead of being silently dropped on save.
    const readRound = (inp) => {
      const raw = (inp.value || '').trim();
      if (!raw) return null;
      const n = parseInt(raw, 10);
      if (!Number.isFinite(n)) return null;
      return Math.min(ROUNDS.length, Math.max(1, n));
    };
    const normalise = (inp, value) => { inp.value = value == null ? '' : String(value); };

    // 11e caps secondaries at 15 VP per battle round, and in this card-major
    // layout that ceiling spans ROWS — two cards that both scored in round 3
    // share it. So a per-input `max` is necessary and nowhere near sufficient;
    // the clamp has to look at every other card claiming the same scored round.
    // (buildHeldSecondaries only runs for 11e, so no edition check is needed.)
    const roundHeadroom = (entry) => secondaryRoundHeadroom(p, entry.roundNumber, entry);

    // Applied on blur, and again whenever the SCORED ROUND moves: dragging a
    // card from round 2 to round 3 can breach round 3's ceiling without its own
    // score being touched at all.
    const clampScore = (entry, inp) => {
      const asked = Math.max(0, entry.score || 0);
      const kept = Math.min(asked, roundHeadroom(entry));
      if (kept !== asked) {
        toast(entry.roundNumber == null
          ? `Capped at ${kept} — ${E11_SECONDARY_ROUND_CAP} is the most one card can score`
          : `Round ${entry.roundNumber} is capped at ${E11_SECONDARY_ROUND_CAP} secondary VP — kept ${kept} here`);
      }
      entry.score = kept;
      if (inp) inp.value = String(kept);
    };

    // A deck row: fixed card name, three inputs. Dimmed until it has data, so
    // the cards that actually came up stand out from the full list.
    const deckRow = (card) => {
      const existing = findEntry(card);
      const drawn = roundInput(existing?.drawnRound);
      const scored = roundInput(existing?.roundNumber);
      const scoreInp = el('input', {
        type: 'number', min: '0', max: String(E11_SECONDARY_ROUND_CAP), step: '1', inputmode: 'numeric',
        value: existing?.score ?? 0,
        style: { width: '100%', textAlign: 'center' },
      });

      const row = el('div', {
        style: { display: 'grid', gridTemplateColumns: COLS, gap: '6px', marginBottom: '4px', alignItems: 'center' },
      }, [
        // buildHeldSecondaries only runs for 11e, so every name here is a card
        // the mission data covers.
        el('div', { style: { fontSize: '13px' } }, missionLink('secondary', card.name) || card.name),
        drawn, scored, scoreInp, el('div', {}),
      ]);

      const paint = () => {
        const e = findEntry(card);
        row.style.opacity = e && !isBlank(e) ? '1' : '0.55';
      };
      paint();

      const commit = (fn) => {
        const e = ensure(card);
        fn(e);
        prune(e);
        paint();
        refreshTotals();
      };

      drawn.addEventListener('input', () => commit(e => { e.drawnRound = readRound(drawn); }));
      drawn.addEventListener('change', () => normalise(drawn, readRound(drawn)));
      scored.addEventListener('input', () => commit(e => { e.roundNumber = readRound(scored); }));
      scored.addEventListener('change', () => {
        normalise(scored, readRound(scored));
        const e = findEntry(card);
        if (e) { clampScore(e, scoreInp); prune(e); paint(); refreshTotals(); }
      });
      scoreInp.addEventListener('input', () =>
        commit(e => { e.score = parseInt(scoreInp.value, 10) || 0; }));
      scoreInp.addEventListener('change', () => {
        const e = findEntry(card);
        if (e) { clampScore(e, scoreInp); prune(e); paint(); refreshTotals(); }
      });

      return row;
    };

    // Anything recorded that the seeded deck doesn't cover — a card typed by
    // hand, or one carried over from a different pack. Keeps its name editable
    // so the (likely incomplete) seed list is never a dead end.
    const extras = (p.secondaries || []).filter(s =>
      !s.cardName || !deckNames.has(s.cardName.toLowerCase()));

    const extraRow = (entry) => {
      const cardSel = comboField(deck, entry.cardId,
        entry.cardName === 'Unspecified' ? null : entry.cardName,
        (id, name) => { entry.cardId = id; entry.cardName = name || 'Unspecified'; },
        { placeholder: 'Card name' });

      const drawn = roundInput(entry.drawnRound);
      drawn.addEventListener('input', () => { entry.drawnRound = readRound(drawn); });
      drawn.addEventListener('change', () => normalise(drawn, entry.drawnRound));
      const scored = roundInput(entry.roundNumber);
      scored.addEventListener('input', () => {
        entry.roundNumber = readRound(scored);
        refreshTotals();
      });
      const scoreInp = el('input', {
        type: 'number', min: '0', max: String(E11_SECONDARY_ROUND_CAP), step: '1', inputmode: 'numeric',
        value: entry.score ?? 0,
        style: { width: '100%', textAlign: 'center' },
      });
      scored.addEventListener('change', () => {
        normalise(scored, entry.roundNumber);
        clampScore(entry, scoreInp);
        refreshTotals();
      });
      scoreInp.addEventListener('input', () => {
        entry.score = parseInt(scoreInp.value, 10) || 0;
        refreshTotals();
      });
      scoreInp.addEventListener('change', () => {
        clampScore(entry, scoreInp);
        refreshTotals();
      });
      const remove = el('button', { class: 'btn small', type: 'button', title: 'Remove card' }, '×');
      remove.addEventListener('click', () => {
        const i = p.secondaries.indexOf(entry);
        if (i >= 0) p.secondaries.splice(i, 1);
        rerender();
      });

      return el('div', {
        style: { display: 'grid', gridTemplateColumns: COLS, gap: '6px', marginBottom: '4px', alignItems: 'center' },
      }, [cardSel, drawn, scored, scoreInp, remove]);
    };

    const add = el('button', { class: 'btn small', type: 'button' }, '+ Card not listed');
    add.addEventListener('click', () => {
      p.secondaries.push({ cardId: null, cardName: 'Unspecified', drawnRound: null, roundNumber: null, score: 0 });
      rerender();
    });

    const hdr = (t, align) => el('div', {
      class: 'dim',
      style: {
        fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em',
        paddingBottom: '4px', textAlign: align || 'left',
      },
    }, t);

    return el('div', {}, [
      el('h3', { style: { marginTop: '18px' } }, [
        'Secondary Missions ',
        el('span', {
          'data-sec-total': String(idx),
          class: 'dim tabular',
          style: { fontSize: '12px', fontWeight: 'normal' },
        }, capLabel(sumSecondaries(p), E11_SECONDARY_CAP)),
      ]),
      deck.length || extras.length
        ? el('div', { style: { display: 'grid', gridTemplateColumns: COLS, gap: '6px', marginBottom: '2px' } },
            [hdr('Card'), hdr('Drawn R#', 'center'), hdr('Scored R#', 'center'), hdr('VP', 'center'), el('div', {})])
        : el('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } },
            'Choose a mission pack to list its secondaries.'),
      ...deck.map(deckRow),
      ...extras.map(extraRow),
      el('div', { style: { marginTop: '6px' } }, add),
    ].filter(Boolean));
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
      edition: DEFAULT_EDITION,
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
    edition: existing.edition || '10',
    players: existing.players.map(p => ({
      userId: p.user_id,
      guestName: p.guest_name || (p.display_name && p.user_id ? p.display_name : null),
      factionId: p.faction_id,
      detachmentId: p.detachment_id,
      detachmentName: p.detachment_name,
      primaryMissionId: p.primary_mission_id ?? null,
      primaryMissionName: p.primary_mission_name ?? null,
      forceDisposition: p.force_disposition ?? null,
      timeSeconds: p.time_seconds ?? null,
      timeIsManual: !!p.time_is_manual,
      secondaryMode: p.secondary_mode === 'fixed' ? 'fixed' : 'tactical',
      detachments: Array.isArray(p.detachments) && p.detachments.length
        ? p.detachments.slice()
        : (p.detachment_name ? [p.detachment_name] : []),
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
        timeSeconds: r.time_seconds ?? null,
      })),
      secondaries: (p.secondaries || []).map(s => ({
        cardId: s.card_id, cardName: s.card_name, roundNumber: s.round_number,
        drawnRound: s.drawn_round ?? null,
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
    primaryMissionId: null, primaryMissionName: null,
    forceDisposition: null, detachments: [], timeSeconds: null, timeIsManual: false,
    secondaryMode: 'tactical',
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
    edition: d.edition || DEFAULT_EDITION,
    players: d.players.map(p => ({
      ...p,
      scoreMode: undefined,
      detachments: (p.detachments || []).map(x => (x || '').trim()).filter(Boolean),
      secondaries: (p.secondaries || []).filter(s => s.cardName),
      challengers: (d.edition || DEFAULT_EDITION) === '11'
        ? []
        : (p.challengers || []).filter(c => c.cardName),
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
    edition: g.edition || '10',
    players: g.players.map(p => ({
      userId: p.user_id,
      guestName: p.guest_name,
      factionId: p.faction_id,
      detachmentId: p.detachment_id,
      detachmentName: p.detachment_name,
      primaryMissionId: p.primary_mission_id ?? null,
      primaryMissionName: p.primary_mission_name ?? null,
      forceDisposition: p.force_disposition ?? null,
      timeSeconds: p.time_seconds ?? null,
      timeIsManual: !!p.time_is_manual,
      secondaryMode: p.secondary_mode === 'fixed' ? 'fixed' : 'tactical',
      detachments: Array.isArray(p.detachments) && p.detachments.length
        ? p.detachments.slice()
        : (p.detachment_name ? [p.detachment_name] : []),
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
        timeSeconds: r.time_seconds ?? null,
      })),
      secondaries: (p.secondaries || []).map(s => ({
        cardId: s.card_id, cardName: s.card_name, roundNumber: s.round_number,
        drawnRound: s.drawn_round ?? null,
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
