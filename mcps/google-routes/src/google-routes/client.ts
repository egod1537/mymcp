import { MemoryCache, createCacheKey } from "../utils/cache.js";
import { logger, type Logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import {
  ConfigurationError,
  GoogleRoutesApiError,
  RateLimitError,
  TimeoutError,
  readPositiveInteger,
} from "../utils/validation.js";
import type {
  GoogleComputeRouteMatrixRequest,
  GoogleComputeRoutesRequest,
  GoogleComputeRoutesResponse,
  GoogleErrorResponse,
  GoogleRouteMatrixElement,
} from "./types.js";

const DEFAULT_BASE_URL = "https://routes.googleapis.com";
const COMPUTE_ROUTES_PATH = "/directions/v2:computeRoutes";
const COMPUTE_MATRIX_PATH = "/distanceMatrix/v2:computeRouteMatrix";

class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}

export interface GoogleRoutesClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
  cacheTtlMs?: number;
  fetch?: typeof fetch;
  logger?: Logger;
  maxRetries?: number;
}

export class GoogleRoutesClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly cache: MemoryCache;
  private readonly limiter: ConcurrencyLimiter;
  private readonly log: Logger;
  private readonly maxRetries: number;

  constructor(options: GoogleRoutesClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? readPositiveInteger(
      process.env.GOOGLE_ROUTES_TIMEOUT_MS,
      10_000,
      "GOOGLE_ROUTES_TIMEOUT_MS",
    );
    const maxConcurrency = options.maxConcurrency ?? readPositiveInteger(
      process.env.GOOGLE_ROUTES_MAX_CONCURRENCY,
      4,
      "GOOGLE_ROUTES_MAX_CONCURRENCY",
    );
    const cacheTtlMs = options.cacheTtlMs ?? readPositiveInteger(
      process.env.GOOGLE_ROUTES_CACHE_TTL_MS,
      300_000,
      "GOOGLE_ROUTES_CACHE_TTL_MS",
    );
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.cache = new MemoryCache(cacheTtlMs);
    this.limiter = new ConcurrencyLimiter(maxConcurrency);
    this.log = options.logger ?? logger;
    this.maxRetries = options.maxRetries ?? 3;
  }

  get logger(): Logger {
    return this.log;
  }

  async computeRoutes(
    request: GoogleComputeRoutesRequest,
    fieldMask: string,
  ): Promise<GoogleComputeRoutesResponse> {
    return this.post<GoogleComputeRoutesResponse>(COMPUTE_ROUTES_PATH, request, fieldMask, {
      travelMode: request.travelMode,
    });
  }

  async computeRouteMatrix(
    request: GoogleComputeRouteMatrixRequest,
    fieldMask: string,
  ): Promise<GoogleRouteMatrixElement[]> {
    return this.post<GoogleRouteMatrixElement[]>(COMPUTE_MATRIX_PATH, request, fieldMask, {
      travelMode: request.travelMode,
      originsCount: request.origins.length,
      destinationsCount: request.destinations.length,
      matrixElements: request.origins.length * request.destinations.length,
    });
  }

  private async post<T>(
    path: string,
    body: unknown,
    fieldMask: string,
    metadata: Record<string, unknown>,
  ): Promise<T> {
    if (!this.apiKey) throw new ConfigurationError("Missing GOOGLE_MAPS_API_KEY.");

    const cacheKey = createCacheKey(path, { body, fieldMask });
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== undefined) {
      this.log.debug("Google Routes cache hit", { endpoint: path, ...metadata });
      return cached;
    }
    this.log.debug("Google Routes cache miss", { endpoint: path, ...metadata });

    const result = await withRetry(
      () => this.limiter.run(() => this.requestOnce<T>(path, body, fieldMask, metadata)),
      {
        maxRetries: this.maxRetries,
        baseDelayMs: 500,
        shouldRetry: (error) => this.isRetryable(error),
        onRetry: (error, retryNumber, delayMs) => {
          this.log.warn("Retrying Google Routes request", {
            endpoint: path,
            retryNumber,
            delayMs,
            error: error instanceof Error ? error.message : String(error),
            ...metadata,
          });
        },
      },
    );
    this.cache.set(cacheKey, result);
    return result;
  }

  private async requestOnce<T>(
    path: string,
    body: unknown,
    fieldMask: string,
    metadata: Record<string, unknown>,
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.apiKey ?? "",
          "X-Goog-FieldMask": fieldMask,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      this.log.debug("Google Routes response", {
        endpoint: path,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
        ...metadata,
      });

      if (!response.ok) {
        const errorBody = await this.readError(response);
        const message = errorBody.error?.message ?? (response.statusText || "Unknown upstream error");
        const apiStatus = errorBody.error?.status;
        if (response.status === 429) {
          throw new RateLimitError(
            `Google Routes API rate limited the request: ${apiStatus ?? message}.`,
            response.status,
            apiStatus,
          );
        }
        throw new GoogleRoutesApiError(
          `Google Routes API rejected the request: ${apiStatus ?? message}.`,
          response.status,
          apiStatus,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (timedOut) {
        throw new TimeoutError(`Google Routes API request timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readError(response: Response): Promise<GoogleErrorResponse> {
    try {
      return (await response.json()) as GoogleErrorResponse;
    } catch {
      return {};
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof TimeoutError || error instanceof RateLimitError) return true;
    if (error instanceof GoogleRoutesApiError) return (error.httpStatus ?? 0) >= 500;
    return error instanceof TypeError;
  }
}
