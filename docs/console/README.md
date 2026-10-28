# MCP Console

The MCP Console is a local, single-owner operator interface for allowlisted stdio MCP servers.
It discovers tools through the MCP SDK, invokes them through a protected API, and stores only
bounded operational metadata by default.

- [Setup](setup.md): clean clone, password setup, local development, and first login.
- [Architecture](architecture.md): browser/API/process/data boundaries.
- [Registry](registry.md): supported versus unverified entries and the enable procedure.
- [Security](security.md): authentication, CSRF, secrets, and safe remote access.
- [Operations](operations.md): Mac mini Docker deployment, backup, upgrade, and rollback.
- [Testing](testing.md): unit, protocol, HTTP, browser, Docker, and manual checks.
- [Known limitations](known-limitations.md): intentionally deferred features and migration risks.
- [Baseline](baseline.md) and [integration boundaries](integration-boundaries.md): pre-change
  evidence and ownership rules.
