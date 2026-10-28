# Known limitations

- Saved regression cases are manual only. There is no schedule, CI fixture export, JUnit output, or
  regression CLI; Playground input is never auto-saved.
- Metrics report actual counts and average latency; median latency remains unavailable rather than
  being estimated or fabricated.
- Authentication is deliberately single-owner. There are no users, roles, password reset email,
  cloud sync, or account recovery service.
- HTTPS termination and remote identity are not bundled. Remote access requires an owner-managed
  SSH tunnel or TLS service with an exact allowed origin and Secure cookies.
- Only Example and DCInside are executable in the production image. Google Routes and Japanese
  Vocabulary are metadata-only until separate offline protocol and credential tests pass.
- The adapter is tested with `@modelcontextprotocol/sdk` 1.32.2. A future MCP SDK v2 migration must
  preserve the Console DTOs and registry boundary behind a separately tested adapter; v1 and v2
  client APIs should not be mixed in one process lifecycle implementation.
- Execution history intentionally omits raw arguments and responses, so forensic replay requires
  an explicit future saved-test workflow rather than recovering sensitive input from logs.
