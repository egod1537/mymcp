export interface AppErrorOptions {
  cause?: unknown;
  details?: Readonly<Record<string, string | number | boolean>>;
}

export class AppError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(message: string, code: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.details = options.details ?? {};
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 'CONFIGURATION_ERROR', options);
  }
}

export class InputError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 'INPUT_ERROR', options);
  }
}
