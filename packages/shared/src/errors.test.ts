import { describe, expect, it } from 'vitest';

import { ConfigurationError, InputError } from './errors.js';

describe('application errors', () => {
  it('keeps stable error codes and typed details', () => {
    const error = new InputError('Invalid name', { details: { field: 'name' } });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('INPUT_ERROR');
    expect(error.details).toEqual({ field: 'name' });
  });

  it('preserves an underlying cause', () => {
    const cause = new Error('missing value');
    const error = new ConfigurationError('Configuration failed', { cause });

    expect(error.cause).toBe(cause);
  });
});
