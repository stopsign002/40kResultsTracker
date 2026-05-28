# `app/js/views/` — per-route view modules

Every file exports one async function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. `app.js` swaps that node into `<main>` after the previous page is cleared.

## Views at a glance

| File | Route | Notes |
|---|---|---|
| `login.js` | (no session) | Public login form. Rendered directly by `app.js` `renderShell(null)`. |
| `games-list.js` | `/games` | Filter panel (player/faction/mission/date/visibility/free-text search) + paginated game table. Subscribes to `live:game.saved` for real-time refresh. Reads URL hash params via `applyHashParams()` so click-throughs from stats / matchups work. |
| `game-detail.js` | `/games/:id` | Single game view with per-player breakdown. Admin-only Hide / Delete buttons (Delete uses `confirmModal`). |
| `game-form.js` | `/games/new`, `/games/:id/edit` | **HEAVIEST file.** Per-round scoring grid, secondary/challenger card slots, draft persistence to `localStorage`, undo-last-save toast on edit. Uses `rerender()` for structural changes; mutates draft directly on score-input change to preserve focus. |
| `stats.js` | `/stats` | Chart.js dashboard: faction/player win rates, head-to-head, faction matchup heatmap, drill-down with detachment breakdown, calendar heatmap, trends. Click bars/cells to drill through to filtered `/games`. |
| `warmap.js` | `/`, `/war` | **Theatre of War.** Canvas-based deterministic map. **DO NOT TOUCH constants** — see CLAUDE.md "Critical invariants". Hover tooltip, faction glyphs on fortresses, legend toggle, season picker. |
| `admin.js` | `/admin` | User CRUD, change own password, audit log viewer, seasons panel (start new), **Guest Accounts** panel (preview + promote guests to inactive accounts). Admin-only nav gating. |
| `ratings.js` | `/rankings` | **Admin-only.** Leaderboard ranked by a confidence floor (Glicko-2 ⇄ Whole-History toggle, margin-of-victory toggle; headline = floor, "est"/± = raw mean + uncertainty, provisional badges), balanced matchmaker (tick who's present → closest-skill pairings with predicted win-% and last-met, reshuffle), and an all-players rating-history compare chart (Chart.js time axis, daily points / month ticks; click a player to highlight + shade their ± band, others dim). Refuses non-admins; the API behind it is `requireAdmin`. |
| `player.js` | `/players/:playerKey` | Per-player profile. Streaks, biggest win/loss margin, per-faction breakdown. `playerKey` is `'user:<id>'` or `'guest:<name>'`. |
| `profile.js` | `/profile` | Self-serve "My Profile" — edit own `army_name`, change own password. Linked from the username in the header session row. |

## Convention

```js
import { games, reference } from '../api.js';
import { el, clear, toast } from '../components.js';

export async function renderFoo(state, fooId) {
  const root = el('div', { class: 'fade-in' });
  const data = await games.get(fooId);

  function rerender() {
    clear(root);
    root.appendChild(buildBody());
  }
  function buildBody() {
    return el('div', { class: 'panel' }, [/* … */]);
  }

  rerender();
  return root;
}
```

- **One `rerender()` closure per form-heavy view.** Score-input changes mutate the draft directly; only structural changes (mission pack changes, faction changes, add/remove a card slot) call `rerender()`. Calling `rerender()` on every keystroke blows away input focus.
- **Use `el()` from `components.js`.** Don't template-string HTML. Don't introduce a framework.
- **Modal dialogs via `confirmModal()` / `promptModal()`.** Don't use native `confirm()` / `prompt()`.
- **Toasts via `toast()`.** `toast(msg, 'error')` for failures.
- **Live updates**: listen for `'live:game.saved'` on `document` if your view should refresh when others save. Self-remove when `!document.body.contains(root)`. Pattern in `games-list.js`.

## Adding a new view

1. Create `app/js/views/<name>.js` exporting `renderXxx(state, ...)`.
2. Add the `<script type="module" src="/js/views/<name>.js"></script>` line to `app/index.html`.
3. Import in `app/js/app.js`: `import { renderXxx } from './views/<name>.js';`
4. Add to the `routes` array in `app.js`:

   ```js
   { match: /^\/foo$/, handler: () => renderXxx(state) },
   ```

5. If user-visible, add a `navLink('/foo', 'Foo')` to `navItems` (and gate by role if needed: `if (state.user.role === 'admin')`).

## When in doubt

- Pick the closest sibling and copy its skeleton.
- For form-with-rerender pattern: `game-form.js` is the canonical example.
- For panel-with-table pattern: `admin.js` user list.
- For chart pattern: `stats.js`.
- For canvas pattern: `warmap.js` — but read the CLAUDE.md "Theatre of War internals" section first; the constants are load-bearing.
