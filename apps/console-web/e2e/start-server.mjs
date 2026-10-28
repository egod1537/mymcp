import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const e2eRoot = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(e2eRoot, '../../..');
const dataDirectory = await mkdtemp(join(tmpdir(), 'mymcp-console-e2e-'));
const passwordModule = pathToFileURL(
  resolve(runtimeRoot, 'apps/console-server/dist/auth/password.js'),
).href;
const { hashPassword } = await import(passwordModule);
const passwordHash = await hashPassword('console-e2e-password');
const serverEntrypoint = resolve(runtimeRoot, 'apps/console-server/dist/main.js');

const child = spawn(process.execPath, [serverEntrypoint], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    CONSOLE_HOST: '127.0.0.1',
    CONSOLE_PORT: '44174',
    CONSOLE_ALLOWED_ORIGIN: 'http://127.0.0.1:44174',
    CONSOLE_SECURE_COOKIES: 'false',
    CONSOLE_DATA_DIR: dataDirectory,
    CONSOLE_RUNTIME_ROOT: runtimeRoot,
    CONSOLE_REGISTRY_PATH: 'config/mcp-registry.json',
    CONSOLE_WEB_ROOT: resolve(runtimeRoot, 'apps/console-web/dist'),
    CONSOLE_AUTH_MODE: 'password',
    CONSOLE_ADMIN_PASSWORD_HASH: passwordHash,
    DCINSIDE_DATA_DIR: resolve(dataDirectory, 'dcinside'),
    BRAVE_SEARCH_API_KEY: '',
  },
  stdio: 'inherit',
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

const exit = await new Promise((resolveExit) => {
  child.once('exit', (code, signal) => resolveExit({ code, signal }));
  child.once('error', (error) => resolveExit({ code: 1, error }));
});
await rm(dataDirectory, { force: true, recursive: true });

if ('error' in exit) throw exit.error;
if (!stopping && exit.code !== 0) {
  throw new Error(`Console E2E server exited unexpectedly (${exit.code ?? exit.signal})`);
}
