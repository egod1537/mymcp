# Console operations

## Local development

Use Node.js 22.12 or newer and pnpm 12.9.1. Create an untracked `.env.console` from
`.env.console.example`, generate an admin hash, and start the API plus Vite:

```bash
pnpm install --frozen-lockfile
pnpm console:hash-password
pnpm console:dev
```

The Vite UI is `http://127.0.0.1:5173`; it proxies `/api` to port 3000. The root helper overrides
the deployment host, port, origin, and data directory with those development values. The password
hash still comes from `.env.console`.

## Docker Compose on the Mac mini

Put the selected auth mode and any optional MCP key in an untracked `.env.console` with mode 0600,
then run. This host intentionally uses `CONSOLE_AUTH_MODE=disabled`; password mode remains the
default for other deployments.

```bash
docker compose --env-file .env.console -f docker-compose.console.yml up -d --build
docker compose --env-file .env.console -f docker-compose.console.yml logs -f mymcp-console
docker compose --env-file .env.console -f docker-compose.console.yml down
```

The deployment URL is `https://mcp-dashboard.mangagaki.net`. Docker publishes container port 4173
as `127.0.0.1:44173` on the host, so it is unreachable directly from an external network. Public
requests reach it through the existing Cloudflare Tunnel and Caddy edge. Do not add a public host
binding for plain HTTP. `CONSOLE_ALLOWED_ORIGIN` must be the exact HTTPS origin and
`CONSOLE_SECURE_COOKIES` must remain `true`. Do not enable blanket proxy trust or trust arbitrary
forwarded host/client headers.

The Mac mini routes this hostname through its `jjs` Cloudflare Tunnel to the
shared Caddy edge. Its host route is:

```caddyfile
http://mcp-dashboard.mangagaki.net {
	reverse_proxy host.docker.internal:44173
}
```

Store that route in the edge's generated route directory, validate the complete Caddy config, and
reload Caddy. Cloudflare terminates public TLS; the Caddy-to-Console hop remains on the local Docker
host path. The host port is intentionally separate from `CONSOLE_PORT` because port 4173 is already
used by another local application.

`down` preserves both named volumes. Never use `down -v` as a routine stop command; it permanently
deletes the Console history/session database and DCInside local imports.

## Backup and restore

SQLite uses WAL mode. Stop the container before a simple file-level backup, or use SQLite's online
backup API from a trusted maintenance process. Back up both `console_data` and `dcinside_data` as
sensitive owner data. Never upload them to the repository.

To restore, stop the service, restore the volume contents with their ownership preserved, then
start the same or a compatible newer image. Schema migrations run before the server begins
accepting traffic.

## Upgrade and rollback

1. Back up the named volumes.
2. Pull or check out the reviewed source revision.
3. Run the repository validation suite.
4. Rebuild with `docker compose ... up -d --build`.
5. Confirm `/api/healthz`, then inspect Example and DCInside manually.

Rollback by rebuilding the previous source revision against a compatible backup. A healthy
Console readiness response means the HTTP service and database started; it does not claim that any
MCP child has been inspected or is healthy.

The image contains executable code only for the supported Example and DCInside MCPs. Unverified
registry entries are metadata-only, and the UI cannot change their command, arguments, or path.

## Cloudflare checks

After an upgrade, verify both the local origin and public route:

```bash
curl --fail http://127.0.0.1:44173/api/healthz
curl --fail https://mcp-dashboard.mangagaki.net/api/healthz
```

The root page should open the Console without a login screen. A Cloudflare `502` means the tunnel
and DNS are working but Caddy cannot reach the loopback origin; check the Console container and the
Caddy route before changing DNS. Neither Cloudflare Access nor application login is enabled for
this hostname.
