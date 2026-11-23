/**
 * Format search results and build search queries.
 */

function formatSearchResults(raw) {
  if (!raw || raw.trim().length === 0) {
    return "No results found.";
  }

  const blocks = raw.split(/\n---+\n/);
  const formatted = blocks
    .map((block) => {
      const titleMatch = block.match(/Title:\s*(.+)/);
      const urlMatch = block.match(/URL:\s*(.+)/);
      const publishedMatch = block.match(/Published:\s*(.+)/);
      const highlightsMatch = block.match(/Highlights:\s*([\s\S]*?)(?=\n\w+:|$)/);

      if (!titleMatch) return block.trim();

      const title = titleMatch[1].trim();
      const url = urlMatch ? urlMatch[1].trim() : "";
      const published = cleanDate(publishedMatch?.[1]);
      const highlights = highlightsMatch
        ? highlightsMatch[1].trim()
        : extractedContent(raw, block);

      let out = `### [${title}](${url || ""})`;
      if (published) out += `\n_${published}_`;
      if (highlights) out += `\n\n${highlights}`;
      return out;
    })
    .join("\n\n---\n\n");

  return formatted;
}

/**
 * Parse Exa's text output into structured items: {title, url, published, content}.
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
        content: highlights || extractedContent(raw, block),
      };
    })
    .filter(Boolean);
}

function cleanDate(v) {
  const d = (v || "").trim();
  return /^(n\/?a|null|undefined|unknown|none)?$/i.test(d) ? "" : d;
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
 * Interleave results from several providers (rank-fair), dedupe by URL.
 * lists: [{ source: "exa", items: [...] }, { source: "tavily", items: [...] }]
 */
function mergeResults(lists, limit) {
  const merged = [];
  const byUrl = new Map();
  const maxLen = Math.max(0, ...lists.map((l) => l.items.length));
  for (let i = 0; i < maxLen; i++) {
    for (const { source, items } of lists) {
      const item = items[i];
      if (!item) continue;
      const key = normalizeUrl(item.url) || `${source}:${i}`;
      const existing = byUrl.get(key);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
        if (!existing.published && item.published) existing.published = item.published;
        if ((item.content || "").length > (existing.content || "").length) existing.content = item.content;
        continue;
      }
      const entry = { ...item, sources: [source] };
      byUrl.set(key, entry);
      merged.push(entry);
    }
  }
  // Results found by both providers are stronger signals — float them up (stable)
  merged.sort((a, b) => b.sources.length - a.sources.length);
  return merged.slice(0, limit);
}

function formatItems(items, { maxContentChars = 2000 } = {}) {
  if (!items.length) return "No results found.";
  return items
    .map((r) => {
      let out = `### [${r.title || r.url}](${r.url || ""})`;
      const meta = [r.published, r.sources ? `via ${r.sources.join(" + ")}` : ""].filter(Boolean);
      if (meta.length) out += `\n_${meta.join(" · ")}_`;
      if (r.content) out += `\n\n${r.content.trim().slice(0, maxContentChars)}`;
      return out;
    })
    .join("\n\n---\n\n");
}

function extractedContent(raw, block) {
  const lines = block.split("\n").filter((l) => l.trim());
  const contentLines = lines.filter(
    (l) =>
      !/^(Title|URL|Published|Author|Highlights):/i.test(l.trim()) &&
      l.trim().length > 0
  );
  return contentLines.join("\n").trim().slice(0, 2000);
}

function buildSearchQuery(query, options) {
  let enriched = query;

  if (options.site) {
    enriched = `${enriched} site:${options.site}`;
  }

  if (options.recency) {
    const now = new Date();
    let since;
    switch (options.recency) {
      case "day":
        since = new Date(now.getTime() - 86400000);
        break;
      case "week":
        since = new Date(now.getTime() - 7 * 86400000);
        break;
      case "month":
        since = new Date(now.getTime() - 30 * 86400000);
        break;
      case "year":
        since = new Date(now.getTime() - 365 * 86400000);
        break;
    }
    if (since) {
      enriched = `${enriched} after:${since.toISOString().split("T")[0]}`;
    }
  }

  return enriched;
}

module.exports = {
  formatSearchResults,
  buildSearchQuery,
  parseExaResults,
  mergeResults,
  formatItems,
};
