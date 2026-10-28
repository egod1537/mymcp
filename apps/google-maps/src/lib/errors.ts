import { z } from 'zod';

export const errorCodes = [
  'INVALID_ARGUMENT',
  'CONFIG_MISSING',
  'UPSTREAM_PERMISSION_DENIED',
  'UPSTREAM_QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_BAD_RESPONSE',
  'TIMEOUT',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorOptions {
  cause?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
  upstreamStatus?: number | string | null;
}

export class GoogleMapsError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly upstreamStatus: number | string | null;

  constructor(code: ErrorCode, message: string, options: ErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'GoogleMapsError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

export interface PublicErrorResult {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    upstream_status: number | string | null;
  };
}

function zodMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'The request arguments are invalid.';
  }

  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}

export function invalidArgument(error: z.ZodError | string): GoogleMapsError {
  return new GoogleMapsError(
    'INVALID_ARGUMENT',
    typeof error === 'string' ? error : zodMessage(error),
  );
}

export function toGoogleMapsError(error: unknown): GoogleMapsError {
  if (error instanceof GoogleMapsError) {
    return error;
  }
  if (error instanceof z.ZodError) {
    return invalidArgument(error);
  }

  return new GoogleMapsError(
    'INTERNAL_ERROR',
    'The request could not be completed because of an internal error.',
    { cause: error },
  );
}

export function toPublicError(error: unknown): PublicErrorResult {
  const safe = toGoogleMapsError(error);
  return {
    ok: false,
    error: {
      code: safe.code,
      message: safe.message,
      retryable: safe.retryable,
      upstream_status: safe.upstreamStatus,
    },
  };
}
