import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { BRAVE_SEARCH_ENDPOINT, BraveSearchProvider } from '../src/providers/brave-search.js';
import { createServer } from '../src/server.js';
import { PostStore } from '../src/store/post-store.js';
import { SearchIndexStore } from '../src/store/search-index.js';
import { loadConfig } from '../src/config.js';
import type { RemoteReadProvider } from '../src/core/types.js';

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
      searchIndex: new SearchIndexStore(directory),
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    });
    const client = new Client({ name: 'network-boundary-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const url = 'https://gall.dcinside.com/board/view/?id=test&no=1';

    try {
      await client.callTool({
        name: 'dc_search_posts',
        arguments: { query: 'test', source: 'brave' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await client.callTool({ name: 'dc_parse_post_url', arguments: { url } });
      await client.callTool({
        name: 'dc_import_post',
        arguments: { url, title: 'synthetic', bodyText: 'local only' },
      });
      await client.callTool({ name: 'dc_get_post', arguments: { url } });
      await client.callTool({ name: 'dc_get_comments', arguments: { url } });
      await client.callTool({ name: 'dc_get_post_with_comments', arguments: { url } });
      await client.callTool({
        name: 'dc_import_search_results',
        arguments: {
          format: 'json',
          data: JSON.stringify([
            {
              galleryId: 'test',
              postId: '3',
              title: 'local',
              url: 'https://gall.dcinside.com/board/view/?id=test&no=3',
            },
          ]),
        },
      });
      await client.callTool({
        name: 'dc_list_gallery_posts',
        arguments: { galleryId: 'test', sourceMode: 'local' },
      });
      const remoteDisabled = await client.callTool({
        name: 'dc_get_post',
        arguments: { url, sourceMode: 'authorized' },
      });
      expect(remoteDisabled.isError).toBe(true);
      expect((remoteDisabled.structuredContent as { code?: string }).code).toBe('REMOTE_DISABLED');
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

describe('authorized mode boundary', () => {
  it('fails closed before invoking an adapter when the gallery is not allowlisted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dcinside-authorized-'));
    const getPost = vi.fn<RemoteReadProvider['getPost']>();
    const listGalleryPosts = vi.fn<RemoteReadProvider['listGalleryPosts']>();
    const server = createServer({
      searchProvider: { searchIndexedPosts: vi.fn() },
      postStore: new PostStore(directory),
      searchIndex: new SearchIndexStore(directory),
      remoteProvider: { id: 'dcinside-js', getPost, listGalleryPosts },
      config: loadConfig({
        DCINSIDE_DATA_DIR: directory,
        DCINSIDE_REMOTE_MODE: 'authorized',
        DCINSIDE_ALLOWED_GALLERIES: 'allowed',
        DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE: '1',
      }),
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    });
    const client = new Client({ name: 'authorized-boundary-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'dc_get_post',
        arguments: {
          url: 'https://gall.dcinside.com/board/view/?id=not_allowed&no=1',
          sourceMode: 'authorized',
        },
      });
      expect(result.isError).toBe(true);
      expect((result.structuredContent as { code?: string }).code).toBe('REMOTE_NOT_AUTHORIZED');
      expect(getPost).not.toHaveBeenCalled();
      expect(listGalleryPosts).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
