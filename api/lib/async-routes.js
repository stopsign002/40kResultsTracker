// Express 4 does not await async route handlers. A handler that rejects
// therefore produces an unhandled promise rejection, and Node 22 defaults to
// `--unhandled-rejections=throw` — so **the process exits**.
//
// That was remotely triggerable without a session. `POST /auth/login` with
// `{"username":"admin","password":{}}` reaches bcrypt.compare, which rejects on
// a non-string, and the container dies. So does `GET /games/abc` (parseInt →
// NaN → Postgres 22P02) and a dozen similar id/limit parses. `restart:
// unless-stopped` brought it back in seconds, but every SSE subscriber and
// in-flight request died with it, and it was repeatable at will.
//
// Rather than touch 35 handlers and rely on nobody ever forgetting again, this
// walks a router's stack after the routes are registered and wraps each handler
// so a rejection goes to `next(err)` — i.e. straight to the normal error
// middleware, which already returns a sanitised 500.
//
// It reaches into Express 4's `router.stack` internals. That is a deliberate
// trade: the alternative is a dependency, and Express 4 is in security-only
// maintenance so these internals are not going to move. `api/test/
// async-routes.test.js` pins the behaviour.

/** True for `(req, res, next)`; false for the 4-arg error middleware. */
function isRequestHandler(fn) {
  return typeof fn === 'function' && fn.length <= 3;
}

function wrap(fn) {
  const wrapped = function asyncSafe(req, res, next) {
    let out;
    try {
      out = fn.call(this, req, res, next);
    } catch (err) {
      next(err);
      return undefined;
    }
    if (out && typeof out.then === 'function') out.catch(next);
    return out;
  };
  // Preserve arity so Express keeps treating it as a request handler, and keep
  // the name for readable stack traces.
  Object.defineProperty(wrapped, 'length', { value: fn.length });
  Object.defineProperty(wrapped, 'name', { value: fn.name || 'anonymous' });
  return wrapped;
}

/**
 * Wrap every handler already registered on a router (and its routes) so that a
 * rejected promise becomes `next(err)` instead of an unhandled rejection.
 * Returns the same router, so it can be applied inline at mount time.
 */
export function catchAsync(router) {
  const stack = router?.stack;
  if (!Array.isArray(stack)) return router;
  for (const layer of stack) {
    if (layer.route) {
      // A route: wrap each method handler on it.
      for (const sub of layer.route.stack || []) {
        if (isRequestHandler(sub.handle)) sub.handle = wrap(sub.handle);
      }
    } else if (isRequestHandler(layer.handle)) {
      // Router-level middleware, e.g. `router.use(requireAdmin)`.
      layer.handle = wrap(layer.handle);
    }
  }
  return router;
}

/**
 * Last-resort backstop. Even with every handler wrapped, a stray rejection
 * outside the request lifecycle (a fire-and-forget notify, a timer) would
 * otherwise take the process down. Log it and keep serving.
 */
export function installRejectionGuard() {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] kept the process alive:', reason);
  });
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] kept the process alive:', err);
  });
}
