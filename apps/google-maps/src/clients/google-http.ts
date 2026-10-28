import type { AppConfig } from '../config.js';
import { GoogleMapsError } from '../lib/errors.js';
import { isRecord, optionalString } from '../lib/normalization.js';

export type GoogleEndpoint = 'placesTextSearch' | 'geocoding' | 'computeRoutes';

const endpointUrls: Record<GoogleEndpoint, string> = {
  placesTextSearch: 'https://places.googleapis.com/v1/places:searchText',
  geocoding: 'https://maps.googleapis.com/maps/api/geocode/json',
  computeRoutes: 'https://routes.googleapis.com/directions/v2:computeRoutes',
};

export interface JsonRequestOptions {
  headers?: Readonly<Record<string, string>>;
  retryOnJsonStatuses?: readonly string[];
}

export interface PostJsonRequest extends JsonRequestOptions {
  body: unknown;
}

export interface GetJsonRequest extends JsonRequestOptions {
  query: Readonly<Record<string, string>>;
}

export interface GoogleHttpClient {
  postJson(endpoint: GoogleEndpoint, request: PostJsonRequest): Promise<unknown>;
  getJson(endpoint: GoogleEndpoint, request: GetJsonRequest): Promise<unknown>;
}

export interface Clock {
  now(): number;
}

export interface GoogleHttpDependencies {
  fetch?: typeof fetch;
  clock?: Clock;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  maxResponseBytes?: number;
}

interface RequestDefinition extends JsonRequestOptions {
  endpoint: GoogleEndpoint;
  method: 'GET' | 'POST';
  query?: Readonly<Record<string, string>>;
  body?: unknown;
}

class RequestGate {
  private readonly timestamps: number[] = [];
  private readonly waiters: Array<() => void> = [];
  private active = 0;

