import type { RuntimeConfig } from '../config.js';
import { parseDcPostUrl, type GalleryType, type ParsedPostUrl } from '../core/dc-url.js';
import type { NormalizedPost, RemoteReadProvider } from '../core/types.js';
import { DomainError } from '../errors.js';
import { parseSearchResultsImport } from '../import/search-results.js';
import type { SearchProvider } from '../providers/search-provider.js';
import type { PostStore, StoredPostRecord } from '../store/post-store.js';
import type { SearchIndexStore } from '../store/search-index.js';

export interface ServiceOptions {
  searchProvider: SearchProvider;
  postStore: PostStore;
  searchIndex: SearchIndexStore;
  remoteProvider?: RemoteReadProvider;
  config: Pick<
    RuntimeConfig,
    | 'braveSearchApiKey'
    | 'remoteMode'
    | 'allowedGalleries'
    | 'remoteRateLimitPerMinute'
    | 'maxImportedRows'
    | 'maxImportBytes'
    | 'maxSearchProviderPages'
  >;
  now: () => Date;
}

class RemoteLimiter {
  private timestamps: number[] = [];
  constructor(private readonly maximum: number) {}
  take(): void {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((timestamp) => timestamp > now - 60_000);
    if (this.timestamps.length >= this.maximum) {
      throw new DomainError('RATE_LIMITED', 'Authorized remote read rate limit reached.', true);
    }
    this.timestamps.push(now);
  }
}

function localPost(record: StoredPostRecord): NormalizedPost {
  return {
    canonicalUrl: record.canonicalUrl,
    galleryId: record.galleryId,
    galleryType: record.galleryType,
    postNo: record.postNo,
    title: record.title,
    bodyText: record.bodyText,
    ...(record.note ? { note: record.note } : {}),
    ...(record.imageUrls ? { imageUrls: record.imageUrls } : {}),
    comments: { total: record.comments.length, items: record.comments, partial: false },
    provenance: {
      source: 'user_import',
      capturedAt: record.importedAt,
      ...(record.parserVersion ? { parserVersion: record.parserVersion } : {}),
    },
    contentAvailable: Boolean(
      record.bodyText || record.comments.length || record.imageUrls?.length,
    ),
  };
}

export class DcinsideService {
  private readonly remoteLimiter?: RemoteLimiter;

  constructor(private readonly options: ServiceOptions) {
    if (options.config.remoteRateLimitPerMinute !== undefined) {
      this.remoteLimiter = new RemoteLimiter(options.config.remoteRateLimitPerMinute);
    }
  }

  capabilities() {
    const authorized =
      this.options.config.remoteMode === 'authorized' &&
      this.options.config.allowedGalleries.size > 0 &&
      this.remoteLimiter !== undefined &&
      this.options.remoteProvider !== undefined;
    return {
      braveSearchConfigured: Boolean(this.options.config.braveSearchApiKey),
      remoteReadEnabled: authorized,
      localImportEnabled: true,
      supportedDataSources: [
        'brave_index',
        'user_import',
        'deep_search_export',
        ...(authorized ? ['authorized_direct'] : []),
      ],
      directReadStatus:
        this.options.config.remoteMode === 'disabled'
          ? ('disabled' as const)
          : authorized
            ? ('authorized' as const)
            : ('unavailable' as const),
    };
  }

  async search(input: {
    query: string;
    galleryId?: string;
    galleryType?: GalleryType;
    freshness: 'any' | 'day' | 'week' | 'month' | 'year';
    limit: number;
    sort: 'relevance' | 'latest';
    source: 'authorized' | 'brave' | 'local';
    keywords?: string[];
    maxPages: number;
  }) {
    if (input.source === 'authorized') {
      const provider = this.authorizedProvider(input.galleryId ?? '*');
      if (!provider.search) {
        throw new DomainError(
          'SOURCE_UNAVAILABLE',
          'The authorized provider does not support search.',
          false,
        );
      }
      const results = await provider.search({
        query: input.query,
        sort: input.sort,
        limit: input.limit,
        ...(input.galleryId ? { galleryId: input.galleryId } : {}),
        ...(input.galleryType ? { galleryType: input.galleryType } : {}),
      });
      return {
        provider: provider.id,
        dataSource: 'authorized_direct',
        results: results.map((result) => ({
          title: result.title,
          url: result.canonicalUrl,
          snippet: result.snippet ?? '',
          galleryId: result.galleryId,
          galleryType: result.galleryType,
          postNo: result.postNo,
          ...(result.dateLabel ? { dateLabel: result.dateLabel } : {}),
          provenance: result.provenance,
          contentAvailable: false,
        })),
        totalFetched: results.length,
        reason: results.length ? undefined : 'no-direct-match',
      };
    }
    if (input.source === 'local') {
      const localCount = await this.options.searchIndex.count();
      const results = await this.options.searchIndex.search({
        query: input.query,
        ...(input.galleryId ? { galleryId: input.galleryId } : {}),
        ...(input.galleryType ? { galleryType: input.galleryType } : {}),
        ...(input.keywords ? { keywords: input.keywords } : {}),
        sort: input.sort,
        limit: input.limit,
      });
      return {
        provider: 'local',
        dataSource: 'deep_search_export',
        results: results.map((record) => ({
          title: record.title,
          url: record.canonicalUrl,
          snippet: record.snippet ?? '',
          galleryId: record.galleryId,
          galleryType: record.galleryType,
          postNo: record.postNo,
          ...(record.dateLabel ? { dateLabel: record.dateLabel } : {}),
          matchedKeywords: record.matchedKeywords,
          provenance: {
            source: record.source,
            capturedAt: record.capturedAt,
          },
          contentAvailable: false,
          ...(input.sort === 'latest' ? { estimatedSort: true } : {}),
        })),
        totalFetched: results.length,
        reason: results.length
          ? undefined
          : localCount === 0
            ? 'local-index-empty'
            : 'no-index-match',
      };
    }
    const cappedPages = Math.min(input.maxPages, this.options.config.maxSearchProviderPages);
    const searched = await this.options.searchProvider.searchIndexedPosts({
      ...input,
      maxPages: cappedPages,
    });
    const results = searched.results.map((result) => {
      const haystack = `${result.title}\n${result.snippet}`.toLocaleLowerCase('ko-KR');
      const matchedKeywords = (input.keywords ?? []).filter((keyword) =>
        haystack.includes(keyword.toLocaleLowerCase('ko-KR')),
      );
      return {
        ...result,
        ...(matchedKeywords.length ? { matchedKeywords } : {}),
        ...(input.sort === 'latest' ? { estimatedSort: true } : {}),
        provenance: {
          source: 'brave_index' as const,
          capturedAt: this.options.now().toISOString(),
          provider: 'brave',
        },
      };
    });
    if (input.sort === 'latest') {
      results.sort((left, right) =>
        left.galleryId === right.galleryId ? Number(right.postNo) - Number(left.postNo) : 0,
      );
    }
    return {
      provider: 'brave',
      dataSource: 'brave_index',
      results,
      totalFetched: searched.totalFetched ?? searched.results.length,
      reason: searched.reason,
    };
  }

