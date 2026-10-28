import { describe, expect, it, vi } from 'vitest';
import {
  BRAVE_SEARCH_ENDPOINT,
  BraveSearchProvider,
  SlidingWindowSearchLimiter,
} from '../src/providers/brave-search.js';
import type { SearchPostsInput } from '../src/core/schemas.js';

const input = (overrides: Partial<SearchPostsInput> = {}): SearchPostsInput => ({
  query: '일본 교환학생',
  freshness: 'any',
  limit: 10,
  sort: 'relevance',
  source: 'brave',
  maxPages: 1,
  ...overrides,
});

const noLimit = { take: vi.fn() };
const noSleep = vi.fn(async () => undefined);

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('BraveSearchProvider', () => {
  it('uses only the exact Brave endpoint and required query defaults', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ web: { results: [] } }));
    const provider = new BraveSearchProvider({
      apiKey: 'private-test-key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });

    await provider.searchIndexedPosts(input({ limit: 5 }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request, init] = fetchMock.mock.calls[0] ?? [];
    const url = new URL(String(request));
    expect(`${url.origin}${url.pathname}`).toBe(BRAVE_SEARCH_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'site:gall.dcinside.com 일본 교환학생',
      country: 'KR',
      search_lang: 'ko',
      ui_lang: 'ko-KR',
      result_filter: 'web',
      safesearch: 'moderate',
      text_decorations: 'false',
      count: '5',
      offset: '0',
    });
    expect(url.searchParams.has('freshness')).toBe(false);
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('private-test-key');
  });

  it('filters non-post URLs, exact gallery/type mismatches, and canonical duplicates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        web: {
          results: [
            {
              title: '<b>Eligible &amp; indexed</b>',
              url: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=00123&page=2',
              description: '<em>short</em> snippet',
              age: '2 days ago',
            },
            {
              title: 'duplicate',
              url: 'https://gall.dcinside.com/mgallery/board/view?id=japan&no=123',
            },
            {
              title: 'wrong gallery',
              url: 'https://gall.dcinside.com/mgallery/board/view/?id=other&no=9',
            },
            { title: 'wrong type', url: 'https://gall.dcinside.com/board/view/?id=japan&no=8' },
            { title: 'home', url: 'https://gall.dcinside.com/' },
            { title: 'mirror', url: 'https://example.com/post/1' },
            { title: null, url: null },
          ],
        },
      }),
    );
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });

    const result = await provider.searchIndexedPosts(
      input({
        galleryId: 'japan',
        galleryType: 'minor',
        limit: 20,
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get('q')).toBe(
      'site:gall.dcinside.com "id=japan" 일본 교환학생',
    );
    expect(result.results).toEqual([
      {
        title: 'Eligible & indexed',
        url: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123',
        snippet: 'short snippet',
        galleryId: 'japan',
        galleryType: 'minor',
        postNo: '123',
        dateLabel: 'search-index age: 2 days ago',
      },
    ]);
  });

  it.each([
    ['day', 'pd'],
    ['week', 'pw'],
    ['month', 'pm'],
    ['year', 'py'],
  ] as const)('maps %s freshness to %s', async (freshness, expected) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ web: { results: [] } }));
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });
    await provider.searchIndexedPosts(input({ freshness }));
    const request = fetchMock.mock.calls[0]?.[0];
    expect(new URL(String(request)).searchParams.get('freshness')).toBe(expected);
  });

  it('fails gracefully without an API key', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new BraveSearchProvider({ fetchImpl: fetchMock, rateLimiter: noLimit });
    await expect(provider.searchIndexedPosts(input())).rejects.toMatchObject({
      code: 'CONFIGURATION_REQUIRED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes user-provided site overrides from the Brave query', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ web: { results: [] } }));
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });
    await provider.searchIndexedPosts(input({ query: 'site:evil.example 교환학생' }));
    const request = fetchMock.mock.calls[0]?.[0];
    expect(new URL(String(request)).searchParams.get('q')).toBe('site:gall.dcinside.com 교환학생');
  });

  it.each([0, 21, 1.5])('rejects an invalid result limit %s before fetching', async (limit) => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });
    await expect(
      provider.searchIndexedPosts({ ...input(), limit } as SearchPostsInput),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'INPUT_INVALID', 1],
    [401, 'SEARCH_PROVIDER_AUTH', 1],
    [403, 'SEARCH_PROVIDER_AUTH', 1],
    [429, 'SEARCH_PROVIDER_QUOTA', 3],
    [500, 'SEARCH_PROVIDER_DOWN', 3],
  ])('maps HTTP %s to %s', async (status, code, calls) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, status));
    const provider = new BraveSearchProvider({
      apiKey: 'secret-that-must-not-leak',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
      sleep: noSleep,
    });
    const promise = provider.searchIndexedPosts(input());
    await expect(promise).rejects.toMatchObject({ code });
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain('secret-that-must-not-leak');
    });
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('maps aborted timeouts to provider-down after bounded retries', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_request, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      timeoutMs: 1,
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
      sleep: noSleep,
    });
    await expect(provider.searchIndexedPosts(input())).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_DOWN',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('rejects malformed JSON', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{bad', { status: 200 }));
    const provider = new BraveSearchProvider({
      apiKey: 'key',
      fetchImpl: fetchMock,
      rateLimiter: noLimit,
    });
    await expect(provider.searchIndexedPosts(input())).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_DOWN',
    });
  });

  it('enforces the process-style sliding-window request limit', () => {
    let current = 1_000;
    const limiter = new SlidingWindowSearchLimiter(2, () => current);
    limiter.take();
    limiter.take();
    expect(() => limiter.take()).toThrowError(
      expect.objectContaining({ code: 'SEARCH_PROVIDER_QUOTA' }),
    );
    current += 60_001;
    expect(() => limiter.take()).not.toThrow();
  });
});
