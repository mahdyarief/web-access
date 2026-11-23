const { callExaMcp } = require("./exa-client.js");
const { fetchWebContent, UnsupportedContentError } = require("./web-fetcher.js");
const {
  formatSearchResults,
  buildSearchQuery,
  parseExaResults,
  mergeResults,
  formatItems,
} = require("./formatter.js");
const { searchGithub } = require("./github-client.js");
const {
  tavilySearch,
  tavilyExtract,
  formatTavilySearch,
  formatTavilyExtract,
} = require("./tavily-client.js");
const { hasKeys: hasTavilyKeys, loadKeys: loadTavilyKeys } = require("./tavily-rotator.js");
const { loadKeys: loadExaKeys } = require("./exa-rotator.js");
const { describeKeys } = require("./key-health.js");
const cache = require("./cache.js");

// Default provider for web_search ("auto" | "exa" | "tavily" | "both"):
// WEB_SEARCH_PROVIDER env → "provider" in ~/.openclaude/web-access.json → "auto".
const { getDefaultProvider, loadConfig, configPath } = require("./config.js");

const FRESH_PROP = {
  type: "boolean",
  description: "Bypass the result cache and force a new request",
  default: false,
};

/**
 * Tool handlers and their definitions.
 */

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web for current/recent information, news, real-time data, or anything beyond your knowledge cutoff. Returns formatted results with titles, URLs, publication dates, and content snippets. Use this when you need up-to-date information, recent events, or facts you're not confident about.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — be specific for best results",
        },
        numResults: {
          type: "number",
          description: "Number of results to return (max 10)",
          default: 5,
        },
        site: {
          type: "string",
          description:
            "Limit results to a specific domain (e.g. 'example.com')",
        },
        recency: {
          type: "string",
          description:
            "Only return results from a specific time period: 'day', 'week', 'month', 'year'",
          enum: ["day", "week", "month", "year"],
        },
        livecrawl: {
          type: "string",
          description:
            "Live crawl mode: 'always' fetches fresh, 'fallback' only if needed, 'never' uses cache",
          default: "fallback",
        },
        provider: {
          type: "string",
          description:
            "Search backend: 'auto' (Exa, falls back to Tavily on error), 'exa', 'tavily', or 'both' (query Exa + Tavily in parallel, merge & dedupe — broader coverage, uses credits on both; good for research). Defaults to 'provider' in web-access.json config, else 'auto'. In 'auto', queries with site/recency go to Tavily first (native filters) when a Tavily key exists.",
          enum: ["auto", "exa", "tavily", "both"],
        },
        fresh: FRESH_PROP,
      },
      required: ["query"],
    },
  },
  {
    name: "web_get_contents",
    description:
      "Fetch and extract readable text content from a URL (HTML, plain text; PDFs and JS-heavy pages via Tavily Extract when a Tavily key is configured). Use this when you need to read the full article, documentation, or detailed content behind a link — beyond what search snippets provide.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full URL to fetch content from (http:// or https://)",
        },
        maxChars: {
          type: "number",
          description: "Maximum characters of content to return (default 8000, max 50000)",
          default: 8000,
        },
        fresh: FRESH_PROP,
      },
      required: ["url"],
    },
  },
  {
    name: "web_search_exa",
    description:
      "Search the web using Exa AI (works keyless; uses configured Exa keys with rotation when available). Returns raw results with titles, URLs, and snippets.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "number",
          description: "Number of results (default 5)",
          default: 5,
        },
        livecrawl: {
          type: "string",
          description:
            "Live crawl mode: 'always', 'fallback', or 'never'",
          default: "fallback",
        },
        type: {
          type: "string",
          description: "Search type: 'auto', 'keyword', or 'neural'",
          default: "auto",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "web_search_tavily",
    description:
      "Search the web using Tavily (with API key rotation). Requires a Tavily API key (tvly-...) in ~/.openclaude/web-access.json; for keyless search use web_search. Supports domain filter, time range, news/finance topics, advanced depth, and an optional AI-generated answer summary.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: {
          type: "number",
          description: "Number of results (default 5, max 20)",
          default: 5,
        },
        site: {
          type: "string",
          description: "Limit results to a specific domain (e.g. 'example.com')",
        },
        recency: {
          type: "string",
          description: "Time range: 'day', 'week', 'month', 'year'",
          enum: ["day", "week", "month", "year"],
        },
        searchDepth: {
          type: "string",
          description: "'basic' (1 credit, fast) or 'advanced' (2 credits, better relevance)",
          enum: ["basic", "advanced"],
          default: "basic",
        },
        topic: {
          type: "string",
          description: "Search category: 'general', 'news', or 'finance'",
          enum: ["general", "news", "finance"],
          default: "general",
        },
        includeAnswer: {
          type: "boolean",
          description: "Include a short LLM-generated answer above the results",
          default: false,
        },
        fresh: FRESH_PROP,
      },
      required: ["query"],
    },
  },
  {
    name: "web_extract_tavily",
    description:
      "Extract clean readable content from one or more URLs using Tavily Extract (handles JS-heavy pages better than web_get_contents). Requires a Tavily API key; uses key rotation.",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "List of URLs to extract (max 20)",
        },
        extractDepth: {
          type: "string",
          description: "'basic' or 'advanced' (tables, embedded content; costs more)",
          enum: ["basic", "advanced"],
          default: "basic",
        },
        fresh: FRESH_PROP,
      },
      required: ["urls"],
    },
  },
  {
    name: "web_access_status",
    description:
      "Show web-access configuration and health: configured Exa/Tavily keys (masked), keys on cooldown, default provider, and cache stats. Use when searches fail or to check quota state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "github_search",
    description:
      "Search GitHub repositories, code, issues, commits, or topics. Returns formatted results with stars, forks, descriptions, and links. Use this to find open-source projects, explore code, look up issues, or discover trending repos.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "GitHub search query — same syntax as github.com/search (e.g. 'openclaude mcp server', 'react state management stars:>10000')",
        },
        type: {
          type: "string",
          description: "Type of search: 'repositories' (default), 'issues', 'code', 'commits', 'topics'",
          enum: ["repositories", "issues", "code", "commits", "topics"],
          default: "repositories",
        },
        sort: {
          type: "string",
          description: "Sort field: 'stars', 'forks', 'updated', 'help-wanted-issues' (repos); 'comments', 'reactions', 'updated' (issues)",
        },
        order: {
          type: "string",
          description: "Sort order: 'desc' (default) or 'asc'",
          enum: ["desc", "asc"],
        },
        perPage: {
          type: "number",
          description: "Results per page (max 30)",
          default: 5,
        },
      },
      required: ["query"],
    },
  },
];

