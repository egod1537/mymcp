import type { ParsedPostUrl } from '../core/dc-url.js';
import { parseDcPostUrl } from '../core/dc-url.js';
import { sanitizeStoredText } from '../core/text.js';
import type {
  NormalizedComment,
  NormalizedPost,
  NormalizedPostSummary,
  RemoteReadProvider,
} from '../core/types.js';
import { DomainError } from '../errors.js';
import { htmlFragmentToText } from '../import/post-html.js';

interface DcinsidePostListItem {
  id?: unknown;
  title?: unknown;
  subject?: unknown;
  link?: unknown;
  date?: unknown;
  count?: unknown;
  recommend?: unknown;
  replyCount?: unknown;
}

interface DcinsidePost {
  postNo?: unknown;
  title?: unknown;
  date?: unknown;
  content?: unknown;
  viewCount?: unknown;
  recommendCount?: unknown;
  dislikeCount?: unknown;
  images?: unknown;
  comments?: {
    totalCount?: unknown;
    items?: Array<{ parent?: unknown; id?: unknown; regDate?: unknown; memo?: unknown }>;
  };
}

interface DcinsideSearchPost {
  title?: unknown;
  content?: unknown;
  galleryId?: unknown;
  date?: unknown;
  link?: unknown;
}

interface DcinsideSearchResult {
  posts?: unknown;
}

export interface DcinsideJsApi {
  getPostList(input: {
    page: number;
    galleryId: string;
    boardType?: 'all' | 'recommend' | 'notice';
  }): Promise<DcinsidePostListItem[]>;
  getPost(input: {
    galleryId: string;
    postNo: string;
    extractImages: true;
    includeImageSource: false;
    retryCount: 0;
  }): Promise<DcinsidePost | null>;
  search?(query: string, options: { sort: 'latest' | 'accuracy' }): Promise<DcinsideSearchResult>;
}

async function loadApi(): Promise<DcinsideJsApi> {
  const loaded = (await import('@gurumnyang/dcinside.js')) as unknown as DcinsideJsApi & {
    default?: DcinsideJsApi;
  };
  return loaded.default ?? loaded;
}

function safeText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? sanitizeStoredText(value).trim().slice(0, maximum) : '';
}

function safeCount(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function canonicalFromList(
  galleryId: string,
  galleryType: 'major' | 'minor' | 'mini' | undefined,
  value: unknown,
  fallbackId?: unknown,
): ParsedPostUrl | undefined {
  if (typeof value !== 'string' && typeof fallbackId !== 'string') return undefined;
  try {
    if (typeof value === 'string') {
      return parseDcPostUrl(
        value.startsWith('http') ? value : new URL(value, 'https://gall.dcinside.com').href,
      );
    }
  } catch {
    // Current dcinside.js list responses use m.dcinside.com links, which do not
    // encode major/minor/mini. The caller-supplied gallery type remains the
    // authoritative source for the canonical desktop URL.
  }
  const postNo =
    typeof fallbackId === 'string' && /^\d+$/.test(fallbackId)
      ? fallbackId
      : typeof value === 'string' && /^\d+$/.test(value)
        ? value
        : undefined;
  if (postNo) {
    const path =
      galleryType === 'minor'
        ? 'mgallery/board/view/'
        : galleryType === 'mini'
          ? 'mini/board/view/'
          : 'board/view/';
    try {
      return parseDcPostUrl(`https://gall.dcinside.com/${path}?id=${galleryId}&no=${postNo}`);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function imageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value) {
    const candidate = typeof item === 'string' ? item : undefined;
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && /(^|\.)dcinside\.com$/i.test(url.hostname))
        result.push(url.href);
    } catch {
      // Ignore untrusted image locations.
    }
  }
  return [...new Set(result)];
}

export class DcinsideJsAdapter implements RemoteReadProvider {
  readonly id = 'dcinside-js' as const;

