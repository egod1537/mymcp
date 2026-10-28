import { parseDcPostUrl } from '../core/dc-url.js';
import { searchPostsInputSchema, type SearchPostsInput } from '../core/schemas.js';
import { sanitizeStoredText } from '../core/text.js';
import { DomainError } from '../errors.js';
import type { IndexedPostHit, IndexedPostSearch, SearchProvider } from './search-provider.js';

export const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';

const FRESHNESS_VALUES = {
  any: undefined,
  day: 'pd',
  week: 'pw',
  month: 'pm',
  year: 'py',
} as const;

interface BraveWebResult {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  age?: unknown;
}

export interface SearchRateLimiter {
  take(): void;
}

export class SlidingWindowSearchLimiter implements SearchRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maximumPerMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): void {
    const current = this.now();
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? current) <= current - 60_000) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maximumPerMinute) {
      throw new DomainError(
        'SEARCH_PROVIDER_QUOTA',
        'Local search rate limit reached; try again after one minute.',
        true,
      );
    }
    this.timestamps.push(current);
  }
}

const processLimiters = new Map<number, SlidingWindowSearchLimiter>();

function processLimiter(maximumPerMinute: number): SlidingWindowSearchLimiter {
  let limiter = processLimiters.get(maximumPerMinute);
  if (!limiter) {
    limiter = new SlidingWindowSearchLimiter(maximumPerMinute);
    processLimiters.set(maximumPerMinute, limiter);
  }
  return limiter;
}

export interface BraveSearchProviderOptions {
  apiKey?: string;
  timeoutMs?: number;
  maxSearchesPerMinute?: number;
  fetchImpl?: typeof fetch;
  rateLimiter?: SearchRateLimiter;
  sleep?: (milliseconds: number) => Promise<void>;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function decodeEntity(entity: string): string {
  const normalized = entity.toLowerCase();
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };
  if (named[normalized] !== undefined) return named[normalized];
  const decimal = /^&#(\d+);$/.exec(normalized)?.[1];
  const hexadecimal = /^&#x([0-9a-f]+);$/.exec(normalized)?.[1];
  const codePoint =
    decimal === undefined ? Number.parseInt(hexadecimal ?? '', 16) : Number(decimal);
  if (Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
    return String.fromCodePoint(codePoint);
  }
  return entity;
}

export function cleanProviderText(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') return '';
  const withoutMarkup = value
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#\d+|#x[0-9a-f]+);/gi, decodeEntity);
  return sanitizeStoredText(withoutMarkup).trim().slice(0, maximumLength);
}

