const { exaSearch, exaAnswer, exaSpend, EXA_CATEGORIES } = require("./exa-client.js");
const { fetchDocument, paginate, UnsupportedContentError, BlockedUrlError } = require("./web-fetcher.js");
const { mergeResults, formatItems, truncate } = require("./formatter.js");
const { searchGithub } = require("./github-client.js");
const {
  tavilySearch,
  tavilyExtract,
  tavilyMap,
  tavilyCrawl,
  tavilyUsage,
  formatTavilyExtract,
  cleanExtracted,
  tavilyItems,
} = require("./tavily-client.js");
const {
  hasKeys: hasTavilyKeys,
  loadKeys: loadTavilyKeys,
  keySource: tavilyKeySource,
} = require("./tavily-rotator.js");
const { hasKeys: hasExaKeys, loadKeys: loadExaKeys, keySource: exaKeySource } = require("./exa-rotator.js");
const { describeKeys, stateFile, maskKey } = require("./key-health.js");
const { getDefaultProvider, loadConfig, configPath } = require("./config.js");
const cache = require("./cache.js");

// ── Shared schema fragments ──────────────────────────────────

const SNIPPET_PROP = {
  type: "number",
  description:
    "Max characters of text per result (default 1200, 100–10000). Lower it for compact overviews, raise it when snippets need more detail",
  default: 1200,
};

const FRESH_PROP = {
  type: "boolean",
  description: "Bypass the result cache and force a new request",
  default: false,
};

const RECENCY_PROP = {
  type: "string",
  description: "Only return results published within this period",
  enum: ["day", "week", "month", "year"],
};

const SITE_PROP = {
  type: "string",
  description: "Limit results to one domain (e.g. 'docs.python.org')",
};

const CATEGORY_PROP = {
  type: "string",
  description:
    "Exa content category: 'news', 'publication' (papers/articles), 'company', 'personal site' (blogs), 'financial report', 'people'. Note: with 'company'/'people', site and recency filters are ignored by Exa.",
  enum: EXA_CATEGORIES,
};

const CRAWL_COMMON = {
  url: { type: "string", description: "Root URL to start from (http/https)" },
  instructions: {
    type: "string",
    description: "Natural-language focus, e.g. 'only API reference pages' (costs more credits)",
  },
  maxDepth: { type: "number", description: "How many link levels deep to go (1–5, default 1)", default: 1 },
  selectPaths: {
    type: "array",
    items: { type: "string" },
    description: "Regex path filters to include, e.g. ['/docs/.*']",
  },
  excludePaths: {
    type: "array",
    items: { type: "string" },
    description: "Regex path filters to exclude, e.g. ['/blog/.*']",
  },
  allowExternal: { type: "boolean", description: "Follow links to other domains (default false)", default: false },
};

// ── Tool definitions ─────────────────────────────────────────

