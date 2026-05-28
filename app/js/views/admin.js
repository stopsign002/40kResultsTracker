import { admin, auth, seasons } from '../api.js';
import { el, clear, toast, pill, promptModal, confirmModal } from '../components.js';

export async function renderAdmin(state) {
  if (state.user?.role !== 'admin') {
    return el('div', { class: 'panel' }, [
      el('div', { class: 'panel-header' }, el('h2', {}, 'Admin')),
      el('div', { class: 'panel-body' }, 'You do not have permission to view this page.'),
    ]);
  }

  const root = el('div', { class: 'fade-in' });
  const usersList = el('div', { class: 'panel-body' }, 'Loading…');

  async function refresh() {
    clear(usersList);
    usersList.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    const users = await admin.users();
    clear(usersList);
    usersList.appendChild(buildUsersTable(users, refresh));
  }

  // Create user form
  const cuUsername = el('input', { type: 'text', placeholder: 'username' });
  const cuDisplay = el('input', { type: 'text', placeholder: 'display name' });
  const cuArmyName = el('input', { type: 'text', placeholder: 'optional — shown on the war map' });
  const cuPassword = el('input', { type: 'password', placeholder: 'min 8 chars' });
  const cuRole = el('select', {}, [
    el('option', { value: 'user' }, 'User'),
    el('option', { value: 'admin' }, 'Admin'),
  ]);
  const cuError = el('div', { class: 'error-text' }, '');
  const cuSubmit = el('button', { class: 'btn primary' }, 'Create User');
  cuSubmit.addEventListener('click', async () => {
    cuError.textContent = '';
    try {
      await admin.createUser({
        username: cuUsername.value.trim(),
        displayName: cuDisplay.value.trim() || cuUsername.value.trim(),
        armyName: cuArmyName.value.trim() || null,
        password: cuPassword.value,
        role: cuRole.value,
      });
      cuUsername.value = ''; cuDisplay.value = ''; cuArmyName.value = '';
      cuPassword.value = ''; cuRole.value = 'user';
      toast('User created');
      refresh();
    } catch (e) {
      cuError.textContent = e.message || 'Failed to create user';
    }
  });

  const createPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Create User')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'form-row cols-3' }, [
        field('Username', cuUsername),
        field('Display Name', cuDisplay),
        field('Army Name', cuArmyName),
      ]),
      el('div', { class: 'form-row cols-2' }, [
        field('Password', cuPassword),
        field('Role', cuRole),
      ]),
      cuError,
      cuSubmit,
    ]),
  ]);

  // Change-own-password panel
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
    } catch (e) {
      pwError.textContent = e.message;
    }
  });
  const pwPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Your Password')),
    el('div', { class: 'panel-body' }, [
      el('div', { class: 'form-row cols-2' }, [
        field('Current Password', pwOld),
        field('New Password (8+)', pwNew),
      ]),
      pwError,
      pwSubmit,
    ]),
  ]);

  const usersPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, el('h2', {}, 'Users')),
    usersList,
  ]);

  // Guest accounts — promote free-text guests into real (inactive) accounts so
  // they're first-class players for rankings etc. Idempotent + war-map-safe.
  const guestsBody = el('div', { class: 'panel-body' }, el('div', { class: 'muted' }, 'Loading…'));
  async function refreshGuests() {
    clear(guestsBody);
    guestsBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const pv = await admin.guestsPreview();
      clear(guestsBody);
      guestsBody.appendChild(el('p', { class: 'muted', style: { marginTop: '0' } },
        'Turns free-text guest names into real but inactive accounts (can\'t log in) so every player is rankable. '
        + 'Names matching an existing account are linked instead. Re-runnable; preserves the war map.'));
      if (!pv.groups.length) {
        guestsBody.appendChild(el('div', { class: 'muted' }, 'No unlinked guests — nothing to promote.'));
        return;
      }
      guestsBody.appendChild(el('div', { style: { marginBottom: '10px' } }, [
        pill(`${pv.toCreate} new account${pv.toCreate === 1 ? '' : 's'}`, 'first'),
        ' ',
        pill(`${pv.toLink} linked to existing`, ''),
      ]));
      const head = el('thead', {}, el('tr', {}, [
        el('th', {}, 'Guest name'), el('th', { style: { textAlign: 'right' } }, 'Games'), el('th', {}, 'Action'),
      ]));
      const tbody = el('tbody', {}, pv.groups.map(g => el('tr', {}, [
        el('td', {}, g.name),
        el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(g.rows)),
        el('td', {}, pill(g.action === 'create' ? 'create account' : 'link existing', g.action === 'create' ? 'first' : '')),
      ])));
      guestsBody.appendChild(el('table', {}, [head, tbody]));
    } catch (e) {
      clear(guestsBody);
      guestsBody.appendChild(el('div', { class: 'error-text' }, e.message));
    }
  }
  const promoteBtn = el('button', { class: 'btn primary small', onClick: async () => {
    const pv = await admin.guestsPreview().catch(() => null);
    if (pv && !pv.groups.length) { toast('No guests to promote'); return; }
    const ok = await confirmModal({
      title: 'Promote all guests?',
      body: pv
        ? `Creates ${pv.toCreate} inactive account(s) and links ${pv.toLink} to existing users, then attaches their historical games. Re-runnable and safe; the war map is preserved.`
        : 'Creates inactive accounts for guests and links the rest, then attaches their historical games.',
      confirmLabel: 'Promote guests',
    });
    if (!ok) return;
    try {
      const r = await admin.promoteGuests();
      toast(`Created ${r.created.length}, linked ${r.linked.length}`);
      refreshGuests();
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  } }, 'Promote guests');
  const guestsPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Guest Accounts'),
      el('div', { class: 'btn-group' }, [
        el('button', { class: 'btn small', onClick: refreshGuests }, 'Refresh'),
        promoteBtn,
      ]),
    ]),
    guestsBody,
  ]);

  // Audit log viewer
  const auditBody = el('div', { class: 'panel-body' }, 'Loading…');
  async function refreshAudit() {
    clear(auditBody);
    auditBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const rows = await admin.audit(200);
      clear(auditBody);
      auditBody.appendChild(buildAuditTable(rows));
    } catch (e) {
      clear(auditBody);
      auditBody.appendChild(el('div', { class: 'error-text' }, e.message));
    }
  }
  const auditPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [
      el('h2', {}, 'Audit Log'),
      el('button', { class: 'btn small', onClick: refreshAudit }, 'Refresh'),
    ]),
    auditBody,
  ]);

  // Seasons panel — list + start-new-season
  const seasonsBody = el('div', { class: 'panel-body' }, 'Loading…');
  async function refreshSeasons() {
    clear(seasonsBody);
    seasonsBody.appendChild(el('div', { class: 'muted' }, 'Loading…'));
    try {
      const list = await seasons.list();
      clear(seasonsBody);
      seasonsBody.appendChild(buildSeasonsTable(list));
    } catch (e) {
      clear(seasonsBody);
      seasonsBody.appendChild(el('div', { class: 'error-text' }, e.message));
    }
  }
  const startSeasonBtn = el('button', { class: 'btn primary small', onClick: async () => {
    const name = await promptModal({
      title: 'Start a new season',
      label: 'Season name (e.g. "Season 2", "Year of the Whisper")',
      placeholder: 'Season 2',
    });
    if (!name) return;
    const ok = await confirmModal({
      title: 'Start "' + name + '"?',
      body: 'A new map seed will be generated. The current season is closed (still browsable from the war map dropdown). Future games attach to the new season.',
      confirmLabel: 'Start season',
    });
    if (!ok) return;
    try {
      await seasons.start({ name });
      toast('New season started');
      refreshSeasons();
    } catch (e) { toast(e.message, 'error'); }
  } }, 'Start new season');
  const seasonsPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-header' }, [el('h2', {}, 'Seasons'), startSeasonBtn]),
    seasonsBody,
  ]);

  root.appendChild(createPanel);
  root.appendChild(usersPanel);
  root.appendChild(guestsPanel);
  root.appendChild(seasonsPanel);
  root.appendChild(auditPanel);
  root.appendChild(pwPanel);

  await refresh();
  await refreshGuests();
  await refreshSeasons();
  await refreshAudit();
  return root;
}

