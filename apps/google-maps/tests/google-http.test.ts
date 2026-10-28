import { describe, expect, it, vi } from 'vitest';

import { FetchGoogleHttpClient } from '../src/clients/google-http.js';
import type { AppConfig } from '../src/config.js';
import { toPublicError } from '../src/lib/errors.js';

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    apiKey: 'test-secret-api-key',
    httpTimeoutMs: 100,
    maxRetries: 0,
    callsPerMinute: 30,
    maxConcurrentCalls: 2,
    logLevel: 'error',
    liveTestsEnabled: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('FetchGoogleHttpClient', () => {
  it('uses the fixed Places endpoint and centrally injects the key and JSON headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ places: [] }));
    const client = new FetchGoogleHttpClient(config(), { fetch: fetchMock });

    await client.postJson('placesTextSearch', {
      headers: { 'X-Goog-FieldMask': 'places.id' },
      body: { textQuery: '東京駅' },
    });

    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(request?.method).toBe('POST');
    expect(request?.redirect).toBe('manual');
    const headers = new Headers(request?.headers);
    expect(headers.get('X-Goog-Api-Key')).toBe('test-secret-api-key');
    expect(headers.get('X-Goog-FieldMask')).toBe('places.id');
    expect(request?.body).toBe(JSON.stringify({ textQuery: '東京駅' }));
  });

  it('URL-encodes Geocoding query values and injects the key query parameter', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
    const client = new FetchGoogleHttpClient(config(), { fetch: fetchMock });

    await client.getJson('geocoding', {
      query: { address: '서울 특별시 & 1', language: 'ko' },
    });

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.origin + calledUrl.pathname).toBe(
      'https://maps.googleapis.com/maps/api/geocode/json',
    );
    expect(calledUrl.searchParams.get('address')).toBe('서울 특별시 & 1');
    expect(calledUrl.searchParams.get('key')).toBe('test-secret-api-key');
  });

  it.each([
    [401, 'UNAUTHENTICATED', 'UPSTREAM_PERMISSION_DENIED'],
    [403, 'PERMISSION_DENIED', 'UPSTREAM_PERMISSION_DENIED'],
    [429, 'RESOURCE_EXHAUSTED', 'UPSTREAM_QUOTA_EXCEEDED'],
    [500, 'INTERNAL', 'UPSTREAM_UNAVAILABLE'],
  ])(
    'maps HTTP %i / %s without exposing the upstream payload',
    async (status, googleStatus, code) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse(
          {
            error: {
              status: googleStatus,
              message: 'the rejected key was test-secret-api-key',
            },
          },
          { status },
        ),
      );
      const client = new FetchGoogleHttpClient(config(), { fetch: fetchMock });

      try {
        await client.postJson('computeRoutes', { body: {} });
        throw new Error('expected request to fail');
      } catch (error) {
        const publicError = toPublicError(error);
        expect(publicError.error.code).toBe(code);
        expect(JSON.stringify(publicError)).not.toContain('test-secret-api-key');
      }
    },
  );

  it('retries only bounded transient failures and caps Retry-After waits', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { status: 'UNAVAILABLE' } },
          { status: 503, headers: { 'retry-after': '30' } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ routes: [] }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const client = new FetchGoogleHttpClient(config({ maxRetries: 2 }), {
      fetch: fetchMock,
      sleep,
      random: () => 0,
    });

    await expect(client.postJson('computeRoutes', { body: {} })).resolves.toEqual({ routes: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('retries a Geocoding UNKNOWN_ERROR body when requested', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'UNKNOWN_ERROR' }))
      .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));
    const sleep = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue();
    const client = new FetchGoogleHttpClient(config({ maxRetries: 1 }), {
      fetch: fetchMock,
      sleep,
      random: () => 0,
    });

    const result = await client.getJson('geocoding', {
      query: { address: 'mock' },
      retryOnJsonStatuses: ['UNKNOWN_ERROR'],
    });

    expect(result).toEqual({ status: 'ZERO_RESULTS', results: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns TIMEOUT after aborting a bounded request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const client = new FetchGoogleHttpClient(config({ httpTimeoutMs: 100 }), {
      fetch: fetchMock,
    });

    await expect(client.postJson('computeRoutes', { body: {} })).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });

  it('rejects malformed and oversized JSON responses', async () => {
    const malformedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{not-json', { status: 200 }));
    const malformedClient = new FetchGoogleHttpClient(config(), { fetch: malformedFetch });
    await expect(malformedClient.postJson('computeRoutes', { body: {} })).rejects.toMatchObject({
      code: 'UPSTREAM_BAD_RESPONSE',
    });

    const oversizedFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ value: 'x'.repeat(100) }));
    const oversizedClient = new FetchGoogleHttpClient(config(), {
      fetch: oversizedFetch,
      maxResponseBytes: 20,
    });
    await expect(oversizedClient.postJson('computeRoutes', { body: {} })).rejects.toMatchObject({
      code: 'UPSTREAM_BAD_RESPONSE',
    });
  });

  it('retries a network failure and enforces the local calls-per-minute cap', async () => {
    const retryFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse({ places: [] }));
    const retryClient = new FetchGoogleHttpClient(config({ maxRetries: 1 }), {
      fetch: retryFetch,
      sleep: async () => undefined,
      random: () => 0,
    });
    await expect(retryClient.postJson('placesTextSearch', { body: {} })).resolves.toEqual({
      places: [],
    });

    const cappedFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ places: [] }));
    const cappedClient = new FetchGoogleHttpClient(config({ callsPerMinute: 1 }), {
      fetch: cappedFetch,
      clock: { now: () => 1_000 },
    });
    await cappedClient.postJson('placesTextSearch', { body: {} });
    await expect(cappedClient.postJson('placesTextSearch', { body: {} })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(cappedFetch).toHaveBeenCalledTimes(1);
  });
});
