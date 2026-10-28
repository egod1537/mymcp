# `@mymcp/example`

Reference MCP server for this monorepo. It exposes an `echo` tool over stdio and has no
environment variables or external services.

## Build and run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @mymcp/example... build
node apps/example/dist/index.js
```

The process speaks MCP on stdin/stdout. Human-readable structured logs go only to stderr, so
invoke it through an MCP client rather than typing into the process directly. See the root
README for a client configuration example.