  constructor(
    private readonly injectedApi?: DcinsideJsApi,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private loadedApi?: Promise<DcinsideJsApi>;

  private api(): Promise<DcinsideJsApi> {
    this.loadedApi ??= this.injectedApi ? Promise.resolve(this.injectedApi) : loadApi();
    return this.loadedApi;
  }

  async listGalleryPosts(input: {
    galleryId: string;
    galleryType?: 'major' | 'minor' | 'mini';
    page: number;
    boardType: 'all' | 'recommend' | 'notice';
  }): Promise<NormalizedPostSummary[]> {
    try {
      const items = await (
        await this.api()
      ).getPostList({
        page: input.page,
        galleryId: input.galleryId,
        boardType: input.boardType,
      });
      const capturedAt = this.now().toISOString();
      return items.flatMap((item) => {
        const parsed = canonicalFromList(input.galleryId, input.galleryType, item.link, item.id);
        const title = safeText(item.title ?? item.subject, 500);
        if (!parsed || parsed.galleryId !== input.galleryId || !title) return [];
        if (input.galleryType && parsed.galleryType !== input.galleryType) return [];
        return [
          {
            ...parsed,
            title,
            ...(safeText(item.date, 100) ? { dateLabel: safeText(item.date, 100) } : {}),
            ...(safeCount(item.replyCount) === undefined
              ? {}
              : { commentCount: safeCount(item.replyCount) }),
            ...(safeCount(item.count) === undefined ? {} : { views: safeCount(item.count) }),
            ...(safeCount(item.recommend) === undefined
              ? {}
              : { recommends: safeCount(item.recommend) }),
            provenance: { source: 'authorized_direct' as const, capturedAt, provider: this.id },
          },
        ];
      });
    } catch (error) {
      throw this.mapUpstream(error);
    }
  }

  async getPost(input: ParsedPostUrl): Promise<NormalizedPost | null> {
    try {
      const post = await (
        await this.api()
      ).getPost({
        galleryId: input.galleryId,
        postNo: input.postNo,
        extractImages: true,
        includeImageSource: false,
        retryCount: 0,
      });
      if (!post) return null;
      const returnedPostNo = safeText(post.postNo, 50).replace(/^0+(?=\d)/, '');
      if (!/^\d+$/.test(returnedPostNo) || returnedPostNo !== input.postNo) {
        throw new DomainError(
          'UPSTREAM_UNAVAILABLE',
          'Authorized upstream returned an unexpected post identity.',
          false,
        );
      }
      const capturedAt = this.now().toISOString();
      const comments: NormalizedComment[] = (post.comments?.items ?? []).flatMap((item) => {
        const text = safeText(item.memo, 5_000);
        if (!text) return [];
        const parent = safeText(item.parent, 200);
        const commentId = safeText(item.id, 200);
        const postedAt = safeText(item.regDate, 100);
        return [
          {
            text,
            ...(commentId ? { commentId } : {}),
            ...(parent && parent !== '0' ? { parentCommentId: parent } : {}),
            ...(postedAt ? { postedAt } : {}),
          },
        ];
      });
      const total = safeCount(post.comments?.totalCount);
      const bodyText = htmlFragmentToText(safeText(post.content, 200_000));
      const images = imageUrls(post.images);
      return {
        ...input,
        title: safeText(post.title, 500),
        bodyText,
        ...(images.length ? { imageUrls: images } : {}),
        ...(safeText(post.date, 100) ? { dateLabel: safeText(post.date, 100) } : {}),
        metrics: {
          ...(safeCount(post.viewCount) === undefined ? {} : { views: safeCount(post.viewCount) }),
          ...(safeCount(post.recommendCount) === undefined
            ? {}
            : { recommends: safeCount(post.recommendCount) }),
          ...(safeCount(post.dislikeCount) === undefined
            ? {}
            : { dislikes: safeCount(post.dislikeCount) }),
        },
        comments: {
          ...(total === undefined ? {} : { total }),
          items: comments,
          partial: total !== undefined && comments.length < total,
        },
        provenance: { source: 'authorized_direct', capturedAt, provider: this.id },
        contentAvailable: Boolean(bodyText || images.length),
      };
    } catch (error) {
      throw this.mapUpstream(error);
    }
  }

  async search(input: {
    query: string;
    sort: 'relevance' | 'latest';
    limit: number;
    galleryId?: string;
    galleryType?: 'major' | 'minor' | 'mini';
  }): Promise<NormalizedPostSummary[]> {
    try {
      const api = await this.api();
      if (!api.search) {
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'The installed dcinside.js package does not expose search.',
          false,
        );
      }
      const response = await api.search(input.query, {
        sort: input.sort === 'latest' ? 'latest' : 'accuracy',
      });
      const candidates = Array.isArray(response.posts)
        ? response.posts.filter(
            (value): value is DcinsideSearchPost => typeof value === 'object' && value !== null,
          )
        : [];
      const capturedAt = this.now().toISOString();
      const seen = new Set<string>();
      const results: NormalizedPostSummary[] = [];
      for (const candidate of candidates) {
        if (typeof candidate.link !== 'string') continue;
        let parsed: ParsedPostUrl;
        try {
          parsed = parseDcPostUrl(
            candidate.link.startsWith('http')
              ? candidate.link
              : new URL(candidate.link, 'https://gall.dcinside.com').href,
          );
        } catch {
          continue;
        }
        if (input.galleryId && parsed.galleryId !== input.galleryId) continue;
        if (input.galleryType && parsed.galleryType !== input.galleryType) continue;
        if (seen.has(parsed.canonicalUrl)) continue;
        const title = safeText(candidate.title, 500);
        if (!title) continue;
        seen.add(parsed.canonicalUrl);
        const snippet = htmlFragmentToText(safeText(candidate.content, 10_000)).slice(0, 2_000);
        const dateLabel = safeText(candidate.date, 100);
        results.push({
          ...parsed,
          title,
          ...(snippet ? { snippet } : {}),
          ...(dateLabel ? { dateLabel } : {}),
          provenance: { source: 'authorized_direct', capturedAt, provider: this.id },
        });
        if (results.length >= input.limit) break;
      }
      return results;
    } catch (error) {
      throw this.mapUpstream(error);
    }
  }

  private mapUpstream(error: unknown): DomainError {
    if (error instanceof DomainError) return error;
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status: unknown }).status)
        : undefined;
    if (status === 403 || status === 429) {
      return new DomainError('UPSTREAM_BLOCKED', 'Authorized upstream access was blocked.', false);
    }
    return new DomainError('UPSTREAM_UNAVAILABLE', 'Authorized upstream read failed.', true);
  }
}
