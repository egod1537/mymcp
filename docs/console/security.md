# Console security

The Console is a tool execution surface. It binds to `127.0.0.1` by default. In the default
`CONSOLE_AUTH_MODE=password` mode it fails closed when `CONSOLE_ADMIN_PASSWORD_HASH` is absent or
is not an Argon2id PHC string.

The `mcp-dashboard.mangagaki.net` deployment deliberately sets `CONSOLE_AUTH_MODE=disabled` at the
owner's request. This removes the login screen, session cookie, and password hash. It also means
any Internet client can inspect and invoke allowlisted MCP tools, consume configured API quotas,
and write Console/DCInside data where a tool permits it. Do not reuse this setting for a deployment
that carries broader credentials or destructive tools.

Generate the hash from a hidden interactive prompt:

```bash
pnpm console:hash-password
```

Copy only the resulting `$argon2id$...` value into the runtime secret environment. Do not pass a
password as a command argument or commit a populated environment file. Sessions last 12 hours;
only a SHA-256 hash of the cookie token is stored in SQLite. Restarting with a different admin
hash invalidates sessions created for the previous hash.

All mutating API calls still require the strict same origin plus a process-local CSRF token. In
password mode, cookies are HttpOnly, SameSite=Strict, and can be made Secure with
`CONSOLE_SECURE_COOKIES=true`. Disabled mode is accepted only with an HTTPS allowed origin. Keep
TLS termination at the trusted reverse proxy and do not expose the backend over plain HTTP.

The registry is a deployment-controlled allowlist. Browser requests cannot set a process command,
argument, working directory, URL, or environment value. Child processes receive a fixed runtime
environment plus only the registry-declared MCP variables. API responses expose environment-key
presence, never values. Request arguments and raw MCP results are not written to operational logs
by default.

Saved Tests are the explicit exception for input persistence: the owner must click Save, and the
arguments are stored only in the protected SQLite volume. Secret-like field names, bearer values,
and password hashes are rejected. Owner-provided sensitive data requires a second confirmation;
run summaries persist assertion outcomes, not raw tool responses.