  constructor(
    private readonly callsPerMinute: number,
    private readonly maxConcurrent: number,
    private readonly clock: Clock,
  ) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const now = this.clock.now();
    while (this.timestamps[0] !== undefined && this.timestamps[0] <= now - 60_000) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.callsPerMinute) {
      throw new GoogleMapsError(
        'RATE_LIMITED',
        'The local Google request limit has been reached. Try again later.',
        { retryable: true },
      );
    }
    this.timestamps.push(now);

    if (this.active >= this.maxConcurrent) {
      if (this.waiters.length >= this.callsPerMinute) {
        throw new GoogleMapsError(
          'RATE_LIMITED',
          'Too many Google requests are queued locally. Try again later.',
          { retryable: true },
        );
      }
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const defaultClock: Clock = { now: () => Date.now() };
const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class FetchGoogleHttpClient implements GoogleHttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxResponseBytes: number;
  private readonly gate: RequestGate;

  constructor(
    private readonly config: AppConfig,
    dependencies: GoogleHttpDependencies = {},
  ) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.clock = dependencies.clock ?? defaultClock;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.random = dependencies.random ?? Math.random;
    this.maxResponseBytes = dependencies.maxResponseBytes ?? 1_048_576;
    this.gate = new RequestGate(config.callsPerMinute, config.maxConcurrentCalls, this.clock);
  }

  postJson(endpoint: GoogleEndpoint, request: PostJsonRequest): Promise<unknown> {
    return this.requestWithRetry({
      endpoint,
      method: 'POST',
      body: request.body,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.retryOnJsonStatuses === undefined
        ? {}
        : { retryOnJsonStatuses: request.retryOnJsonStatuses }),
    });
  }

  getJson(endpoint: GoogleEndpoint, request: GetJsonRequest): Promise<unknown> {
    return this.requestWithRetry({
      endpoint,
      method: 'GET',
      query: request.query,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.retryOnJsonStatuses === undefined
        ? {}
        : { retryOnJsonStatuses: request.retryOnJsonStatuses }),
    });
  }

  private async requestWithRetry(definition: RequestDefinition): Promise<unknown> {
    let retryWaitUsed = 0;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.gate.run(() => this.requestOnce(definition));
      } catch (error) {
        const mapped =
          error instanceof GoogleMapsError
            ? error
            : new GoogleMapsError(
                'UPSTREAM_UNAVAILABLE',
                'The Google service could not be reached.',
                { cause: error, retryable: true },
              );

        if (attempt >= this.config.maxRetries || !this.canRetry(mapped)) {
          throw mapped;
        }

        const exponential = 250 * 2 ** attempt;
        const jitter = Math.floor(this.random() * 100);
        const requestedWait = mapped.retryAfterMs ?? exponential + jitter;
        const delay = Math.min(requestedWait, 2_000, 5_000 - retryWaitUsed);
        if (delay <= 0) {
          throw mapped;
        }
        retryWaitUsed += delay;
        await this.sleep(delay);
      }
    }
  }

  private canRetry(error: GoogleMapsError): boolean {
    if (!error.retryable) {
      return false;
    }
    if (error.code === 'RATE_LIMITED' && error.upstreamStatus === null) {
      return false;
    }
    return true;
  }

  private async requestOnce(definition: RequestDefinition): Promise<unknown> {
    const url = new URL(endpointUrls[definition.endpoint]);
    const headers = new Headers(definition.headers);

    let body: string | undefined;
    if (definition.method === 'GET') {
      for (const [key, value] of Object.entries(definition.query ?? {})) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set('key', this.config.apiKey);
    } else {
      headers.set('X-Goog-Api-Key', this.config.apiKey);
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(definition.body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.httpTimeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, {
        method: definition.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GoogleMapsError('TIMEOUT', 'The Google request timed out.', {
          cause: error,
          retryable: true,
        });
      }
      throw new GoogleMapsError(
        'UPSTREAM_UNAVAILABLE',
        'The Google service could not be reached.',
        { cause: error, retryable: true },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (new TextEncoder().encode(text).byteLength > this.maxResponseBytes) {
      throw new GoogleMapsError(
        'UPSTREAM_BAD_RESPONSE',
        'The Google response exceeded the allowed size.',
        { upstreamStatus: response.status },
      );
    }

    let json: unknown;
    try {
      json = text.length === 0 ? {} : JSON.parse(text);
    } catch (error) {
      if (!response.ok) {
        throw this.mapHttpError(response, undefined);
      }
      throw new GoogleMapsError('UPSTREAM_BAD_RESPONSE', 'Google returned malformed JSON.', {
        cause: error,
        upstreamStatus: response.status,
      });
    }

    if (!response.ok) {
      throw this.mapHttpError(response, json);
    }

    const topLevelStatus = isRecord(json) ? optionalString(json.status) : null;
    if (topLevelStatus !== null && definition.retryOnJsonStatuses?.includes(topLevelStatus)) {
      throw new GoogleMapsError(
        'UPSTREAM_UNAVAILABLE',
        'Google reported a temporary service error.',
        { retryable: true, upstreamStatus: topLevelStatus },
      );
    }

    return json;
  }

  private mapHttpError(response: Response, json: unknown): GoogleMapsError {
    const errorObject = isRecord(json) && isRecord(json.error) ? json.error : undefined;
    const googleStatus = optionalString(errorObject?.status);
    const upstreamStatus: number | string = googleStatus ?? response.status;
    const retryAfterMs = this.parseRetryAfter(response.headers.get('retry-after'));

    if (
      response.status === 401 ||
      response.status === 403 ||
      googleStatus === 'PERMISSION_DENIED'
    ) {
      return new GoogleMapsError(
        'UPSTREAM_PERMISSION_DENIED',
        'Google rejected the API credentials or API access. Check key restrictions, billing, and enabled APIs.',
        { upstreamStatus },
      );
    }
    if (googleStatus === 'RESOURCE_EXHAUSTED') {
      return new GoogleMapsError('UPSTREAM_QUOTA_EXCEEDED', 'The Google API quota is exhausted.', {
        retryable: response.status === 429,
        upstreamStatus,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    if (response.status === 429) {
      return new GoogleMapsError('RATE_LIMITED', 'Google is rate limiting requests.', {
        retryable: true,
        upstreamStatus,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    if ([500, 502, 503, 504].includes(response.status)) {
      return new GoogleMapsError(
        'UPSTREAM_UNAVAILABLE',
        'The Google service is temporarily unavailable.',
        {
          retryable: true,
          upstreamStatus,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        },
      );
    }
    if (response.status === 400 || googleStatus === 'INVALID_ARGUMENT') {
      return new GoogleMapsError('INVALID_ARGUMENT', 'Google rejected the request arguments.', {
        upstreamStatus,
      });
    }

    return new GoogleMapsError(
      'UPSTREAM_BAD_RESPONSE',
      'Google returned an unexpected HTTP error.',
      { upstreamStatus },
    );
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (value === null) {
      return undefined;
    }
    if (/^\d+(?:\.\d+)?$/.test(value)) {
      return Math.max(0, Math.round(Number(value) * 1_000));
    }
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - this.clock.now()) : undefined;
  }
}
