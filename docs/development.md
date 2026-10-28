# Development

## Standard workflow

Use Node.js 22 LTS and the pnpm version pinned by the root `packageManager` field.

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

During implementation, filter to one package:

```bash
pnpm --filter @mymcp/example test
pnpm --filter @mymcp/example typecheck
pnpm --filter @mymcp/example... build
```

The trailing `...` in the build filter includes workspace dependencies. Root test and typecheck
commands build `@mymcp/shared` first so its declared exports exist from a clean clone.

## Create an app

```bash
pnpm create:mcp weather-tools
pnpm install
pnpm --filter @mymcp/weather-tools test
pnpm --filter @mymcp/weather-tools... build
```

The name must be lowercase kebab-case. The generator creates only `apps/<name>`, rejects path
components and existing targets before writing, and does not execute generated or user-supplied
commands. Add the server to `docs/mcp-catalog.md` when its purpose and state are known.

## Conventions

- Keep `src/index.ts` as a small process/transport entrypoint.
- Put server construction and tool registration in `src/server.ts` or focused modules it imports.
- Export pure domain logic so it can be tested without a transport.
- Validate every externally supplied tool argument with SDK-compatible Zod schemas.
- Return MCP content objects rather than ad hoc JSON strings unless the tool contract calls for
  textual JSON.
- Never write diagnostics to stdout in a stdio server.
- Do not log secrets, authorization values, or raw sensitive request payloads.
- Keep `.env` local; commit only documented placeholders in `.env.example` when an app needs them.

## Testing

Each app should have unit tests for tool/domain behavior and at least one protocol-level test when
feasible. The example links the official SDK client and server with `InMemoryTransport`, then lists
and invokes its tool through MCP. Tests should not require production credentials or live services
in the default CI path.

The scaffold tests generate into operating-system temporary directories. They verify the complete
file set, package metadata, unsafe-name rejection, and that a repeated name fails without changing
the first generated app.

## Local MCP client configuration

Build the app and use its compiled entrypoint. For the example:

```bash
pnpm --filter @mymcp/example... build
```

```json
{
  "mcpServers": {
    "mymcp-example": {
      "command": "node",
      "args": ["/absolute/path/to/mymcp/apps/example/dist/index.js"]
    }
  }
}
```

Use an absolute path because most MCP clients do not run the command from the repository root.
Client-specific configuration locations vary, but the command and arguments are portable.
