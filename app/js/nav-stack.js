// Back-button support for things that are *open* rather than *navigated to*.
//
// The app is hash-routed, so back moves between routes. Anything layered on top
// of a route — the photo viewer, a modal, a step of the live-game wizard — is
// invisible to history, so back skips past it and leaves the page. On a phone
// that reads as the app throwing you out.
//
//   const layer = pushLayer((reason) => teardown());  // the BACK path
//   function close() { teardown(); layer.done(); }    // the own-means path
//
// `teardown()` must be idempotent — both paths reach it.
//
// ── Why one sentinel, not one entry per layer ──────────────────────────────
//
// The obvious design pushes a history entry per layer and matches an id in
// `history.state`. It fails badly in one specific way: if a push silently
// doesn't take, back falls straight through to the previous ROUTE, so the
// overlay closes AND the page changes underneath it from a single press. That
// is precisely the reported symptom, and it is miserable to reproduce.
//
// So instead we hold an invariant: **while any layer is open, exactly one
// sentinel entry sits above the route entry.** Back consumes the sentinel, we
// close the top layer, and re-arm if layers remain. The route entry is never
// what back lands on until everything is closed, and we make one pushState per
// overlay session instead of one per layer — which also keeps us clear of
// WebKit's pushState rate limit.

// Importable outside a browser: game-rules.test.js pulls in components.js for
// fmtDuration, and a bare `window.addEventListener` at module scope would throw
// before a single assertion ran.
const hasDom = typeof window !== 'undefined' && typeof history !== 'undefined';

let seq = 0;
const stack = [];
let armed = false;

function arm() {
  if (armed || !hasDom) return;
  try {
    history.pushState({ navSentinel: true }, '');
    armed = true;
  } catch {
    // History unavailable or rate-limited. The layer still works; it just
    // won't answer the back button this time.
    armed = false;
  }
}

function disarm() {
  if (!armed || !hasDom) return;
  armed = false;
  // Pushed with no url, so this rewind fires popstate but NOT hashchange —
  // the route is untouched.
  history.back();
}

export function pushLayer(onPop) {
  if (!hasDom) return { done() {} };
  const id = ++seq;
  stack.push({ id, onPop });
  arm();
  return {
    done() {
      const idx = stack.findIndex((l) => l.id === id);
      if (idx < 0) return; // the back button already took it
      stack.splice(idx, 1);
      if (!stack.length) disarm();
    },
  };
}

function popTop(reason) {
  const layer = stack.pop();
  if (!layer) return;
  try { layer.onPop(reason); } catch (err) { console.error('layer close failed:', err); }
}

// Overlays live in <body>, NOT inside #app, so a route re-render doesn't remove
// them. Whatever else goes wrong, a route change must not leave one on screen.
function sweepOrphans() {
  if (!hasDom) return;
  document.querySelectorAll('.lb-overlay, .modal-overlay').forEach((n) => n.remove());
  document.body.classList.remove('lb-lock');
}

if (hasDom) {
  window.addEventListener('popstate', () => {
    if (!stack.length) {
      // Nothing of ours is open — a genuine route move. Let it happen.
      armed = false;
      return;
    }
    armed = false; // the sentinel we were sitting on has just been consumed
    popTop('popstate');
    // Layers still underneath? Put the sentinel back, so the next press closes
    // another layer rather than leaving the page.
    if (stack.length) arm();
  });

  window.addEventListener('hashchange', () => {
    // A route change tears the view down anyway; drop everything without
    // touching history, since those entries went with the navigation.
    armed = false;
    while (stack.length) popTop('route');
    sweepOrphans();
  });
}

export function openLayerCount() {
  return stack.length;
}

export function isArmed() {
  return armed;
}
