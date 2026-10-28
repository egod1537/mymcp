import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config.js';
import { createGoogleMapsServer } from '../src/server.js';
import type { LocationResolver } from '../src/tools/resolve-location.js';
import type { RouteGetter } from '../src/tools/get-route.js';

function dependencies(): {
  locationResolver: LocationResolver;
  routeGetter: RouteGetter;
} {
  return {
    locationResolver: {
      resolve: vi.fn<LocationResolver['resolve']>().mockResolvedValue({
        status: 'no_results',
        query: 'mock',
        query_type: 'place',
        source: 'google_places_text_search',
        candidates: [],
        needs_disambiguation: false,
        attribution: 'Google Maps',
      }),
    },
    routeGetter: {
      getRoute: vi.fn<RouteGetter['getRoute']>().mockResolvedValue({
        status: 'no_route',
        mode: 'WALK',
        origin: { type: 'place_id', place_id: 'mock-origin' },
        destination: { type: 'place_id', place_id: 'mock-destination' },
        requested_departure_time: null,
        requested_arrival_time: null,
        routes: [],
        fallback_info: null,
        attribution: 'Google Maps',
      }),
    },
  };
}

describe('Google Maps MCP server', () => {
  it('initializes, lists exactly two tools, and invokes a tool in memory', async () => {
    const server = createGoogleMapsServer(dependencies());
    const client = new Client({ name: 'google-maps-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name).sort()).toEqual([
        'get_route',
        'resolve_location',
      ]);

      const result = await client.callTool({
        name: 'resolve_location',
        arguments: { query: 'mock' },
      });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content[0];
      expect(text).toMatchObject({ type: 'text' });
      if (text?.type === 'text' && text.text !== undefined) {
        expect(JSON.parse(text.text)).toMatchObject({
          status: 'no_results',
          attribution: 'Google Maps',
        });
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('initializes and lists exactly two tools over a spawned stdio process', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/mock-stdio-server.ts', import.meta.url));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fixture],
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'stdio-test-client', version: '1.0.0' });
    await client.connect(transport);

    try {
      const listed = await client.listTools();
      expect(listed.tools.map(({ name }) => name).sort()).toEqual([
        'get_route',
        'resolve_location',
      ]);
    } finally {
      await client.close();
    }
  });
});

describe('live startup configuration', () => {
  it('validates safe environment ranges and never returns the live-test switch as runtime config', () => {
    expect(
      loadConfig({
        GOOGLE_MAPS_API_KEY: 'private-test-key',
        GOOGLE_MAPS_HTTP_TIMEOUT_MS: '8000',
        GOOGLE_MAPS_MAX_RETRIES: '2',
        GOOGLE_MAPS_CALLS_PER_MINUTE: '30',
        GOOGLE_MAPS_MAX_CONCURRENT_CALLS: '2',
        LOG_LEVEL: 'warn',
        GOOGLE_MAPS_LIVE_TESTS: '0',
      }),
    ).toEqual({
      apiKey: 'private-test-key',
      httpTimeoutMs: 8000,
      maxRetries: 2,
      callsPerMinute: 30,
      maxConcurrentCalls: 2,
      logLevel: 'warn',
      liveTestsEnabled: false,
    });
    expect(() =>
      loadConfig({ GOOGLE_MAPS_API_KEY: 'x', GOOGLE_MAPS_HTTP_TIMEOUT_MS: '8001' }),
    ).toThrowError(/GOOGLE_MAPS_HTTP_TIMEOUT_MS/);
    expect(() =>
      loadConfig({ GOOGLE_MAPS_API_KEY: 'x', GOOGLE_MAPS_LIVE_TESTS: '2' }),
    ).toThrowError(/GOOGLE_MAPS_LIVE_TESTS/);
  });

  it('exits nonzero with useful stderr and empty stdout when the key is missing', async () => {
    const entrypoint = fileURLToPath(new URL('../src/index.ts', import.meta.url));
    const childEnvironment = { ...process.env };
    delete childEnvironment.GOOGLE_MAPS_API_KEY;

    const result = await new Promise<{ code: number | null; stderr: string; stdout: string }>(
      (resolveResult, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: childEnvironment,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => resolveResult({ code, stderr, stdout }));
      },
    );

    expect(result.code).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('CONFIG_MISSING');
    expect(result.stderr).toContain('GOOGLE_MAPS_API_KEY is required');
  });
});
