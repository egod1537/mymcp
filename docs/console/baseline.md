# Console implementation baseline

Recorded on 2026-10-28 (Asia/Seoul) before Console implementation.

## Repository snapshot

- Branch: `main`
- HEAD: `0478bd716cd28a041e9acd23691c8a6e2176b6cd`
- Package manager: pnpm 12.9.1
- Required runtime: Node.js 22 or newer
- Workspace globs: `apps/*`, `mcps/*`, `packages/*`
- Existing user changes were present and intentionally preserved. Notable differences from the
  issued specification include `mcps/japanese-vocab` being moved to `mcps/jlpt`, a new
  `apps/google-maps` package, and ongoing DCInside worker changes.

## Pre-change quality baseline

| Check                            | Result              | Evidence                                                |
| -------------------------------- | ------------------- | ------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Pass                | Lockfile current; 7 workspace projects discovered       |
| `pnpm format:check`              | Fail (pre-existing) | Prettier reported only `docs/mcp-catalog.md`            |
| `pnpm lint`                      | Pass                | Root ESLint completed without findings                  |
| `pnpm typecheck`                 | Pass                | Six script-bearing workspace packages passed            |
| `pnpm test`                      | Pass                | 16 files passed, 1 skipped; 145 tests passed, 4 skipped |
| `pnpm build`                     | Pass                | Six script-bearing workspace packages built             |

The format failure preceded any Console edit and came from the locally modified catalog table.
It is corrected as part of the documentation reconciliation rather than hidden or excluded.

## Package observations

| Package                               | Build/typecheck | Test evidence                                 | Console classification            |
| ------------------------------------- | --------------- | --------------------------------------------- | --------------------------------- |
| `@mymcp/example`                      | Pass            | 3 tests; MCP list/call covers `echo`          | Verified P0 target                |
| `@mymcp/dcinside`                     | Pass            | 62 tests; MCP list/call covers all five tools | Verified P0 target                |
| `@mymcp/google-maps`                  | Pass            | 52 offline tests                              | Unverified; not in P0 registry    |
| `@mymcp/google-routes`                | Pass            | 23 passed, 4 live tests skipped               | Unverified; disabled              |
| `@mymcp/japanese-vocab` (`mcps/jlpt`) | Pass            | 14 tests                                      | Unverified; disabled              |
| `@mymcp/shared`                       | Pass            | 3 tests                                       | Shared library; not an MCP server |

`example` and `dcinside` write startup diagnostics to stderr. Their stdio entrypoints reserve
stdout for MCP protocol messages. DCInside's protocol test asserts the existing five tool names
and object input schemas; the Console implementation must not change those contracts.

## Dist entrypoints and configuration

- Example: `apps/example/dist/index.js`; no secret configuration.
- DCInside: `mcps/dcinside/dist/index.js`; optional variables are documented in
  `mcps/dcinside/.env.example`. `dc_parse_post_url` needs no API credential.
- Google Routes: `mcps/google-routes/dist/index.js`; live API configuration remains unverified.
- Japanese vocabulary: `mcps/jlpt/dist/index.js`; local data configuration remains unverified.
- Google Maps: `apps/google-maps/dist/index.js`; not part of the Console P0 registry.

This baseline records build and test observations only. It never upgrades a server to `running`
or `healthy`; runtime state requires a fresh process handshake.
