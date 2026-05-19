# `app/` — frontend

Vanilla HTML/CSS/JS. **No build step**, no framework, no bundler. Caddy serves this directory directly off disk at `/srv/40kResultsTracker/app`. The browser loads ES modules (`<script type="module">`) straight from `js/` — `index.html` lists every module with a script tag.

## Layout

| Path | What |
|---|---|
| `index.html` | Single page; script tags for every JS module + Chart.js CDN |
| `css/style.css` | Dark Warhammer theme matched to the `yetanotherarmybuilder` sister site (CSS variables: `--bg`, `--panel-bg`, `--accent`, `--font-display`, etc.) |
| `js/` | Application code — see `js/README.md` |
| `js/views/` | Per-route view modules — see `js/views/README.md` |

## How it runs

1. Browser loads `index.html`, which loads `js/app.js` (and every module it imports transitively, plus the standalone view files).
2. `app.js` resolves the current hash, calls `auth.me()` to check the session, then dispatches to the matching view.
3. The view fetches its data via `api.js` and returns a single root DOM node.
4. `app.js` swaps that node into `<main>`.
5. SSE feed (`live.js`) opens once; views can subscribe to `'live:game.saved'` on `document` for live refresh.

There is no service worker, no localStorage other than the new-game draft, no IndexedDB, no router library.

## Conventions

- **DOM via `el()` / `clear()`** from `js/components.js`. Don't introduce React, Vue, lit-html, htm, or template-literal HTML — the project is consciously framework-free.
- **Never `fetch()` from a view.** Always extend the right export object on `js/api.js` and call that.
- **Modal dialogs**: `confirmModal()` / `promptModal()` from `components.js`. Don't use native `confirm()` / `prompt()`.
- **Toasts**: `toast(message, kind?)` from `components.js`. `kind: 'error'` styles red.
- **Routing**: hash-based. `#/foo` → `routes` array in `app.js`. Update both the regex and `navItems` when you add a route.

## Theme

Don't redesign — match. `css/style.css` mirrors the YAAB sister project. Add new components by reusing the existing CSS variables (`--bg`, `--panel-bg`, `--accent`, `--accent-on`, `--text`, `--text-muted`, `--border`, `--radius`, `--shadow-lg`, `--font-display`, `--font-mono`).

The Theatre of War uses its own deeper-black palette (`HUD_BG`, `HUD_CYAN`, `HUD_AMBER`) — those are intentionally outside the YAAB theme to evoke a tactical map.

## When in doubt

- `js/README.md` for file roles
- `js/views/README.md` for view conventions + recipes
- Repo-root `CLAUDE.md` "Frontend architecture" for cross-cutting orientation
- `index.html` itself for the script-tag inventory
