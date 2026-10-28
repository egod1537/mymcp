import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionManager, loadRegistry, McpClientError } from '@mymcp/mcp-client';

import { createApp } from '../src/app.js';
import { DisabledAuthProvider } from '../src/auth/disabled-auth.js';
import { SqliteObservabilityStore } from '../src/observability/sqlite-store.js';
import { SqliteSavedTestStore } from '../src/saved-tests/sqlite-store.js';
import type { AuthProvider, AuthSession, McpManager } from '../src/types.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const origin = 'http://console.test';

class FakeAuth implements AuthProvider {
  readonly #sessions = new Map<string, AuthSession>();

  isConfigured(): boolean {
    return true;
  }

  async login(password: string): Promise<AuthSession | null> {
    if (password !== 'correct-password') return null;
    const session = {
      id: 'test-session',
      csrfToken: 'test-csrf-token-1234567890',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    this.#sessions.set(session.id, session);
    return session;
  }

  async getSession(sessionId: string): Promise<AuthSession | null> {
    return this.#sessions.get(sessionId) ?? null;
  }

  async logout(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }
}

describe('Console API', () => {
  let app: FastifyInstance;
  let cookie: string;
  let csrfToken: string;
  let observability: SqliteObservabilityStore;

  beforeEach(async () => {
    const registry = await loadRegistry({
      registryPath: 'config/mcp-registry.json',
      runtimeRoot: repositoryRoot,
    });
    const manager = new ConnectionManager(registry, { healthIntervalMs: 0, backoffBaseMs: 1 });
    observability = new SqliteObservabilityStore({ database: new DatabaseSync(':memory:') });
    const testCases = new SqliteSavedTestStore({ database: new DatabaseSync(':memory:') });
    app = await createApp({
      auth: new FakeAuth(),
      manager,
      observability,
      testCases,
      allowedOrigin: origin,
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { password: 'correct-password' },
    });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('SameSite=Strict');
    const setCookie = login.headers['set-cookie']!;
    cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    csrfToken = login.json<{ csrfToken: string }>().csrfToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps health minimal and protects authenticated routes', async () => {
    const health = await app.inject({ method: 'GET', url: '/api/healthz' });
    expect(health.json()).toEqual({ apiVersion: 1, alive: true });
    expect(health.body).not.toContain('server');
    expect(health.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(health.headers['x-content-type-options']).toBe('nosniff');

    const unauthorized = await app.inject({ method: 'GET', url: '/api/servers' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });

    const authorized = await app.inject({
      method: 'GET',
      url: '/api/servers',
      headers: { cookie },
    });
    expect(authorized.statusCode).toBe(200);
    const servers = authorized.json<{
      servers: Array<{ id: string; runtimeState: string; health: string; toolCount?: number }>;
    }>().servers;
    expect(servers).toHaveLength(4);
    expect(servers.find(({ id }) => id === 'example')).toMatchObject({
      runtimeState: 'ready',
      health: 'ok',
      toolCount: 1,
    });
    expect(servers.find(({ id }) => id === 'dcinside')).toMatchObject({
      runtimeState: 'ready',
      health: 'ok',
      toolCount: 9,
    });
    expect(authorized.headers['cache-control']).toBe('no-store');
  });

  it('requires CSRF and never spawns from a cache-only GET', async () => {
    const beforeInspect = await app.inject({
      method: 'GET',
      url: '/api/servers/example/tools',
      headers: { cookie },
    });
    expect(beforeInspect.statusCode).toBe(409);
    expect(beforeInspect.json()).toMatchObject({ error: { code: 'NOT_INSPECTED' } });

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/servers/example/inspect',
      headers: { cookie, origin },
      payload: {},
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });

    const wrongOrigin = await app.inject({
      method: 'POST',
      url: '/api/servers/example/inspect',
      headers: { cookie, origin: 'https://evil.example', 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(wrongOrigin.statusCode).toBe(403);
    expect(wrongOrigin.json()).toMatchObject({ error: { code: 'ORIGIN_FORBIDDEN' } });
  });

  it('rate limits repeated login attempts with a typed 429 response', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { password: 'wrong-password' },
      });
      expect(response.statusCode).toBe(401);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { password: 'wrong-password' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({
      error: { code: 'TOO_MANY_REQUESTS', retryable: true },
    });
  });

  it('inspects and calls echo with discovered-schema validation', async () => {
    const inspect = await app.inject({
      method: 'POST',
      url: '/api/servers/example/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(inspect.statusCode).toBe(200);
    expect(
      inspect.json<{ tools: Array<{ name: string }> }>().tools.map(({ name }) => name),
    ).toEqual(['echo']);

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/servers/example/tools/echo/call',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: { arguments: {} },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'INVALID_ARGUMENTS' } });

    const html = '<img src=x onerror=alert(1)>';
    const called = await app.inject({
      method: 'POST',
      url: '/api/servers/example/tools/echo/call',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: { arguments: { message: html } },
    });
    expect(called.statusCode).toBe(200);
    expect(called.headers['content-type']).toMatch(/^application\/json/u);
    expect(called.json()).toMatchObject({
      outcome: 'success',
      isError: false,
      content: [{ type: 'text', text: html }],
    });
    const recorded = await observability.listEvents({
      serverId: 'example',
      toolName: 'echo',
      outcome: 'success',
      limit: 50,
    });
    expect(recorded.events).toHaveLength(1);
    expect(recorded.events[0]).toMatchObject({
      serverId: 'example',
      toolName: 'echo',
      outcome: 'success',
    });
    expect(JSON.stringify(recorded.events)).not.toContain(html);
  });

  it('returns MCP tool failures as HTTP 200 and requires write confirmation', async () => {
    const inspect = await app.inject({
      method: 'POST',
      url: '/api/servers/dcinside/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(inspect.statusCode).toBe(200);

    const toolError = await app.inject({
      method: 'POST',
      url: '/api/servers/dcinside/tools/dc_parse_post_url/call',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: { arguments: { url: 'https://example.com/not-allowed' } },
    });
    expect(toolError.statusCode).toBe(200);
    expect(toolError.json()).toMatchObject({ outcome: 'tool_error', isError: true });

    const write = await app.inject({
      method: 'POST',
      url: '/api/servers/dcinside/tools/dc_import_post/call',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        arguments: {
          url: 'https://gall.dcinside.com/board/view/?id=test&no=1',
          title: 'not executed',
          bodyText: 'not executed',
        },
      },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json()).toMatchObject({ error: { code: 'WRITE_CONFIRMATION_REQUIRED' } });
  });

  it('returns typed 404 errors for unknown registry IDs and tools', async () => {
    const server = await app.inject({
      method: 'GET',
      url: '/api/servers/not-registered',
      headers: { cookie },
    });
    expect(server.statusCode).toBe(404);
    expect(server.json()).toMatchObject({ error: { code: 'SERVER_NOT_FOUND' } });

    await app.inject({
      method: 'POST',
      url: '/api/servers/example/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    const tool = await app.inject({
      method: 'POST',
      url: '/api/servers/example/tools/not-a-tool/call',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: { arguments: {} },
    });
    expect(tool.statusCode).toBe(404);
    expect(tool.json()).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
  });

  it('returns 409 for an unverified server without starting a process', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/servers/google-routes/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_SUPPORTED' } });

    const detail = await app.inject({
      method: 'GET',
      url: '/api/servers/google-routes',
      headers: { cookie },
    });
    expect(detail.json()).toMatchObject({
      server: { runtimeState: 'not_started', pid: null },
    });
  });

  it('exposes configured environment presence without exposing the secret value', async () => {
    const previous = process.env.BRAVE_SEARCH_API_KEY;
    process.env.BRAVE_SEARCH_API_KEY = 'brave-secret-must-not-leak';
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/servers/dcinside',
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        server: { environmentPresence: { BRAVE_SEARCH_API_KEY: true } },
      });
      expect(response.body).not.toContain('brave-secret-must-not-leak');
    } finally {
      if (previous === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
      else process.env.BRAVE_SEARCH_API_KEY = previous;
    }
  });

  it('saves and reruns synthetic assertions without persisting secrets', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/servers/example/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    const created = await app.inject({
      method: 'POST',
      url: '/api/test-cases',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        name: 'Echo hello',
        description: 'Synthetic deterministic echo',
        serverId: 'example',
        toolName: 'echo',
        arguments: { message: 'hello saved test' },
        expectedIsError: false,
        assertions: [{ path: '', op: 'contains', expected: 'hello saved test' }],
        source: 'synthetic',
      },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json<{ testCase: { id: string } }>().testCase.id;

    for (let run = 0; run < 3; run += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/test-cases/${id}/run`,
        headers: { cookie, origin, 'x-csrf-token': csrfToken },
        payload: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ result: { status: 'passed' } });
    }

    const list = await app.inject({
      method: 'GET',
      url: '/api/test-cases',
      headers: { cookie },
    });
    expect(list.json()).toMatchObject({
      testCases: [{ id, latestResult: { status: 'passed' } }],
    });
    expect(list.body).not.toContain('request arguments are never automatically saved');

    const denied = await app.inject({
      method: 'POST',
      url: '/api/test-cases',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        name: 'Must be denied',
        serverId: 'example',
        toolName: 'echo',
        arguments: { message: 'Bearer secret-test-value' },
      },
    });
    expect(denied.statusCode).toBe(400);
    expect(denied.json()).toMatchObject({
      error: { code: 'SENSITIVE_ARGUMENTS_DENIED' },
    });
  });

  it('treats NOT_IMPORTED as data and skips write tests without opt-in', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/servers/dcinside/inspect',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    const parseCase = await app.inject({
      method: 'POST',
      url: '/api/test-cases',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        name: 'Offline URL parse',
        serverId: 'dcinside',
        toolName: 'dc_parse_post_url',
        arguments: {
          url: 'https://gall.dcinside.com/board/view/?id=savedtest&no=123456',
        },
        expectedIsError: false,
        assertions: [{ path: '/valid', op: 'equals', expected: true }],
      },
    });
    const parseId = parseCase.json<{ testCase: { id: string } }>().testCase.id;
    const parseRun = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${parseId}/run`,
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(parseRun.json()).toMatchObject({ result: { status: 'passed' } });

    const readCase = await app.inject({
      method: 'POST',
      url: '/api/test-cases',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        name: 'Missing local post is expected data',
        serverId: 'dcinside',
        toolName: 'dc_get_post',
        arguments: {
          url: 'https://gall.dcinside.com/board/view/?id=savedtest&no=987654321',
        },
        expectedIsError: false,
        assertions: [{ path: '/reason', op: 'equals', expected: 'NOT_IMPORTED' }],
      },
    });
    const readId = readCase.json<{ testCase: { id: string } }>().testCase.id;
    const readRun = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${readId}/run`,
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(readRun.json()).toMatchObject({ result: { status: 'passed' } });

    const writeCase = await app.inject({
      method: 'POST',
      url: '/api/test-cases',
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {
        name: 'Write case',
        serverId: 'dcinside',
        toolName: 'dc_import_post',
        arguments: {
          url: 'https://gall.dcinside.com/board/view/?id=savedtest&no=987654322',
          title: 'Synthetic title',
          bodyText: 'Synthetic body',
        },
      },
    });
    const writeId = writeCase.json<{ testCase: { id: string } }>().testCase.id;
    const skipped = await app.inject({
      method: 'POST',
      url: `/api/test-cases/${writeId}/run`,
      headers: { cookie, origin, 'x-csrf-token': csrfToken },
      payload: {},
    });
    expect(skipped.json()).toMatchObject({
      result: { status: 'skipped', reason: expect.stringContaining('opt-in') },
    });
  });
});

function fakeManager(call: McpManager['callTool']): McpManager {
  const status = {
    id: 'fixture',
    runtimeState: 'ready' as const,
    credentialState: 'not_required' as const,
    health: 'ok' as const,
    lastCheckedAt: '2026-10-28T00:00:00.000Z',
    lastErrorCode: null,
    lastErrorMessage: null,
    uptimeSince: '2026-10-28T00:00:00.000Z',
    pid: 123,
    nextRetryAt: null,
  };
  const tools = [
    {
      name: 'fixture-tool',
      description: 'Fixture tool',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        additionalProperties: false,
        $schema: 'https://json-schema.org/draft/2020-12/schema',
      },
    },
  ];
  return {
    listRegistry: () => [
      {
        id: 'fixture',
        displayName: 'Fixture',
        description: 'Fixture MCP',
        catalogState: 'supported',
        transport: 'stdio',
        command: 'node',
        args: ['apps/example/dist/index.js'],
        cwd: 'apps/example',
        requiredBuildPackage: '@mymcp/example',
        permittedEnvironmentKeys: [],
        supportsWriteTools: false,
        launchByDefault: false,
      },
    ],
    getStatus: () => status,
    getCachedTools: () => tools,
    getStderr: () => [],
    inspect: async () => ({ status, tools }),
    callTool: call,
    stopAll: async () => undefined,
  };
}

describe('Console API result boundaries', () => {
  async function authenticatedApp(manager: McpManager): Promise<{
    app: FastifyInstance;
    headers: Record<string, string>;
  }> {
    const app = await createApp({ auth: new FakeAuth(), manager, allowedOrigin: origin });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin },
      payload: { password: 'correct-password' },
    });
    const setCookie = login.headers['set-cookie']!;
    const cookie = (Array.isArray(setCookie) ? setCookie[0]! : setCookie).split(';', 1)[0]!;
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;
    return { app, headers: { cookie, origin, 'x-csrf-token': csrfToken } };
  }

  it('supports explicitly disabled authentication while retaining Origin and CSRF checks', async () => {
    const app = await createApp({
      auth: new DisabledAuthProvider(),
      manager: fakeManager(async () => {
        throw new Error('must not run');
      }),
      allowedOrigin: origin,
    });
    try {
      const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
      expect(session.statusCode).toBe(200);
      expect(session.headers['set-cookie']).toBeUndefined();
      expect(session.json()).toMatchObject({
        authenticated: true,
        authMode: 'disabled',
      });
      const csrfToken = session.json<{ csrfToken: string }>().csrfToken;

      const servers = await app.inject({ method: 'GET', url: '/api/servers' });
      expect(servers.statusCode).toBe(200);

      const noCsrf = await app.inject({
        method: 'POST',
        url: '/api/servers/fixture/inspect',
        headers: { origin },
        payload: {},
      });
      expect(noCsrf.statusCode).toBe(403);
      expect(noCsrf.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });

      const wrongOrigin = await app.inject({
        method: 'POST',
        url: '/api/servers/fixture/inspect',
        headers: { origin: 'https://evil.example', 'x-csrf-token': csrfToken },
        payload: {},
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json()).toMatchObject({ error: { code: 'ORIGIN_FORBIDDEN' } });

      const inspect = await app.inject({
        method: 'POST',
        url: '/api/servers/fixture/inspect',
        headers: { origin, 'x-csrf-token': csrfToken },
        payload: {},
      });
      expect(inspect.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('returns a bounded valid JSON marker for oversized MCP results', async () => {
    const manager = fakeManager(async (_id, _tool, _args, options) => ({
      requestId: options.requestId,
      status: 'success',
      durationMs: 1,
      content: [{ type: 'text', text: 'x'.repeat(3 * 1024 * 1024) }],
    }));
    const { app, headers } = await authenticatedApp(manager);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/servers/fixture/tools/fixture-tool/call',
        headers,
        payload: { arguments: {} },
      });
      expect(response.statusCode).toBe(200);
      expect(Buffer.byteLength(response.body, 'utf8')).toBeLessThan(2 * 1024 * 1024);
      expect(response.json()).toMatchObject({ truncated: true, outcome: 'success' });
    } finally {
      await app.close();
    }
  });

  it('maps an MCP timeout to a typed 504 response', async () => {
    const manager = fakeManager(async () => {
      throw new McpClientError('MCP_TIMEOUT', 'fixture timed out');
    });
    const { app, headers } = await authenticatedApp(manager);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/servers/fixture/tools/fixture-tool/call',
        headers,
        payload: { arguments: {} },
      });
      expect(response.statusCode).toBe(504);
      expect(response.json()).toMatchObject({
        error: { code: 'MCP_TIMEOUT', retryable: true },
      });
    } finally {
      await app.close();
    }
  });

  it('fails closed when the admin password hash is not configured', async () => {
    const auth: AuthProvider = {
      isConfigured: () => false,
      login: async () => null,
      getSession: async () => null,
      logout: async () => undefined,
    };
    const app = await createApp({
      auth,
      manager: fakeManager(async () => {
        throw new Error('must not run');
      }),
      allowedOrigin: origin,
    });
    try {
      const session = await app.inject({ method: 'GET', url: '/api/auth/session' });
      expect(session.json()).toEqual({
        apiVersion: 1,
        authenticated: false,
        setupRequired: true,
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { origin },
        payload: { password: 'anything' },
      });
      expect(login.statusCode).toBe(503);
      expect(login.json()).toMatchObject({ error: { code: 'AUTH_NOT_CONFIGURED' } });
    } finally {
      await app.close();
    }
  });

  it('rate-limits repeated login attempts', async () => {
    const app = await createApp({
      auth: new FakeAuth(),
      manager: fakeManager(async () => {
        throw new Error('must not run');
      }),
      allowedOrigin: origin,
    });
    try {
      const responses = [];
      for (let index = 0; index < 6; index += 1) {
        responses.push(
          await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            headers: { origin },
            payload: { password: 'wrong-password' },
          }),
        );
      }
      expect(responses.slice(0, 5).every(({ statusCode }) => statusCode === 401)).toBe(true);
      expect(responses[5]?.statusCode).toBe(429);
      expect(responses[5]?.json()).toMatchObject({ error: { code: 'TOO_MANY_REQUESTS' } });
    } finally {
      await app.close();
    }
  });
});
