# MCP catalog

This catalog distinguishes phase-1 workspace packages from pre-existing projects awaiting a
deliberate migration. Presence of source under `mcps/` does **not** mean it has been migrated,
validated, or included in the new workspace.

| MCP              | Description                                         | State                               | Package / path                                          |
| ---------------- | --------------------------------------------------- | ----------------------------------- | ------------------------------------------------------- |
| `example`        | Reference stdio server with a validated `echo` tool | Implemented phase-1 reference       | `@mymcp/example` / `apps/example`                       |
| `dcinside`       | Existing DCInside MCP project                       | Planned migration; **not migrated** | No phase-1 package / pre-existing `mcps/dcinside`       |
| `google-routes`  | Existing Google Routes MCP project                  | Planned migration; **not migrated** | No phase-1 package / pre-existing `mcps/google-routes`  |
| `japanese-vocab` | Existing Japanese vocabulary MCP project            | Planned migration; **not migrated** | No phase-1 package / pre-existing `mcps/japanese-vocab` |

## example

Implemented solely as the infrastructure reference. It has no external service dependency and
exposes one `echo` tool over stdio. See `apps/example/README.md`.

## dcinside

Planned migration candidate. Its existing files were preserved in place and are outside
`pnpm-workspace.yaml`; phase 1 makes no compatibility or release claim for them.

## google-routes

Planned migration candidate. Its existing files were preserved in place and are outside
`pnpm-workspace.yaml`; phase 1 does not validate its API integration or credentials model.

## japanese-vocab

Planned migration candidate. Its existing files and local-data conventions were preserved in
place and are outside `pnpm-workspace.yaml`; phase 1 does not migrate its storage or tools.
