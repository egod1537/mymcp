import { z } from 'zod';

import { GoogleMapsError } from './lib/errors.js';
import type { LogLevel } from './lib/logger.js';

const integerEnv = (name: string, minimum: number, maximum: number, defaultValue: number) =>
  z
    .string()
    .default(String(defaultValue))
    .refine((value) => /^\d+$/.test(value), `${name} must be an integer.`)
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

const envSchema = z.object({
  GOOGLE_MAPS_API_KEY: z.string().trim().min(1).max(512),
  GOOGLE_MAPS_HTTP_TIMEOUT_MS: integerEnv('GOOGLE_MAPS_HTTP_TIMEOUT_MS', 100, 8_000, 8_000),
  GOOGLE_MAPS_MAX_RETRIES: integerEnv('GOOGLE_MAPS_MAX_RETRIES', 0, 2, 2),
  GOOGLE_MAPS_CALLS_PER_MINUTE: integerEnv('GOOGLE_MAPS_CALLS_PER_MINUTE', 1, 300, 30),
  GOOGLE_MAPS_MAX_CONCURRENT_CALLS: integerEnv('GOOGLE_MAPS_MAX_CONCURRENT_CALLS', 1, 2, 2),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  GOOGLE_MAPS_LIVE_TESTS: z
    .enum(['0', '1'])
    .default('0')
    .transform((value) => value === '1'),
});

export interface AppConfig {
  apiKey: string;
  callsPerMinute: number;
  httpTimeoutMs: number;
  liveTestsEnabled: boolean;
  logLevel: LogLevel;
  maxConcurrentCalls: number;
  maxRetries: number;
}

export type EnvironmentSource = Readonly<Record<string, unknown>>;

export function loadConfig(env: EnvironmentSource = process.env): AppConfig {
  if (typeof env.GOOGLE_MAPS_API_KEY !== 'string' || !env.GOOGLE_MAPS_API_KEY.trim()) {
    throw new GoogleMapsError(
      'CONFIG_MISSING',
      'GOOGLE_MAPS_API_KEY is required. Set it in the MCP client environment before starting the server.',
    );
  }

  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const variable = parsed.error.issues[0]?.path[0] ?? 'environment';
    throw new GoogleMapsError(
      'CONFIG_MISSING',
      `Invalid ${String(variable)} configuration. Check the documented environment variable range.`,
    );
  }

  return {
    apiKey: parsed.data.GOOGLE_MAPS_API_KEY,
    httpTimeoutMs: parsed.data.GOOGLE_MAPS_HTTP_TIMEOUT_MS,
    maxRetries: parsed.data.GOOGLE_MAPS_MAX_RETRIES,
    callsPerMinute: parsed.data.GOOGLE_MAPS_CALLS_PER_MINUTE,
    maxConcurrentCalls: parsed.data.GOOGLE_MAPS_MAX_CONCURRENT_CALLS,
    logLevel: parsed.data.LOG_LEVEL,
    liveTestsEnabled: parsed.data.GOOGLE_MAPS_LIVE_TESTS,
  };
}