function sanitizeSearchQuery(query: string): string {
  const sanitized = sanitizeStoredText(query)
    .replace(/\bsite:\S+/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (sanitized.length === 0) {
    throw new DomainError(
      'INPUT_INVALID',
      'Search query must contain terms other than a site override.',
      false,
    );
  }
  return sanitized;
}

function retryAfterMilliseconds(response: Response, fallback: number): number {
  const value = response.headers.get('retry-after');
  if (!value) return fallback;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_000, Math.round(seconds * 1_000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(2_000, Math.max(0, date - Date.now()));
  return fallback;
}

function readWebResults(payload: unknown): BraveWebResult[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new DomainError('SEARCH_PROVIDER_DOWN', 'Search provider returned malformed data.', true);
  }
  const web = (payload as { web?: unknown }).web;
  if (web === undefined) return [];
  if (typeof web !== 'object' || web === null || Array.isArray(web)) {
    throw new DomainError('SEARCH_PROVIDER_DOWN', 'Search provider returned malformed data.', true);
  }
  const results = (web as { results?: unknown }).results;
  if (results === undefined) return [];
  if (!Array.isArray(results)) {
    throw new DomainError('SEARCH_PROVIDER_DOWN', 'Search provider returned malformed data.', true);
  }
  return results.filter(
    (result): result is BraveWebResult => typeof result === 'object' && result !== null,
  );
}

export class BraveSearchProvider implements SearchProvider {
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly rateLimiter: SearchRateLimiter;
  private readonly wait: (milliseconds: number) => Promise<void>;

  constructor(options: BraveSearchProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.rateLimiter = options.rateLimiter ?? processLimiter(options.maxSearchesPerMinute ?? 10);
    this.wait = options.sleep ?? sleep;
  }

  async searchIndexedPosts(input: SearchPostsInput): Promise<IndexedPostSearch> {
    const validated = searchPostsInputSchema.safeParse(input);
    if (!validated.success) {
      throw new DomainError(
        'INPUT_INVALID',
        'Search input does not match the required schema.',
        false,
      );
    }
    const request = validated.data;
    if (!this.apiKey) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Set BRAVE_SEARCH_API_KEY to use dc_search_posts; local parse/import/get tools work without it.',
        false,
      );
    }
    this.rateLimiter.take();

    const requestUrl = new URL(BRAVE_SEARCH_ENDPOINT);
    requestUrl.searchParams.set(
      'q',
      `site:gall.dcinside.com ${sanitizeSearchQuery(request.query)}`,
    );
    requestUrl.searchParams.set('country', 'KR');
    requestUrl.searchParams.set('search_lang', 'ko');
    requestUrl.searchParams.set('ui_lang', 'ko-KR');
    requestUrl.searchParams.set('result_filter', 'web');
    requestUrl.searchParams.set('safesearch', 'moderate');
    requestUrl.searchParams.set('text_decorations', 'false');
    requestUrl.searchParams.set('count', String(request.limit));
    requestUrl.searchParams.set('offset', '0');
    const freshness = FRESHNESS_VALUES[request.freshness];
    if (freshness) requestUrl.searchParams.set('freshness', freshness);

    const payload = await this.request(requestUrl);
    const hits: IndexedPostHit[] = [];
    const seen = new Set<string>();
    for (const candidate of readWebResults(payload)) {
      if (typeof candidate.url !== 'string') continue;
      let parsed;
      try {
        parsed = parseDcPostUrl(candidate.url);
      } catch {
        continue;
      }
      if (request.galleryId !== undefined && parsed.galleryId !== request.galleryId) continue;
      if (request.galleryType !== undefined && parsed.galleryType !== request.galleryType) continue;
      if (seen.has(parsed.canonicalUrl)) continue;
      seen.add(parsed.canonicalUrl);

      const date = cleanProviderText(candidate.age, 100);
      hits.push({
        title: cleanProviderText(candidate.title, 500),
        url: parsed.canonicalUrl,
        snippet: cleanProviderText(candidate.description, 2_000),
        galleryId: parsed.galleryId,
        galleryType: parsed.galleryType,
        postNo: parsed.postNo,
        ...(date ? { dateLabel: `search-index age: ${date}` } : {}),
      });
      if (hits.length >= request.limit) break;
    }

    return { results: hits };
  }

  private async request(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            'X-Subscription-Token': this.apiKey ?? '',
          },
        });
      } catch {
        if (attempt < 2) {
          await this.wait(250 * 2 ** attempt);
          continue;
        }
        throw new DomainError(
          'SEARCH_PROVIDER_DOWN',
          'Search provider request failed or timed out.',
          true,
        );
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 401 || response.status === 403) {
        throw new DomainError(
          'SEARCH_PROVIDER_AUTH',
          'Brave Search rejected the configured API key.',
          false,
        );
      }
      if (response.status === 400) {
        throw new DomainError(
          'INPUT_INVALID',
          'Search provider rejected the search request.',
          false,
        );
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) {
          await this.wait(retryAfterMilliseconds(response, 250 * 2 ** attempt));
          continue;
        }
        if (response.status === 429) {
          throw new DomainError(
            'SEARCH_PROVIDER_QUOTA',
            'Brave Search quota or rate limit was reached.',
            true,
          );
        }
        throw new DomainError(
          'SEARCH_PROVIDER_DOWN',
          'Search provider is temporarily unavailable.',
          true,
        );
      }
      if (!response.ok) {
        throw new DomainError(
          'SEARCH_PROVIDER_DOWN',
          'Search provider request was not successful.',
          false,
        );
      }

      try {
        return (await response.json()) as unknown;
      } catch {
        throw new DomainError(
          'SEARCH_PROVIDER_DOWN',
          'Search provider returned malformed JSON.',
          true,
        );
      }
    }

    throw new DomainError('SEARCH_PROVIDER_DOWN', 'Search provider request failed.', true);
  }
}
