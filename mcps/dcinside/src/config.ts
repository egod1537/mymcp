import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DomainError } from './errors.js';

export interface RuntimeConfig {
  braveSearchApiKey?: string;
  dataDir: string;
  searchTimeoutMs: number;
  maxSearchesPerMinute: number;
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
  };
}
