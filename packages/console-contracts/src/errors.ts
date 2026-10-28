import { z } from 'zod';

export const consoleErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'AUTH_NOT_CONFIGURED',
  'ALREADY_BUSY',
  'BUILD_REQUIRED',
  'CSRF_REQUIRED',
  'FORBIDDEN',
  'INTERNAL_ERROR',
  'INVALID_ARGUMENTS',
  'INVALID_REQUEST',
  'MCP_BACKOFF',
  'MCP_CALL_FAILED',
  'MCP_CONNECT_FAILED',
  'MCP_PROTOCOL_ERROR',
  'MCP_SHUTTING_DOWN',
  'MCP_TIMEOUT',
  'MCP_TOOL_NOT_FOUND',
  'NOT_INSPECTED',
  'NOT_SUPPORTED',
  'NOT_VERIFIED',
  'NOT_FOUND',
  'ORIGIN_FORBIDDEN',
  'PROCESS_EXITED',
  'REGISTRY_INVALID',
  'REGISTRY_PATH_INVALID',
  'REGISTRY_SERVER_NOT_FOUND',
  'RESULT_TOO_LARGE',
  'SERVER_NOT_FOUND',
  'SENSITIVE_ARGUMENTS_DENIED',
  'TEST_CASE_NOT_FOUND',
  'TEST_RUN_CONFIRMATION_REQUIRED',
  'TOOL_NOT_FOUND',
  'TOO_MANY_REQUESTS',
  'UNAUTHENTICATED',
  'VALIDATION_FAILED',
  'WRITE_CONFIRMATION_REQUIRED',
]);

export const apiErrorSchema = z
  .object({
    apiVersion: z.literal(1),
    error: z.object({
      code: consoleErrorCodeSchema,
      message: z.string(),
      requestId: z.string().optional(),
      retryable: z.boolean(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  })
  .strict();

export type ConsoleErrorCode = z.infer<typeof consoleErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