async function rawExaSearch(args) {
  return callExaMcp("web_search_exa", {
    query: buildSearchQuery(args.query, args),
    numResults: args.numResults || 5,
    livecrawl: args.livecrawl || "fallback",
    type: args.type || "auto",
  });
}

function rawTavilySearch(args) {
  return tavilySearch({
    query: args.query,
    maxResults: args.numResults || 5,
    site: args.site,
    recency: args.recency,
    searchDepth: args.searchDepth,
    topic: args.topic,
    includeAnswer: args.includeAnswer,
  });
}

async function searchViaExa(args) {
  return formatSearchResults(await rawExaSearch(args));
}

async function searchViaTavily(args) {
  return formatTavilySearch(await rawTavilySearch(args));
}

async function searchBoth(args) {
  const limit = Math.min(Number(args.numResults) || 5, 20);
  const tavilyEnabled = hasTavilyKeys();
  const [exa, tavily] = await Promise.allSettled([
    rawExaSearch(args),
    tavilyEnabled ? rawTavilySearch(args) : Promise.resolve(null),
  ]);

  const lists = [];
  const notes = [];
  if (!tavilyEnabled) notes.push("Tavily skipped (no API key configured) — Exa results only");
  if (exa.status === "fulfilled") lists.push({ source: "exa", items: parseExaResults(exa.value) });
  else notes.push(`Exa failed: ${exa.reason?.message}`);
  if (tavily.status === "fulfilled" && tavily.value) {
    lists.push({
      source: "tavily",
      items: (tavily.value?.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        published: r.published_date || "",
        content: r.raw_content || r.content || "",
      })),
    });
  } else if (tavilyEnabled) notes.push(`Tavily failed: ${tavily.reason?.message}`);

  if (lists.length === 0) throw new Error(`All providers failed — ${notes.join("; ")}`);

  const parts = [];
  if (tavily.status === "fulfilled" && tavily.value?.answer) {
    parts.push(`**Answer:** ${tavily.value.answer.trim()}`);
  }
  parts.push(formatItems(mergeResults(lists, limit * 2)));
  if (notes.length) parts.push(`_Note: ${notes.join("; ")}_`);
  return parts.join("\n\n---\n\n");
}

async function handleWebSearch(args) {
  if (!args.query || !String(args.query).trim()) throw new Error("Search query is required");
  const provider = (args.provider || getDefaultProvider()).toLowerCase();

  if (provider === "both") return await searchBoth(args);

  if (provider === "tavily") {
    if (!hasTavilyKeys()) {
      // Tavily requires an API key; Exa works keyless — degrade gracefully.
      const out = await searchViaExa(args);
      return `${out}

---

_Note: Tavily requested but no Tavily API key is configured — used Exa instead._`;
    }
    try {
      return await searchViaTavily(args);
    } catch (err) {
      console.error(`[web_search] Tavily failed (${err.message}), falling back to Exa`);
      return await searchViaExa(args);
    }
  }

  if (provider === "exa" || !hasTavilyKeys()) {
    return await searchViaExa(args);
  }

  // auto + site/recency: Tavily has native domain/time filters, Exa only gets
  // them as query-text hints — so try Tavily first.
  if (args.site || args.recency) {
    try {
      return await searchViaTavily(args);
    } catch (err) {
      console.error(`[web_search] Tavily failed (${err.message}), falling back to Exa`);
      return await searchViaExa(args);
    }
  }

  // auto: Exa first, Tavily as fallback
  try {
    return await searchViaExa(args);
  } catch (err) {
    console.error(`[web_search] Exa failed (${err.message}), falling back to Tavily`);
    return await searchViaTavily(args);
  }
}

