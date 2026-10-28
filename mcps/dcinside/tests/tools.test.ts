import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from '../src/server.js';
import { PostStore } from '../src/store/post-store.js';
import type { SearchProvider } from '../src/providers/search-provider.js';
import { SearchIndexStore } from '../src/store/search-index.js';

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
      searchIndex: new SearchIndexStore(directory),
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

  it('registers the compatible and extended tools with explicit descriptions and schemas', async () => {
    const tools = (await client.listTools()).tools;
    expect(tools.map(({ name }) => name).sort()).toEqual([
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
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe('object');
    }
    const resources = await client.listResources();
    expect(resources.resources).toContainEqual(
      expect.objectContaining({ uri: 'dcinside://capabilities' }),
    );
    const capabilities = await client.readResource({ uri: 'dcinside://capabilities' });
    expect(JSON.parse((capabilities.contents[0] as { text: string }).text)).toMatchObject({
      remoteReadEnabled: false,
      localImportEnabled: true,
      directReadStatus: 'disabled',
    });
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
      arguments: {
        query: '일본 교환학생',
        galleryId: 'japan',
        galleryType: 'minor',
        source: 'brave',
        limit: 5,
      },
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
      sort: 'relevance',
      source: 'brave',
      maxPages: 1,
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
      note: '메모',
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

  it('imports deep-search CSV, merges duplicate keywords, lists, and searches locally', async () => {
    const data = [
      'index,galleryId,keyword,searchType,title,author,date,views,recommends,commentCount,postId,url,searchStep,sourceUrl',
      '1,japan,항공,search_subject_memo,"시험용, 글",ignored,2026.10.01,14,3,2,123,https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123,0,javascript:ignored',
      '2,japan,취업,search_subject_memo,"시험용, 글",ignored,2026.10.01,14,3,2,123,https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123,1,file:///ignored',
    ].join('\r\n');
    const imported = await client.callTool({
      name: 'dc_import_search_results',
      arguments: { format: 'csv', data },
    });
    expect(structured(imported)).toMatchObject({
      status: 'imported',
      source: 'deep_search_export',
      accepted: 1,
      duplicates: 1,
      rejected: 0,
    });
    expect(JSON.stringify(structured(imported))).not.toContain('ignored');

    const listed = await client.callTool({
      name: 'dc_list_gallery_posts',
      arguments: { galleryId: 'japan', galleryType: 'minor', page: 1, limit: 10 },
    });
    expect(structured(listed)).toMatchObject({ count: 1, source: 'deep_search_export' });

    const searched = await client.callTool({
      name: 'dc_search_posts',
      arguments: {
        query: '시험용',
        galleryId: 'japan',
        source: 'local',
        keywords: ['항공', '취업'],
      },
    });
    expect(structured(searched)).toMatchObject({ provider: 'local', count: 1 });
    expect(
      (structured(searched).results as Array<{ matchedKeywords: string[] }>)[0]?.matchedKeywords,
    ).toEqual(['항공', '취업']);
  });

  it('imports supplied HTML without fetching and exposes one combined snapshot', async () => {
    const url = 'https://gall.dcinside.com/board/view/?id=test&no=77';
    const imported = await client.callTool({
      name: 'dc_import_post_html',
      arguments: {
        url,
        html: '<html><head><title>ignored</title><script>alert(1)</script></head><body><h1 data-role="post-title">HTML 제목</h1><div data-role="post-content">본문 <b>텍스트</b><img src="javascript:bad"><img src="https://image.dcinside.com/a.jpg"></div><div data-role="comment" data-comment-id="c1">댓글</div></body></html>',
      },
    });
    expect(structured(imported)).toMatchObject({
      status: 'saved',
      bodyLength: '본문 텍스트'.length,
      commentCount: 1,
      imageCount: 1,
    });
    const combined = await client.callTool({
      name: 'dc_get_post_with_comments',
      arguments: { url },
    });
    expect(structured(combined)).toMatchObject({
      found: true,
      source: 'user_import',
      post: {
        title: 'HTML 제목',
        bodyText: '본문 텍스트',
        imageUrls: ['https://image.dcinside.com/a.jpg'],
      },
      comments: { loadedCount: 1, partial: false },
    });
    expect(JSON.stringify(structured(combined))).not.toContain('alert');
    expect(JSON.stringify(structured(combined))).not.toContain('javascript:');
  });
});
