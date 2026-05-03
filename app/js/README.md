# `app/js/` — frontend modules

Four shared modules + a `views/` directory of per-route render functions. ES modules, no build step. Each script is loaded directly from a `<script type="module">` tag in `index.html`.

## Module roles

| File | Exports | Purpose |
|---|---|---|
| `app.js` | (script entry; no exports) | Hash router + shell renderer + nav. Wraps each view in a try/catch error boundary; on failure shows a friendly panel with the stack trace and a Reload button. Calls `startLiveFeed()` once we know we're authenticated. |
| `api.js` | `api`, `auth`, `reference`, `games`, `stats`, `admin`, `seasons` | Typed wrapper around `fetch`. All requests `credentials: 'same-origin'`. Throws Errors with `.status`, `.code` (server error code), and `.data` (full response body). Network failures throw with `status: 0`, `code: 'network'`. |
| `components.js` | `el`, `clear`, `toast`, `pill`, `fmtDate`, `fmtScore`, `selectOptions`, `confirmModal`, `promptModal` | DOM helpers. **Use these — don't template-string HTML.** `el(tag, attrs?, children?)` is the workhorse; `attrs.class`, `attrs.style` (object), `attrs.onClick`. |
| `live.js` | `startLiveFeed`, `stopLiveFeed`, `isLiveConnected` | Singleton `EventSource` connection to `/api/events`. Listens for SSE `game.saved` / `season.changed` events and dispatches them as CustomEvents (`live:game.saved`, etc.) on `document`. Browser-native retry handles reconnects. |

## Conventions

- **Never `fetch()` directly from a view.** Always extend the right export object in `api.js`.
- **Never use `confirm()` / `prompt()`.** Use `confirmModal()` / `promptModal()` from `components.js`.
- **Never use `localeCompare` in `views/warmap.js`.** Use codepoint comparison (`a < b ? -1 : a > b ? 1 : 0`) — locale ordering would break the war map's deterministic rendering across devices. See CLAUDE.md pitfall #7.
- **Live updates**: views that should refresh when others save register a self-removing `live:game.saved` listener. Pattern (from `views/games-list.js`):

  ```js
  const liveHandler = () => {
    if (!document.body.contains(root)) {
      document.removeEventListener('live:game.saved', liveHandler);
      return;
    }
    refresh().catch(() => {});
  };
  document.addEventListener('live:game.saved', liveHandler);
  ```

  The listener self-removes when its view's root is gone. No listener cleanup needed in `app.js`.

## Adding a new shared module

1. Create `app/js/<name>.js` with named exports.
2. Add a `<script type="module" src="/js/<name>.js"></script>` line to `app/index.html`.
3. Import from any view that needs it.

For new view files, see `views/README.md`.

## Notable subtleties

- **Hash routes carry query strings**: `currentPath()` in `app.js` strips `?...` before regex-matching, so `/games?playerFaction=4` still matches `/^\/games$/`. Views can read the query via `window.location.hash.split('?')[1]` (see `views/games-list.js` `applyHashParams()` and `views/warmap.js` season picker).
- **`route()` is wrapped in try/catch**: an `unhandledrejection` listener also backstops async errors that escape the wrapper.
- **`window.__nav('/foo')`** is set globally in `app.js` for cross-view navigation; views can call it without importing.