  async importSearchResults(input: {
    format: 'csv' | 'json';
    data: string;
    galleryId?: string;
    replace: boolean;
  }) {
    const importedAt = this.options.now().toISOString();
    const parsed = parseSearchResultsImport(input.format, input.data, input.galleryId, importedAt, {
      maxBytes: this.options.config.maxImportBytes,
      maxRows: this.options.config.maxImportedRows,
    });
    const stored = await this.options.searchIndex.upsert(parsed.records, input.replace);
    return {
      status: 'imported' as const,
      source: input.format === 'csv' ? ('deep_search_export' as const) : ('user_import' as const),
      accepted: stored.accepted,
      duplicates: stored.duplicates,
      rejected: parsed.rejected,
      diagnostics: parsed.diagnostics,
      importedAt,
      totalIndexed: stored.total,
    };
  }

  async listGallery(input: {
    galleryId: string;
    galleryType?: GalleryType;
    page: number;
    boardType: 'all' | 'recommend' | 'notice';
    limit: number;
    sourceMode: 'local' | 'authorized';
  }) {
    if (input.sourceMode === 'authorized') {
      const provider = this.authorizedProvider(input.galleryId);
      const items = (await provider.listGalleryPosts(input)).slice(0, input.limit);
      return {
        ...input,
        source: 'authorized_direct' as const,
        items,
        count: items.length,
        partial: items.length >= input.limit,
        provenance: { source: 'authorized_direct' as const, provider: provider.id },
      };
    }
    const result = await this.options.searchIndex.listGallery(
      input.galleryId,
      input.galleryType,
      input.page,
      input.limit,
    );
    return {
      ...input,
      source: 'deep_search_export' as const,
      items: result.items.map((record) => ({
        postNo: record.postNo,
        canonicalUrl: record.canonicalUrl,
        title: record.title,
        ...(record.dateLabel ? { dateLabel: record.dateLabel } : {}),
        ...(record.commentCount === undefined ? {} : { commentCount: record.commentCount }),
        ...(record.views === undefined ? {} : { views: record.views }),
        ...(record.recommends === undefined ? {} : { recommends: record.recommends }),
        contentAvailable: false,
      })),
      count: result.items.length,
      partial: input.page * input.limit < result.total,
      provenance: { source: 'deep_search_export' as const },
      ...(result.total === 0 ? { reason: 'EMPTY_LOCAL_INDEX' } : {}),
    };
  }

  async read(url: string, sourceMode: 'local' | 'authorized'): Promise<NormalizedPost | null> {
    const parsed = parseDcPostUrl(url);
    if (sourceMode === 'local') {
      const record = await this.options.postStore.get(parsed.canonicalUrl);
      return record ? localPost(record) : null;
    }
    const provider = this.authorizedProvider(parsed.galleryId);
    return provider.getPost(parsed);
  }

  async readParsed(input: ParsedPostUrl, sourceMode: 'local' | 'authorized') {
    return this.read(input.canonicalUrl, sourceMode);
  }

  private authorizedProvider(galleryId: string): RemoteReadProvider {
    if (this.options.config.remoteMode === 'disabled') {
      throw new DomainError('REMOTE_DISABLED', 'Authorized direct reads are disabled.', false);
    }
    if (
      (!this.options.config.allowedGalleries.has('*') &&
        !this.options.config.allowedGalleries.has(galleryId)) ||
      !this.options.remoteProvider ||
      !this.remoteLimiter
    ) {
      throw new DomainError(
        'REMOTE_NOT_AUTHORIZED',
        'This gallery is not authorized for direct reads.',
        false,
      );
    }
    this.remoteLimiter.take();
    return this.options.remoteProvider;
  }
}
