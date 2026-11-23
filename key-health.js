/**
 * In-memory key health tracker shared by the Exa and Tavily rotators.
 *
 * A key that gets rejected is put on cooldown so subsequent requests skip it
 * instead of wasting a round-trip on a key that is known to be exhausted.
 * State lives in memory only — a server restart clears all cooldowns.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// HTTP status → how long to skip the key
const COOLDOWNS = {
  429: 1 * MINUTE, // rate limited — short pause
  402: 24 * HOUR, // out of credits / payment required
  432: 24 * HOUR, // Tavily: plan credit limit exceeded
  433: 24 * HOUR, // Tavily: pay-as-you-go limit exceeded
  401: 6 * HOUR, // invalid key — retried later in case it was a transient auth issue
  403: 6 * HOUR, // forbidden
};

const _state = new Map(); // "provider:key" → { until, status, at }

const id = (provider, key) => `${provider}:${key}`;

function shouldRotate(status) {
  return Object.prototype.hasOwnProperty.call(COOLDOWNS, status);
}

function markFailure(provider, key, status) {
  if (!key || !shouldRotate(status)) return;
  const now = Date.now();
  _state.set(id(provider, key), { until: now + COOLDOWNS[status], status, at: now });
}

function markSuccess(provider, key) {
  if (key) _state.delete(id(provider, key));
}

function cooldownOf(provider, key) {
  const s = _state.get(id(provider, key));
  if (!s) return null;
  if (s.until <= Date.now()) {
    _state.delete(id(provider, key));
    return null;
  }
  return s;
}

function isCooling(provider, key) {
  return cooldownOf(provider, key) !== null;
}

function maskKey(key) {
  if (!key) return "(keyless)";
  return key.length <= 12 ? `${key.slice(0, 3)}…` : `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** Status rows for the web_access_status tool. Never exposes full keys. */
function describeKeys(provider, keys) {
  return keys.map((k) => {
    const s = cooldownOf(provider, k);
    if (!s) return { key: maskKey(k), state: "ready" };
    const mins = Math.ceil((s.until - Date.now()) / MINUTE);
    return { key: maskKey(k), state: `cooling (HTTP ${s.status}, ${mins} min left)` };
  });
}

function reset() {
  _state.clear();
}

module.exports = {
  COOLDOWNS,
  shouldRotate,
  markFailure,
  markSuccess,
  isCooling,
  describeKeys,
  maskKey,
  reset,
};
