import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConnectionManager } from './connection-manager.js';
import { loadRegistry } from './registry.js';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

describe('ConnectionManager stdio integration', () => {
  let manager: ConnectionManager;

  beforeEach(async () => {
    const registry = await loadRegistry({
      registryPath: 'config/mcp-registry.json',
      runtimeRoot: repositoryRoot,
    });
    manager = new ConnectionManager(registry, { healthIntervalMs: 0, backoffBaseMs: 1 });
  });

  afterEach(async () => {
    await manager?.stopAll();
  });

  it('shares one child across concurrent inspection and invokes echo', async () => {
    const inspections = await Promise.all(
      Array.from({ length: 20 }, () => manager.inspect('example')),
    );
    expect(inspections.every(({ status }) => status.runtimeState === 'ready')).toBe(true);
    expect(new Set(inspections.map(({ status }) => status.pid)).size).toBe(1);
    expect(inspections[0]?.tools.map(({ name }) => name)).toEqual(['echo']);

    const result = await manager.callTool(
      'example',
      'echo',
      { message: 'hello from console' },
      { requestId: 'request-echo' },
    );
    expect(result).toMatchObject({ requestId: 'request-echo', status: 'success' });
    expect(result.content).toContainEqual({ type: 'text', text: 'hello from console' });
    expect(manager.getStderr('example').some(({ text }) => text.includes('jsonrpc'))).toBe(false);
  });

  it('discovers the extended DCInside tools and parses a URL without a Brave key', async () => {
    const previousKey = process.env.BRAVE_SEARCH_API_KEY;
    delete process.env.BRAVE_SEARCH_API_KEY;
    try {
      const inspection = await manager.inspect('dcinside');
      expect(inspection.tools.map(({ name }) => name).sort()).toEqual([
        'dc_get_comments',
        'dc_get_post',
        'dc_get_post_with_comments',
        'dc_import_post',
        'dc_import_post_html',
        'dc_import_search_results',
        'dc_list_gallery_posts',
        'dc_parse_post_url',
        'dc_search_posts',
      ]);

      const result = await manager.callTool(
        'dcinside',
        'dc_parse_post_url',
        { url: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=00123&page=2' },
        { requestId: 'request-dcinside' },
      );
      expect(result.status).toBe('success');
      expect(result.structuredContent).toMatchObject({
        valid: true,
        galleryId: 'japan',
        postNo: '123',
      });

      const search = await manager.callTool(
        'dcinside',
        'dc_search_posts',
        { query: 'offline configuration check', source: 'brave' },
        { requestId: 'request-search-without-key' },
      );
      expect(search.status).toBe('tool_error');
      expect(search.structuredContent).toMatchObject({ code: 'CONFIGURATION_REQUIRED' });
    } finally {
      if (previousKey === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
      else process.env.BRAVE_SEARCH_API_KEY = previousKey;
    }
  });

  it('blocks unverified servers and unknown tools without launching them', async () => {
    await expect(manager.inspect('google-routes')).rejects.toMatchObject({
      code: 'NOT_VERIFIED',
    });
    expect(manager.getStatus('google-routes')).toMatchObject({
      runtimeState: 'not_started',
      health: 'unknown',
      pid: null,
    });

    await expect(
      manager.callTool('example', 'missing', {}, { requestId: 'request-missing' }),
    ).rejects.toMatchObject({ code: 'MCP_TOOL_NOT_FOUND' });
  });

  it('rejects new work after shutdown and leaves no active child PID', async () => {
    await manager.inspect('example');
    const pid = manager.getStatus('example').pid;
    await manager.stopAll();
    expect(manager.getStatus('example')).toMatchObject({
      runtimeState: 'disconnected',
      pid: null,
    });
    expect(pid).not.toBeNull();
    expect(() => process.kill(pid!, 0)).toThrow();
    await expect(manager.inspect('example')).rejects.toMatchObject({
      code: 'MCP_SHUTTING_DOWN',
    });
  });

  it('reports a missing compiled entrypoint as BUILD_REQUIRED', async () => {
    await manager.stopAll();
    const root = await mkdtemp(join(tmpdir(), 'mymcp-manager-missing-'));
    try {
      await mkdir(join(root, 'config'));
      await mkdir(join(root, 'apps/missing/dist'), { recursive: true });
      await writeFile(
        join(root, 'config/registry.json'),
        JSON.stringify({
          version: 1,
          servers: [
            {
              id: 'missing',
              displayName: 'Missing build',
              description: 'Fixture with no compiled entrypoint',
              catalogState: 'supported',
              transport: 'stdio',
              command: 'node',
              args: ['apps/missing/dist/index.js'],
              cwd: 'apps/missing',
              requiredBuildPackage: '@mymcp/missing',
              permittedEnvironmentKeys: [],
              launchByDefault: false,
            },
          ],
        }),
      );
      const registry = await loadRegistry({
        registryPath: 'config/registry.json',
        runtimeRoot: root,
      });
      manager = new ConnectionManager(registry, { healthIntervalMs: 0 });
      await expect(manager.inspect('missing')).rejects.toMatchObject({ code: 'BUILD_REQUIRED' });
      expect(manager.getStatus('missing')).toMatchObject({
        runtimeState: 'error',
        lastErrorCode: 'BUILD_REQUIRED',
      });
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('times out an incompatible stdio process and cleans it up', async () => {
    await manager.stopAll();
    const registry = await loadRegistry({
      registryPath: 'packages/mcp-client/test-fixtures/hanging-registry.json',
      runtimeRoot: repositoryRoot,
    });
    manager = new ConnectionManager(registry, {
      connectTimeoutMs: 50,
      healthIntervalMs: 0,
      backoffBaseMs: 1,
    });

    await expect(manager.inspect('hanging')).rejects.toMatchObject({ code: 'MCP_TIMEOUT' });
    expect(manager.getStatus('hanging')).toMatchObject({
      runtimeState: 'error',
      pid: null,
      lastErrorCode: 'MCP_TIMEOUT',
    });
  });
});