const TOOLS = [
  {
    name: "web_search",
    description:
      "Search the web for current/recent information, news, documentation, or anything beyond your knowledge cutoff. Returns titles, URLs, dates and snippets. Uses Exa and/or Tavily depending on 'provider'.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query — be specific for best results" },
        numResults: { type: "number", description: "Number of results (1–10, default 5)", default: 5 },
        site: SITE_PROP,
        recency: RECENCY_PROP,
        category: CATEGORY_PROP,
        provider: {
          type: "string",
          description:
            "'auto' (default: Exa first, Tavily on error), 'exa', 'tavily', or 'both' (Exa + Tavily in parallel, merged with rank fusion and deduplicated — broader coverage for research, uses credits on both). Defaults to the configured provider.",
          enum: ["auto", "exa", "tavily", "both"],
        },
        includeAnswer: {
          type: "boolean",
          description:
            "Also return a short AI-generated answer (Tavily answer and/or Exa /answer — needs a key for that provider). In 'both' mode answers from both are shown for cross-checking.",
          default: false,
        },
        maxCharsPerResult: SNIPPET_PROP,
        livecrawl: {
          type: "string",
          description: "Exa freshness: 'always' (fetch live), 'fallback' (default), 'never' (cache only)",
          enum: ["always", "fallback", "never"],
        },
        fresh: FRESH_PROP,
      },
      required: ["query"],
    },
  },
  {
    name: "web_search_exa",
    description:
      "Search with Exa only (works keyless; with Exa keys uses the REST API with native filters and key rotation).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results (1–10, default 5)", default: 5 },
        site: SITE_PROP,
        recency: RECENCY_PROP,
        category: CATEGORY_PROP,
        type: {
          type: "string",
          description: "Exa search type: 'auto' (default), 'lite' (fastest), 'deep' (more thorough, slower). Needs an Exa key.",
          enum: ["auto", "lite", "deep"],
          default: "auto",
        },
        maxCharsPerResult: SNIPPET_PROP,
        livecrawl: {
          type: "string",
          description: "'always' (fetch live), 'fallback' (default), 'never' (cache only)",
          enum: ["always", "fallback", "never"],
        },
        fresh: FRESH_PROP,
      },
      required: ["query"],
    },
  },
  {
    name: "web_search_tavily",
    description:
      "Search with Tavily only. Requires a Tavily API key (tvly-...). Supports news/finance topics, advanced depth, native domain/time filters and an optional AI answer.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        numResults: { type: "number", description: "Number of results (1–20, default 5)", default: 5 },
        site: SITE_PROP,
        recency: RECENCY_PROP,
        searchDepth: {
          type: "string",
          description: "'basic' (1 credit) or 'advanced' (2 credits, better relevance)",
          enum: ["basic", "advanced"],
          default: "basic",
        },
        topic: {
          type: "string",
          description: "'general', 'news', or 'finance'",
          enum: ["general", "news", "finance"],
          default: "general",
        },
        includeAnswer: {
          type: "boolean",
          description: "Include a short AI-generated answer above the results",
          default: false,
        },
        maxCharsPerResult: SNIPPET_PROP,
        fresh: FRESH_PROP,
      },
      required: ["query"],
    },
  },
  {
    name: "web_get_contents",
    description:
      "Read the full text of a URL (HTML, text; PDFs and JS-heavy pages via Tavily Extract when a Tavily key is configured). Long pages are paged: use the offset given at the end of a result to continue. Internal/private network addresses are refused.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full URL (http:// or https://)" },
        maxChars: {
          type: "number",
          description: "Max characters to return in this call (500–50000, default 8000)",
          default: 8000,
        },
        offset: {
          type: "number",
          description: "Character offset to continue a long page from (given at the end of the previous result)",
          default: 0,
        },
        fresh: FRESH_PROP,
      },
      required: ["url"],
    },
  },
  {
    name: "web_extract_tavily",
    description:
      "Extract clean content from up to 20 URLs at once with Tavily Extract (handles PDFs and JS-heavy pages). Requires a Tavily API key.",
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, description: "URLs to extract (max 20)" },
        extractDepth: {
          type: "string",
          description: "'basic' or 'advanced' (tables, embedded content; costs more)",
          enum: ["basic", "advanced"],
          default: "basic",
        },
        maxCharsPerPage: {
          type: "number",
          description: "Max characters per page (default 8000)",
          default: 8000,
        },
        fresh: FRESH_PROP,
      },
      required: ["urls"],
    },
  },
  {
    name: "web_map",
    description:
      "List the pages of a website (URLs only, no content) using Tavily Map — e.g. to discover all pages of a documentation site before reading the relevant ones. Requires a Tavily API key (≈1 credit per 10 pages).",
    inputSchema: {
      type: "object",
      properties: {
        ...CRAWL_COMMON,
        limit: { type: "number", description: "Max URLs to return (1–500, default 50)", default: 50 },
        fresh: FRESH_PROP,
      },
      required: ["url"],
    },
  },
  {
    name: "web_crawl",
    description:
      "Crawl a website and return the content of multiple pages in one call using Tavily Crawl — e.g. read a whole docs section. Requires a Tavily API key (≈3 credits per 10 pages basic). Prefer web_map + web_get_contents when you only need a few pages.",
    inputSchema: {
      type: "object",
      properties: {
        ...CRAWL_COMMON,
        limit: { type: "number", description: "Max pages to crawl (1–50, default 10)", default: 10 },
        extractDepth: {
          type: "string",
          description: "'basic' or 'advanced' (tables, embedded content; costs more)",
          enum: ["basic", "advanced"],
          default: "basic",
        },
        maxCharsPerPage: {
          type: "number",
          description: "Max characters per page in the output (default 3000)",
          default: 3000,
        },
        fresh: FRESH_PROP,
      },
      required: ["url"],
    },
  },
  {
    name: "web_access_status",
    description:
      "Show web-access configuration and health: Exa/Tavily keys (masked) and where they come from, keys on cooldown, Tavily remaining credits, Exa spend this session, default provider and cache stats. Use when searches fail or to check quota.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "github_search",
    description:
      "Search GitHub repositories, code, issues, commits, or topics. Returns stars, forks, descriptions and links.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "GitHub search query — same syntax as github.com/search (e.g. 'mcp server language:typescript stars:>100')",
        },
        type: {
          type: "string",
          description: "'repositories' (default), 'issues', 'code', 'commits', 'topics'",
          enum: ["repositories", "issues", "code", "commits", "topics"],
          default: "repositories",
        },
        sort: {
          type: "string",
          description: "Repos: 'stars', 'forks', 'updated', 'help-wanted-issues'; issues: 'comments', 'reactions', 'updated'",
        },
        order: { type: "string", description: "'desc' (default) or 'asc'", enum: ["desc", "asc"] },
        perPage: { type: "number", description: "Results per page (max 30)", default: 5 },
      },
      required: ["query"],
    },
  },
];

