import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DomainError } from './errors.js';

export interface RuntimeConfig {
  braveSearchApiKey?: string;
  dataDir: string;
  searchTimeoutMs: number;
  maxSearchesPerMinute: number;
  remoteMode: 'disabled' | 'authorized';
  allowedGalleries: ReadonlySet<string>;
  remoteRateLimitPerMinute?: number;
  maxImportedRows: number;
  maxImportBytes: number;
  maxSearchProviderPages: number;
}

function boundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim())) {
    throw new DomainError('CONFIGURATION_REQUIRED', `${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainError('CONFIGURATION_REQUIRED', `${name} must be a safe integer.`);
  }
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const key = env.BRAVE_SEARCH_API_KEY?.trim();
  const configuredDataDir = env.DCINSIDE_DATA_DIR?.trim();

  const remoteMode = env.DCINSIDE_REMOTE_MODE?.trim() || 'disabled';
  if (remoteMode !== 'disabled' && remoteMode !== 'authorized') {
    throw new DomainError(
      'CONFIGURATION_REQUIRED',
      'DCINSIDE_REMOTE_MODE must be disabled or authorized.',
    );
  }
  const allowedGalleries = new Set(
    (env.DCINSIDE_ALLOWED_GALLERIES ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const remoteRateValue = env.DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE?.trim();

  return {
    ...(key ? { braveSearchApiKey: key } : {}),
    dataDir: resolve(configuredDataDir || resolve(homedir(), '.local/share/mymcp/dcinside')),
    searchTimeoutMs: boundedInteger(
      env.DCINSIDE_SEARCH_TIMEOUT_MS,
      'DCINSIDE_SEARCH_TIMEOUT_MS',
      8_000,
      1_000,
      15_000,
    ),
    maxSearchesPerMinute: boundedInteger(
      env.DCINSIDE_MAX_SEARCHES_PER_MINUTE,
      'DCINSIDE_MAX_SEARCHES_PER_MINUTE',
      10,
      1,
      30,
    ),
    remoteMode,
    allowedGalleries,
    ...(remoteRateValue
      ? {
          remoteRateLimitPerMinute: boundedInteger(
            remoteRateValue,
            'DCINSIDE_REMOTE_RATE_LIMIT_PER_MINUTE',
            1,
            1,
            60,
          ),
        }
      : {}),
    maxImportedRows: boundedInteger(
      env.DCINSIDE_MAX_IMPORTED_ROWS,
      'DCINSIDE_MAX_IMPORTED_ROWS',
      1_000,
      1,
      10_000,
    ),
    maxImportBytes: boundedInteger(
      env.DCINSIDE_MAX_IMPORT_BYTES,
      'DCINSIDE_MAX_IMPORT_BYTES',
      1_048_576,
      1_024,
      10_485_760,
    ),
    maxSearchProviderPages: boundedInteger(
      env.DCINSIDE_MAX_SEARCH_PROVIDER_PAGES,
      'DCINSIDE_MAX_SEARCH_PROVIDER_PAGES',
      2,
      1,
      3,
    ),
  };
}
