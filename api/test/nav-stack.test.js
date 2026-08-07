// Unit tests for app/js/nav-stack.js — the back-button layer stack.
//
// Lives in api/test because that's where `npm test` runs; the module under test
// is a frontend one, dependency-free apart from `window`/`history`, shimmed
// below. Worth pinning hard: the logic is fiddly, it's invisible until someone
// hits it on a phone, and the failure modes are both bad — either an overlay
// is stranded over the app with no way to dismiss it, or one back press closes
// the overlay AND navigates, which is what a user actually reported.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Behaves like the browser's history for the parts we use. `url` is tracked so
// we can assert the route never moves while a layer is open.
class FakeHistory {
  constructor() {
    this.entries = [{ state: null, url: '#/games/17' }];
    this.idx = 0;
    this.onPop = null;
  }
  get state() { return this.entries[this.idx].state; }
  get url() { return this.entries[this.idx].url; }
  pushState(state) {
    this.entries = this.entries.slice(0, this.idx + 1);
    this.entries.push({ state, url: this.url });
    this.idx += 1;
  }
  back() {
    if (this.idx === 0) { this.wentPastStart = true; return; }
    this.idx -= 1;
    this.onPop?.({ state: this.entries[this.idx].state });
  }
  get depth() { return this.entries.length; }
}

const listeners = {};
globalThis.window = {
  addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
};
const h = new FakeHistory();
globalThis.history = h;
globalThis.document = {
  querySelectorAll: () => [],
  body: { classList: { remove() {} } },
};

const fire = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
h.onPop = (ev) => fire('popstate', ev);

const { pushLayer, openLayerCount, isArmed } = await import('../../app/js/nav-stack.js');

function reset() {
  fire('hashchange');           // drops any open layers
  h.entries = [{ state: null, url: '#/games/17' }];
  h.idx = 0;
  h.wentPastStart = false;
}

describe('nav-stack', () => {
  test('opening a layer arms exactly one sentinel history entry', () => {
    reset();
    pushLayer(() => {});
    assert.equal(h.depth, 2, 'one entry above the route entry');
    assert.equal(isArmed(), true);
  });

  test('a second layer does NOT push another entry', () => {
    reset();
    pushLayer(() => {});
    pushLayer(() => {});
    assert.equal(h.depth, 2,
      'one sentinel covers the whole overlay session — fewer pushState calls, and '
      + 'no way for a missing entry to drop back through to the route');
    assert.equal(openLayerCount(), 2);
  });

  test('back closes the layer and leaves the route exactly where it was', () => {
    reset();
    let closed = 0;
    pushLayer(() => { closed += 1; });
    const urlBefore = h.url;
    h.back();
    assert.equal(closed, 1);
    assert.equal(openLayerCount(), 0);
    assert.equal(h.url, urlBefore, 'the route must not move');
    assert.equal(h.idx, 0, 'we land back on the route entry, not past it');
  });

  test('back closes one layer per press and re-arms while any remain', () => {
    reset();
    const order = [];
    pushLayer(() => order.push('outer'));
    pushLayer(() => order.push('inner'));

    h.back();
    assert.deepEqual(order, ['inner'], 'newest first');
    assert.equal(isArmed(), true, 'a layer is still open, so the sentinel is back');
    assert.equal(h.idx, 1, 'still sitting above the route entry');

    h.back();
    assert.deepEqual(order, ['inner', 'outer']);
    assert.equal(isArmed(), false);
    assert.equal(h.idx, 0);
    assert.equal(h.wentPastStart, undefined || false);
  });

  test('one back press never closes a layer AND changes the route', () => {
    reset();
    let closed = 0;
    pushLayer(() => { closed += 1; });
    const idxBefore = h.idx;
    h.back();
    // Landed on the route entry, did not go past it: the page is unchanged.
    assert.equal(closed, 1);
    assert.equal(idxBefore - h.idx, 1, 'exactly one history step was consumed');
    assert.ok(!h.wentPastStart, 'must never rewind past the route entry');
  });

  test('closing by its own means consumes the sentinel so back does not double-fire', () => {
    reset();
    let closed = 0;
    const layer = pushLayer(() => { closed += 1; });
    layer.done();
    assert.equal(openLayerCount(), 0);
    assert.equal(isArmed(), false);
    assert.equal(h.idx, 0, 'the sentinel is consumed, we are back on the route entry');
    assert.equal(closed, 0, 'onPop is the BACK path only — the caller already tore down');
  });

  test('the sentinel is only released when the LAST layer closes', () => {
    reset();
    const a = pushLayer(() => {});
    const b = pushLayer(() => {});
    a.done();
    assert.equal(isArmed(), true, 'b is still open');
    assert.equal(h.idx, 1);
    b.done();
    assert.equal(isArmed(), false);
    assert.equal(h.idx, 0);
  });

  test('done() after the back button already closed the layer is a no-op', () => {
    reset();
    const layer = pushLayer(() => {});
    h.back();
    const idxAfter = h.idx;
    layer.done();
    assert.equal(h.idx, idxAfter,
      'a second rewind here would eat an unrelated entry and skip a page');
  });

  test('a popstate with nothing open is left alone as a genuine route move', () => {
    reset();
    pushLayer(() => {});
    h.back();                 // closes the layer
    assert.equal(openLayerCount(), 0);
    h.back();                 // a real back press now
    assert.ok(h.wentPastStart, 'the second press reaches the route, as it should');
  });

  test('a route change drops every layer and says why', () => {
    reset();
    const reasons = [];
    pushLayer((r) => reasons.push(r));
    pushLayer((r) => reasons.push(r));
    fire('hashchange');
    assert.equal(openLayerCount(), 0);
    assert.deepEqual(reasons, ['route', 'route'],
      'the reason matters: an overlay skips its zoom-out when the thumbnail it '
      + 'would animate into has just been destroyed');
    assert.equal(isArmed(), false);
  });

  test('back reports itself as a popstate so overlays animate out normally', () => {
    reset();
    const reasons = [];
    pushLayer((r) => reasons.push(r));
    h.back();
    assert.deepEqual(reasons, ['popstate']);
  });

  test('a layer whose teardown throws still leaves the stack consistent', () => {
    reset();
    pushLayer(() => { throw new Error('boom'); });
    pushLayer(() => {});
    assert.doesNotThrow(() => fire('hashchange'));
    assert.equal(openLayerCount(), 0, 'one bad teardown must not strand the rest');
  });
});
