# README, Mac mini Setup, and MCP Client Registration

README CONTENT MUST INCLUDE
- What it does and does NOT do.
- Terms/compliance caveat with official DCInside TOS URL.
- Brave Search API required only for dc_search_posts.
- Installation, development, build, local test.
- All five tools with valid sample inputs and outputs.
- Explicit explanation that search hits are indexed links/snippets; full body/comments require user import.
- Local storage location and privacy constraints.
- Troubleshooting for missing key, no indexed hits, 429, unsupported URL, not imported.
- How to upgrade with a legally authorized data source in a separate future phase.

EXAMPLE .env.example
BRAVE_SEARCH_API_KEY=
# Optional:
# DCINSIDE_DATA_DIR=/Users/yang/.local/share/mymcp/dcinside
# DCINSIDE_SEARCH_TIMEOUT_MS=8000
# DCINSIDE_MAX_SEARCHES_PER_MINUTE=10

MAC MINI DEVELOPMENT
  cd /Users/yang/proj/mymcp
  pnpm install
  pnpm --filter @mymcp/dcinside typecheck
  pnpm --filter @mymcp/dcinside test
  pnpm --filter @mymcp/dcinside build

These commands are targets; check actual workspace setup before running. The package name must match actual package.json.

CLIENT CONFIG EXAMPLE (illustrative JSON, adjust for client's supported schema)
{
  "mcpServers": {
    "dcinside": {
      "command": "node",
      "args": ["/Users/yang/proj/mymcp/mcps/dcinside/dist/index.js"],
      "env": {
        "BRAVE_SEARCH_API_KEY": "${BRAVE_SEARCH_API_KEY}"
      }
    }
  }
}
Note: Not every MCP client expands ${...} in JSON. Explain how to pass an environment variable securely for the actual target client instead of claiming this always works. Never embed a real key in a committed config file.

SMOKE TESTS
- Start server with no key: parse/import/get should work; search should explain config requirement.
- Start with a test/mocked Brave provider: search returns only canonical DCInside post links.
- Import a synthetic user post and retrieve it, including comments.
- Confirm no process logs are emitted on stdout (stdout is MCP protocol only).

USER-FACING LANGUAGE
Provide Korean README examples when practical, preserving English MCP tool names. State limitations plainly; no claim of direct gallery scraping.
