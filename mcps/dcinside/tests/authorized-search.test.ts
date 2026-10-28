import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import type { RemoteReadProvider } from '../src/core/types.js';
import { createServer } from '../src/server.js';
import { PostStore } from '../src/store/post-store.js';
import { SearchIndexStore } from '../src/store/search-index.js';

describe('authorized dcinside.js search', () => {
  let directory: string;
  let client: Client;
  let close: () => Promise<void>;
  let search: ReturnType<typeof vi.fn<NonNullable<RemoteReadProvider['search']>>>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dcinside-authorized-search-'));
    search = vi.fn<NonNullable<RemoteReadProvider['search']>>().mockResolvedValue([
      {
        canonicalUrl: 'https://gall.dcinside.com/mgallery/board/view/?id=umamusme&no=10',
        galleryId: 'umamusme',
        galleryType: 'minor',
        postNo: '10',
        title: '24년생 direct result',
        dateLabel: '2026.10.28',
        provenance: {
          source: 'authorized_direct',
          capturedAt: '2026-10-28T00:00:00.000Z',
          provider: 'dcinside-js',
        },
      },
    ]);
    const remoteProvider: RemoteReadProvider = {
      id: 'dcinside-js',
      search,
      getPost: vi.fn(),
      listGalleryPosts: vi.fn(),
    };
    const server = createServer({
      searchProvider: { searchIndexedPosts: vi.fn() },
      postStore: new PostStore(directory),
      searchIndex: new SearchIndexStore(directory),
      remoteProvider,
      config: loadConfig({
        DCINSIDE_DATA_DIR: directory,
        DCINSIDE_REMOTE_MODE: 'authorized',
        DCINSIDE_ALLOWED_GALLERIES: '*',
        DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE: '5',
      }),
      now: () => new Date('2026-10-28T00:00:00.000Z'),
    });
    client = new Client({ name: 'authorized-search-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    close = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });

  it('uses authorized direct search by default and enforces five calls per minute', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await client.callTool({
        name: 'dc_search_posts',
        arguments: { query: '24년생', limit: 5 },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        provider: 'dcinside-js',
        source: 'authorized_direct',
        count: 1,
      });
    }
    const limited = await client.callTool({
      name: 'dc_search_posts',
      arguments: { query: '24년생', limit: 5 },
    });
    expect(limited.isError).toBe(true);
    expect(limited.structuredContent).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(search).toHaveBeenCalledTimes(5);
  });
});
