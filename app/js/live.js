// Single shared EventSource subscription. Other views can listen for
// 'live:game.saved' on document; the connection auto-reconnects via the
// browser's native EventSource retry behaviour.

let es = null;
let connected = false;

export function startLiveFeed() {
  if (es) return;
  try {
    es = new EventSource('/api/events');
  } catch (e) {
    console.warn('SSE unavailable:', e);
    return;
  }
  es.addEventListener('open', () => { connected = true; });
  es.addEventListener('error', () => { connected = false; });
  es.addEventListener('game.saved', (e) => {
    let data = {};
    try { data = JSON.parse(e.data); } catch {}
    document.dispatchEvent(new CustomEvent('live:game.saved', { detail: data }));
  });
}

export function isLiveConnected() { return connected; }

export function stopLiveFeed() {
  if (es) { es.close(); es = null; connected = false; }
}
