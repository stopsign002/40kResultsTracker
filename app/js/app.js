import { auth } from './api.js';
import { el, clear } from './components.js';
import { renderLogin } from './views/login.js';
import { renderGamesList } from './views/games-list.js';
import { renderGameDetail } from './views/game-detail.js';
import { renderGameForm } from './views/game-form.js';
import { renderStats } from './views/stats.js';
import { renderAdmin } from './views/admin.js';

const root = document.getElementById('app');

const state = {
  user: null,
};

const routes = [
  { match: /^\/$/,                handler: () => renderGamesList(state) },
  { match: /^\/games$/,           handler: () => renderGamesList(state) },
  { match: /^\/games\/new$/,      handler: () => renderGameForm(state, null) },
  { match: /^\/games\/(\d+)\/edit$/, handler: (m) => renderGameForm(state, parseInt(m[1], 10)) },
  { match: /^\/games\/(\d+)$/,    handler: (m) => renderGameDetail(state, parseInt(m[1], 10)) },
  { match: /^\/stats$/,           handler: () => renderStats(state) },
  { match: /^\/admin$/,           handler: () => renderAdmin(state) },
];

function currentPath() {
  const h = window.location.hash || '#/';
  return h.startsWith('#') ? h.slice(1) : h;
}

export function navigate(path) {
  window.location.hash = path;
}

function renderShell(viewNode) {
  clear(root);
  if (!state.user) {
    root.appendChild(renderLogin(state, async () => {
      state.user = await auth.me();
      route();
    }));
    return;
  }
  const path = currentPath();
  const navLink = (href, label) => {
    const a = el('a', { href: '#' + href }, label);
    if (path === href || (href === '/games' && path === '/')) a.classList.add('active');
    return a;
  };
  const navItems = [
    navLink('/games', 'Games'),
    navLink('/games/new', 'New Game'),
    navLink('/stats', 'Stats'),
  ];
  if (state.user.role === 'admin') navItems.push(navLink('/admin', 'Admin'));

  const header = el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      document.createTextNode('40K'),
      el('span', { class: 'accent' }, 'RESULTS'),
    ]),
    el('nav', {}, navItems),
    el('div', { class: 'session' }, [
      el('span', { class: 'who' }, state.user.displayName || state.user.username),
      el('span', { class: 'pill' }, state.user.role),
      el('button', {
        class: 'btn small',
        onClick: async () => { await auth.logout(); state.user = null; navigate('/'); route(); },
      }, 'Log out'),
    ]),
  ]);
  const main = el('main', {}, viewNode);
  root.appendChild(header);
  root.appendChild(main);
}

async function route() {
  if (!state.user) {
    try { state.user = await auth.me(); } catch { state.user = null; }
  }
  if (!state.user) {
    renderShell(null);
    return;
  }
  const path = currentPath();
  for (const r of routes) {
    const m = path.match(r.match);
    if (m) {
      const node = await r.handler(m);
      renderShell(node);
      return;
    }
  }
  // Fallback
  navigate('/games');
}

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// Expose for views to navigate
window.__nav = navigate;
