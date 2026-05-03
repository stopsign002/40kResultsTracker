import { admin, auth } from '../api.js';
import { el, clear, toast, pill } from '../components.js';

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

  root.appendChild(createPanel);
  root.appendChild(usersPanel);
  root.appendChild(pwPanel);

  await refresh();
  return root;
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
        const name = prompt(`Army name for "${u.username}" (blank to clear):`, u.army_name || '');
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
        const newPw = prompt(`Set new password for "${u.username}" (min 8 chars):`);
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
