import { describe, expect, it } from 'vitest';

import worker, { type GoogleMapsWorkerEnv } from '../src/worker.js';

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

function env(overrides: Partial<GoogleMapsWorkerEnv> = {}): GoogleMapsWorkerEnv {
  return {
    GOOGLE_MAPS_API_KEY: 'test-key',
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

describe('Cloudflare Worker entrypoint', () => {
  it('reports whether its required secret is configured', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-route.mangagaki.net/healthz'),
      env({ GOOGLE_MAPS_API_KEY: '' }),
      executionContext,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'misconfigured',
      service: '@mymcp/google-maps',
    });
  });

  it('rejects unknown paths', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-route.mangagaki.net/unknown'),
      env(),
      executionContext,
    );

    expect(response.status).toBe(404);
  });

  it('enforces the Cloudflare rate-limit binding before MCP dispatch', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-route.mangagaki.net/mcp', { method: 'POST' }),
      env({ MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } }),
      executionContext,
    );

    expect(response.status).toBe(429);
  });

  it('serves the two tools over Streamable HTTP', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-route.mangagaki.net/mcp', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }),
      env(),
      executionContext,
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('resolve_location');
    expect(body).toContain('get_route');
  });
});
