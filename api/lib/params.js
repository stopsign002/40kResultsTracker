// Safe parsing for ids and numeric query params.
//
// `parseInt('abc')` is NaN and `parseInt('99999999999999999999')` is 1e20 —
// both of which node-pg happily binds to an `integer` column, where Postgres
// throws 22P02 (invalid input syntax) or 22003 (out of range). Before the async
// wrapper landed those rejections killed the process; now they are 500s. They
// should be 400s: the request was malformed, not the server.
//
// `Number.isInteger` is not enough on its own — 1e20 passes it. Postgres
// `integer` tops out at 2147483647, so that is the real ceiling.

const PG_INT_MAX = 2147483647;

/** A positive Postgres-safe integer id, or null. */
export function idParam(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > PG_INT_MAX) return null;
  return n;
}

/** A bounded integer for limits/offsets/day-counts. Falls back to `fallback`. */
export function intParam(value, { min = 0, max = PG_INT_MAX, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
