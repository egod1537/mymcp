import type { ConsoleErrorCode } from '@mymcp/console-contracts';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ConsoleErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown> | undefined;

  constructor(options: {
    statusCode: number;
    code: ConsoleErrorCode;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
  }) {
    super(options.message);
    this.name = 'HttpError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}
