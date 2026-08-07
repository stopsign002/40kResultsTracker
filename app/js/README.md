# `app/js/` — frontend modules

Ten shared modules + a `views/` directory of per-route render functions. ES modules, no build step. Each script is loaded directly from a `<script type="module">` tag in `index.html`.

Three of them are dependency-free enough to import in plain Node, and are unit-tested from `api/test/` rather than a second runner: `game-rules.js`, `army-list.js`, `nav-stack.js` (plus `components.js`, pulled in for `fmtDuration`). Run them with `scripts/test-unit.sh`. That's why a bare `window.addEventListener` at module scope is a hazard here — see the `hasDom` guard in `nav-stack.js`.

## Module roles

| File | Exports | Purpose |
|---|---|---|
| `app.js` | (script entry; no exports) | Hash router + shell renderer + nav. Wraps each view in a try/catch error boundary; on failure shows a friendly panel with the stack trace and a Reload button. Calls `startLiveFeed()` on every `route()` pass, signed in or not — it's a no-op once the `EventSource` exists, and the feed is public like the rest of the read surface. |
| `api.js` | `api`, `auth`, `reference`, `games`, `gameImages`, `mapImages`, `drafts`, `draftImages`, `stats`, `admin`, `seasons`, `ratings` | Typed wrapper around `fetch`. All requests `credentials: 'same-origin'`. Throws Errors with `.status`, `.code` (server error code), and `.data` (full response body). Network failures throw with `status: 0`, `code: 'network'`. |
| `components.js` | `el`, `clear`, `toast`, `pill`, `fmtDate`, `fmtDuration`, `fmtScore`, `selectOptions`, `confirmModal`, `promptModal` | DOM helpers. **Use these — don't template-string HTML.** `el(tag, attrs?, children?)` is the workhorse; `attrs.class`, `attrs.style` (object), `attrs.onClick`. |
| `nav-stack.js` | `pushLayer(onPop)`, `openLayerCount`, `isArmed` | Back-button support for things that are **open** rather than **navigated to** — see "The back button" below. |
| `army-list.js` | `looksLikeYaabCode`, `extractCode`, `isPlainJson`, `decodeArmyList`, `normaliseArmyList` | Decodes YAAB army-list share codes into readable text — see "Army lists" below. Zero dependencies; importable in plain Node, so it's tested without a browser. |
| `lightbox.js` | `openLightbox({ items, startIndex, thumbFor })` | Full-screen photo viewer. Opens with a **FLIP** zoom out of the clicked thumbnail — only `transform`/`opacity` are animated, the two properties the compositor can handle without re-running layout. Cycles with arrows / chevrons / swipe, closes on Esc / backdrop / swipe-down / **back**, preloads neighbours, locks body scroll, restores focus, and honours `prefers-reduced-motion`. `thumbFor(index)` is re-queried on close so it zooms back into whichever photo you cycled to. `close()` latches `closing = true` on its first line, so its teardown is wrapped in try/catch and always reaches `finish()` — a throw in the zoom maths used to strand the overlay in `<body>` permanently, with every later `close()` returning early. |
| `zip.js` | `extractImagesFromZip(file)`, `isZipFile(file)` | Dependency-free ZIP reader, because Google Photos hands you a `.zip` for a multi-photo download. Inflates via the browser's `DecompressionStream('deflate-raw')`. Handles STORED + DEFLATE in a classic (non-Zip64) archive; skips directories, `__MACOSX/`, dot-files and non-images, and skips an unreadable entry rather than failing the batch. Importable in plain Node, so it's testable without a browser. |
| `live.js` | `startLiveFeed`, `stopLiveFeed`, `isLiveConnected` | Singleton `EventSource` connection to `/api/events`. Listens for the SSE `game.saved` and `draft.updated` events and re-dispatches each as a `live:game.saved` / `live:draft.updated` CustomEvent on `document`. (The API also broadcasts `season.changed` from `routes/seasons.js`; nothing on the client subscribes to it yet.) Browser-native retry handles reconnects. |
| `game-rules.js` | `ROUNDS`, `DEFAULT_EDITION`, `MATCHED_PLAY_LAYOUTS`, `E11_PRIMARY_CAP`, `E11_SECONDARY_CAP`, `FORCE_DISPOSITIONS`, `PRIMARY_MATRIX`, `parseDuration`, `sumPrimary`, `sumSecondaries`, `sumSecondaryPoints`, `capLabel`, `calcTotal` | 40k rules constants + score maths shared by `views/game-form.js` and `views/live-game.js`. **`calcTotal()` must track `computeFinalScores()` in `api/lib/game-scoring.js` exactly** — it is a hand-maintained mirror driving the live readout only; the server value is authoritative. |
| `images.js` | `shrink(file, maxDim, quality)` | Browser-side downscale → JPEG re-encode, returning `{ dataUrl, width, height }`. `createImageBitmap(file, { imageOrientation: 'from-image' })` is load-bearing (see "Images" below). |

