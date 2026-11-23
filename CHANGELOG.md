# Changelog

## 1.5.0 — 2026-11-23

### Added
- **Exa REST API** when Exa keys are configured: native `includeDomains`, `startPublishedDate` and `category` filters, `type` (`auto`/`lite`/`deep`), highlight-based snippets and per-request cost tracking. Keyless still uses Exa's MCP endpoint.
- `category` parameter (`news`, `publication`, `company`, `personal site`, `financial report`, `people`) on `web_search` and `web_search_exa`.
- `includeAnswer` on `web_search`: the Tavily answer and/or Exa `/answer`. Both are shown in `both` mode.
- `maxCharsPerResult` for compact snippets on all search tools.
- `web_map` and `web_crawl` tools (Tavily Map/Crawl).
- `offset` paging in `web_get_contents`. The document is cached, so paging does not re-download it.
- `web_access_status` shows remaining Tavily credits (from `/usage`, cached for 10 minutes) and Exa spend this session.
- Persistent key cooldowns in `web-access-state.json` next to the config file (key fingerprints only, never keys). Override with `WEB_ACCESS_STATE_FILE`, or set it to `off`.
- 429 cooldowns honour `Retry-After` (max 1 h).
- SSRF protection: private, loopback and link-local addresses are refused, including on every redirect hop. Opt in with `fetch.allowPrivateNetwork`.
- Download cap for direct fetches (`fetch.maxBytes`, default 5 MB).
- GitHub Actions CI on Node 18/20/22 × Linux/Windows, with manifest checks.

### Changed
- `both` mode ranks with Reciprocal Rank Fusion. Hits found by both providers come first, followed by single-provider hits interleaved by rank.
- In `auto` mode, filtered queries go to Tavily first only when Exa has no key.
- A 403 no longer puts a key on cooldown, because it is not a key problem.
- Exa `livecrawl` is mapped to `maxAgeHours`. The legacy `type` values `neural`/`keyword` are treated as `auto`.

### Not included
- `web_find_similar`: Exa has deprecated `/findSimilar`.


## 1.4.1 — 2026-11-23

### Fixed
- `web_search_exa` now always uses Exa. Before, it followed the configured default provider.
- `numResults` for Exa searches is clamped to 1–10, as documented.

### Docs
- Complete README: requirements, full parameter reference for every tool, quick start, how providers, extraction and caching work, environment variables, credits and cost, privacy and security, troubleshooting, update and uninstall, project structure, and release process.
- Indonesian README expanded to match.

## 1.4.0 — 2026-11-23

### Added
- Packaged as a Claude Code plugin with the `mahdyarief` marketplace (`/plugin install web-access@mahdyarief`).
- Plugin options for Tavily and Exa keys (stored as sensitive values) and for the default provider.
- `web-research` skill and `/web-access:setup` skill.
- `EXA_API_KEYS` / `EXA_API_KEY` env support. `web_access_status` now shows where keys come from.
- MIT license, plugin icon, Indonesian README.

## 1.3.0 — 2026-11-23

### Added
- Per-key cooldowns after 429, 402/432/433 and 401/403 responses.
- One shared deadline for all attempts. Only key, quota, 5xx and network errors are retried.
- `auto` mode sends `site`/`recency` queries to Tavily first.
- In-memory result cache (`cacheTtlSeconds`, `fresh: true`).
- `web_access_status` tool.
- Better direct page extraction (charset, main content, boilerplate removal), with Tavily Extract as fallback for PDFs and JS pages.
- `package.json`, mocked test suite.

### Fixed
- JSON-RPC compliance: notifications get no response, unknown methods return `-32601`, and tool errors are returned as `isError` results.

## 1.2.0 — 2026-11-23

### Added
- Tavily search and extract with round-robin key rotation.
- `provider` option for `web_search`: `auto`, `exa`, `tavily` and `both` (merged and deduplicated).
- Single config file `~/.openclaude/web-access.json` holding both Exa and Tavily keys, hot-reloaded.
- Exa keyless fallback when all keys are rejected.

### Fixed
- Exa key rotation is now round-robin. Before, every request started on the first key.
