# Console integration boundaries

## Console-owned changes

The Console owns its web and API applications, browser-safe contracts, stdio client adapter,
allowlisted registry, operational database, authentication, deployment files, and Console
documentation. It may launch configured compiled entrypoints, perform MCP protocol operations,
and record redacted execution metadata.

## Existing MCP-owned contracts

The Console must not change an existing server's public tool names, descriptions, schemas,
result shapes, stdio transport, storage format, external-service policy, or credential behavior.
In particular, it must not add direct DCInside crawling or bypass controls. Compatibility fixes
must be made in the Console adapter unless a separately reviewed MCP change is unavoidable.

The P0 acceptance contract is:

- `@mymcp/example`: initialize, list `echo`, and call it with a string message.
- `@mymcp/dcinside`: initialize, list the existing five tools, and call
  `dc_parse_post_url` with a public URL that requires no network or credential.

## Process and network boundary

- Only IDs in `config/mcp-registry.json` may be addressed.
- Registry commands and arguments are developer-controlled, never browser-supplied.
- Disabled or unverified entries are not auto-started.
- The API provides lifecycle observation and MCP connect/disconnect semantics, not arbitrary
  shell execution, Docker control, or deployment management.
- Child environments begin from a minimal allowlist plus registry-declared variable names.
- stdout is protocol-only; bounded, redacted stderr is operational evidence.

## Data boundary

The operational store contains server observations, tool metadata, saved non-secret test inputs,
and redacted execution records. It must not contain authentication secrets, API keys, raw
authorization headers, or unbounded child output. Browser bundles receive no server environment
values. Mock or seed data, when used, is labelled and kept separate from runtime observations.
