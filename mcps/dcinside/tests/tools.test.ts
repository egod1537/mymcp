import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { PostStore } from '../src/store/post-store.js';
import type { SearchProvider } from '../src/providers/search-provider.js';

function structured(result: unknown): Record<string, unknown> {
  return (result as { structuredContent?: unknown }).structuredContent as Record<string, unknown>;
}

describe('DCInside MCP tools', () => {
  let directory: string;
  let client: Client;
  let closeServer: () => Promise<void>;
  let search: ReturnType<typeof vi.fn<SearchProvider['searchIndexedPosts']>>;
  let currentTime: Date;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dcinside-tools-'));
    search = vi.fn<SearchProvider['searchIndexedPosts']>().mockResolvedValue({
      results: [
        {
          title: 'indexed title',
          url: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123',
          snippet: 'indexed snippet',
          galleryId: 'japan',
          galleryType: 'minor',
          postNo: '123',
        },
      ],
    });
    currentTime = new Date('2026-10-28T00:00:00.000Z');
    const server = createServer({
      searchProvider: { searchIndexedPosts: search },
      postStore: new PostStore(directory),
      now: () => currentTime,
    });
    client = new Client({ name: 'dcinside-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closeServer = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await closeServer();
    await rm(directory, { recursive: true, force: true });
  });

  it('registers exactly the five P0 tools with explicit descriptions and schemas', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.map(({ name }) => name).sort()).toEqual([
      'dc_get_comments',
      'dc_get_post',
      'dc_import_post',
      'dc_parse_post_url',
      'dc_search_posts',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('parses URLs and returns transparent indexed-search provenance', async () => {
    const parsed = await client.callTool({
      name: 'dc_parse_post_url',
      arguments: {
        url: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=00123&page=2',
      },
    });
    expect(structured(parsed)).toEqual({
      valid: true,
      canonicalUrl: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123',
      galleryId: 'japan',
      galleryType: 'minor',
      postNo: '123',
      source: 'url_parse',
    });

    const searched = await client.callTool({
      name: 'dc_search_posts',
      arguments: { query: '일본 교환학생', galleryId: 'japan', galleryType: 'minor', limit: 5 },
    });
    expect(structured(searched)).toMatchObject({
      query: '일본 교환학생',
      provider: 'brave',
      source: 'search_index',
      count: 1,
    });
    expect(search).toHaveBeenCalledWith({
      query: '일본 교환학생',
      galleryId: 'japan',
      galleryType: 'minor',
      freshness: 'any',
      limit: 5,
    });
  });

  it('imports, replaces, and paginates only user-supplied local data', async () => {
    const url = 'https://gall.dcinside.com/board/view/?id=test&no=7&page=9';
    const imported = await client.callTool({
      name: 'dc_import_post',
      arguments: {
        url,
        title: '사용자\u0000 제목',
        bodyText: '첫 줄\n둘째 줄',
        note: '메모',
        author: 'top-level author must be dropped',
        authorIp: '9.9',
        comments: [
          { text: '첫 댓글', commentId: 'c1', author: 'must be dropped', ip: '1.2' },
          { text: '둘째 댓글', postedAt: '2026-10-28' },
        ],
      },
    });
    expect(imported.isError).not.toBe(true);
    expect(structured(imported)).toMatchObject({
      status: 'saved',
      canonicalUrl: 'https://gall.dcinside.com/board/view/?id=test&no=7',
      bodyLength: '첫 줄\n둘째 줄'.length,
      commentCount: 2,
      source: 'user_import',
    });

    const post = await client.callTool({ name: 'dc_get_post', arguments: { url } });
    expect(structured(post)).toMatchObject({
      found: true,
      source: 'user_import',
      title: '사용자 제목',
      bodyText: '첫 줄\n둘째 줄',
      commentCount: 2,
    });

    const comments = await client.callTool({
      name: 'dc_get_comments',
      arguments: { url, offset: 1, limit: 1 },
    });
    expect(structured(comments)).toMatchObject({ found: true, total: 2, offset: 1, limit: 1 });
    expect(structured(comments).comments).toEqual([{ text: '둘째 댓글', postedAt: '2026-10-28' }]);
    expect(JSON.stringify(structured(comments))).not.toContain('author');
    expect(JSON.stringify(structured(comments))).not.toContain('1.2');
    expect(JSON.stringify(structured(post))).not.toContain('9.9');

    currentTime = new Date('2026-10-28T00:01:00.000Z');
    await client.callTool({
      name: 'dc_import_post',
      arguments: { url, title: '교체', bodyText: '새 본문' },
    });
    const replaced = await client.callTool({ name: 'dc_get_post', arguments: { url } });
    expect(structured(replaced)).toMatchObject({
      title: '교체',
      importedAt: '2026-10-28T00:01:00.000Z',
      commentCount: 0,
    });
  });

  it('returns explicit NOT_IMPORTED results without treating them as tool failures', async () => {
    const url = 'https://gall.dcinside.com/mini/board/view/?id=missing&no=1';
    for (const name of ['dc_get_post', 'dc_get_comments']) {
      const result = await client.callTool({ name, arguments: { url } });
      expect(result.isError).not.toBe(true);
      expect(structured(result)).toMatchObject({
        found: false,
        source: 'local_store',
        reason: 'NOT_IMPORTED',
      });
    }
  });

  it('returns stable JSON errors for domain validation and oversized imports', async () => {
    const invalid = await client.callTool({
      name: 'dc_parse_post_url',
      arguments: { url: 'https://example.com/not-allowed' },
    });
    expect(invalid.isError).toBe(true);
    expect(structured(invalid)).toMatchObject({ code: 'INPUT_INVALID' });

    const oversized = await client.callTool({
      name: 'dc_import_post',
      arguments: {
        url: 'https://gall.dcinside.com/board/view/?id=test&no=99',
        title: 'large',
        bodyText: '한'.repeat(100_000),
      },
    });
    expect(oversized.isError).toBe(true);
    expect(structured(oversized)).toMatchObject({ code: 'INPUT_INVALID' });
  });
});
