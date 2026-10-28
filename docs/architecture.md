# Architecture

## Workspace boundaries

`pnpm-workspace.yaml` discovers `apps/*`, `mcps/*`, and `packages/*`. Each directory with a
`package.json` is an independently versioned package with its own build, test, and typecheck
scripts. Workspace discovery only means that pnpm can run the package scripts; it does not mean a
server is trusted, production-ready, or enabled in the Console registry.

Applications may depend on packages, but packages must not depend on applications. Internal
dependencies use `workspace:*` so an accidental registry package cannot replace local code.
Use `@mymcp/shared` only for stable, cross-server primitives. Server-specific tools, schemas,
clients, and configuration belong in that server's app; avoid a global server singleton or a
framework layer that couples releases.

All new TypeScript packages extend `packages/config/tsconfig.base.json`. The repository uses ESM,
NodeNext module and resolution settings, explicit `.js` suffixes in relative imports, and strict
type checking. Builds emit JavaScript, declarations, and source maps to package-local `dist/`
directories.

## MCP server lifecycle

A stdio server follows this lifecycle:

1. Construct a fresh SDK `McpServer` and register tools with validated schemas.
2. Connect one `StdioServerTransport`; connection startup is owned by the SDK.
3. Keep stdout reserved for JSON-RPC/MCP traffic and send operational logs to stderr.
4. On `SIGINT` or `SIGTERM`, stop accepting work and close the server/owned transport.
5. Set a non-zero exit code if startup or shutdown fails without exposing sensitive payloads.

The example uses stdio because local MCP clients can launch it directly. Streamable HTTP is the
preferred future network transport when a server must be remote or shared. Adding it requires an
explicit authentication, authorization, origin validation, session, rate-limit, and deployment
design; it is not enabled in phase 1.

## Naming and versions

- App directories use lowercase kebab-case: `apps/google-routes`.
- Package names use the matching scope: `@mymcp/google-routes`.
- Executable names use `mymcp-<name>` and point to `dist/index.js`.
- Packages begin at `0.1.0` and use semantic versioning independently.
- A breaking change in one MCP increments that package only; shared-package breaking changes must
  be coordinated with every consuming app.
- Publishing is opt-in per package. The root package is permanently private.

## Console boundary

The Console is an operator application, not a general-purpose process launcher. Its backend may
start only entries from the version-controlled `config/mcp-registry.json` allowlist. Browser code
uses `@mymcp/console-contracts` and never imports the Node-only `@mymcp/mcp-client` package.

Existing MCP public tool names, descriptions, input schemas, transport behavior, and persistent
formats are outside the Console's ownership. The Console adapts to those contracts and records
observations; it does not rewrite them. See
[Console integration boundaries](console/integration-boundaries.md) for the detailed policy.
