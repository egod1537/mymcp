export const errorCodes = [
  'INPUT_INVALID',
  'CONFIGURATION_REQUIRED',
  'SEARCH_PROVIDER_AUTH',
  'SEARCH_PROVIDER_QUOTA',
  'SEARCH_PROVIDER_DOWN',
  'NOT_IMPORTED',
  'DATA_CORRUPT',
  'STORAGE_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
}

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly retryable?: boolean;

  constructor(code: ErrorCode, message: string, retryable?: boolean) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.retryable = retryable;
  }
}

export function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof DomainError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.retryable === undefined ? {} : { retryable: error.retryable }),
    };
  }

  return {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected internal error occurred.',
    retryable: false,
  };
}
