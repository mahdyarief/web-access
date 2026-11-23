const { keysInRotationOrder, hasKeys } = require("./exa-rotator");
const { loadConfig } = require("./config");
const { markFailure, markSuccess, shouldRotate } = require("./key-health");

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";

const DEFAULT_DEADLINE_MS = 45000; // total budget across all attempts
const MAX_ATTEMPT_MS = 30000; // cap for a single attempt

// Exa MCP sometimes reports quota problems inside a 200 response body.
const QUOTA_TEXT = /rate.?limit|too many requests|quota|insufficient credits|exceeded/i;

/** Error that is worth retrying with another key (or keyless). */
class RetryableError extends Error {}

function exaSettings() {
  const exa = loadConfig()?.exa || {};
  return {
    keylessFallback: exa.keylessFallback !== false,
    deadlineMs: Number(exa.timeoutMs) > 0 ? Number(exa.timeoutMs) : DEFAULT_DEADLINE_MS,
  };
}

/**
 * Call a tool on Exa's hosted MCP endpoint.
 *
 * - Rotates through healthy keys (keys on cooldown are skipped).
 * - Exa works without a key, so a final keyless attempt is made when every key
 *   is rejected / cooling, unless "exa.keylessFallback" is false in the config.
 * - Only key/quota errors, 5xx and network errors trigger another attempt;
 *   everything else fails fast. All attempts share one overall deadline.
 */
async function callExaMcp(toolName, args) {
  const { keylessFallback, deadlineMs } = exaSettings();
  const configured = hasKeys();
  const keys = keysInRotationOrder();

  // null = keyless request
  let attempts;
  if (!configured) attempts = [null];
  else if (keylessFallback) attempts = [...keys, null];
  else attempts = keys;

  if (attempts.length === 0) {
    throw new Error(
      "All Exa keys are cooling down (rate-limited or out of credits) and keyless fallback is disabled."
    );
  }

  const deadline = Date.now() + deadlineMs;
  let lastError = null;

  for (let i = 0; i < attempts.length; i++) {
    const key = attempts[i];
    const remaining = deadline - Date.now();
    if (remaining < 1000) {
      lastError = new Error(`Exa request timed out after ${deadlineMs}ms (${i} attempt(s))`);
      break;
    }
    if (!key && configured) console.error("[exa] No usable key left, retrying keyless...");

    try {
      const text = await attemptOnce(toolName, args, key, Math.min(remaining, MAX_ATTEMPT_MS));
      markSuccess("exa", key);
      return text;
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      lastError = err;
      if (i < attempts.length - 1) console.error(`[exa] ${err.message} — trying next...`);
    }
  }

  throw lastError || new Error("Exa MCP request failed");
}

async function attemptOnce(toolName, args, key, timeoutMs) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (key) headers.Authorization = `Bearer ${key}`;

  let response;
  try {
    response = await fetch(EXA_MCP_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // network error / timeout — not the key's fault, but another attempt may succeed
    throw new RetryableError(`Exa network error: ${err.message}`);
  }

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 300);
    const msg = `Exa error ${response.status}: ${errText}`;
    if (shouldRotate(response.status)) {
      markFailure("exa", key, response.status);
      throw new RetryableError(msg);
    }
    if (response.status >= 500) throw new RetryableError(msg);
    throw new Error(msg);
  }

  const body = await response.text();
  const parsed = tryParseSse(body) || tryParseJson(body);
  if (!parsed) throw new Error("Exa MCP returned empty response");

  if (parsed.error) {
    const msg = `Exa error${parsed.error.code ? " " + parsed.error.code : ""}: ${
      parsed.error.message || "Unknown"
    }`;
    if (QUOTA_TEXT.test(msg)) {
      markFailure("exa", key, 429);
      throw new RetryableError(msg);
    }
    throw new Error(msg);
  }
  if (parsed.result?.isError) {
    const msg =
      parsed.result.content?.find((c) => c.type === "text")?.text?.trim() ||
      "Exa MCP returned an error";
    if (QUOTA_TEXT.test(msg)) {
      markFailure("exa", key, 429);
      throw new RetryableError(msg);
    }
    throw new Error(msg);
  }

  const text = parsed.result?.content?.find(
    (c) => c.type === "text" && typeof c.text === "string" && c.text.trim().length > 0
  )?.text;
  if (!text) throw new Error("Exa MCP returned empty content");
  return text;
}

function tryParseSse(body) {
  const dataLines = body.split("\n").filter((l) => l.startsWith("data:"));
  for (const line of dataLines) {
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const c = JSON.parse(payload);
      if (c?.result || c?.error) return c;
    } catch {}
  }
  return null;
}

function tryParseJson(body) {
  try {
    const c = JSON.parse(body);
    if (c?.result || c?.error) return c;
  } catch {}
  return null;
}

module.exports = { callExaMcp };
