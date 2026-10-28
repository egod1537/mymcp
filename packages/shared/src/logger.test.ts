import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('writes structured entries to stderr and redacts sensitive fields', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const logger = createLogger('test-component');

    logger.info('started', { port: 3000, apiKey: 'must-not-appear' });

    expect(write).toHaveBeenCalledOnce();
    const entry = JSON.parse(String(write.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      component: 'test-component',
      message: 'started',
      port: 3000,
      apiKey: '[REDACTED]',
    });
  });
});