## Conventions

- **Never `fetch()` directly from a view.** Always extend the right export object in `api.js`.
- **Never use `confirm()` / `prompt()`.** Use `confirmModal()` / `promptModal()` from `components.js`. They already answer the back button.
- **Any new overlay registers a layer.** `pushLayer()` from `nav-stack.js`, with an idempotent teardown — see "The back button" below. An overlay that skips it means back leaves the page with the overlay still up.
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

## The back button (`nav-stack.js`)

The app is hash-routed, so back moves between **routes**. Anything layered *on
top* of a route — the photo viewer, a modal, a step of the live-game wizard — is
invisible to history, so back skipped past it and left the page. On a phone that
reads as the app throwing you out.

```js
const layer = pushLayer((reason) => teardown());  // the BACK path
function close() { teardown(); layer.done(); }    // the own-means path
```

Two rules, both load-bearing:

- **`teardown()` must be idempotent.** Both paths reach it. `buildModal` uses a
  `torn` flag; `lightbox.js` uses `closing`; the live-game picker uses `torn`.
- **Handle `reason`.** It is `'popstate'` (a real back press) or `'route'` (the
  hash changed). On `'route'` the thing an overlay would animate back into is
  already destroyed, so skip the animation —
  `close({ immediate: reason === 'route' })` in `lightbox.js` is the worked
  example. A layer that does real work on pop should think about whether it
  wants to do it at all on a route change.

**One sentinel, not one entry per layer.** While *any* layer is open, exactly one
sentinel history entry sits above the route entry; back consumes it, the top
layer closes, and the sentinel is re-armed if layers remain. The obvious
alternative — one `pushState` per layer, matched by an id in `history.state` —
fails in one specific and miserable way: if a push silently doesn't take, back
falls straight through to the previous **route**, so the overlay closes *and* the
page changes underneath it from a single press. The single sentinel also keeps
one `pushState` per overlay session, well clear of WebKit's rate limit.

On a route change the module also **sweeps orphaned `.lb-overlay` /
`.modal-overlay` nodes** and drops `lb-lock` from `<body>`. Overlays are appended
to `<body>`, not inside `#app`, so a route re-render does not remove them —
whatever else goes wrong, a route change must not leave one on screen. If you add
a new body-parented overlay, give it one of those two classes or extend the
sweep.

Wired in today: `components.js` (`buildModal`, so `confirmModal` / `promptModal`
both answer back — and back means **cancel**, resolving `false` / `null` exactly
like the backdrop), `lightbox.js`, and `views/live-game.js` (the draw picker, and
one layer per wizard step so back walks the rounds you actually visited).

## Army lists (`army-list.js`)

Decodes YAAB share codes so a pasted list is stored as readable, searchable text
instead of base64. Wire format is `YAAB1:<base64url(deflate-raw(JSON))>`, inflated
with the browser's native `DecompressionStream('deflate-raw')` plus `atob` —
**zero dependencies**. It handles v2 compact tuples, pre-v2 full-army codes, a raw
JSON paste, and a YAAB share **URL** (`?a=…`).

- `normaliseArmyList(text)` → `{ value, decoded }` is what callers actually want:
  the readable rendering with the original code kept on the last line, so the list
  stays searchable in `/games?q=` *and* re-openable in YAAB.
- **Accepts `v >= 2` deliberately**, not `v === 2`. Every extension yaab has
  shipped was additive — new positional slots on the end — so a future v3 most
  likely still decodes, and a partial read beats none.
- **Never half-renders.** If the entry array isn't walkable it returns `null`
  rather than a header with no units under it, and the caller stores the raw paste
  **exactly as typed**. Nothing is ever dropped or mangled; a hand-typed list is a
  perfectly good army list.
- Unit ids are 40kdc slugs, de-slugged for display, so no 10MB yaab data bundle is
  needed. A few read slightly off ("Arco Flagellants" vs "Arco-flagellants") —
  that's the accepted price, not a bug to fix by adding a dependency.

`views/game-form.js` and `views/live-game.js` both decode **on blur** (a `change`
listener on the textarea) and import only `looksLikeYaabCode` + `normaliseArmyList`.
`views/game-detail.js` imports nothing from here — decoding happens once at write
time, and detail just prints the stored text.

`api/test/army-list.test.js` round-trips fixtures through yaab's own encoder, and
carries a **format-drift canary** that reads the sister repo's `storage.js` and
fails if `YAAB1:` or `v: 2` disappears. `scripts/test-unit.sh` mounts that repo so
the canary can run; it skips when absent.

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
