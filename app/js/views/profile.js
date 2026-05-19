import { auth } from '../api.js';
import { el, toast } from '../components.js';

export async function renderProfile(state) {
  const root = el('div', { class: 'fade-in' });
  // Pull a fresh copy in case army_name was changed by an admin
  let me;
  try { me = await auth.me(); }
  catch { me = state.user; }

  const armyInput = el('input', {
    type: 'text',
    placeholder: 'House Vosk, The Eternal Crusade, …',
    value: me.armyName ?? '',
    autocomplete: 'off',
  });
  const errEl = el('div', { class: 'error-text' }, '');
  const saveBtn = el('button', { class: 'btn primary' }, 'Save Army Name');
  saveBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    try {
      const updated = await auth.updateMe({ armyName: armyInput.value });
      if (state.user) state.user.armyName = updated.armyName;
      toast('Army name updated');
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
          el('label', {}, 'Army Name'),
          armyInput,
          el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } },
            'Shown on the Theatre of War map for every faction you play. Leave blank to fall back to your display name.'),
        ]),
      ]),
      errEl,
      saveBtn,
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
