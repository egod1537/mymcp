# mymcp

TypeScript monorepo infrastructure for developing, testing, maintaining, and distributing MCP
servers independently. Phase 1 provides the shared toolchain, a small shared package, a safe app
generator, and one functional reference server.

The pre-existing `dcinside`, `google-routes`, and `japanese-vocab` sources have **not** been
migrated into this workspace. They remain under `mcps/` as migration inputs and are excluded from
phase-1 workspace commands.

## Repository map

```text
apps/example/       Reference stdio MCP server
packages/shared/    Typed errors and structured stderr logging
packages/config/    Shared strict TypeScript configuration
scripts/            MCP app scaffolding and its tests
docs/               Architecture, development, deployment, and catalog docs
mcps/               Pre-existing projects; not migrated or managed in phase 1
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

Useful root commands:

| Command             | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `pnpm dev`          | Run the example server from TypeScript in watch mode       |
| `pnpm build`        | Build all managed workspace packages to `dist/`            |
| `pnpm test`         | Run scaffold, shared-package, and MCP tests                |
| `pnpm typecheck`    | Typecheck every managed package with strict settings       |
| `pnpm lint`         | Lint phase-1 source and scripts                            |
| `pnpm format`       | Format phase-1 files                                       |
| `pnpm format:check` | Check formatting without changing files                    |
| `pnpm clean`        | Remove generated `dist/` directories from managed packages |

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

| MCP              | Phase-1 state                   | Details                                                          |
| ---------------- | ------------------------------- | ---------------------------------------------------------------- |
| `example`        | Implemented reference           | [`apps/example`](apps/example), [README](apps/example/README.md) |
| `dcinside`       | Planned migration; not migrated | [Catalog entry](docs/mcp-catalog.md#dcinside)                    |
| `google-routes`  | Planned migration; not migrated | [Catalog entry](docs/mcp-catalog.md#google-routes)               |
| `japanese-vocab` | Planned migration; not migrated | [Catalog entry](docs/mcp-catalog.md#japanese-vocab)              |

The complete source-of-truth catalog is [docs/mcp-catalog.md](docs/mcp-catalog.md).
