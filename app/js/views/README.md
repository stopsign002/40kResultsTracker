# `app/js/views/` — per-route view modules

Every file exports one function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. `app.js` swaps that node into `<main>` after the previous page is cleared. (`login.js` is the one sync exception — `app.js` `await`s the handler's result either way, so sync is fine when a view fetches nothing.)

## Views at a glance

| File | Route | Notes |
|---|---|---|
| `login.js` | `/login` | Public login form, an ordinary route like any other — it renders inside the normal shell (header + nav), not in place of it. Exports `renderLogin(state, onSuccess)`; `app.js` passes `onSuccess = () => navigate('/')`. A `requireAuth` / `requireAdmin` route redirects here when the session doesn't qualify, and the header shows a **Sign In** link when `state.user` is null. |
| `games-list.js` | `/games` | Filter panel (player/faction/mission/edition/medium/date/visibility/free-text search) + paginated game table. Each row carries up to **two thumbnails** (cover photo + terrain layout) with a hover preview, the players' chess-clock times, and — for 11e — the mission rendered as `"A vs B"` since the primary is per-player. Subscribes to `live:game.saved`. Reads URL hash params via `applyHashParams()` so click-throughs from stats / matchups work. |
| `game-detail.js` | `/games/:id` | Single game view with per-player breakdown. Secondaries are re-sorted **by round drawn** so the game reads back chronologically (entry is alphabetical). Hides the rounds grid entirely for a final-score-only game — an all-zero grid reads as "they scored nothing" rather than "nobody wrote it down". Photos panel (upload, incl. `.zip`; Cover / Map flags; lightbox) and a Terrain Layout panel. Admin-only Hide / Delete buttons (Delete uses `confirmModal`). |
| `game-form.js` | `/games/new`, `/games/:id/edit` | **HEAVIEST file.** Branches on edition throughout — see CLAUDE.md "10th vs 11th edition". Per-player **Score detail** toggle (track each secondary / round totals / final score only), per-player Force Disposition driving `PRIMARY_MATRIX`, multi-detachment list, Matched Play vs Custom terrain layout, chess-clock entry. Draft persistence to `localStorage`, undo-last-save toast on edit. Uses `rerender()` for structural changes; mutates draft directly on score-input change to preserve focus. Client-only draft keys (`scoreMode`, `mapMode`) are stripped in `serializeDraft()`. |
| `live-game.js` | `/play`, `/play/:id` | **The tracker you drive DURING a game**, 11e only. `/play` lists your in-progress drafts; `/play/:id` is the wizard — Setup → Round 1..5 → Summary. Everything autosaves to a server-side draft (`game_drafts`), so nothing reaches `games`/stats/war map/rankings until Submit. Round pips in the sticky header are tap targets, so a number typed into the wrong round is one tap to fix. Secondaries are **round-major** here (hand → draw / score / discard) rather than card-major as in `game-form.js`; the stored shape is identical, only the presentation inverts. Also: ± steppers for primary VP and CP (`cp_remaining` had no UI anywhere before this), a per-round chess clock that banks seconds as they elapse, per-round photos with an opt-out "snap a photo?" prompt between rounds, and an invited opponent who can score their own seat from their own phone over SSE. Mobile-first: its own `.lg-*` CSS block, 44px targets, 16px inputs. |
| `stats.js` | `/stats` | Chart.js dashboard: faction/player win rates, head-to-head, faction matchup heatmap, drill-down with detachment breakdown, calendar heatmap, trends. Click bars/cells to drill through to filtered `/games`. |
| `warmap.js` | `/`, `/war` | **Theatre of War.** Canvas-based deterministic map. **DO NOT TOUCH constants** — see CLAUDE.md "Critical invariants". Hover tooltip, faction glyphs in the legend (nothing is drawn on the map itself — banners grow from invisible seed positions), legend toggle, season picker. |
| `admin.js` | `/admin` | User CRUD, change own password, audit log viewer, seasons panel (start new), **Guest Accounts** panel (preview + promote guests to inactive accounts). Admin-only nav gating. |
| `ratings.js` | `/rankings` | **Admin-only.** Leaderboard ranked by a confidence floor (Glicko-2 ⇄ Whole-History toggle, margin-of-victory toggle; headline = floor, "est"/± = raw mean + uncertainty, provisional badges), balanced matchmaker (tick who's present → closest-skill pairings with predicted win-% and last-met, reshuffle), and an all-players rating-history compare chart (Chart.js time axis, daily points / month ticks, lines = the confidence floor, carried forward to today; click a player to highlight, others dim). Refuses non-admins; the API behind it is `requireAdmin`. |
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

- **Derive UI mode from data, not from a saved flag.** `game-form.js` works out
  which score-detail rung a game is on by looking at what it actually holds
  (cards → rounds → final), mirroring the server. The mode lives on the draft
  only so a half-filled choice doesn't snap back mid-edit; it never reaches the
  payload, and the server never trusts it.
- **Mirror server maths, don't invent a second rule.** `calcTotal()` exists
  purely for the live readout and must track `computeFinalScores` exactly —
  including the caps and the detail ladder. The server value is authoritative.
- **One `rerender()` closure per form-heavy view.** Score-input changes mutate the draft directly; only structural changes (mission pack changes, faction changes, add/remove a card slot) call `rerender()`. Calling `rerender()` on every keystroke blows away input focus.
- **Use `el()` from `components.js`.** Don't template-string HTML. Don't introduce a framework.
- **Modal dialogs via `confirmModal()` / `promptModal()`.** Don't use native `confirm()` / `prompt()`.
- **Toasts via `toast()`.** `toast(msg, 'error')` for failures.
- **Live updates**: listen for `'live:game.saved'` on `document` if your view should refresh when others save. Self-remove when `!document.body.contains(root)`. Pattern in `games-list.js`. `'live:draft.updated'` is the second event, for live-game co-editing — the SSE stream is **public and unfiltered**, so it carries only `{id, rev, by}` and the client re-fetches through the auth-gated endpoint. Ignore events whose `by` is your own client id, or you'll clobber whatever the user is typing with an echo of their own write.
- **Full-bleed views**: `main` is `padding: 24px; max-width: 1400px` and the header goes `position: relative` below 700px. `live-game.js` opts out by adding `live-game-mode` to `<body>` and **must remove it on teardown** — it hooks `hashchange` and drops the class as soon as the path stops being `/play`, because a leaked class costs every other route its gutters.

## Adding a new view

1. Create `app/js/views/<name>.js` exporting `renderXxx(state, ...)`.
2. Add the `<script type="module" src="/js/views/<name>.js"></script>` line to `app/index.html`.
3. Import in `app/js/app.js`: `import { renderXxx } from './views/<name>.js';`
4. Add to the `routes` array in `app.js`:

   ```js
   { match: /^\/foo$/, handler: () => renderXxx(state) },
   ```

   Add `requireAuth: true` or `requireAdmin: true` to the same entry if the route needs a session — `route()` redirects to `/login` when it doesn't qualify.

5. If user-visible, push `{ href: '/foo', label: 'Foo' }` onto `linkDefs` in `renderShell()` (gate by role if needed: `if (state.user?.role === 'admin')`).

## When in doubt

- Pick the closest sibling and copy its skeleton.
- For form-with-rerender pattern: `game-form.js` is the canonical example.
- For touch-first / autosaving / multi-client: `live-game.js`.
- For panel-with-table pattern: `admin.js` user list.
- For chart pattern: `stats.js`.
- For canvas pattern: `warmap.js` — but read the CLAUDE.md "Theatre of War internals" section first; the constants are load-bearing.
