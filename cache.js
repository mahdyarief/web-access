/**
 * Small in-memory TTL cache for tool results — saves API credits when the
 * model repeats the same search within a few minutes.
 *
 * TTL comes from "cacheTtlSeconds" in web-access.json (default 600; 0 disables).
 */

const { loadConfig } = require("./config");

const DEFAULT_TTL_S = 600;
const MAX_ENTRIES = 200;

const _store = new Map(); // key → { value, expires }
let _hits = 0;
let _misses = 0;

function ttlMs() {
  const v = loadConfig()?.cacheTtlSeconds;
  const s = v === undefined ? DEFAULT_TTL_S : Number(v);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

/** Stable key: sorted args so {a,b} and {b,a} hit the same entry. */
function makeKey(tool, args) {
  const sorted = Object.keys(args || {})
    .sort()
    .reduce((o, k) => {
      const v = args[k];
      o[k] = typeof v === "string" ? v.trim() : v;
      return o;
    }, {});
  return `${tool}:${JSON.stringify(sorted)}`;
}

/**
 * Return cached value for (tool,args) or compute it with fn(). Only
 * successful results are cached.
 */
async function cached(tool, args, fn) {
  const ttl = ttlMs();
  if (!ttl) return fn();

  const key = makeKey(tool, args);
  const hit = _store.get(key);
  if (hit && hit.expires > Date.now()) {
    _hits++;
    // refresh LRU position
    _store.delete(key);
    _store.set(key, hit);
    return hit.value;
  }
  _misses++;

  const value = await fn();
  _store.set(key, { value, expires: Date.now() + ttl });
  while (_store.size > MAX_ENTRIES) _store.delete(_store.keys().next().value);
  return value;
}

function stats() {
  const now = Date.now();
  let live = 0;
  for (const v of _store.values()) if (v.expires > now) live++;
  return { entries: live, hits: _hits, misses: _misses, ttlSeconds: ttlMs() / 1000 };
}

function clear() {
  _store.clear();
  _hits = 0;
  _misses = 0;
}

module.exports = { cached, stats, clear, makeKey };
