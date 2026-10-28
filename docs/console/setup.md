# Console setup

## Clean clone

Use Node.js 22.12 or newer and the pinned pnpm 12.9.1 release:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
cp .env.console.example .env.console
chmod 0600 .env.console
pnpm console:hash-password
```

Paste only the generated Argon2id PHC value after `CONSOLE_ADMIN_PASSWORD_HASH=` in the
untracked `.env.console`. Do not put the plaintext password in that file or in shell history.
The public Mac mini deployment is the explicit exception: it sets `CONSOLE_AUTH_MODE=disabled`
and leaves the hash blank.

## Local development

```bash
pnpm console:dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the Fastify process on loopback port 3000.
The helper builds the Console client and the two supported MCP entrypoints before starting watch
mode. Registry commands remain deployment-controlled and cannot be supplied by the browser.

## Production deployment

Follow [operations](operations.md) for the single-container Mac mini deployment. Its browser URL
is `https://mcp-dashboard.mangagaki.net`; the private host-origin check is
`http://127.0.0.1:44173`. The compiled SPA and API share the public HTTPS origin.

Inspect **Example** and call `echo` with `{"message":"hello"}`. Then inspect **DCInside** and call
`dc_parse_post_url`. The parse tool is offline and does not require a Brave key. Google Routes and
Japanese Vocabulary intentionally remain visible but unverified.
