const { keysInRotationOrder, hasKeys } = require("./tavily-rotator");
const { loadConfig } = require("./config");
const { markFailure, markSuccess, shouldRotate } = require("./key-health");

const TAVILY_API = "https://api.tavily.com";
const DEFAULT_DEADLINE_MS = 45000; // total budget across all keys
const MAX_ATTEMPT_MS = 30000;

class RetryableError extends Error {}

/**
 * POST to a Tavily endpoint, rotating through healthy keys.
 * Tavily has no keyless mode — at least one key (tvly-...) is required.
 * Key/quota errors put the key on cooldown and try the next one; 5xx and
 * network errors try the next key; anything else fails fast.
 */
async function callTavily(endpoint, payload, { deadlineMs } = {}) {
  if (!hasKeys()) {
    throw new Error(
      "No Tavily API keys configured. Add them to ~/.openclaude/web-access.json " +
        '({"tavily": {"keys": ["tvly-..."]}}) or set TAVILY_API_KEY(S).'
    );
  }
  const keys = keysInRotationOrder();
  if (keys.length === 0) {
    throw new Error("All Tavily keys are cooling down (rate-limited or out of credits).");
  }

  const cfgTimeout = Number(loadConfig()?.tavily?.timeoutMs);
  const budget = deadlineMs || (cfgTimeout > 0 ? cfgTimeout : DEFAULT_DEADLINE_MS);
  const deadline = Date.now() + budget;
  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const remaining = deadline - Date.now();
    if (remaining < 1000) {
      lastError = new Error(`Tavily request timed out after ${budget}ms (${i} attempt(s))`);
      break;
    }
    try {
      const data = await attemptOnce(endpoint, payload, key, Math.min(remaining, Math.max(MAX_ATTEMPT_MS, budget / 2)));
      markSuccess("tavily", key);
      return data;
    } catch (err) {
      if (!(err instanceof RetryableError)) throw err;
      lastError = err;
      if (i < keys.length - 1) console.error(`[tavily] Key #${i + 1}: ${err.message} — trying next key...`);
    }
  }
  throw lastError || new Error("Tavily request failed");
}

async function attemptOnce(endpoint, payload, key, timeoutMs) {
  let response;
  try {
    response = await fetch(`${TAVILY_API}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new RetryableError(`Tavily network error: ${err.message}`);
  }

  if (!response.ok) {
    const msg = `Tavily error ${response.status}: ${(await response.text()).slice(0, 300)}`;
    if (shouldRotate(response.status)) {
      markFailure("tavily", key, response.status);
      throw new RetryableError(msg);
    }
    if (response.status >= 500) throw new RetryableError(msg);
    throw new Error(msg);
  }
  return await response.json();
}

/**
 * Tavily web search.
 * @param {object} opts
 *   query, maxResults, site, recency (day|week|month|year),
 *   searchDepth (basic|advanced), topic (general|news|finance),
 *   includeAnswer (bool), includeRawContent (bool)
 */
async function tavilySearch(opts) {
  const payload = {
    query: opts.query,
    max_results: Math.min(Math.max(Number(opts.maxResults) || 5, 1), 20),
    search_depth: opts.searchDepth || "basic",
    topic: opts.topic || "general",
    include_answer: opts.includeAnswer ?? false,
    include_raw_content: opts.includeRawContent ?? false,
  };
  if (opts.site) payload.include_domains = [opts.site];
  if (opts.recency) payload.time_range = opts.recency;

  return callTavily("/search", payload);
}

/**
 * Tavily extract — fetch clean content from one or more URLs.
 */
async function tavilyExtract(urls, { extractDepth = "basic" } = {}) {
  return callTavily(
    "/extract",
    { urls: Array.isArray(urls) ? urls : [urls], extract_depth: extractDepth },
    { deadlineMs: 90000 }
  );
}

// ── Formatting ─────────────────────────────────────────────────

function formatTavilySearch(data, { maxContentChars = 2000 } = {}) {
  const parts = [];
  if (data?.answer) parts.push(`**Answer:** ${data.answer.trim()}`);

  const results = data?.results || [];
  if (results.length === 0 && parts.length === 0) return "No results found.";

  for (const r of results) {
    let out = `### [${r.title || r.url}](${r.url || ""})`;
    if (r.published_date) out += `\n_${r.published_date}_`;
    const body = (r.raw_content || r.content || "").trim();
    if (body) out += `\n\n${body.slice(0, maxContentChars)}`;
    parts.push(out);
  }
  return parts.join("\n\n---\n\n");
}

/** Strip image markup and navigation-only lines (in-page anchors, skip links). */
function cleanExtracted(md) {
  return (md || "")
    .replace(/\[(\s*!\[[^\]]*\]\([^)]*\)\s*)+\]\([^)]*\)/g, "") // linked images
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return true;
      // drop lines that are nothing but links to in-page anchors / site search
      const rest = t
        .replace(/^[*+\-\s]+/, "")
        .replace(/\[[^\]]*\]\((#|\/wiki\/Special:)[^)]*\)/g, "")
        .trim();
      return rest.length > 0;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatTavilyExtract(data, { maxChars = 8000 } = {}) {
  const parts = [];
  for (const r of data?.results || []) {
    const text = cleanExtracted(r.raw_content);
    const more = text.length > maxChars ? `\n\n[… truncated at ${maxChars} characters]` : "";
    parts.push(`## Content from: ${r.url}\n\n${text.slice(0, maxChars)}${more}`);
  }
  for (const f of data?.failed_results || []) {
    parts.push(`## Failed: ${f.url}\n\n${f.error || "unknown error"}`);
  }
  return parts.length ? parts.join("\n\n---\n\n") : "No content extracted.";
}

module.exports = { callTavily, tavilySearch, tavilyExtract, formatTavilySearch, formatTavilyExtract };
