# Console registry

`config/mcp-registry.json` is a reviewed deployment artifact, not user-editable Console data.
Each entry fixes its ID, display metadata, stdio command arguments, working directory, build
package, permitted environment keys, expected tools, and catalog state.

Catalog states have deliberately different meanings:

- `supported`: protocol-tested against the compiled entrypoint and allowed to launch.
- `unverified`: shown for inventory, but every inspect or call attempt is blocked.
- `disabled`: known entry intentionally unavailable to the Console.

Runtime state (`not_started`, `connecting`, `ready`, `degraded`, `error`, or `disconnected`) is
fresh process evidence. Catalog state never implies that a process is running or healthy.

## Enabling an MCP

1. Confirm its compiled entrypoint and stdio transport. stdout must contain MCP protocol only.
2. Document every required environment key and ensure secrets are optional at registry-load time.
3. Add offline protocol tests for initialize, `tools/list`, and representative `tools/call`.
4. Assert the exact public tool names and schemas without changing the MCP-owned contract.
5. Add timeout, shutdown, redaction, and missing-credential coverage. CI must not call paid or
   third-party live APIs.
6. Add the code and production dependencies to `Dockerfile.console`; metadata-only directories are
   insufficient for a supported entry.
7. Change `catalogState` to `supported`, rebuild, and run the Docker smoke procedure.

The UI cannot perform this procedure, edit registry fields, add arbitrary paths, or run a shell.
Google Routes and Japanese Vocabulary stay unverified until they independently meet these steps.
