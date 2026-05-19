import { auth } from './api.js';
import { el, clear } from './components.js';
import { startLiveFeed } from './live.js';
import { renderLogin } from './views/login.js';
import { renderGamesList } from './views/games-list.js';
import { renderGameDetail } from './views/game-detail.js';
import { renderGameForm } from './views/game-form.js';
import { renderStats } from './views/stats.js';
import { renderWarmap } from './views/warmap.js';
import { renderAdmin } from './views/admin.js';
import { renderPlayer } from './views/player.js';
import { renderProfile } from './views/profile.js';

const root = document.getElementById('app');

const state = {
  user: null,
};

const routes = [
  { match: /^\/$/,                   handler: () => renderWarmap(state) },
  { match: /^\/war$/,                handler: () => renderWarmap(state) },
  { match: /^\/games$/,              handler: () => renderGamesList(state) },
  { match: /^\/games\/new$/,         handler: () => renderGameForm(state, null),               requireAuth: true },
  { match: /^\/games\/(\d+)\/edit$/, handler: (m) => renderGameForm(state, parseInt(m[1], 10)), requireAuth: true },
  { match: /^\/games\/(\d+)$/,       handler: (m) => renderGameDetail(state, parseInt(m[1], 10)) },
  { match: /^\/stats$/,              handler: () => renderStats(state) },
  { match: /^\/players\/(.+)$/,      handler: (m) => renderPlayer(state, decodeURIComponent(m[1])) },
  { match: /^\/profile$/,            handler: () => renderProfile(state),     requireAuth: true },
  { match: /^\/admin$/,              handler: () => renderAdmin(state),       requireAdmin: true },
  { match: /^\/login$/,              handler: () => renderLogin(state, () => navigate('/')) },
];

function currentPath() {
  const h = window.location.hash || '#/';
  const raw = h.startsWith('#') ? h.slice(1) : h;
  const qIdx = raw.indexOf('?');
  return qIdx >= 0 ? raw.slice(0, qIdx) : raw;
}

export function navigate(path) {
  window.location.hash = path;
}

function renderShell(viewNode) {
  clear(root);
  const path = currentPath();
  const isActiveHref = (href) =>
    path === href || (href === '/war' && (path === '/' || path === ''));

  const linkDefs = [
    { href: '/war',   label: 'Theatre of War' },
    { href: '/games', label: 'Games' },
    { href: '/stats', label: 'Stats' },
  ];
  if (state.user) linkDefs.push({ href: '/games/new', label: 'New Game' });
  if (state.user?.role === 'admin') linkDefs.push({ href: '/admin', label: 'Admin' });

  const navItems = linkDefs.map(d => {
    const a = el('a', { href: '#' + d.href }, d.label);
    if (isActiveHref(d.href)) a.classList.add('active');
    return a;
  });
  const nav = el('nav', { id: 'main-nav' }, navItems);

  const activeDef = linkDefs.find(d => isActiveHref(d.href)) || linkDefs[0];
  const navToggle = el('button', {
    type: 'button',
    class: 'nav-toggle',
    'aria-label': 'Toggle navigation',
    onClick: (e) => { e.stopPropagation(); nav.classList.toggle('open'); },
  }, [
    el('span', { class: 'nav-toggle-label' }, activeDef.label),
    el('span', { class: 'nav-toggle-caret' }, '▾'),
  ]);

  const sessionArea = state.user
    ? el('div', { class: 'session' }, [
        el('a', {
          class: 'who',
          href: '#/profile',
          title: 'Edit your profile',
          style: { textDecoration: 'none', cursor: 'pointer' },
        }, state.user.displayName || state.user.username),
        el('span', { class: 'pill' }, state.user.role),
        el('button', {
          class: 'btn small',
          onClick: async () => { await auth.logout(); state.user = null; navigate('/'); route(); },
        }, 'Log out'),
      ])
    : el('div', { class: 'session' }, [
        el('a', { class: 'btn primary small', href: '#/login' }, 'Sign In'),
      ]);

  const header = el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [
      document.createTextNode('40K'),
      el('span', { class: 'accent' }, 'RESULTS'),
    ]),
    navToggle,
    nav,
    sessionArea,
  ]);
  const main = el('main', {}, viewNode);
  root.appendChild(header);
  root.appendChild(main);
}

// One-time wiring: clicking outside the mobile nav, or pressing Escape,
// closes any open dropdown. Routing changes (hashchange → renderShell)
// already rebuild the nav fresh without the .open class, so link clicks
// auto-close.
if (!window.__navOutsideListenerInstalled) {
  document.addEventListener('click', (e) => {
    const nav = document.getElementById('main-nav');
    if (!nav || !nav.classList.contains('open')) return;
    if (e.target.closest('.nav-toggle')) return;
    nav.classList.remove('open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const nav = document.getElementById('main-nav');
    if (nav) nav.classList.remove('open');
  });
  window.__navOutsideListenerInstalled = true;
}

function renderErrorBoundary(err) {
  clear(root);
  const detail = err?.stack || err?.message || String(err);
  const panel = el('div', { class: 'error-boundary' }, [
    el('h1', {}, 'Something broke'),
    el('p', {}, 'The page hit an unexpected error. Try reloading; if it keeps happening, send the trace below to whoever set this thing up.'),
    el('pre', {}, detail),
    el('div', { class: 'btn-group', style: { marginTop: '14px' } }, [
      el('button', { class: 'btn primary', onClick: () => location.reload() }, 'Reload'),
      el('a', { class: 'btn', href: '#/' }, 'Home'),
    ]),
  ]);
  root.appendChild(panel);
}

async function route() {
  try {
    if (!state.user) {
      try { state.user = await auth.me(); } catch { state.user = null; }
    }
    startLiveFeed();
    const path = currentPath();
    for (const r of routes) {
      const m = path.match(r.match);
      if (!m) continue;
      if ((r.requireAuth && !state.user) || (r.requireAdmin && state.user?.role !== 'admin')) {
        navigate('/login');
        return;
      }
      const node = await r.handler(m);
      renderShell(node);
      return;
    }
    // Fallback
    navigate(state.user ? '/games' : '/');
  } catch (err) {
    console.error('Route handler threw:', err);
    renderErrorBoundary(err);
  }
}

// Catch async errors that escape our wrappers (rare but happens with rogue
// event handlers); show the same friendly panel.
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  if (!document.getElementById('app').firstChild) renderErrorBoundary(e.reason);
});

window.addEventListener('hashchange', route);
window.addEventListener('load', route);

// Expose for views to navigate
window.__nav = navigate;
