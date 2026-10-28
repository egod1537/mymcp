import { TtlCache } from "../utils/cache.js";
import { Logger } from "../utils/logger.js";
import { RateLimiter } from "../utils/rate-limit.js";
import { withRetry } from "../utils/retry.js";
import { isGalleryPage } from "./parser.js";
import type { GetCommentsOptions } from "./comments.js";
import type { GetGalleryPostsOptions } from "./gallery.js";
import type { PostReference } from "./post.js";
import type { SearchGalleryPostsOptions } from "./search.js";
import type { Comment, GalleryPostList, GalleryType, ParsedPost, SearchResult } from "./types.js";

const BASE_URL = "https://gall.dcinside.com";

export interface DcinsideClientOptions {
  requestIntervalMs?: number;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
  userAgent?: string;
  acceptLanguage?: string;
  logger?: Logger;
  galleryCacheTtlMs?: number;
  postCacheTtlMs?: number;
  commentCacheTtlMs?: number;
}

export class HttpStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "HttpStatusError";
  }
}

function envInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export function galleryPath(type: GalleryType): string {
  switch (type) {
    case "major": return "/board";
    case "minor": return "/mgallery/board";
    case "mini": return "/mini/board";
  }
}

export function galleryTypeCode(type: GalleryType): string {
  switch (type) {
    case "major": return "G";
    case "minor": return "M";
    case "mini": return "MI";
  }
}

export class DcinsideClient {
  readonly logger: Logger;
  private readonly limiter: RateLimiter;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly acceptLanguage: string;
  private readonly galleryCache: TtlCache<string>;
  private readonly postCache: TtlCache<string>;
  private readonly commentCache: TtlCache<unknown>;
  private readonly galleryTypeCache = new TtlCache<GalleryType>(30 * 60_000);
  private readonly cookies = new Map<string, string>();

  constructor(options: DcinsideClientOptions = {}) {
    this.logger = options.logger ?? new Logger();
    this.limiter = new RateLimiter(
      options.requestIntervalMs ?? envInteger("DC_REQUEST_INTERVAL_MS", 800, 0),
      options.maxConcurrency ?? envInteger("DC_MAX_CONCURRENCY", 2, 1),
    );
    this.timeoutMs = options.requestTimeoutMs ?? envInteger("DC_REQUEST_TIMEOUT_MS", 10_000, 1);
    this.userAgent = options.userAgent ?? process.env.DC_USER_AGENT ?? "mymcp-dcinside/0.1 (+https://github.com/egod1537/mymcp)";
    this.acceptLanguage = options.acceptLanguage ?? "ko-KR,ko;q=0.9,en;q=0.7";
    this.galleryCache = new TtlCache(options.galleryCacheTtlMs ?? 30_000);
    this.postCache = new TtlCache(options.postCacheTtlMs ?? 5 * 60_000);
    this.commentCache = new TtlCache(options.commentCacheTtlMs ?? 60_000);
  }

  async getGalleryPosts(options: GetGalleryPostsOptions): Promise<GalleryPostList> {
    const { getGalleryPosts } = await import("./gallery.js");
    return getGalleryPosts(this, options);
  }

  async searchGalleryPosts(options: SearchGalleryPostsOptions): Promise<SearchResult> {
    const { searchGalleryPosts } = await import("./search.js");
    return searchGalleryPosts(this, options);
  }

  async getPost(reference: PostReference): Promise<ParsedPost> {
    const { getPost } = await import("./post.js");
    return getPost(this, reference);
  }

  async getComments(options: GetCommentsOptions): Promise<Comment[]> {
    const { getComments } = await import("./comments.js");
    return getComments(this, options);
  }

  async detectGalleryType(galleryId: string): Promise<GalleryType> {
    const cached = this.galleryTypeCache.get(galleryId);
    if (cached) return cached;
    for (const type of ["major", "minor", "mini"] as const) {
      try {
        const query = new URLSearchParams({ id: galleryId, page: "1" });
        const html = await this.getGalleryHtml(type, query);
        if (isGalleryPage(html, galleryId)) {
          this.galleryTypeCache.set(galleryId, type);
          this.logger.debug("gallery type detected", { galleryId, galleryType: type });
          return type;
        }
      } catch (error) {
        if (error instanceof HttpStatusError && error.status !== 404) throw error;
      }
    }
    throw new Error(`Gallery not found: ${galleryId}`);
  }

