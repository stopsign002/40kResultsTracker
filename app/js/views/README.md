# `app/js/views/` — per-route view modules

Every file exports one function: `export async function renderXxx(state, ...args)`. It returns a single root DOM node. `app.js` swaps that node into `<main>` after the previous page is cleared. (`login.js` is the one sync exception — `app.js` `await`s the handler's result either way, so sync is fine when a view fetches nothing.)

## Views at a glance

| File | Route | Notes |
|---|---|---|
| `login.js` | `/login` | Public login form, an ordinary route like any other — it renders inside the normal shell (header + nav), not in place of it. Exports `renderLogin(state, onSuccess)`; `app.js` passes `onSuccess = () => navigate('/')`. A `requireAuth` / `requireAdmin` route redirects here when the session doesn't qualify, and the header shows a **Sign In** link when `state.user` is null. |
| `games-list.js` | `/games` | Filter panel (player/faction/mission/edition/medium/date/visibility/free-text search) + paginated game table. Each row carries up to **two thumbnails** (the game's cover photo + its own terrain shot) with a hover preview, the players' chess-clock times, and — for 11e — the mission rendered as `"A vs B"` since the primary is per-player. Subscribes to `live:game.saved`. Reads URL hash params via `applyHashParams()` so click-throughs from stats / matchups work. |
| `game-detail.js` | `/games/:id` | Single game view with per-player breakdown. Secondaries are re-sorted **by round drawn** so the game reads back chronologically (entry is alphabetical). Hides the rounds grid entirely for a final-score-only game — an all-zero grid reads as "they scored nothing" rather than "nobody wrote it down". Army list in a collapsible `<details>` (`.detail-summary`), printed as stored — decoding happened at write time, so nothing is imported from `army-list.js` here. Photos panel (upload, incl. `.zip`; Cover / Map flags; lightbox) and a Terrain Layout panel showing this game's `is_map` photo — both read one shared image list, so tagging in either repaints both; a photo carrying a caption gets a `.photo-badge.is-round` chip bottom-right. Admin-only Hide / Delete buttons (Delete uses `confirmModal`). |
| `game-form.js` | `/games/new`, `/games/:id/edit` | **HEAVIEST file.** Branches on edition throughout — see CLAUDE.md "10th vs 11th edition". Per-player **Score detail** toggle (track each secondary / round totals / final score only), per-player Force Disposition driving `PRIMARY_MATRIX`, multi-detachment list, Matched Play vs Custom terrain layout, chess-clock entry (per-round splits, plus a Total Time box that is derived from them until **Edit** sets `timeIsManual`). Per-player **Tactical vs Fixed** secondaries — Fixed swaps the card-major deck for a chosen-cards x R1-R5 VP grid. Draft persistence to `localStorage`, undo-last-save toast on edit. Uses `rerender()` for structural changes; mutates draft directly on score-input change to preserve focus. Client-only draft keys (`scoreMode`, `mapMode`) are stripped in `serializeDraft()`. |
| `live-game.js` | `/play`, `/play/:id` | **The tracker you drive DURING a game**, 11e only. `/play` lists **everyone's** in-progress drafts (yours first); `/play/:id` is the wizard — Setup → Round 1..5 → Summary. Everything autosaves to a server-side draft (`game_drafts`), so nothing reaches `games`/stats/war map/rankings until Submit. Round pips in the sticky header are tap targets. Secondaries are **round-major** here (hand → draw / score / discard) rather than card-major as in `game-form.js`; the Setup step also carries the per-seat **Tactical vs Fixed** choice, and in Fixed mode the round screen scores the two chosen missions instead of offering a draw picker; the stored shape is identical, only the presentation inverts. Also: ± steppers for primary VP and CP (`cp_remaining` had no UI anywhere before this; CP carries forward from the previous round since it's a running pool, primary VP doesn't), a per-round chess clock that banks seconds as they elapse, per-round photos with an opt-out "snap a photo?" prompt between rounds, and an invited opponent who can score their own seat from their own phone over SSE. Mobile-first: its own `.lg-*` CSS block, 44px targets, 16px inputs. See "Live game tracker" below. |
| `stats.js` | `/stats` | Chart.js dashboard: faction/player win rates, head-to-head, faction matchup heatmap, drill-down with detachment breakdown, calendar heatmap, trends. Click bars/cells to drill through to filtered `/games`. Fully mobile-passed — see "Stats on a phone" below. |
| `warmap.js` | `/`, `/war` | **Theatre of War.** Canvas-based deterministic map. **DO NOT TOUCH constants** — see CLAUDE.md "Critical invariants". Hover tooltip, faction glyphs in the legend (nothing is drawn on the map itself — banners grow from invisible seed positions), legend toggle, season picker. |
| `admin.js` | `/admin` | User CRUD (incl. a **Last Login** column), change own password, audit log viewer, seasons panel (start new), **Guest Accounts** panel (preview + promote guests to inactive accounts), **Deleted Items** panel (Restore / Delete forever). Admin-only nav gating. |
| `ratings.js` | `/rankings` | **Admin-only.** Leaderboard ranked by a confidence floor (Glicko-2 ⇄ Whole-History toggle, margin-of-victory toggle; headline = floor, "est"/± = raw mean + uncertainty, provisional badges), balanced matchmaker (tick who's present → closest-skill pairings with predicted win-% and last-met, reshuffle), and an all-players rating-history compare chart (Chart.js time axis, daily points / month ticks, lines = the confidence floor, carried forward to today; click a player to highlight, others dim). Refuses non-admins; the API behind it is `requireAdmin`. |
| `player.js` | `/players/:playerKey` | Per-player profile. Streaks, biggest win/loss margin, per-faction breakdown. `playerKey` is `'user:<id>'` or `'guest:<name>'`. |
| `profile.js` | `/profile` | Self-serve "My Profile" — edit own `army_name`, change own password, and a **Live Game** panel holding the between-rounds photo-prompt opt-out (`users.prompt_round_photo`, saved through `auth.updateMe`). Linked from the username in the header session row. |

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
- **Modal dialogs via `confirmModal()` / `promptModal()`.** Don't use native `confirm()` / `prompt()`. Both already answer the back button, and back means cancel.
- **Anything that *opens* registers a back layer.** `pushLayer(onPop)` from
  `../nav-stack.js` — an overlay, a picker, a wizard step. The teardown must be
  idempotent (back and your own close button both reach it), and the callback's
  `reason` is `'popstate'` or `'route'`: on `'route'` the thing you'd animate back
  into is already gone, so skip the animation. Full rationale in
  `app/js/README.md` "The back button". Overlays live in `<body>`, so a route
  re-render will **not** clean them up for you.
- **Toasts via `toast()`.** `toast(msg, 'error')` for failures.
- **Live updates**: listen for `'live:game.saved'` on `document` if your view should refresh when others save. Self-remove when `!document.body.contains(root)`. Pattern in `games-list.js`. `'live:draft.updated'` is the second event, for live-game co-editing — the SSE stream is **public and unfiltered**, so it carries only `{id, rev, by}` and the client re-fetches through the auth-gated endpoint. Ignore events whose `by` is your own client id, or you'll clobber whatever the user is typing with an echo of their own write.
- **Full-bleed views**: `main` is `padding: 24px; max-width: 1400px` and the header goes `position: relative` below 700px. `live-game.js` opts out by adding `live-game-mode` to `<body>` and **must remove it on teardown** — it hooks `hashchange` and drops the class as soon as the path stops being `/play`, because a leaked class costs every other route its gutters.

## Live game tracker (`live-game.js`)

The wizard is the app's only three-audience view, and most of its complexity is
deciding **who is looking**.

| | `viewerSeat` | Can edit | Follows the owner's round |
|---|---|---|---|
| Owner | `1` | everything | n/a — they set it |
| Invited opponent | `2` | their own seat only | **no** (deliberately) |
| Spectator | `null` | nothing | yes, over SSE |

- **Spectating is a first-class mode, not a degraded one.** Reads are public, so
  anyone can open a live game. `isSpectator` makes every control read-only,
  suppresses the local-restore prompt, short-circuits `touch()`, hides the photo
  panel when there are no photos, and shows a "Watching" pill plus "Updates live
  as they play" where the save chip would be.
- **The opponent is deliberately NOT dragged along** when the owner advances.
  They may still be entering the round they just played, and yanking the screen
  out from under them loses keystrokes. Instead `ownerStep` is tracked separately
  from `step` and rendered as a tappable `.lg-follow` chip — "They're on Round 3
  →" — which jumps only when they choose to. Spectators auto-follow because they
  have nothing to lose.
- **`canNavigate = isOwner || isAdmin`** gates the pip strip and the setup gear
  only. The footer Back / Next / Submit buttons stay owner-only, and a non-owner
  admin's moves are never persisted (`goStep` only calls `touch()` for the owner)
  — so an admin can walk through someone's game without editing it.
- **Setup is reachable from the pip strip**, via a `.lg-pip-setup` gear pinned at
  the head of it. The pips themselves derive "played" from **actual recorded
  data** (`roundHasData`: a primary score, a CP figure, banked time, or a
  secondary drawn/scored that round) rather than from the current step, so
  jumping back to fix round 2 doesn't un-play rounds 3–5. From setup the forward
  button reads "Round 4 →" — the furthest round that has data — instead of
  always restarting at round 1.
- **Two photo inputs, not one.** "📷 Take photo" carries `capture: 'environment'`;
  "🖼 Upload" carries `multiple`. One input can't do both jobs: `capture` hides
  the library outright, so a single button would mean you could never attach a
  photo you'd already taken.
- **The draw picker leads with "🎲 Draw at random"** (`.lg-picker-item.is-random`,
  pinned above the deck) — the common case at the table is "give me a card", not
  "find this specific one".
- **A "Danger zone" panel on the setup screen** lets the owner (or an admin)
  abandon a game without recording it. The confirm spells out what's being thrown
  away — "N rounds of scoring", "N photos" — because a draft is unrecoverable.
- **`flush()` genuinely awaits in-flight saves** and returns a boolean. It used
  to bail out while a PATCH was in flight, so tapping Submit straight after
  typing raced its own autosave and filed the *previous* payload — which is how a
  game with both names filled in came back "player 2 still needs a name". Submit
  now refuses to proceed if the save didn't land, and "Save draft" reports
  honestly ("Kept on this device — it will sync when you are back online").
- **Back walks the wizard.** `goStep()` pushes a layer per move, so back returns
  through the rounds you actually visited rather than leaving the site. The draw
  picker is a layer too.
- **In-place patching, not `rerender()`.** Totals go through `[data-lg-total]` /
  `[data-lg-split]` / `[data-lg-head]`, the clock through
  `[data-lg-timer="<seat>-<round>"]`, and the name field patches `.lg-seat-name`
  and its `.lg-seat-tab` directly — same focus-preservation rule as
  `game-form.js`, but stricter, because this view also persists on every mutation.
- **"Finished" means `submitted_at`, not `submitted_game_id`.** A submitted draft
  whose game was later hard-deleted shows an explanatory panel rather than
  404-ing into nowhere.

## Stats on a phone (`stats.js`)

The whole page used to scroll sideways. The fix is worth knowing because it is
not where you'd look:

- **`.stats-grid > * { min-width: 0 }`.** A grid item's default `min-width: auto`
  refuses to shrink below its content, so one wide table pushed the entire grid
  wider than the viewport.
- **`.stats-scroll` wrappers on every wide table.** `.stat-card` has **no**
  `overflow` rule of its own — unlike `.panel` (`overflow: hidden`) and
  `.panel-body` (`overflow-x: auto`) — so a table inside a stat card overflows the
  page unless it's wrapped. Wrap it; don't add `overflow` to `.stat-card` and
  change every card's clipping.
- **Charts size from CSS.** `maintainAspectRatio: false` plus a fixed-height
  `.stats-chart` box; Chart.js's aspect-ratio sizing fights a responsive column.
- **The faction matchup matrix has a mobile twin.** Below 700px
  `.stats-matchup-grid` is hidden and `.stats-matchup-mobile` takes over: pick a
  faction, get a list of `button.stats-matchup-row` rows. An N×N grid of factions
  is not a thing that can be made to fit a phone.
- **Calendar days select rather than navigate.** Tapping a lit day toggles
  `.is-selected` and fills the readout; a separate "View games" button is what
  actually leaves the page. A tap that navigates on a heatmap is too easy to hit
  by accident while scrolling.
- **Span cards use `.stats-span`, not `.stat-card[style*="grid-column"]`.** The
  attribute-selector hack is gone from this view. It survives elsewhere in
  `style.css` (`.player-panel > div[style*="grid-template-columns"]`) reaching
  into `game-form.js`'s inline grids — don't propagate it into new code.

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
