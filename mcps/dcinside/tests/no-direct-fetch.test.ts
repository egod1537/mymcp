import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { BRAVE_SEARCH_ENDPOINT, BraveSearchProvider } from '../src/providers/brave-search.js';
import { createServer } from '../src/server.js';
import { PostStore } from '../src/store/post-store.js';

describe('P0 network boundary', () => {
  it('allows only the mocked Brave endpoint and never fetches on parse/import/get/comments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dcinside-network-'));
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const url = new URL(String(request));
      expect(`${url.origin}${url.pathname}`).toBe(BRAVE_SEARCH_ENDPOINT);
      expect(url.hostname.endsWith('dcinside.com')).toBe(false);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    });
    const server = createServer({
      searchProvider: new BraveSearchProvider({
        apiKey: 'test-key',
        fetchImpl: fetchMock,
        rateLimiter: { take: () => undefined },
      }),
      postStore: new PostStore(directory),
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    });
    const client = new Client({ name: 'network-boundary-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const url = 'https://gall.dcinside.com/board/view/?id=test&no=1';

    try {
      await client.callTool({ name: 'dc_search_posts', arguments: { query: 'test' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await client.callTool({ name: 'dc_parse_post_url', arguments: { url } });
      await client.callTool({
        name: 'dc_import_post',
        arguments: { url, title: 'synthetic', bodyText: 'local only' },
      });
      await client.callTool({ name: 'dc_get_post', arguments: { url } });
      await client.callTool({ name: 'dc_get_comments', arguments: { url } });
      await client.callTool({
        name: 'dc_get_post',
        arguments: { url: 'https://gall.dcinside.com/board/view/?id=test&no=2' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
