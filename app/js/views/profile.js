import { auth, reference } from '../api.js';
import { el, toast, selectOptions } from '../components.js';

export async function renderProfile(state) {
  const root = el('div', { class: 'fade-in' });
  // Pull a fresh copy in case army_name was changed by an admin
  let me;
  try { me = await auth.me(); }
  catch { me = state.user; }
  let factions = [];
  try { factions = await reference.factions(); } catch { /* armies panel degrades */ }

  const armyInput = el('input', {
    type: 'text',
    placeholder: 'House Vosk, The Eternal Crusade, …',
    value: me.armyName ?? '',
    autocomplete: 'off',
  });
  const errEl = el('div', { class: 'error-text' }, '');
  const saveBtn = el('button', { class: 'btn primary' }, 'Save Banner Name');
  saveBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    try {
      const updated = await auth.updateMe({ armyName: armyInput.value });
      if (state.user) state.user.armyName = updated.armyName;
      toast('Banner name updated');
    } catch (e) { errEl.textContent = e.message || 'Failed to save'; }
  });

  // Change-own-password section (mirrors the admin page so it lives here too)
  const pwOld = el('input', { type: 'password' });
  const pwNew = el('input', { type: 'password' });
  const pwError = el('div', { class: 'error-text' }, '');
  const pwSubmit = el('button', { class: 'btn' }, 'Change Password');
  pwSubmit.addEventListener('click', async () => {
    pwError.textContent = '';
    try {
      await auth.changePassword(pwOld.value, pwNew.value);
      pwOld.value = ''; pwNew.value = '';
      toast('Password changed');
    } catch (e) { pwError.textContent = e.message; }
  });

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'My Profile')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'form-row cols-2' }, [
        field('Username', readOnly(me.username)),
        field('Display Name', readOnly(me.displayName)),
      ]),
      el('div', { class: 'form-row' }, [
        el('div', { class: 'form-group' }, [
          el('label', {}, 'War-map Banner Name'),
          armyInput,
          el('div', { class: 'hint' },
            'Shown on the Theatre of War map for every faction you play. Leave blank to fall back to your display name.'),
        ]),
      ]),
      errEl,
      saveBtn,
    ]),
  ]));

  // My Armies — the registered list the game forms quick-pick from. Replace-
  // the-whole-list save; the war map and stats never read this table.
  const armies = (me.armies || []).map((a) => ({ factionId: a.factionId, name: a.name || '', isPrimary: a.isPrimary }));
  const armiesBody = el('div', {});
  const armiesErr = el('div', { class: 'error-text' }, '');

  function armyRow(a, idx) {
    const facSel = el('select', {}, selectOptions(factions));
    facSel.value = a.factionId || '';
    facSel.addEventListener('change', () => { a.factionId = facSel.value ? parseInt(facSel.value, 10) : null; });
    const nameInput = el('input', {
      type: 'text',
      placeholder: 'e.g. The Silent Host — optional',
      value: a.name,
      autocomplete: 'off',
    });
    nameInput.addEventListener('input', () => { a.name = nameInput.value; });
    const primaryBtn = el('button', {
      class: 'btn small' + (a.isPrimary ? ' primary' : ''),
      title: 'Your primary army pre-fills the game form',
      onClick: () => {
        armies.forEach((x) => { x.isPrimary = false; });
        a.isPrimary = true;
        rerenderArmies();
      },
    }, a.isPrimary ? '★ Primary' : 'Primary');
    const upBtn = el('button', { class: 'btn small', onClick: () => { move(idx, -1); } }, '↑');
    const downBtn = el('button', { class: 'btn small', onClick: () => { move(idx, 1); } }, '↓');
    upBtn.disabled = idx === 0;
    downBtn.disabled = idx === armies.length - 1;
    const removeBtn = el('button', {
      class: 'btn small danger',
      onClick: () => {
        armies.splice(idx, 1);
        if (a.isPrimary && armies.length) armies[0].isPrimary = true;
        rerenderArmies();
      },
    }, 'Remove');
    return el('div', { class: 'form-row cols-2', style: { alignItems: 'end' } }, [
      field('Faction', facSel),
      el('div', { class: 'form-group' }, [
        el('label', {}, 'Army Name'),
        nameInput,
        el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' } },
          [primaryBtn, upBtn, downBtn, removeBtn]),
      ]),
    ]);
  }

  function move(idx, delta) {
    const j = idx + delta;
    if (j < 0 || j >= armies.length) return;
    [armies[idx], armies[j]] = [armies[j], armies[idx]];
    rerenderArmies();
  }

  function rerenderArmies() {
    while (armiesBody.firstChild) armiesBody.removeChild(armiesBody.firstChild);
    if (!armies.length) {
      armiesBody.appendChild(el('div', { class: 'hint' }, 'No armies registered yet.'));
    }
    armies.forEach((a, idx) => armiesBody.appendChild(armyRow(a, idx)));
  }
  rerenderArmies();

  const addArmyBtn = el('button', {
    class: 'btn small',
    onClick: () => {
      armies.push({ factionId: null, name: '', isPrimary: armies.length === 0 });
      rerenderArmies();
    },
  }, '+ Add Army');
  const saveArmiesBtn = el('button', {
    class: 'btn primary',
    onClick: async () => {
      armiesErr.textContent = '';
      const payload = armies.filter((a) => a.factionId);
      try {
        const { armies: saved } = await auth.setArmies(payload);
        armies.length = 0;
        for (const a of saved) armies.push({ factionId: a.factionId, name: a.name || '', isPrimary: a.isPrimary });
        rerenderArmies();
        toast('Armies saved');
      } catch (e) { armiesErr.textContent = e.message || 'Failed to save'; }
    },
  }, 'Save Armies');

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'My Armies')),
    el('div', { class: 'panel-body' }, [
      armiesBody,
      armiesErr,
      el('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, [addArmyBtn, saveArmiesBtn]),
      el('div', { class: 'hint' },
        'Your primary army pre-fills the faction when you’re added to a game; the rest show as one-tap picks. The war map and stats are unaffected.'),
    ]),
  ]));

  // Live-game preference. Some people want the nudge between rounds because a
  // board photo is exactly the thing that slips the mind; others find it
  // intrusive. Off here means the prompt never fires — the round screen keeps
  // its own upload button either way.
  const photoToggle = el('input', { type: 'checkbox' });
  photoToggle.checked = me.promptRoundPhoto !== false;
  photoToggle.addEventListener('change', async () => {
    try {
      const updated = await auth.updateMe({ promptRoundPhoto: photoToggle.checked });
      if (state.user) state.user.promptRoundPhoto = updated.promptRoundPhoto;
      toast(photoToggle.checked ? 'Photo prompts on' : 'Photo prompts off');
    } catch (e) {
      photoToggle.checked = !photoToggle.checked;
      toast(e.message || 'Failed to save', 'error');
    }
  });

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Live Game')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'form-group' }, [
        el('label', {}, 'Photo prompts'),
        el('label', { class: 'inline-toggle' }, [photoToggle, 'Ask me to snap a board photo between rounds']),
      ]),
      el('div', { class: 'hint' },
        'You can always add photos from the round screen, whether this is on or off.'),
    ]),
  ]));

  root.appendChild(el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Change Password')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'form-row cols-2' }, [
        field('Current Password', pwOld),
        field('New Password (8+)', pwNew),
      ]),
      pwError,
      pwSubmit,
    ]),
  ]));

  return root;
}

function field(label, control) {
  return el('div', { class: 'form-group' }, [el('label', {}, label), control]);
}

function readOnly(value) {
  return el('div', {
    style: {
      padding: '8px 10px',
      background: 'var(--bg)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      color: 'var(--text-muted)',
    },
  }, value || '—');
}
