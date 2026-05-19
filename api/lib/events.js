// @ts-check
// Lightweight Server-Sent Events broadcaster. Subscribers (any browser
// tab on the site with the live-feed enabled) hold a long-lived GET
// connection to /events; the server pushes a single line per event.
//
// Designed for friend-group scale: in-process Set of `res` handles, no
// fan-out to multiple servers, no persistence. If a connection drops we
// just stop writing to it.

/** @typedef {{ res: import('http').ServerResponse, userId: number }} Subscriber */

/** @type {Set<Subscriber>} */
const subs = new Set();

/**
 * Register a subscriber. Returns a cleanup function the caller should
 * invoke on `req.on('close', ...)`.
 * @param {Subscriber} sub
 * @returns {() => void}
 */
export function addSubscriber(sub) {
  subs.add(sub);
  return () => subs.delete(sub);
}

/**
 * Broadcast a JSON-serialisable event to every connected subscriber.
 * Failed writes silently remove the dead subscriber.
 * @param {string} type   Short event type identifier (e.g. 'game.saved')
 * @param {object} data
 */
export function broadcast(type, data) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const sub of subs) {
    try {
      sub.res.write(payload);
    } catch {
      subs.delete(sub);
    }
  }
}

/** @returns {number} Current subscriber count (debug / metrics) */
export function subscriberCount() { return subs.size; }
