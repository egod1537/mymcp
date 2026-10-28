# MCP catalog

This catalog separates three facts that must not be conflated: source presence, workspace script
validation, and Console protocol verification. Presence under `apps/` or `mcps/` does not by
itself authorize the Console to launch a server.

| MCP              | Description                                         | Console state                   | Package / path                                |
| ---------------- | --------------------------------------------------- | ------------------------------- | --------------------------------------------- |
| `example`        | Reference stdio server with a validated `echo` tool | Verified, enabled               | `@mymcp/example` / `apps/example`             |
| `dcinside`       | Indexed search and local user-imported post data    | Verified, enabled               | `@mymcp/dcinside` / `mcps/dcinside`           |
| `google-maps`    | Read-only Maps location and routing tools           | Unverified, disabled by default | `@mymcp/google-maps` / `apps/google-maps`     |
| `google-routes`  | Existing Google Routes MCP project                  | Unverified, disabled by default | `@mymcp/google-routes` / `mcps/google-routes` |
| `japanese-vocab` | Personal vocabulary and flashcard tools             | Unverified, disabled by default | `@mymcp/japanese-vocab` / `mcps/jlpt`         |

`Verified` means the configured compiled stdio entrypoint has completed an MCP initialize/list
tools handshake and at least one safe acceptance call expected by the Console specification.
`Unverified` does not mean broken: it means the Console has not established that evidence, so the
registry must not auto-start it. A developer promotes a server by adding an explicit registry
entry, keeping it disabled initially, and recording a successful protocol-level verification.

## example

Implemented solely as the infrastructure reference. It has no external service dependency and
exposes one `echo` tool over stdio. See `apps/example/README.md`.

## dcinside

Implemented as a stdio workspace package. It searches only Brave's third-party web index,
validates post URLs locally, and stores only content explicitly supplied by the user. It does not
send automated requests to DCInside.

## google-routes

The package participates in workspace build, typecheck, and offline tests. Its live API behavior,
credentials model, and Console handshake are not part of the current verified set.

## google-maps

The package participates in workspace build, typecheck, and offline tests. It is not part of the
Console P0 allowlist and must not be presented as running or healthy without a live handshake.

## japanese-vocab

The package currently lives at `mcps/jlpt` while retaining the package name
`@mymcp/japanese-vocab`. It participates in workspace build, typecheck, and offline tests. Its
local-data conventions and Console protocol behavior remain outside the verified set.
