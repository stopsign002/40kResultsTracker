# `app/js/` — frontend modules

Eight shared modules + a `views/` directory of per-route render functions. ES modules, no build step. Each script is loaded directly from a `<script type="module">` tag in `index.html`.

## Module roles

| File | Exports | Purpose |
|---|---|---|
| `app.js` | (script entry; no exports) | Hash router + shell renderer + nav. Wraps each view in a try/catch error boundary; on failure shows a friendly panel with the stack trace and a Reload button. Calls `startLiveFeed()` on every `route()` pass, signed in or not — it's a no-op once the `EventSource` exists, and the feed is public like the rest of the read surface. |
| `api.js` | `api`, `auth`, `reference`, `games`, `gameImages`, `mapImages`, `drafts`, `draftImages`, `stats`, `admin`, `seasons`, `ratings` | Typed wrapper around `fetch`. All requests `credentials: 'same-origin'`. Throws Errors with `.status`, `.code` (server error code), and `.data` (full response body). Network failures throw with `status: 0`, `code: 'network'`. |
| `components.js` | `el`, `clear`, `toast`, `pill`, `fmtDate`, `fmtDuration`, `fmtScore`, `selectOptions`, `confirmModal`, `promptModal` | DOM helpers. **Use these — don't template-string HTML.** `el(tag, attrs?, children?)` is the workhorse; `attrs.class`, `attrs.style` (object), `attrs.onClick`. |
| `lightbox.js` | `openLightbox({ items, startIndex, thumbFor })` | Full-screen photo viewer. Opens with a **FLIP** zoom out of the clicked thumbnail — only `transform`/`opacity` are animated, the two properties the compositor can handle without re-running layout. Cycles with arrows / chevrons / swipe, closes on Esc / backdrop / swipe-down, preloads neighbours, locks body scroll, restores focus, and honours `prefers-reduced-motion`. `thumbFor(index)` is re-queried on close so it zooms back into whichever photo you cycled to. |
| `zip.js` | `extractImagesFromZip(file)`, `isZipFile(file)` | Dependency-free ZIP reader, because Google Photos hands you a `.zip` for a multi-photo download. Inflates via the browser's `DecompressionStream('deflate-raw')`. Handles STORED + DEFLATE in a classic (non-Zip64) archive; skips directories, `__MACOSX/`, dot-files and non-images, and skips an unreadable entry rather than failing the batch. Importable in plain Node, so it's testable without a browser. |
| `live.js` | `startLiveFeed`, `stopLiveFeed`, `isLiveConnected` | Singleton `EventSource` connection to `/api/events`. Listens for the SSE `game.saved` and `draft.updated` events and re-dispatches each as a `live:game.saved` / `live:draft.updated` CustomEvent on `document`. (The API also broadcasts `season.changed` from `routes/seasons.js`; nothing on the client subscribes to it yet.) Browser-native retry handles reconnects. |
| `game-rules.js` | `ROUNDS`, `DEFAULT_EDITION`, `MATCHED_PLAY_LAYOUTS`, `E11_PRIMARY_CAP`, `E11_SECONDARY_CAP`, `FORCE_DISPOSITIONS`, `PRIMARY_MATRIX`, `parseDuration`, `sumPrimary`, `sumSecondaries`, `sumSecondaryPoints`, `capLabel`, `calcTotal` | 40k rules constants + score maths shared by `views/game-form.js` and `views/live-game.js`. **`calcTotal()` must track `computeFinalScores()` in `api/lib/game-scoring.js` exactly** — it is a hand-maintained mirror driving the live readout only; the server value is authoritative. |
| `images.js` | `shrink(file, maxDim, quality)` | Browser-side downscale → JPEG re-encode, returning `{ dataUrl, width, height }`. `createImageBitmap(file, { imageOrientation: 'from-image' })` is load-bearing (see "Images" below). |

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

## Images

Photos and terrain-layout pictures are **downscaled in the browser** before
upload (`shrink()` in `images.js`) and posted as base64 data URLs:
a ~2048px full plus a ~400px thumb. That keeps a native image library out of the
container and stops a 12MP phone photo crossing the wire whole.

- `createImageBitmap(file, { imageOrientation: 'from-image' })` is **load-
  bearing** — without it, portrait phone photos come out sideways once
  re-encoded through a canvas.
- Reads never touch the API: `gameImages.url()` / `mapImages.url()` build plain
  `/uploads/...` paths that Caddy serves off disk with a 1-year immutable cache
  header (filenames are UUIDs, so they never collide).

## Notable subtleties

- **Hash routes carry query strings**: `currentPath()` in `app.js` strips `?...` before regex-matching, so `/games?playerFaction=4` still matches `/^\/games$/`. Views can read the query via `window.location.hash.split('?')[1]` (see `views/games-list.js` `applyHashParams()` and `views/warmap.js` season picker).
- **`route()` is wrapped in try/catch**: an `unhandledrejection` listener also backstops async errors that escape the wrapper.
- **`window.__nav('/foo')`** is set globally in `app.js` for cross-view navigation; views can call it without importing.