// ── Search ───────────────────────────────────────────────────

function requireQuery(args) {
  if (!args.query || !String(args.query).trim()) throw new Error("Search query is required");
}

/** Map an Exa category to the closest Tavily topic (for fallbacks / both mode). */
function tavilyTopicFor(args) {
  if (args.topic) return args.topic;
  if (args.category === "news") return "news";
  if (args.category === "financial report") return "finance";
  return undefined;
}

async function runExa(args) {
  const { items, via } = await exaSearch(args);
  return { source: "exa", items, via };
}

async function runTavily(args, { withAnswer = false } = {}) {
  const data = await tavilySearch({
    query: args.query,
    maxResults: args.numResults || 5,
    site: args.site,
    recency: args.recency,
    searchDepth: args.searchDepth,
    topic: tavilyTopicFor(args),
    includeAnswer: withAnswer,
  });
  return { source: "tavily", items: tavilyItems(data), answer: data?.answer || "" };
}

/** Exa /answer, only when asked and an Exa key exists; never fails the search. */
function maybeExaAnswer(args) {
  if (!args.includeAnswer || !hasExaKeys()) return Promise.resolve(null);
  return exaAnswer(args.query).catch((err) => {
    console.error(`[web_search] Exa answer failed: ${err.message}`);
    return null;
  });
}

function renderAnswers(answers) {
  const real = answers.filter((a) => a && a.text);
  if (!real.length) return "";
  const label = (a) => (real.length > 1 ? ` (${a.source})` : "");
  return real
    .map((a) => {
      let out = `**Answer${label(a)}:** ${a.text.trim()}`;
      if (a.citations?.length) {
        out += `\n\nSources: ${a.citations
          .slice(0, 5)
          .map((c, i) => `[${i + 1}](${c.url})`)
          .join(" ")}`;
      }
      return out;
    })
    .join("\n\n");
}

function renderSearch({ answers = [], items, showSources = false, notes = [], args }) {
  const parts = [];
  const ans = renderAnswers(answers);
  if (ans) parts.push(ans);
  parts.push(formatItems(items, { maxCharsPerResult: args.maxCharsPerResult, showSources }));
  if (notes.length) parts.push(`_Note: ${notes.join("; ")}_`);
  return parts.join("\n\n---\n\n");
}

