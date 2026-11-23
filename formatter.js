/**
 * Result model shared by all providers, merging and formatting.
 *
 * Every provider is normalized to items of the form
 *   { title, url, published, content, score? }
 * so formatting, compact output and multi-provider merging work the same way.
 */

const DEFAULT_SNIPPET_CHARS = 1200;
const RRF_K = 60; // standard Reciprocal Rank Fusion constant

/** Clamp the per-result snippet length requested by the caller. */
function snippetLimit(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SNIPPET_CHARS;
  return Math.min(Math.max(Math.floor(n), 100), 10000);
}

/** Cut text at a word boundary close to max, marking the cut with "…". */
function truncate(text, max) {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

function cleanDate(v) {
  const d = (v || "").trim();
  if (/^(n\/?a|null|undefined|unknown|none)?$/i.test(d)) return "";
  // ISO timestamps → date only; keep anything else as given
  const iso = d.match(/^(\d{4}-\d{2}-\d{2})T/);
  return iso ? iso[1] : d;
}

/**
 * Parse Exa MCP's text output into items. (The REST client returns JSON and
 * does not need this.)
 */
function parseExaResults(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/\n---+\n/)
    .map((block) => {
      const title = block.match(/Title:\s*(.+)/)?.[1]?.trim();
      if (!title) return null;
      const highlights = block.match(/Highlights:\s*([\s\S]*?)(?=\n\w+:|$)/)?.[1]?.trim();
      return {
        title,
        url: block.match(/URL:\s*(.+)/)?.[1]?.trim() || "",
        published: cleanDate(block.match(/Published:\s*(.+)/)?.[1]),
        content: highlights || extractedContent(block),
      };
    })
    .filter(Boolean);
}

function extractedContent(block) {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(Title|URL|Published|Author|Highlights):/i.test(l))
    .join("\n")
    .trim();
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|fbclid$|gclid$)/i.test(k)) u.searchParams.delete(k);
    }
    const host = u.hostname.replace(/^www\./, "");
    return `${host}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return (url || "").trim().toLowerCase();
  }
}

/**
 * Merge ranked lists from several providers with Reciprocal Rank Fusion:
 * score(url) = Σ 1 / (K + rank), K = 60. Agreement between providers is a
 * strong relevance signal: with K = 60 a result found by both ranks above any
 * single-provider result (top-10 lists). Single-provider results are then
 * interleaved fairly by rank (e#1, t#1, e#2, t#2, …).
 * Duplicates are detected by normalized URL; the longer snippet is kept.
 *
 * lists: [{ source: "exa", items: [...] }, { source: "tavily", items: [...] }]
 */
function mergeResults(lists, limit) {
  const byUrl = new Map();
  let order = 0;
  for (const { source, items } of lists) {
    items.forEach((item, rank) => {
      const key = normalizeUrl(item.url) || `${source}:${rank}`;
      let entry = byUrl.get(key);
      if (!entry) {
        entry = { ...item, sources: [], rrf: 0, firstSeen: order++ };
        byUrl.set(key, entry);
      } else {
        if (!entry.published && item.published) entry.published = item.published;
        if ((item.content || "").length > (entry.content || "").length) entry.content = item.content;
      }
      if (!entry.sources.includes(source)) entry.sources.push(source);
      entry.rrf += 1 / (RRF_K + rank + 1);
    });
  }
  return [...byUrl.values()]
    .sort((a, b) => b.rrf - a.rrf || a.firstSeen - b.firstSeen)
    .slice(0, limit);
}

/**
 * Render items as Markdown.
 * @param {object} opts
 *   maxCharsPerResult — snippet length per result (compact output)
 *   showSources — append "via exa + tavily" (merged results)
 */
function formatItems(items, { maxCharsPerResult, showSources = false } = {}) {
  if (!items || !items.length) return "No results found.";
  const max = snippetLimit(maxCharsPerResult);
  return items
    .map((r) => {
      let out = `### [${r.title || r.url}](${r.url || ""})`;
      const meta = [cleanDate(r.published), showSources && r.sources ? `via ${r.sources.join(" + ")}` : ""].filter(Boolean);
      if (meta.length) out += `\n_${meta.join(" · ")}_`;
      if (r.content) out += `\n\n${truncate(r.content, max)}`;
      return out;
    })
    .join("\n\n---\n\n");
}

/** Exa MCP text → Markdown (keyless path). */
function formatSearchResults(raw, opts = {}) {
  if (!raw || raw.trim().length === 0) return "No results found.";
  const items = parseExaResults(raw);
  return items.length ? formatItems(items, opts) : truncate(raw, snippetLimit(opts.maxCharsPerResult) * 5);
}

/** Query-text hints for backends without native filters (Exa MCP keyless). */
function buildSearchQuery(query, options) {
  let enriched = query;
  if (options.site) enriched = `${enriched} site:${options.site}`;
  const since = recencyToDate(options.recency);
  if (since) enriched = `${enriched} after:${since.slice(0, 10)}`;
  return enriched;
}

const RECENCY_DAYS = { day: 1, week: 7, month: 30, year: 365 };

/** "week" → ISO timestamp 7 days ago (or null). */
function recencyToDate(recency) {
  const days = RECENCY_DAYS[recency];
  return days ? new Date(Date.now() - days * 86400000).toISOString() : null;
}

module.exports = {
  formatSearchResults,
  buildSearchQuery,
  parseExaResults,
  mergeResults,
  formatItems,
  normalizeUrl,
  truncate,
  snippetLimit,
  cleanDate,
  recencyToDate,
};