async function handleTavilySearch(args) {
  if (!args.query || !String(args.query).trim()) throw new Error("Search query is required");
  return await searchViaTavily(args);
}

async function handleTavilyExtract(args) {
  let urls = args.urls ?? args.url;
  if (typeof urls === "string") urls = [urls];
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("At least one URL is required");
  urls = urls.filter((u) => /^https?:\/\//.test(u)).slice(0, 20);
  if (urls.length === 0) throw new Error("Valid URL(s) required (http:// or https://)");
  const data = await tavilyExtract(urls, { extractDepth: args.extractDepth || "basic" });
  return formatTavilyExtract(data);
}

async function handleGetContents(args) {
  const url = args.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    throw new Error("Valid URL is required (http:// or https://)");
  }
  const maxChars = Math.min(Math.max(Number(args.maxChars) || 8000, 500), 50000);

  // Direct fetch first: free and usually cleanest for static HTML. Tavily
  // Extract (if a key exists) covers what it can't: fetch failures/blocks,
  // PDFs & other documents, and thin JS-rendered pages.
  let direct = null;
  let directErr = null;
  try {
    direct = await fetchWebContent(url, { maxChars });
  } catch (err) {
    directErr = err;
  }

  const thin = direct !== null && direct.length < MIN_USEFUL_CHARS;
  if (direct !== null && !thin) return `## Content from: ${url}\n\n${direct}`;

  if (hasTavilyKeys()) {
    const why = directErr ? `failed (${directErr.message})` : "returned very little text";
    console.error(`[web_get_contents] Direct fetch ${why}, trying Tavily Extract`);
    try {
      const data = await tavilyExtract([url]);
      if (data?.results?.length) return formatTavilyExtract(data, { maxChars });
    } catch (err) {
      if (!direct) throw new Error(`Direct fetch: ${directErr.message}; Tavily Extract: ${err.message}`);
    }
  }

  if (direct !== null) return `## Content from: ${url}\n\n${direct}`;
  if (directErr instanceof UnsupportedContentError) {
    throw new Error(`${directErr.message}. Configure a Tavily API key to extract PDFs and other documents.`);
  }
  throw directErr;
}

// Below this many characters a direct fetch is probably a JS-rendered shell
const MIN_USEFUL_CHARS = 300;

function handleStatus() {
  const exaKeys = loadExaKeys();
  const tavilyKeys = loadTavilyKeys();
  const cfg = loadConfig();
  const c = cache.stats();
  const fmtRows = (rows) => rows.map((r) => `  - \`${r.key}\` — ${r.state}`).join("\n");

  const lines = [
    "## web-access status",
    "",
    `**Config file:** \`${configPath()}\``,
    `**Default provider:** ${getDefaultProvider()}`,
    "",
    `**Exa:** ${exaKeys.length ? `${exaKeys.length} key(s)` : "keyless (anonymous)"}` +
      (exaKeys.length ? ` · keyless fallback ${cfg?.exa?.keylessFallback === false ? "off" : "on"}` : ""),
  ];
  if (exaKeys.length) lines.push(fmtRows(describeKeys("exa", exaKeys)));
  lines.push(
    "",
    `**Tavily:** ${tavilyKeys.length ? `${tavilyKeys.length} key(s)` : "disabled — requires an API key (tvly-...)"}`
  );
  if (tavilyKeys.length) lines.push(fmtRows(describeKeys("tavily", tavilyKeys)));
  lines.push(
    "",
    `**Cache:** ${c.ttlSeconds ? `${c.entries} entries, TTL ${c.ttlSeconds}s, ${c.hits} hit(s) / ${c.misses} miss(es)` : "disabled"}`
  );
  return lines.join("\n");
}

async function handleGithubSearch(args) {
  const { query, type = "repositories", sort, order, perPage = 5 } = args;
  if (!query || query.trim().length === 0) {
    throw new Error("Search query is required");
  }
  const result = await searchGithub(query, { type, sort, order, perPage });
  const header = `## GitHub ${type} search: "${query}"\n\n`;
  return header + result;
}

const CACHEABLE = {
  web_search: handleWebSearch,
  web_search_exa: handleWebSearch,
  web_search_tavily: handleTavilySearch,
  web_extract_tavily: handleTavilyExtract,
  web_get_contents: handleGetContents,
};

async function dispatchTool(toolName, args = {}) {
  const handler = CACHEABLE[toolName];
  if (handler) {
    const { fresh, ...keyArgs } = args;
    if (fresh || args.livecrawl === "always") return await handler(args);
    // web_search_exa is an alias — share cache entries with web_search
    const cacheTool = toolName === "web_search_exa" ? "web_search" : toolName;
    return await cache.cached(cacheTool, keyArgs, () => handler(args));
  }
  if (toolName === "web_access_status") return handleStatus();
  if (toolName === "github_search") return await handleGithubSearch(args);
  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = { TOOLS, dispatchTool };
