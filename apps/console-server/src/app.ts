import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { McpClientError, RegistryError } from '@mymcp/mcp-client';

import { HttpError } from './http-error.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerEventRoutes } from './routes/events.js';
import { registerServerRoutes } from './routes/servers.js';
import { registerSavedTestRoutes } from './routes/test-cases.js';
import { registerToolRoutes } from './routes/tools.js';
import type { ConsoleAppOptions } from './types.js';

function translateMcpError(error: McpClientError | RegistryError): HttpError {
  switch (error.code) {
    case 'REGISTRY_SERVER_NOT_FOUND':
      return new HttpError({ statusCode: 404, code: 'SERVER_NOT_FOUND', message: error.message });
    case 'MCP_TOOL_NOT_FOUND':
      return new HttpError({ statusCode: 404, code: 'TOOL_NOT_FOUND', message: error.message });
    case 'NOT_VERIFIED':
      return new HttpError({ statusCode: 409, code: 'NOT_SUPPORTED', message: error.message });
    case 'TOO_MANY_REQUESTS':
      return new HttpError({
        statusCode: 429,
        code: 'TOO_MANY_REQUESTS',
        message: error.message,
        retryable: true,
      });
    case 'MCP_TIMEOUT':
      return new HttpError({
        statusCode: 504,
        code: 'MCP_TIMEOUT',
        message: error.message,
        retryable: true,
      });
    case 'BUILD_REQUIRED':
      return new HttpError({ statusCode: 503, code: 'BUILD_REQUIRED', message: error.message });
    case 'MCP_CONNECT_FAILED':
    case 'MCP_BACKOFF':
    case 'MCP_SHUTTING_DOWN':
      return new HttpError({
        statusCode: 503,
        code: 'MCP_CONNECT_FAILED',
        message: error.message,
        retryable: true,
      });
    default:
      return new HttpError({
        statusCode: 502,
        code: 'MCP_PROTOCOL_ERROR',
        message: 'MCP operation failed.',
        retryable: true,
      });
  }
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

export async function createApp(options: ConsoleAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger
      ? {
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
            censor: '[REDACTED]',
          },
        }
      : false,
    bodyLimit: 1024 * 1024,
    requestIdHeader: 'x-request-id',
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
  });
  if (options.webRoot) {
    await app.register(staticFiles, {
      root: options.webRoot,
      prefix: '/',
      wildcard: false,
      index: false,
    });
  }

  app.addHook('onClose', async () => {
    await options.manager.stopAll();
    await options.auth.close?.();
    await options.observability?.close?.();
    await options.testCases?.close?.();
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    reply.headers({
      'content-security-policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    return payload;
  });

  app.get('/api/healthz', async () => ({ apiVersion: 1 as const, alive: true as const }));
  await registerAuthRoutes(app, options);
  await registerServerRoutes(app, options);
  await registerToolRoutes(app, options);
  await registerEventRoutes(app, options);
  await registerSavedTestRoutes(app, options);

  app.setNotFoundHandler((request, reply) => {
    if (options.webRoot && request.raw.method === 'GET' && !request.url.startsWith('/api/')) {
      void reply.header('cache-control', 'no-cache').sendFile('index.html');
      return;
    }
    void reply.status(404).send({
      apiVersion: 1,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId: request.id,
        retryable: false,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const translated =
      error instanceof HttpError
        ? error
        : error instanceof McpClientError || error instanceof RegistryError
          ? translateMcpError(error)
          : hasStatusCode(error) && error.statusCode === 429
            ? new HttpError({
                statusCode: 429,
                code: 'TOO_MANY_REQUESTS',
                message: 'Too many requests.',
                retryable: true,
              })
            : new HttpError({
                statusCode: 500,
                code: 'INTERNAL_ERROR',
                message: 'Internal server error.',
              });
    if (!(error instanceof HttpError) && !(error instanceof McpClientError)) {
      request.log.error({ err: error, requestId: request.id }, 'Console request failed');
    }
    if (translated.statusCode === 429 && request.url === '/api/auth/login') {
      void options.securityAudit?.recordAuth({
        outcome: 'rate_limited',
        source: request.ip,
        at: new Date().toISOString(),
      });
    }
    void reply.status(translated.statusCode).send({
      apiVersion: 1,
      error: {
        code: translated.code,
        message: translated.message,
        requestId: request.id,
        retryable: translated.retryable,
        ...(translated.details ? { details: translated.details } : {}),
      },
    });
  });

  return app;
}
