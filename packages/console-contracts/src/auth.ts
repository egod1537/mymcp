import { z } from 'zod';

export const loginRequestSchema = z
  .object({
    password: z.string().min(1).max(1024),
  })
  .strict();

export const authenticatedSessionSchema = z
  .object({
    apiVersion: z.literal(1),
    authenticated: z.literal(true),
    csrfToken: z.string().min(16),
    authMode: z.enum(['password', 'disabled']).optional(),
  })
  .strict();

export const anonymousSessionSchema = z
  .object({
    apiVersion: z.literal(1),
    authenticated: z.literal(false),
    setupRequired: z.boolean(),
  })
  .strict();

export const sessionResponseSchema = z.union([authenticatedSessionSchema, anonymousSessionSchema]);

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
