// Unit tests for lib/async-routes.js.
//
// This is the guard against the worst bug this codebase has had: Express 4
// doesn't await async handlers and Node 22 exits on an unhandled rejection, so
// `POST /auth/login {"username":"admin","password":{}}` — unauthenticated —
// terminated the container. `catchAsync` walks a router's stack at mount time
// and wraps every handler, which means it depends on Express 4 internals
// (`router.stack`, `layer.route.stack`). Those are frozen in practice, but if
// they ever move, this file is what tells you.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from 'express';
import { catchAsync } from '../lib/async-routes.js';

/** Drive a wrapped router's first matching handler without a live server. */
function invoke(router, { method = 'get', path = '/x' } = {}) {
  const layer = router.stack.find((l) => l.route?.path === path);
  assert.ok(layer, `no route registered at ${path}`);
  const sub = layer.route.stack.find((s) => !s.method || s.method === method);
  assert.ok(sub, `no ${method} handler at ${path}`);

  return new Promise((resolve) => {
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; resolve({ kind: 'response', res: this }); return this; },
    };
    const next = (err) => resolve({ kind: 'next', err });
    try {
      sub.handle({}, res, next);
    } catch (err) {
      resolve({ kind: 'threw', err });
    }
  });
}

describe('catchAsync', () => {
  test('a rejected async handler is routed to next(err) instead of escaping as an unhandled rejection', async () => {
    const router = Router();
    router.get('/x', async () => { throw new Error('boom'); });
    catchAsync(router);

    const out = await invoke(router);
    assert.equal(out.kind, 'next', 'the rejection must reach the error middleware');
    assert.equal(out.err.message, 'boom');
  });

  test('a synchronous throw is caught too', async () => {
    const router = Router();
    router.get('/x', () => { throw new Error('sync boom'); });
    catchAsync(router);

    const out = await invoke(router);
    assert.equal(out.kind, 'next');
    assert.equal(out.err.message, 'sync boom');
  });

  test('a handler that succeeds is untouched', async () => {
    const router = Router();
    router.get('/x', async (_req, res) => res.status(200).json({ ok: true }));
    catchAsync(router);

    const out = await invoke(router);
    assert.equal(out.kind, 'response');
    assert.equal(out.res.statusCode, 200);
    assert.deepEqual(out.res.body, { ok: true });
  });

  test('router-level middleware is wrapped as well as route handlers', async () => {
    // `router.use(requireAdmin)` is the shape that matters: if requireAuth ever
    // becomes async (it should, to re-read is_active) its rejection has to be
    // caught too.
    const router = Router();
    let reached = false;
    router.use(async () => { throw new Error('middleware boom'); });
    router.get('/x', async () => { reached = true; });
    catchAsync(router);

    const mw = router.stack.find((l) => !l.route);
    assert.ok(mw, 'the use() layer should be on the stack');
    const err = await new Promise((resolve) => mw.handle({}, {}, resolve));
    assert.equal(err.message, 'middleware boom');
    assert.equal(reached, false);
  });

  test('the 4-argument error middleware is left alone', () => {
    // Wrapping it would change its arity and Express would stop recognising it
    // as an error handler, silently disabling error handling altogether.
    const router = Router();
    const errorHandler = (_err, _req, _res, _next) => {};
    router.use(errorHandler);
    catchAsync(router);

    const layer = router.stack.find((l) => !l.route);
    assert.equal(layer.handle.length, 4, 'arity must survive');
    assert.equal(layer.handle, errorHandler, 'and it must not be wrapped at all');
  });

  test('wrapping preserves handler arity, which Express uses to classify layers', async () => {
    const router = Router();
    router.get('/x', async (_req, _res, _next) => {});
    catchAsync(router);
    const sub = router.stack.find((l) => l.route?.path === '/x').route.stack[0];
    assert.equal(sub.handle.length, 3);
  });

  test('a router with no stack is returned unchanged rather than throwing', () => {
    assert.doesNotThrow(() => catchAsync(undefined));
    assert.doesNotThrow(() => catchAsync({}));
    const notARouter = { nope: true };
    assert.equal(catchAsync(notARouter), notARouter);
  });
});
