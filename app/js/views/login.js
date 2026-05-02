import { auth } from '../api.js';
import { el } from '../components.js';

export function renderLogin(state, onSuccess) {
  const errorEl = el('div', { class: 'error-text' }, '');

  const usernameInput = el('input', { type: 'text', id: 'login-username', autocomplete: 'username', autofocus: true });
  const passwordInput = el('input', { type: 'password', id: 'login-password', autocomplete: 'current-password' });

  const submit = async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    try {
      await auth.login(usernameInput.value.trim(), passwordInput.value);
      onSuccess();
    } catch (err) {
      errorEl.textContent = err.message || 'Login failed';
    }
  };

  const form = el('form', { onSubmit: submit }, [
    el('div', { class: 'form-group' }, [
      el('label', { for: 'login-username' }, 'Username'),
      usernameInput,
    ]),
    el('div', { class: 'form-group' }, [
      el('label', { for: 'login-password' }, 'Password'),
      passwordInput,
    ]),
    errorEl,
    el('button', { type: 'submit', class: 'btn primary' }, 'Sign In'),
  ]);

  return el('div', { class: 'login-shell' }, [
    el('div', { class: 'login-card fade-in' }, [
      el('h1', {}, '40K Results'),
      el('div', { class: 'muted', style: { textAlign: 'center', marginBottom: '20px', fontSize: '12px' } },
        'Accounts are issued by the keeper of the records.'),
      form,
    ]),
  ]);
}
