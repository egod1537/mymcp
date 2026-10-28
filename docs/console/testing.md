# Console testing

## Automated layers

Run the repository gate from the root:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The MCP client tests exercise registry confinement, stderr redaction, concurrent single-child
inspection, actual stdio Example echo, all five DCInside tool names, and offline URL parsing. The
Fastify tests cover authentication, CSRF/origin, schema validation, write confirmation, typed
errors, response limits, and persistent redacted events. Vitest frontend tests cover dynamic
server rendering and theme persistence.

After a production build and one-time Chromium installation, run the browser suite:

```bash
pnpm --filter @mymcp/console-web exec playwright install chromium
pnpm --filter @mymcp/console-web test:e2e
```

Playwright starts the compiled same-origin server with a temporary SQLite directory and synthetic
test password. At 1440px and 390px it verifies login, honest registry inventory, Example echo,
explicit Saved Test creation and rerun, DCInside discovery, write confirmation, logs, local Monaco
assets, theme persistence, navigation, and horizontal overflow. It never calls the DCInside
website or Brave API.

## Docker smoke

Use the auth mode configured in `.env.console`, then run:

```bash
docker compose --env-file .env.console -f docker-compose.console.yml up -d --build
curl --fail http://127.0.0.1:44173/api/healthz
curl --fail https://mcp-dashboard.mangagaki.net/api/healthz
docker compose --env-file .env.console -f docker-compose.console.yml restart mymcp-console
docker compose --env-file .env.console -f docker-compose.console.yml down
```

The full smoke check logs in through the API, inspects and calls Example echo, calls the offline
DCInside URL parser, checks events after restart, and verifies loopback-only/non-root/read-only
container settings. `down` must omit `-v` unless the owner explicitly intends permanent data loss.

## Manual release checks

- In password mode, confirm unauthenticated `/api/servers` returns 401. In disabled mode, confirm
  `/api/auth/session` reports `authMode=disabled` without setting a cookie.
- Inspect supported entries and confirm unverified entries remain unlaunchable.
- Confirm the Playground distinguishes tool errors from transport/API errors.
- Review desktop/mobile keyboard focus, empty/error states, and the write confirmation dialog.
- Confirm no real key, `.env.console`, SQLite database, or user fixture exists in the image or JS.