function buildSeasonsTable(rows) {
  if (!rows.length) return el('div', { class: 'muted' }, 'No seasons yet.');
  const head = el('thead', {}, el('tr', {}, [
    el('th', {}, 'Name'),
    el('th', { style: { textAlign: 'right' } }, 'Games'),
    el('th', {}, 'Started'),
    el('th', {}, 'Ended'),
    el('th', {}, 'Status'),
    el('th', {}, 'Map seed'),
  ]));
  const body = el('tbody', {}, rows.map(r => el('tr', {}, [
    el('td', {}, r.name),
    el('td', { class: 'tabular', style: { textAlign: 'right' } }, String(r.games)),
    el('td', { class: 'muted', style: { fontSize: '11px' } }, String(r.started_at).slice(0, 10)),
    el('td', { class: 'muted', style: { fontSize: '11px' } }, r.ended_at ? String(r.ended_at).slice(0, 10) : '—'),
    el('td', {}, pill(r.is_active ? 'active' : 'archived', r.is_active ? 'win' : '')),
    el('td', { class: 'tabular', style: { fontSize: '11px', color: 'var(--text-muted)' } }, r.map_seed),
  ])));
  return el('table', {}, [head, body]);
}

function buildAuditTable(rows) {
  if (!rows.length) return el('div', { class: 'muted' }, 'No audit entries yet.');
  const head = el('thead', {}, el('tr', {}, [
    el('th', {}, 'When'),
    el('th', {}, 'Actor'),
    el('th', {}, 'Action'),
    el('th', {}, 'Target'),
    el('th', {}, 'Payload'),
  ]));
  const body = el('tbody', {}, rows.map(r => el('tr', {}, [
    el('td', { class: 'muted', style: { fontSize: '11px', whiteSpace: 'nowrap' } }, formatAuditTime(r.created_at)),
    el('td', {}, r.actor_username || (r.actor_user_id ? `#${r.actor_user_id}` : '—')),
    el('td', {}, el('span', { class: 'pill' }, r.action)),
    el('td', { class: 'muted' }, r.target_type ? `${r.target_type} #${r.target_id ?? '?'}` : '—'),
    el('td', { style: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
      r.payload ? JSON.stringify(r.payload) : ''),
  ])));
  return el('table', {}, [head, body]);
}

function formatAuditTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function field(label, control) {
  return el('div', { class: 'form-group' }, [el('label', {}, label), control]);
}

function buildUsersTable(users, refresh) {
  const head = el('thead', {}, el('tr', {}, [
    el('th', {}, 'Username'),
    el('th', {}, 'Display Name'),
    el('th', {}, 'Army Name'),
    el('th', {}, 'Role'),
    el('th', {}, 'Active'),
    el('th', {}, 'Created'),
    el('th', {}, ''),
  ]));
  const body = el('tbody', {}, users.map(u => {
    const toggleActive = el('button', {
      class: 'btn small',
      onClick: async () => {
        try {
          await admin.updateUser(u.id, { isActive: !u.is_active });
          toast(u.is_active ? 'Deactivated' : 'Activated');
          refresh();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, u.is_active ? 'Deactivate' : 'Activate');

    const promote = el('button', {
      class: 'btn small',
      onClick: async () => {
        try {
          await admin.updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' });
          toast('Role updated');
          refresh();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, u.role === 'admin' ? 'Demote' : 'Promote');

    const editArmy = el('button', {
      class: 'btn small',
      onClick: async () => {
        const name = await promptModal({
          title: 'Set army name',
          label: `Army name for "${u.username}" — leave blank to clear`,
          defaultValue: u.army_name || '',
          placeholder: 'House Vosk',
        });
        if (name === null) return;
        try {
          await admin.updateUser(u.id, { armyName: name.trim() });
          toast('Army name updated');
          refresh();
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'Army');

    const resetPw = el('button', {
      class: 'btn small',
      onClick: async () => {
        const newPw = await promptModal({
          title: 'Reset password',
          label: `New password for "${u.username}" (min 8 chars)`,
          type: 'password',
          placeholder: 'min 8 chars',
        });
        if (!newPw) return;
        try {
          await admin.updateUser(u.id, { password: newPw });
          toast('Password reset');
        } catch (e) { toast(e.message, 'error'); }
      },
    }, 'Reset PW');

    return el('tr', {}, [
      el('td', {}, u.username),
      el('td', {}, u.display_name),
      el('td', { class: u.army_name ? '' : 'muted' }, u.army_name || '—'),
      el('td', {}, pill(u.role, u.role === 'admin' ? 'first' : '')),
      el('td', {}, pill(u.is_active ? 'active' : 'inactive', u.is_active ? 'win' : 'loss')),
      el('td', { class: 'muted', style: { fontSize: '11px' } }, String(u.created_at).slice(0, 10)),
      el('td', {}, el('div', { class: 'btn-group' }, [toggleActive, promote, editArmy, resetPw])),
    ]);
  }));
  return el('table', {}, [head, body]);
}
