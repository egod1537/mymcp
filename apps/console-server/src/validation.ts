import type { z } from 'zod';

import { HttpError } from './http-error.js';

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed.',
      details: {
        issues: parsed.error.issues.map(({ code, path, message }) => ({ code, path, message })),
      },
    });
  }
  return parsed.data;
}
