import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';

import type { RemoteReadProvider } from '../src/core/types.js';
import worker, { createDcinsideWorkerServer, type DcinsideWorkerEnv } from '../src/worker.js';

const executionContext = {
  passThroughOnException() {},
  waitUntil() {},
} as unknown as ExecutionContext;

function env(overrides: Partial<DcinsideWorkerEnv> = {}): DcinsideWorkerEnv {
  return {
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
    DCINSIDE_REMOTE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ...overrides,
  };
}

describe('Cloudflare Worker entrypoint', () => {
  it('reports a healthy parse-only service without a Brave key', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-dc.mangagaki.net/healthz'),
      env(),
      executionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: '@mymcp/dcinside',
      search: 'unconfigured',
      directSearch: 'disabled',
      directRead: 'disabled',
    });
  });

  it('uses the injected authorized dcinside.js provider and its dedicated rate limit', async () => {
    const search = vi.fn<NonNullable<RemoteReadProvider['search']>>().mockResolvedValue([
      {
        canonicalUrl: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=10',
        galleryId: 'japan',
        galleryType: 'minor',
        postNo: '10',
        title: 'direct result',
        provenance: {
          source: 'authorized_direct',
          capturedAt: '2026-10-28T00:00:00.000Z',
          provider: 'dcinside-js',
        },
      },
    ]);
    const provider: RemoteReadProvider = {
      id: 'dcinside-js',
      search,
      getPost: vi.fn(),
      listGalleryPosts: vi.fn(),
    };
    const directLimit = vi.fn(async () => ({ success: true }));
    const server = createDcinsideWorkerServer(
      env({
        DCINSIDE_REMOTE_MODE: 'authorized',
        DCINSIDE_ALLOWED_GALLERIES: '*',
        DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE: '5',
        DCINSIDE_REMOTE_RATE_LIMITER: { limit: directLimit },
      }),
      provider,
    );
    const client = new Client({ name: 'worker-direct-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'dc_search_posts',
        arguments: { query: '24년생' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        provider: 'dcinside-js',
        source: 'authorized_direct',
        count: 1,
      });
      expect(search).toHaveBeenCalledWith(
        expect.objectContaining({ query: '24년생', sort: 'relevance' }),
      );
      expect(directLimit).toHaveBeenCalledTimes(1);
      expect(directLimit).toHaveBeenCalledWith({ key: 'dcinside-direct' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('exposes authorized list, post, and comment reads with the shared direct limit', async () => {
    const canonicalUrl = 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=10';
    const listGalleryPosts = vi.fn<RemoteReadProvider['listGalleryPosts']>().mockResolvedValue([
      {
        canonicalUrl,
        galleryId: 'japan',
        galleryType: 'minor',
        postNo: '10',
        title: 'listed post',
        provenance: {
          source: 'authorized_direct',
          capturedAt: '2026-10-28T00:00:00.000Z',
          provider: 'dcinside-js',
        },
      },
    ]);
    const getPost = vi.fn<RemoteReadProvider['getPost']>().mockResolvedValue({
      canonicalUrl,
      galleryId: 'japan',
      galleryType: 'minor',
      postNo: '10',
      title: 'direct post',
      bodyText: 'body',
      comments: {
        total: 2,
        items: [
          { commentId: '1', text: 'first' },
          { commentId: '2', parentCommentId: '1', text: 'reply' },
        ],
        partial: false,
      },
      provenance: {
        source: 'authorized_direct',
        capturedAt: '2026-10-28T00:00:00.000Z',
        provider: 'dcinside-js',
      },
      contentAvailable: true,
    });
    const provider: RemoteReadProvider = {
      id: 'dcinside-js',
      listGalleryPosts,
      getPost,
    };
    const directLimit = vi.fn(async () => ({ success: true }));
    const server = createDcinsideWorkerServer(
      env({
        DCINSIDE_REMOTE_MODE: 'authorized',
        DCINSIDE_ALLOWED_GALLERIES: '*',
        DCINSIDE_REMOTE_RATE_LIMITER: { limit: directLimit },
      }),
      provider,
    );
    const client = new Client({ name: 'worker-read-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.callTool({
        name: 'dc_list_posts',
        arguments: { galleryId: 'japan', galleryType: 'minor', limit: 10 },
      });
      expect(listed.structuredContent).toMatchObject({
        source: 'authorized_direct',
        provider: 'dcinside-js',
        count: 1,
      });

      const post = await client.callTool({
        name: 'dc_get_post',
        arguments: { url: canonicalUrl },
      });
      expect(post.structuredContent).toMatchObject({
        found: true,
        source: 'authorized_direct',
        title: 'direct post',
        bodyText: 'body',
      });

      const comments = await client.callTool({
        name: 'dc_get_comments',
        arguments: { url: canonicalUrl, offset: 1, limit: 1 },
      });
      expect(comments.structuredContent).toMatchObject({
        found: true,
        total: 2,
        loadedCount: 1,
        comments: [{ commentId: '2', parentCommentId: '1', text: 'reply' }],
      });

      expect(listGalleryPosts).toHaveBeenCalledTimes(1);
      expect(getPost).toHaveBeenCalledTimes(2);
      expect(directLimit).toHaveBeenCalledTimes(3);
      expect(directLimit).toHaveBeenCalledWith({ key: 'dcinside-direct' });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it('enforces the Cloudflare rate-limit binding before MCP dispatch', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-dc.mangagaki.net/mcp', { method: 'POST' }),
      env({ MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } }),
      executionContext,
    );

    expect(response.status).toBe(429);
  });

  it('exposes the five read-only public tools without import tools', async () => {
    const response = await worker.fetch(
      new Request('https://mcp-dc.mangagaki.net/mcp', {
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
    expect(body).toContain('dc_search_posts');
    expect(body).toContain('dc_list_posts');
    expect(body).toContain('dc_get_post');
    expect(body).toContain('dc_get_comments');
    expect(body).toContain('dc_parse_post_url');
    expect(body).not.toContain('dc_import_post');
  });
});
