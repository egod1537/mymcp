import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('keeps search optional and applies documented defaults', () => {
    const config = loadConfig({});
    expect(config.braveSearchApiKey).toBeUndefined();
    expect(config.dataDir).toContain('.local/share/mymcp/dcinside');
    expect(config.searchTimeoutMs).toBe(8_000);
    expect(config.maxSearchesPerMinute).toBe(10);
  });

  it('clamps numeric settings and accepts a data directory override', () => {
    expect(
      loadConfig({
        BRAVE_SEARCH_API_KEY: ' key ',
        DCINSIDE_DATA_DIR: '/tmp/dcinside-test-data',
        DCINSIDE_SEARCH_TIMEOUT_MS: '999999',
        DCINSIDE_MAX_SEARCHES_PER_MINUTE: '999',
      }),
    ).toMatchObject({
      braveSearchApiKey: 'key',
      dataDir: '/tmp/dcinside-test-data',
      searchTimeoutMs: 15_000,
      maxSearchesPerMinute: 30,
      remoteMode: 'disabled',
      maxImportedRows: 1_000,
      maxImportBytes: 1_048_576,
      maxSearchProviderPages: 2,
    });
    expect(
      loadConfig({
        DCINSIDE_SEARCH_TIMEOUT_MS: '1',
        DCINSIDE_MAX_SEARCHES_PER_MINUTE: '0',
      }),
    ).toMatchObject({ searchTimeoutMs: 1_000, maxSearchesPerMinute: 1 });
  });

  it('rejects malformed numeric environment values without exposing secrets', () => {
    expect(() => loadConfig({ DCINSIDE_SEARCH_TIMEOUT_MS: 'fast' })).toThrowError(
      /DCINSIDE_SEARCH_TIMEOUT_MS/,
    );
  });

  it('keeps direct reads disabled by default and does not invent an authorized rate limit', () => {
    const disabled = loadConfig({});
    expect(disabled.remoteMode).toBe('disabled');
    expect(disabled.remoteRateLimitPerMinute).toBeUndefined();

    const authorized = loadConfig({
      DCINSIDE_REMOTE_MODE: 'authorized',
      DCINSIDE_ALLOWED_GALLERIES: 'japan, test ',
    });
    expect([...authorized.allowedGalleries]).toEqual(['japan', 'test']);
    expect(authorized.remoteRateLimitPerMinute).toBeUndefined();
  });
});