async function searchBoth(args) {
  const limit = Math.min(Math.max(Number(args.numResults) || 5, 1), 10);
  const tavilyEnabled = hasTavilyKeys();
  const [exa, tavily, exaAns] = await Promise.allSettled([
    runExa(args),
    tavilyEnabled ? runTavily(args, { withAnswer: !!args.includeAnswer }) : Promise.resolve(null),
    maybeExaAnswer(args),
  ]);

  const lists = [];
  const notes = [];
  if (!tavilyEnabled) notes.push("Tavily skipped (no API key configured) — Exa results only");
  if (exa.status === "fulfilled") lists.push(exa.value);
  else notes.push(`Exa failed: ${exa.reason?.message}`);
  if (tavily.status === "fulfilled" && tavily.value) lists.push(tavily.value);
  else if (tavilyEnabled) notes.push(`Tavily failed: ${tavily.reason?.message}`);

  if (lists.length === 0) throw new Error(`All providers failed — ${notes.join("; ")}`);

  const answers = [
    tavily.status === "fulfilled" && tavily.value?.answer ? { source: "Tavily", text: tavily.value.answer } : null,
    exaAns.status === "fulfilled" && exaAns.value
      ? { source: "Exa", text: exaAns.value.answer, citations: exaAns.value.citations }
      : null,
  ];
  return renderSearch({ answers, items: mergeResults(lists, limit * 2), showSources: true, notes, args });
}

/** Run primary, fall back to secondary on error. */
async function withFallback(primary, secondary, label) {
  try {
    return await primary();
  } catch (err) {
    console.error(`[web_search] ${label} failed (${err.message}), falling back`);
    return await secondary();
  }
}

async function handleWebSearch(args) {
  requireQuery(args);
  const provider = String(args.provider || getDefaultProvider()).toLowerCase();
  if (provider === "both") return await searchBoth(args);

  const tavilyOn = hasTavilyKeys();
  const exa = () => runExa(args);
  const tavily = () => runTavily(args, { withAnswer: !!args.includeAnswer });
  const notes = [];

  let order; // [primary, secondary|null]
  if (provider === "exa" || !tavilyOn) {
    order = [exa, null];
    if (provider === "tavily") notes.push("Tavily requested but no Tavily API key is configured — used Exa instead");
  } else if (provider === "tavily") {
    order = [tavily, exa];
  } else if ((args.site || args.recency) && !hasExaKeys() && !args.category) {
    // auto: keyless Exa can only take site/recency as query hints, Tavily has
    // native filters — so prefer Tavily for filtered queries.
    order = [tavily, exa];
  } else {
    order = [exa, tavily];
  }

  // Exa answer runs in parallel with the search when the result comes from Exa.
  const exaAnsP = order[0] === exa ? maybeExaAnswer(args) : Promise.resolve(null);
  const result = order[1]
    ? await withFallback(order[0], order[1], order[0] === exa ? "Exa" : "Tavily")
    : await order[0]();

  const answers = [];
  if (result.source === "tavily" && result.answer) answers.push({ source: "Tavily", text: result.answer });
  const ea = await exaAnsP;
  if (ea) answers.push({ source: "Exa", text: ea.answer, citations: ea.citations });
  if (args.includeAnswer && !answers.length) {
    notes.push("no AI answer available (needs a Tavily or Exa API key)");
  }
  return renderSearch({ answers, items: result.items, notes, args });
}

async function handleExaSearch(args) {
  requireQuery(args);
  const r = await runExa(args);
  return renderSearch({ items: r.items, args });
}

async function handleTavilySearch(args) {
  requireQuery(args);
  const r = await runTavily(args, { withAnswer: !!args.includeAnswer });
  return renderSearch({ answers: [r.answer ? { source: "Tavily", text: r.answer } : null], items: r.items, args });
}

// ── Extract / map / crawl ────────────────────────────────────