  rememberGalleryType(galleryId: string, type: GalleryType): void {
    this.galleryTypeCache.set(galleryId, type);
  }

  async getGalleryHtml(type: GalleryType, query: URLSearchParams): Promise<string> {
    const url = new URL(`${galleryPath(type)}/lists/?${query}`, BASE_URL).toString();
    const cached = this.galleryCache.get(url);
    if (cached !== undefined) return cached;
    const text = await this.getText(url);
    this.galleryCache.set(url, text);
    return text;
  }

  async getPostHtml(galleryId: string, postId: string, type: GalleryType): Promise<{ html: string; url: string }> {
    const query = new URLSearchParams({ id: galleryId, no: postId });
    const url = new URL(`${galleryPath(type)}/view/?${query}`, BASE_URL).toString();
    const cached = this.postCache.get(url);
    if (cached !== undefined) return { html: cached, url };
    const referer = new URL(`${galleryPath(type)}/lists/?id=${encodeURIComponent(galleryId)}`, BASE_URL).toString();
    const html = await this.getText(url, referer);
    this.postCache.set(url, html);
    return { html, url };
  }

  async getCommentsData(
    galleryId: string,
    postId: string,
    type: GalleryType,
    token: string,
    page: number,
    sort: "D" | "N" | "R",
    referer: string,
  ): Promise<unknown> {
    const cacheKey = `${type}:${galleryId}:${postId}:${page}:${sort}`;
    const cached = this.commentCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const form = new URLSearchParams({
      id: galleryId,
      no: postId,
      cmt_id: galleryId,
      cmt_no: postId,
      e_s_n_o: token,
      comment_page: String(page),
      sort,
      prevCnt: "0",
      board_type: "",
      _GALLTYPE_: galleryTypeCode(type),
    });
    const data = await this.postFormJson("/board/comment/", form, referer);
    this.commentCache.set(cacheKey, data);
    return data;
  }

  private async getText(url: string, referer?: string): Promise<string> {
    const response = await this.request(url, { method: "GET" }, referer);
    return response.text();
  }

  private async postFormJson(pathOrUrl: string, form: URLSearchParams, referer: string): Promise<unknown> {
    const url = new URL(pathOrUrl, BASE_URL).toString();
    const response = await this.request(url, {
      method: "POST",
      body: form,
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      },
    }, referer);
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Failed to fetch comments: upstream returned non-JSON data (${text.slice(0, 80)})`);
    }
  }

  private async request(url: string, init: RequestInit, referer?: string): Promise<Response> {
    return this.limiter.schedule(() => withRetry(async () => {
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const headers = new Headers(init.headers);
      headers.set("accept", "text/html,application/json;q=0.9,*/*;q=0.8");
      headers.set("accept-language", this.acceptLanguage);
      headers.set("user-agent", this.userAgent);
      if (referer) headers.set("referer", referer);
      // The comments endpoint requires the anonymous PHP session established by the post GET.
      if (this.cookies.size > 0) headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
      this.logger.debug("request started", { method: init.method ?? "GET", url });
      try {
        const response = await fetch(url, { ...init, headers, signal: controller.signal, redirect: "follow" });
        this.captureAnonymousCookies(response);
        this.logger.debug("request completed", {
          method: init.method ?? "GET",
          url,
          status: response.status,
          durationMs: Date.now() - startedAt,
        });
        if (!response.ok) {
          const message = response.status === 429 ? "Rate limited by upstream" : `DCInside request failed with HTTP ${response.status}`;
          throw new HttpStatusError(response.status, message);
        }
        return response;
      } finally {
        clearTimeout(timeout);
      }
    }, {
      attempts: 4,
      baseDelayMs: 500,
      shouldRetry: (error) => !(error instanceof HttpStatusError) || error.status === 408 || error.status === 429 || error.status >= 500,
      onRetry: (error, attempt, delayMs) => this.logger.debug("request retry scheduled", {
        url,
        attempt,
        delayMs,
        error: error instanceof Error ? error.message : String(error),
      }),
    }));
  }

  private captureAnonymousCookies(response: Response): void {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      if (!pair) continue;
      const separator = pair.indexOf("=");
      if (separator <= 0) continue;
      this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}
