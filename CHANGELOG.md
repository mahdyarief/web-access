# Changelog

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