function cleanUrls(urls, max) {
  if (typeof urls === "string") urls = [urls];
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("At least one URL is required");
  const valid = urls.filter((u) => /^https?:\/\//.test(u)).slice(0, max);
  if (valid.length === 0) throw new Error("Valid URL(s) required (http:// or https://)");
  return valid;
}

async function handleTavilyExtract(args) {
  const urls = cleanUrls(args.urls ?? args.url, 20);
  const data = await tavilyExtract(urls, { extractDepth: args.extractDepth || "basic" });
  return formatTavilyExtract(data, { maxChars: Math.min(Math.max(Number(args.maxCharsPerPage) || 8000, 500), 50000) });
}

function crawlOpts(args, defaultLimit, maxLimit) {
  const [url] = cleanUrls(args.url, 1);
  return {
    url,
    instructions: args.instructions,
    maxDepth: Math.min(Math.max(Number(args.maxDepth) || 1, 1), 5),
    limit: Math.min(Math.max(Number(args.limit) || defaultLimit, 1), maxLimit),
    selectPaths: args.selectPaths,
    excludePaths: args.excludePaths,
    allowExternal: args.allowExternal === true,
    extractDepth: args.extractDepth,
  };
}

async function handleMap(args) {
  const data = await tavilyMap(crawlOpts(args, 50, 500));
  const urls = data?.results || [];
  if (!urls.length) return `No pages found for ${args.url}.`;
  return [
    `## Site map: ${data.base_url || args.url}`,
    `_${urls.length} URL(s)_`,
    urls.map((u) => `- ${u}`).join("\n"),
  ].join("\n\n");
}

async function handleCrawl(args) {
  const data = await tavilyCrawl(crawlOpts(args, 10, 50));
  const pages = data?.results || [];
  if (!pages.length) return `No pages crawled for ${args.url}.`;
  const per = Math.min(Math.max(Number(args.maxCharsPerPage) || 3000, 200), 20000);
  const header = `## Crawl: ${data.base_url || args.url}\n\n_${pages.length} page(s); read any page in full with web_get_contents_`;
  const body = pages
    .map((p) => `### ${p.url}\n\n${truncate(cleanExtracted(p.raw_content), per) || "_(no content)_"}`)
    .join("\n\n---\n\n");
  return `${header}\n\n${body}`;
}

// ── Page contents ────────────────────────────────────────────

// Below this many characters a direct fetch is probably a JS-rendered shell
const MIN_USEFUL_CHARS = 300;

/**
 * Load the full readable text of a URL: { title, text, via }.
 * Direct fetch first: free and usually cleanest for static HTML. Tavily
 * Extract (if a key exists) covers what it can't: fetch failures/blocks,
 * PDFs & other documents, and thin JS-rendered pages.
 */
async function loadDocument(url) {
  let direct = null;
  let directErr = null;
  try {
    direct = await fetchDocument(url);
  } catch (err) {
    // Internal addresses are refused outright — and never forwarded to Tavily.
    if (err instanceof BlockedUrlError) throw err;
    directErr = err;
  }

  if (direct && direct.text.length >= MIN_USEFUL_CHARS) return { ...direct, via: "direct" };

  if (hasTavilyKeys()) {
    const why = directErr ? `failed (${directErr.message})` : "returned very little text";
    console.error(`[web_get_contents] Direct fetch ${why}, trying Tavily Extract`);
    try {
      const data = await tavilyExtract([url]);
      const text = cleanExtracted(data?.results?.[0]?.raw_content);
      if (text) return { title: "", text, via: "tavily" };
    } catch (err) {
      if (!direct) throw new Error(`Direct fetch: ${directErr.message}; Tavily Extract: ${err.message}`);
    }
  }

  if (direct) return { ...direct, via: "direct" };
  if (directErr instanceof UnsupportedContentError) {
    throw new Error(`${directErr.message}. Configure a Tavily API key to extract PDFs and other documents.`);
  }
  throw directErr;
}

async function handleGetContents(args) {
  const url = args.url;
  if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
    throw new Error("Valid URL is required (http:// or https://)");
  }
  const maxChars = Math.min(Math.max(Number(args.maxChars) || 8000, 500), 50000);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));

  // The whole document is cached once, so reading the next part (offset) of a
  // long page does not download it again.
  const doc = args.fresh
    ? await loadDocument(url)
    : await cache.cached("__document", { url: url.trim() }, () => loadDocument(url));

  const head = [`## Content from: ${url}`];
  if (doc.title && offset === 0) head.push(`# ${doc.title}`);
  if (doc.bytesCut) head.push(`_(download stopped at ${Math.round(doc.bytesCut / 1048576)} MB)_`);
  return `${head.join("\n\n")}\n\n${paginate(doc.text, { offset, maxChars })}`;
}

// ── Status ───────────────────────────────────────────────────

const USAGE_TTL_MS = 10 * 60 * 1000; // Tavily /usage allows 10 requests per 10 minutes
const _usageCache = new Map(); // key → { at, data | error }

async function tavilyUsageCached(key) {
  const hit = _usageCache.get(key);
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit;
  let entry;
  try {
    entry = { at: Date.now(), data: await tavilyUsage(key) };
  } catch (err) {
    entry = { at: Date.now(), error: err.message };
  }
  _usageCache.set(key, entry);
  return entry;
}

