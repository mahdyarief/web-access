# web-access-mcp

<img src=".claude-plugin/icon.png" alt="" width="96" align="right">

[Bahasa Indonesia](README.id.md) · [Changelog](CHANGELOG.md) · MIT licensed

A zero-dependency local [MCP](https://modelcontextprotocol.io) server, packaged as a Claude Code plugin, that gives AI coding agents web access:

- **Web search** through [Exa](https://exa.ai) and [Tavily](https://tavily.com), with automatic fallback or merged results
- **API key rotation** for both providers, with cooldowns for exhausted or rate-limited keys
- **URL content extraction**: a direct fetch with a readability-style cleanup, plus Tavily Extract for PDFs and JS-rendered pages
- **GitHub search** for repositories, code, issues, commits and topics

It works out of the box: Exa is used **keyless** when no key is configured. Tavily is optional and adds news/finance search, AI answers, native time and domain filters, and PDF extraction.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Tools reference](#tools-reference)
- [How it works](#how-it-works)
- [Configuration](#configuration)
- [Key rotation and cooldowns](#key-rotation-and-cooldowns)
- [Credits and cost](#credits-and-cost)
- [Privacy and security](#privacy-and-security)
- [Troubleshooting](#troubleshooting)
- [Updating and uninstalling](#updating-and-uninstalling)
- [Project structure](#project-structure)
- [Development and releasing](#development-and-releasing)

## Requirements

- **Node.js 18.17 or newer** on your `PATH`. Check with `node -v`. No `npm install` is needed, because there are no dependencies.
- **Claude Code** for plugin install, or any MCP client that supports stdio servers.
- Optional: [Tavily API key(s)](https://app.tavily.com), [Exa API key(s)](https://dashboard.exa.ai), and the [GitHub CLI](https://cli.github.com) (`gh auth login`) for GitHub code search.

Works on Windows, macOS and Linux.

## Install

### Claude Code plugin (recommended)

```
/plugin marketplace add mahdyarief/web-access-mcp
/plugin install web-access@mahdyarief
```

On Claude Code 2.1.275 or later, a single command does both:

```
/plugin install web-access --marketplace mahdyarief/web-access-mcp
```

During install, Claude Code asks for the plugin options. **All of them are optional**:

| Option | Key | Meaning |
|---|---|---|
| **Tavily API keys** | `tavily_api_keys` | `tvly-...` keys, comma separated, rotated automatically. |
| **Exa API keys** | `exa_api_keys` | Comma separated. Leave empty to use Exa keyless. |
| **Default search provider** | `search_provider` | `auto` (default), `exa`, `tavily` or `both`. |

The key fields are marked *sensitive*. Claude Code stores them in your OS credential store, not in `settings.json`, and they never pass through the chat. To change them later, run `/plugin configure web-access@mahdyarief` and then restart Claude Code (or reconnect `web-access` in `/mcp`).

From a shell (for scripts or CI):

```bash
claude plugin marketplace add mahdyarief/web-access-mcp
claude plugin install web-access@mahdyarief
echo '{"tavily_api_keys":"tvly-aaa,tvly-bbb","search_provider":"auto"}' \
  | claude plugin configure web-access@mahdyarief --values-stdin
```

The plugin bundles:

| Component | Name | Purpose |
|---|---|---|
| MCP server | `web-access` | The tools below, exposed as `mcp__plugin_web-access_web-access__<tool>`. |
| Skill | `web-research` | Teaches Claude which tool and mode to use for each kind of question. |
| Skill | `/web-access:setup` | Guided key setup, a status check and diagnosis. |

### Any other MCP client

Clone the repo, then point your client at `server.js`:

```bash
git clone https://github.com/mahdyarief/web-access-mcp.git
```

```json
{
  "mcpServers": {
    "web-access": {
      "command": "node",
      "args": ["/absolute/path/to/web-access-mcp/server.js"],
      "env": {
        "TAVILY_API_KEYS": "tvly-aaa,tvly-bbb",
        "EXA_API_KEYS": ""
      }
    }
  }
}
```

You can leave `env` out and use the [config file](#configuration) instead.

## Quick start

After installing, just ask Claude:

- *"What changed in the latest Node.js release?"* → `web_search` with `recency`
- *"Read https://example.com/docs/api and summarize the auth section"* → `web_get_contents`
- *"Find popular MCP server repos written in TypeScript"* → `github_search`
- *"Research the pros and cons of Bun vs Deno, cite sources"* → `web_search` with `provider: "both"`, then `web_get_contents` on the best hits

To check the setup, run `/web-access:setup` or ask *"run web_access_status"*:

```
## web-access status

**Config file:** `~/.openclaude/web-access.json`
**Default provider:** auto

**Exa:** keyless (anonymous)

**Tavily:** 2 key(s) from env / plugin settings
  - `tvly-13T…bbqN` — ready
  - `tvly-9xQ…k2Lm` — cooling (HTTP 432, 1380 min left)

**Cache:** 5 entries, TTL 600s, 3 hit(s) / 5 miss(es)
```

Example `web_search` result with `provider: "both"`:

```markdown
**Answer:** …   ← only when Tavily is used with includeAnswer

### [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search)
_via exa + tavily_

POST /search …

---

### [Tavily AI · GitHub](https://github.com/tavily-ai)
_via tavily_

The web access layer for AI applications …
```

## Tools reference

Every tool returns Markdown text. If a tool fails, the result is marked `isError` and the error message tells you what to fix.

### `web_search`

Searches the web with the configured provider strategy.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | Be specific: include product names, versions or error text. |
| `numResults` | number | `5` | 1–10. In `both` mode, up to 2× after deduplication. |
| `site` | string | | Limits results to one domain, e.g. `docs.python.org`. |
| `recency` | `day` \| `week` \| `month` \| `year` | | Time filter. |
| `provider` | `auto` \| `exa` \| `tavily` \| `both` | config, else `auto` | See [provider modes](#provider-modes). |
| `livecrawl` | `always` \| `fallback` \| `never` | `fallback` | Exa only. `always` also skips the cache. |
| `fresh` | boolean | `false` | Skips the result cache. |

### `web_search_exa`

Exa-only search. It **always** uses Exa, whatever the default provider is.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | |
| `numResults` | number | `5` | 1–10 |
| `type` | `auto` \| `keyword` \| `neural` | `auto` | Exa search type. |
| `livecrawl` | `always` \| `fallback` \| `never` | `fallback` | |
| `fresh` | boolean | `false` | |

### `web_search_tavily`

Tavily-only search. **Requires a Tavily key.**

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | |
| `numResults` | number | `5` | 1–20 |
| `site` | string | | Sent as Tavily `include_domains`. |
| `recency` | `day` \| `week` \| `month` \| `year` | | Sent as Tavily `time_range`. |
| `topic` | `general` \| `news` \| `finance` | `general` | |
| `searchDepth` | `basic` \| `advanced` | `basic` | `advanced` gives better relevance and costs more. |
| `includeAnswer` | boolean | `false` | Adds a short LLM-generated answer above the results. |
| `fresh` | boolean | `false` | |

### `web_get_contents`

Returns the readable content of one URL. Works without any key. See [content extraction](#content-extraction).

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `url` | string | **required** | `http://` or `https://` |
| `maxChars` | number | `8000` | 500–50000. Longer text is cut and marked `[… truncated]`. |
| `fresh` | boolean | `false` | |

### `web_extract_tavily`

Extracts several URLs in one call with Tavily Extract. **Requires a Tavily key.**

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `urls` | string[] | **required** | Up to 20 `http(s)` URLs. A single string is also accepted. |
| `extractDepth` | `basic` \| `advanced` | `basic` | `advanced` handles tables and embedded content, and costs more. |
| `fresh` | boolean | `false` | |

URLs that fail are listed under `## Failed:` along with the reason.

### `github_search`

Searches GitHub through the REST API.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | string | **required** | Same syntax as github.com/search, e.g. `mcp server language:typescript stars:>100`. |
| `type` | `repositories` \| `issues` \| `code` \| `commits` \| `topics` | `repositories` | **Code search requires auth.** |
| `sort` | string | | Repos: `stars`, `forks`, `updated`, `help-wanted-issues`. Issues: `comments`, `reactions`, `updated`. |
| `order` | `desc` \| `asc` | `desc` | |
| `perPage` | number | `5` | 1–30 |

Authentication is optional and improves rate limits. The token is taken from `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token`.

### `web_access_status`

No parameters. Shows the config file path, the default provider, key counts and where they came from, masked keys with their cooldown state, and cache stats. Full keys are never shown.

## How it works

### Provider modes

| Mode | Behaviour | Best for |
|---|---|---|
| `auto` | Exa first, Tavily on error. When `site` or `recency` is set and a Tavily key exists, **Tavily goes first**, because it supports those filters natively. Exa only receives them as query hints. | Everyday use |
| `exa` | Exa only. | Saving Tavily credits |
| `tavily` | Tavily, with Exa on error. Without a Tavily key it uses Exa directly and adds a note. | News, recent events |
| `both` | Exa and Tavily run in parallel. Results are interleaved, deduplicated by normalized URL (ignoring `www.`, trailing `/` and `utm_*` parameters), and hits found by **both** providers are ranked first and tagged `via exa + tavily`. If one provider fails, you still get the other's results plus a note. | Research, thin results, cross-checking |

### Content extraction

`web_get_contents` tries the cheapest method that works:

1. **Direct fetch**, which is free. It decodes the page using its declared charset, prefers `<article>`/`<main>` content, drops navigation, header, footer, forms and scripts, and keeps headings and lists as Markdown-ish text. Plain text, JSON and Markdown are returned as-is.
2. **Tavily Extract**, used only with a Tavily key, when the direct fetch fails (blocked, timeout, HTTP error), when the URL is a **PDF** or other document, or when the page yields under ~300 characters (usually a JS-rendered page).

Without a Tavily key, PDFs return a clear error asking for one.

### Caching

Successful results are kept in memory for `cacheTtlSeconds` (600 by default) and keyed by tool plus arguments, ignoring argument order and surrounding whitespace. Errors are never cached. `fresh: true` or `livecrawl: "always"` bypasses the cache. Up to 200 entries are kept, and the oldest are evicted first.

## Configuration

### Where keys come from

Keys are loaded from the **first source that has any**, separately for each provider:

1. **Environment / plugin settings**: `TAVILY_API_KEYS` (or `TAVILY_API_KEY`) and `EXA_API_KEYS` (or `EXA_API_KEY`). Separate multiple keys with commas. The Claude Code plugin fills these from its options.
2. **Config file**: `~/.openclaude/web-access.json`, described below.
3. **Legacy files**: `~/.openclaude/exa_keys.json` and `~/.openclaude/tavily_keys.json` (paths can be changed with `EXA_KEYS_FILE` / `TAVILY_KEYS_FILE`).

`web_access_status` shows which source is in use.

### Config file

The default path is `~/.openclaude/web-access.json`. Override it with `WEB_ACCESS_CONFIG=/path/to/file.json`. Copy [`web-access.example.json`](web-access.example.json) to get started:

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
| `provider` | `auto` | Default mode for `web_search`. `WEB_SEARCH_PROVIDER` or the plugin option overrides it. Invalid values fall back to `auto`. |
| `cacheTtlSeconds` | `600` | Cache lifetime. `0` disables the cache. |
| `exa.keys` | `[]` | Exa API keys. With none, Exa runs keyless (anonymous, lower rate limits). |
| `exa.keylessFallback` | `true` | Makes one last keyless attempt when every key is rejected or cooling down. Set it to `false` to fail instead. |
| `exa.timeoutMs` | `45000` | Total time budget for one Exa request across all attempts. |
| `tavily.keys` | `[]` | Tavily API keys (`tvly-...`). Tavily is disabled without at least one key. |
| `tavily.timeoutMs` | `45000` | Total time budget for one Tavily search across all keys (extract uses 90 s). |

`"exa"` and `"tavily"` can also be plain arrays of keys. The file is **re-read automatically when it changes**, so you don't need to restart.

### Environment variables

| Variable | Purpose |
|---|---|
| `TAVILY_API_KEYS` / `TAVILY_API_KEY` | Tavily keys (comma separated). |
| `EXA_API_KEYS` / `EXA_API_KEY` | Exa keys (comma separated). |
| `WEB_SEARCH_PROVIDER` | Default provider (`auto`, `exa`, `tavily`, `both`). |
| `WEB_ACCESS_CONFIG` | Path to the config file. |
| `EXA_KEYS_FILE` / `TAVILY_KEYS_FILE` | Paths to the legacy key files. |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub token for `github_search`. |

Empty values and unfilled placeholders such as `${user_config.tavily_api_keys}` are ignored.

### Legacy key file formats

These are still supported for existing setups:

```jsonc
["key-1", "key-2"]                      // plain array
{ "keys": ["key-1", "key-2"] }          // object with keys
{ "account1": "key-1", "acc2": "key-2" } // named values (Exa: UUID keys only)
```

## Key rotation and cooldowns

- **Round-robin**: each request starts on the next key, so usage spreads evenly across keys.
- **Retry on key problems**: when a key is rejected, the same request moves on to the next key, and the rejected key is put on cooldown:

  | Status | Meaning | Cooldown |
  |---|---|---|
  | 429 | Rate limited | 1 minute |
  | 402 / 432 / 433 | Out of credits or over the plan / pay-as-you-go limit | 24 hours |
  | 401 / 403 | Invalid or forbidden key | 6 hours |

  For Exa, rate-limit or quota messages inside a successful MCP response are treated as 429.
- **Other failures**: network errors and 5xx responses also move on to the next attempt, without a cooldown. Other errors (for example a 400 bad request) **fail fast** instead of burning through keys.
- **Deadline**: all attempts share one time budget (`timeoutMs`, 45 s by default), so a request never hangs for minutes.
- **Exa keyless**: after every Exa key is rejected or cooling down, one keyless attempt is made (unless `keylessFallback` is `false`).
- Cooldowns live in memory, so restarting the server clears them.

## Credits and cost

| Action | Exa | Tavily |
|---|---|---|
| `web_search` in `auto` / `exa` | 1 request (free when keyless) | only used as a fallback |
| `web_search` in `both` | 1 request | 1 search |
| `web_search_tavily` | none | `basic` ≈ 1 credit, `advanced` ≈ 2 credits |
| `web_get_contents` | none | only used as a fallback (PDF, blocked or JS pages) |
| `web_extract_tavily` | none | charged per batch of URLs, more for `advanced` |
| Cached repeat | none | none |

Tavily credit numbers change over time. Check [Tavily's pricing and credits docs](https://docs.tavily.com) for current values. Exa's keyless limits are not published and may change.

## Privacy and security

- **What leaves your machine**: search queries go to Exa (`mcp.exa.ai`) and/or Tavily (`api.tavily.com`). URLs you read are fetched **directly from your machine**, or sent to Tavily Extract when the fallback is used. GitHub queries go to `api.github.com`.
- **No telemetry**: the server sends nothing anywhere else and stores nothing on disk. The cache and cooldowns live in memory only.
- **Keys**: plugin keys are stored by Claude Code in your OS credential store. Keys are never logged, and `web_access_status` only shows masked keys such as `tvly-13T…bbqN`.
- **Config file**: `~/.openclaude/web-access.json` is plain text. Keep it private and never commit it. This repo's `.gitignore` excludes `web-access.json` and the legacy key files.
- **Untrusted content**: fetched pages are third-party content. The bundled `web-research` skill tells Claude to treat it as data, never as instructions.
- **Leaked key**: if a key ever ends up in a chat, log or commit, rotate it in the provider's dashboard.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `web-access` is missing from `/mcp`, or shows as failed | Node.js isn't on `PATH` or is older than 18.17. Run `node -v`, install a newer Node, and restart Claude Code. |
| `No Tavily API keys configured` | Tavily is optional. Use `web_search` (Exa works keyless), or add keys with `/plugin configure web-access@mahdyarief`. |
| You set keys but `web_access_status` still shows none | Restart Claude Code after `/plugin configure`, because plugin options are passed when the server starts. Also check that Tavily keys start with `tvly-`. |
| `All Tavily keys are cooling down` | Every key hit a rate or credit limit. Check `web_access_status` for the time left, use `provider: "exa"` meanwhile, or add another key. |
| `Exa error 429` with keyless Exa | You hit the anonymous rate limit. Add an Exa key, or configure Tavily so `auto` can fall back. |
| `Exa request timed out` / `Tavily request timed out` | Slow network or provider. Retry, or raise `timeoutMs` in the config file. |
| `PDF documents are not supported by the direct fetcher` | Add a Tavily key. PDFs are then extracted automatically. |
| A page returns almost no text | The page is probably JS-rendered. With a Tavily key this is retried automatically. Otherwise, find another source. |
| `GitHub API requires authentication` | Code search always needs auth. Run `gh auth login`, or set `GITHUB_TOKEN`. |
| `GitHub API rate limited` | You hit the unauthenticated limit. Authenticate as above for a higher one. |
| Results look stale | Pass `fresh: true`, or set `cacheTtlSeconds` to `0`. |

Server logs go to stderr, so they appear in your MCP client's server log. They include the startup summary, key rotations and fallbacks.

## Updating and uninstalling

```
/plugin marketplace update mahdyarief
/plugin update web-access@mahdyarief
```

Restart Claude Code after updating. To remove the plugin:

```
/plugin uninstall web-access@mahdyarief
/plugin marketplace remove mahdyarief
```

Your config file (`~/.openclaude/web-access.json`) is left untouched. Delete it yourself if you no longer need it.

## Project structure

```
.claude-plugin/
  plugin.json         plugin manifest + userConfig (keys, provider)
  marketplace.json    "mahdyarief" marketplace listing this plugin
  icon.png
.mcp.json             MCP server definition (passes plugin options as env)
skills/
  web-research/       when to use which tool
  setup/              /web-access:setup
server.js             stdio JSON-RPC / MCP entry point
tools.js              tool schemas, provider routing, merge, status
config.js             unified config file + env helpers (hot reload)
exa-client.js         Exa MCP client: rotation, keyless fallback, deadline
exa-rotator.js        Exa key loading + round-robin
tavily-client.js      Tavily search/extract client + formatting
tavily-rotator.js     Tavily key loading + round-robin
key-health.js         per-key cooldowns, masking
cache.js              in-memory TTL cache
formatter.js          result parsing, URL normalization, merging
web-fetcher.js        direct fetch + HTML → text
github-client.js      GitHub search
test/                 node:test suite (fully mocked)
```

## Development and releasing

```bash
git clone https://github.com/mahdyarief/web-access-mcp.git
cd web-access-mcp
npm test                          # 33 tests, fully mocked: no network, no keys
claude plugin validate .          # validate the plugin manifest
claude plugin validate .claude-plugin/marketplace.json
```

To try local changes in Claude Code, add the folder as a marketplace: `/plugin marketplace add ./path/to/web-access-mcp`.

**Releasing a new version:**

1. Bump `version` in **both** `.claude-plugin/plugin.json` and `package.json`. Claude Code uses the plugin version to detect updates.
2. Add an entry to [`CHANGELOG.md`](CHANGELOG.md).
3. Run `npm test` and `claude plugin validate .`.
4. Commit, push, and optionally tag with `claude plugin tag .`.

Issues and pull requests are welcome at [github.com/mahdyarief/web-access-mcp](https://github.com/mahdyarief/web-access-mcp/issues).

## License

[MIT](LICENSE) © mahdyarief
