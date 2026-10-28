# Console architecture

The production deployment is one same-origin HTTP service with a strict process boundary:

```text
Browser (Blueprint React SPA)
        |
        | cookie + CSRF, JSON DTOs
        v
Fastify Console API ---- SQLite (sessions, health, redacted execution metadata)
        |
        | fixed registry ID only
        v
Node-only ConnectionManager ---- MCP SDK StdioClientTransport
        |                              |
        +---- Example child -----------+
        +---- DCInside child ----------+
```

Fastify serves `apps/console-web/dist` and `/api` from the same origin in production. Development
uses separate Vite and Fastify processes with a fixed loopback proxy. Browser code never imports
the Node MCP client, sees a command path, or receives environment values.

`config/mcp-registry.json` is the only launch allowlist. The manager resolves paths under a fixed
runtime root, uses the current Node executable, passes a minimal environment plus declared keys,
shares one child per MCP, bounds concurrency and stderr, and shuts children down on SIGTERM.
Unverified entries are metadata-only and cannot be launched.

GET routes read cached state and never start a process. An authenticated, same-origin POST to
inspect performs the MCP handshake and live tool discovery. Tool calls are validated against the
discovered JSON Schema on both client and server. MCP tool errors remain successful HTTP responses
with `outcome=tool_error`; transport and policy failures use stable typed HTTP errors.

SQLite migrations run before listening. The store persists session token hashes, health samples,
and execution metadata such as tool name, outcome, duration, and byte counts. Raw arguments,
responses, cookies, password hashes, and API-key values are not execution-log columns.
