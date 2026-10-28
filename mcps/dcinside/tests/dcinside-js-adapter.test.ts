import { describe, expect, it, vi } from 'vitest';
import { parseDcPostUrl } from '../src/core/dc-url.js';
import { DcinsideJsAdapter, type DcinsideJsApi } from '../src/providers/dcinside-js-adapter.js';

describe('DcinsideJsAdapter', () => {
  it('normalizes one mocked post while dropping author identifiers and unsafe images', async () => {
    const api: DcinsideJsApi = {
      getPostList: vi.fn(),
      getPost: vi.fn().mockResolvedValue({
        postNo: '123',
        title: '제목',
        content: '<div>본문 <b>텍스트</b><script>bad()</script></div>',
        viewCount: 12,
        images: ['javascript:bad', 'https://image.dcinside.com/a.png'],
        comments: {
          totalCount: 2,
          items: [
            { id: 'c1', parent: '0', memo: 'root', author: { userId: 'secret' } },
            { id: 'c2', parent: 'c1', memo: 'reply', author: { ip: '1.2.3.4' } },
          ],
        },
      }),
    };
    const adapter = new DcinsideJsAdapter(api, () => new Date('2026-10-28T00:00:00.000Z'));
    const result = await adapter.getPost(
      parseDcPostUrl('https://gall.dcinside.com/mgallery/board/view/?id=japan&no=123'),
    );
    expect(result).toMatchObject({
      title: '제목',
      bodyText: '본문 텍스트',
      imageUrls: ['https://image.dcinside.com/a.png'],
      comments: {
        total: 2,
        partial: false,
        items: [
          { commentId: 'c1', text: 'root' },
          { commentId: 'c2', parentCommentId: 'c1', text: 'reply' },
        ],
      },
      provenance: { source: 'authorized_direct', provider: 'dcinside-js' },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('1.2.3.4');
    expect(api.getPost).toHaveBeenCalledWith({
      galleryId: 'japan',
      postNo: '123',
      extractImages: true,
      includeImageSource: false,
      retryCount: 0,
    });
  });

  it('maps a mocked gallery list and omits authors', async () => {
    const api: DcinsideJsApi = {
      getPostList: vi.fn().mockResolvedValue([
        {
          id: '9',
          link: 'https://m.dcinside.com/board/japan/9?page=1',
          title: '목록 제목',
          author: { nickname: 'drop me' },
          count: 4,
          replyCount: 1,
        },
      ]),
      getPost: vi.fn(),
    };
    const result = await new DcinsideJsAdapter(api).listGalleryPosts({
      galleryId: 'japan',
      galleryType: 'minor',
      page: 1,
      boardType: 'all',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ postNo: '9', title: '목록 제목', views: 4, commentCount: 1 });
    expect(JSON.stringify(result)).not.toContain('drop me');
    expect(api.getPostList).toHaveBeenCalledWith({
      page: 1,
      galleryId: 'japan',
      boardType: 'all',
    });
  });

  it('maps dcinside.js direct search and applies exact gallery filtering', async () => {
    const api: DcinsideJsApi = {
      getPostList: vi.fn(),
      getPost: vi.fn(),
      search: vi.fn().mockResolvedValue({
        posts: [
          {
            title: '24년생 정확 결과',
            content: '<b>검색 본문</b>',
            date: '2026.10.28',
            link: 'https://gall.dcinside.com/mgallery/board/view/?id=japan&no=10',
          },
          {
            title: '다른 갤러리',
            link: 'https://gall.dcinside.com/board/view/?id=other&no=9',
          },
        ],
      }),
    };
    const adapter = new DcinsideJsAdapter(api, () => new Date('2026-10-28T00:00:00.000Z'));
    const results = await adapter.search({
      query: '24년생',
      sort: 'relevance',
      limit: 10,
      galleryId: 'japan',
      galleryType: 'minor',
    });
    expect(api.search).toHaveBeenCalledWith('24년생', { sort: 'accuracy' });
    expect(results).toEqual([
      expect.objectContaining({
        title: '24년생 정확 결과',
        snippet: '검색 본문',
        galleryId: 'japan',
        galleryType: 'minor',
        postNo: '10',
        provenance: expect.objectContaining({ source: 'authorized_direct' }),
      }),
    ]);
  });
});