function fmtCredits(used, limit) {
  return limit === null || limit === undefined ? `${used ?? "?"} used (no limit)` : `${used ?? "?"} / ${limit} used`;
}

async function handleStatus() {
  const exaKeys = loadExaKeys();
  const tavilyKeys = loadTavilyKeys();
  const cfg = loadConfig();
  const c = cache.stats();
  const spend = exaSpend();

  const lines = [
    "## web-access status",
    "",
    `**Config file:** \`${configPath()}\``,
    `**Default provider:** ${getDefaultProvider()}`,
    "",
    `**Exa:** ${
      exaKeys.length ? `${exaKeys.length} key(s) from ${exaKeySource()} · REST API` : "keyless (anonymous MCP endpoint)"
    }` + (exaKeys.length ? ` · keyless fallback ${cfg?.exa?.keylessFallback === false ? "off" : "on"}` : ""),
  ];
  for (const r of describeKeys("exa", exaKeys)) lines.push(`  - \`${r.key}\` — ${r.state}`);
  if (spend.requests) lines.push(`  - spend this session: $${spend.total.toFixed(4)} over ${spend.requests} request(s)`);

  lines.push(
    "",
    `**Tavily:** ${
      tavilyKeys.length
        ? `${tavilyKeys.length} key(s) from ${tavilyKeySource()}`
        : "disabled — requires an API key (tvly-...); add one with /web-access:setup"
    }`
  );
  if (tavilyKeys.length) {
    const rows = describeKeys("tavily", tavilyKeys);
    const usages = await Promise.all(tavilyKeys.map((k) => tavilyUsageCached(k)));
    let account = null;
    rows.forEach((r, i) => {
      const u = usages[i];
      const credits = u.data?.key ? ` · credits ${fmtCredits(u.data.key.usage, u.data.key.limit)}` : "";
      const err = u.error ? ` · usage unavailable (${u.error})` : "";
      lines.push(`  - \`${r.key}\` — ${r.state}${credits}${err}`);
      if (!account && u.data?.account) account = u.data.account;
    });
    if (account) {
      lines.push(
        `  - account plan: ${account.current_plan ?? "?"} · plan ${fmtCredits(account.plan_usage, account.plan_limit)}` +
          (account.paygo_limit ? ` · pay-as-you-go ${fmtCredits(account.paygo_usage, account.paygo_limit)}` : "")
      );
    }
  }

  lines.push(
    "",
    `**Cooldown state:** ${stateFile() ? `\`${stateFile()}\`` : "memory only"}`,
    `**Cache:** ${
      c.ttlSeconds ? `${c.entries} entries, TTL ${c.ttlSeconds}s, ${c.hits} hit(s) / ${c.misses} miss(es)` : "disabled"
    }`
  );
  return lines.join("\n");
}

// ── GitHub ───────────────────────────────────────────────────

async function handleGithubSearch(args) {
  const { query, type = "repositories", sort, order, perPage = 5 } = args;
  if (!query || query.trim().length === 0) throw new Error("Search query is required");
  const result = await searchGithub(query, { type, sort, order, perPage });
  return `## GitHub ${type} search: "${query}"\n\n${result}`;
}

// ── Dispatch ─────────────────────────────────────────────────

const CACHEABLE = {
  web_search: handleWebSearch,
  web_search_exa: handleExaSearch,
  web_search_tavily: handleTavilySearch,
  web_extract_tavily: handleTavilyExtract,
  web_map: handleMap,
  web_crawl: handleCrawl,
};

async function dispatchTool(toolName, args = {}) {
  const handler = CACHEABLE[toolName];
  if (handler) {
    const { fresh, ...keyArgs } = args;
    if (fresh || args.livecrawl === "always") return await handler(args);
    return await cache.cached(toolName, keyArgs, () => handler(args));
  }
  if (toolName === "web_get_contents") return await handleGetContents(args); // caches internally
  if (toolName === "web_access_status") return await handleStatus();
  if (toolName === "github_search") return await handleGithubSearch(args);
  throw new Error(`Unknown tool: ${toolName}`);
}

module.exports = { TOOLS, dispatchTool, maskKey };
