import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionManager, loadRegistry } from '@mymcp/mcp-client';
import { config as loadEnv } from 'dotenv';

import { createApp } from './app.js';
import { DisabledAuthProvider } from './auth/disabled-auth.js';
import { createSqliteAuthProvider } from './auth/sqlite-auth.js';
import { createSqliteObservabilityStore } from './observability/sqlite-store.js';
import { createSqliteSavedTestStore } from './saved-tests/sqlite-store.js';

const defaultRuntimeRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
loadEnv({ path: resolve(defaultRuntimeRoot, '.env.console'), quiet: true });
const runtimeRoot = process.env.CONSOLE_RUNTIME_ROOT ?? defaultRuntimeRoot;
const dataDirectory = process.env.CONSOLE_DATA_DIR ?? resolve(runtimeRoot, 'data');
const databasePath = process.env.CONSOLE_DB_PATH ?? resolve(dataDirectory, 'console.sqlite');
const host = process.env.CONSOLE_HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.CONSOLE_PORT ?? '3000', 10);
const allowedOrigin = process.env.CONSOLE_ALLOWED_ORIGIN ?? `http://${host}:${port}`;
const authMode = process.env.CONSOLE_AUTH_MODE ?? 'password';
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error('CONSOLE_PORT must be an integer from 1 to 65535');
}
if (authMode !== 'password' && authMode !== 'disabled') {
  throw new Error('CONSOLE_AUTH_MODE must be password or disabled');
}
if (authMode === 'disabled' && !allowedOrigin.startsWith('https://')) {
  throw new Error('Disabled authentication requires an HTTPS CONSOLE_ALLOWED_ORIGIN');
}
if (
  !loopbackHosts.has(host) &&
  !allowedOrigin.startsWith('https://') &&
  process.env.CONSOLE_CONTAINER_LOOPBACK_ONLY !== 'true'
) {
  throw new Error('Non-loopback CONSOLE_HOST requires an HTTPS CONSOLE_ALLOWED_ORIGIN');
}

const registry = await loadRegistry({
  registryPath: process.env.CONSOLE_REGISTRY_PATH ?? 'config/mcp-registry.json',
  runtimeRoot,
});
const manager = new ConnectionManager(registry);
const auth =
  authMode === 'disabled'
    ? new DisabledAuthProvider()
    : await createSqliteAuthProvider({
        databasePath,
        passwordHash: process.env.CONSOLE_ADMIN_PASSWORD_HASH,
      });
const observability = await createSqliteObservabilityStore({ databasePath });
const testCases = await createSqliteSavedTestStore({ databasePath });
manager.onStatus((status) => {
  if (!status.lastCheckedAt) return;
  void observability.recordHealth({
    serverId: status.id,
    checkedAt: status.lastCheckedAt,
    runtimeState: status.runtimeState,
    errorCode: status.lastErrorCode,
  });
});
const app = await createApp({
  auth,
  manager,
  allowedOrigin,
  secureCookies:
    process.env.CONSOLE_SECURE_COOKIES === 'true' || allowedOrigin.startsWith('https://'),
  logger: true,
  observability,
  testCases,
  securityAudit: observability,
  ...(process.env.CONSOLE_WEB_ROOT ? { webRoot: process.env.CONSOLE_WEB_ROOT } : {}),
});

let closing = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'Shutting down Console server');
  await app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error, 'Console server failed to start');
  await app.close();
  process.exitCode = 1;
}
