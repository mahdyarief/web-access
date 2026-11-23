# web-access-mcp

A zero-dependency local [MCP](https://modelcontextprotocol.io) server that gives AI coding agents web access:

- **Web search** through [Exa](https://exa.ai) and [Tavily](https://tavily.com), with automatic fallback or merged results
- **API key rotation** for both providers, with cooldowns for exhausted or rate-limited keys
- **URL content extraction**: a direct fetch with a readability-style cleanup, plus Tavily Extract for PDFs and JS-rendered pages
- **GitHub search** for repositories, code, issues, commits and topics

It runs over stdio, needs only Node.js 18.17 or newer, and works out of the box: Exa is used **keyless** when no key is configured.

## Tools

| Tool | What it does |
|---|---|
| `web_search` | Searches the web. `provider` can be `auto` (default), `exa`, `tavily` or `both`. |
| `web_search_exa` | Alias of `web_search`. It shares the result cache. |
| `web_search_tavily` | Searches with Tavily. Supports `topic` (general/news/finance), `searchDepth` and `includeAnswer`. **Requires a Tavily key.** |
| `web_get_contents` | Returns the readable text of a URL (`maxChars` up to 50k). |
| `web_extract_tavily` | Extracts up to 20 URLs at once with Tavily Extract. **Requires a Tavily key.** |
| `web_access_status` | Shows configured keys (masked), cooldowns, the default provider and cache stats. |
| `github_search` | Searches GitHub. Uses `GITHUB_TOKEN`/`GH_TOKEN` or `gh auth token` when available. |

All search and extract tools accept `fresh: true` to bypass the cache.

### How providers are chosen (`web_search`)

| Mode | Behaviour |
|---|---|
| `auto` | Exa first, with Tavily as fallback. When `site`/`recency` is set and a Tavily key exists, Tavily goes **first**, because it supports those filters natively. Exa only receives them as query hints. |
| `exa` | Exa only. |
| `tavily` | Tavily, with Exa as fallback. Without a Tavily key it uses Exa directly and adds a note. |
| `both` | Exa and Tavily run in parallel. Results are interleaved and deduplicated by normalized URL, and hits found by both providers are ranked first. Uses credits on both providers, so it is best kept for research queries. |

### How `web_get_contents` works

1. A direct fetch runs first. It is free, honours the page charset, prefers `<article>`/`<main>`, and drops nav, header and footer.
2. Tavily Extract is used when the direct fetch fails, when the target is a PDF or other document, or when the page returns very little text (likely JS-rendered). This step needs a Tavily key.

## Install

### As a Claude Code / OpenClaude plugin

The repo already contains `.claude-plugin/plugin.json` and `.mcp.json`. Install it as a plugin from this directory or repository.

### As a plain MCP server

```json
{
  "mcpServers": {
    "web-access": {
      "command": "node",
      "args": ["/path/to/web-access-mcp/server.js"]
    }
  }
}
```

## Configuration

All keys and settings live in one file: `~/.openclaude/web-access.json`. You can override the path with `WEB_ACCESS_CONFIG`. Copy [`web-access.example.json`](web-access.example.json) to get started:

```json
{
  "provider": "auto",
  "cacheTtlSeconds": 600,
  "exa": {
    "keylessFallback": true,
    "timeoutMs": 45000,
    "keys": ["your-exa-key-1", "your-exa-key-2"]
  },
  "tavily": {
    "timeoutMs": 45000,
    "keys": ["tvly-your-key-1", "tvly-your-key-2"]
  }
}
```

| Setting | Default | Meaning |
|---|---|---|
| `provider` | `auto` | Default mode for `web_search`. The `WEB_SEARCH_PROVIDER` env var overrides it. |
| `cacheTtlSeconds` | `600` | How long identical calls are served from memory. `0` disables the cache. |
| `exa.keys` | `[]` | Exa API keys. With no keys, Exa runs keyless (anonymous, lower limits). |
| `exa.keylessFallback` | `true` | Makes one last keyless attempt when every key is rejected or cooling down. |
| `tavily.keys` | `[]` | Tavily API keys (`tvly-...`). Tavily is disabled without at least one key. |
| `*.timeoutMs` | `45000` | Total time budget across all keys for one request. |

The file is re-read whenever it changes, so you can add or replace keys without restarting the server.

**Other key sources:** the `TAVILY_API_KEYS` env var (comma-separated) and `TAVILY_API_KEY` override the config file for Tavily. The legacy files `~/.openclaude/exa_keys.json` and `~/.openclaude/tavily_keys.json`, or the `EXA_KEYS_FILE` and `TAVILY_KEYS_FILE` env vars, are still read when the unified config has no keys.

> Keep your config file private. `.gitignore` already excludes `web-access.json` and the legacy key files.

## Key rotation and cooldowns

- Requests go round-robin: each request starts on the next key, which spreads usage evenly.
- When a key is rejected, the request moves on to the next key, and the rejected key is skipped for a while:

  | Status | Meaning | Cooldown |
  |---|---|---|
  | 429 | Rate limited | 1 minute |
  | 402 / 432 / 433 | Out of credits or over the plan limit | 24 hours |
  | 401 / 403 | Invalid or forbidden key | 6 hours |

- Network errors and 5xx responses also move on to the next attempt. Other errors (for example a 400) fail fast instead of burning through keys.
- Cooldowns are kept in memory, so restarting the server clears them. Use `web_access_status` to inspect them.

## Development

```bash
npm test   # node:test suite, fully mocked — no network, no API keys needed
```

## License

No license has been chosen yet. All rights are reserved by the author until one is added.
