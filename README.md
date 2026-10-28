# mymcp

TypeScript monorepo infrastructure for developing, testing, maintaining, and distributing MCP
servers independently. The repository contains stdio MCP servers, shared packages, and a local
operator console for inspecting and invoking an explicit allowlist of those servers.

## Repository map

```text
apps/example/       Reference stdio MCP server
apps/google-maps/   Read-only Google Maps MCP server
apps/console-*/     Local MCP Console web and API applications
packages/shared/    Typed errors and structured stderr logging
packages/config/    Shared strict TypeScript configuration
packages/mcp-client/          Reusable Node-only stdio MCP client
packages/console-contracts/   Browser-safe Console API contracts
scripts/            MCP app scaffolding and its tests
docs/               Architecture, development, deployment, and catalog docs
mcps/               MCP server workspace packages
```

## Requirements

- Node.js 22 LTS
- pnpm 12.9.1 (pinned in `package.json`)

If pnpm is not already available, enable the Node.js Corepack shim first:

```bash
corepack enable
```

## Quickstart

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The Console has its own setup and security requirements. Start with the
[Console setup guide](docs/console/setup.md) and read the
[security guidance](docs/console/security.md) before exposing it on a network.

Useful root commands:

| Command                      | Purpose                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                   | Run the example server from TypeScript in watch mode       |
| `pnpm console:dev`           | Run the Console API and Vite UI on loopback                |
| `pnpm console:hash-password` | Generate the Console's Argon2id admin password hash        |
| `pnpm build`                 | Build all managed workspace packages to `dist/`            |
| `pnpm test`                  | Run scaffold, shared-package, MCP, and Console unit tests  |
| `pnpm typecheck`             | Typecheck every managed package with strict settings       |
| `pnpm lint`                  | Lint workspace source and scripts                          |
| `pnpm format`                | Format managed source and documentation                    |
| `pnpm format:check`          | Check formatting without changing files                    |
| `pnpm clean`                 | Remove generated `dist/` directories from managed packages |

## Run the example with a local MCP client

Build the dependency chain and find the absolute repository path:

```bash
pnpm --filter @mymcp/example... build
pwd
```

Add the following to a client that accepts the common `mcpServers` JSON shape. Replace
`/absolute/path/to/mymcp` with the `pwd` result; MCP clients generally do not expand shell
variables in JSON configuration.

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

Restart or reload the client, list its tools, and call `echo` with a payload such as
`{"message":"hello"}`. The server reserves stdout for MCP protocol messages and writes logs to
stderr.

## Create another MCP server

```bash
pnpm create:mcp weather-tools
pnpm install
pnpm --filter @mymcp/weather-tools test
pnpm --filter @mymcp/weather-tools... build
node apps/weather-tools/dist/index.js
```

Names must be kebab-case. The generator refuses unsafe names and existing destinations and never
overwrites an app. New apps start with a minimal `echo` tool that should be replaced with their
documented capability.

See [development guidance](docs/development.md) for the full workflow and
[deployment guidance](docs/deployment.md) for the independent release model.

## MCP catalog

| MCP              | Repository state                           | Details                                                          |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------- |
| `example`        | Implemented; Console-verified              | [`apps/example`](apps/example), [README](apps/example/README.md) |
| `dcinside`       | Implemented; Console-verified              | [Catalog entry](docs/mcp-catalog.md#dcinside)                    |
| `google-maps`    | Implemented; not enabled in Console P0     | [Catalog entry](docs/mcp-catalog.md#google-maps)                 |
| `google-routes`  | Build/test baseline only; Console-disabled | [Catalog entry](docs/mcp-catalog.md#google-routes)               |
| `japanese-vocab` | Build/test baseline only; Console-disabled | [Catalog entry](docs/mcp-catalog.md#japanese-vocab)              |

The complete source-of-truth catalog is [docs/mcp-catalog.md](docs/mcp-catalog.md).
