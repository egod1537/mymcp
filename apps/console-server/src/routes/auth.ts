import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from '@mymcp/console-contracts';

import { HttpError } from '../http-error.js';
import {
  getAuthSession,
  isAuthenticationRequired,
  requireAuth,
  SESSION_COOKIE,
  verifyCsrf,
  verifyOrigin,
} from '../security.js';
import type { ConsoleAppOptions } from '../types.js';
import { parseRequest } from '../validation.js';

export async function registerAuthRoutes(
  app: FastifyInstance,
  options: ConsoleAppOptions,
): Promise<void> {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      verifyOrigin(request, options.allowedOrigin);
      if (!isAuthenticationRequired(options.auth)) {
        const session = await requireAuth(request, options.auth);
        return {
          apiVersion: 1 as const,
          authenticated: true as const,
          csrfToken: session.csrfToken,
          authMode: 'disabled' as const,
        };
      }
      if (!options.auth.isConfigured()) {
        throw new HttpError({
          statusCode: 503,
          code: 'AUTH_NOT_CONFIGURED',
          message: 'Console authentication is not configured.',
        });
      }
      const body = parseRequest(loginRequestSchema, request.body);
      const session = await options.auth.login(body.password);
      await options.securityAudit?.recordAuth({
        outcome: session ? 'success' : 'failure',
        source: request.ip,
        at: new Date().toISOString(),
      });
      if (!session) {
        throw new HttpError({
          statusCode: 401,
          code: 'UNAUTHENTICATED',
          message: 'Invalid credentials.',
        });
      }
      const maxAge = Math.max(1, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000));
      reply.setCookie(SESSION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.secureCookies ?? false,
        path: '/',
        maxAge,
      });
      return {
        apiVersion: 1 as const,
        authenticated: true as const,
        csrfToken: session.csrfToken,
        authMode: 'password' as const,
      };
    },
  );

  app.get('/api/auth/session', async (request) => {
    const session = await getAuthSession(request, options.auth);
    return session
      ? {
          apiVersion: 1 as const,
          authenticated: true as const,
          csrfToken: session.csrfToken,
          authMode: isAuthenticationRequired(options.auth)
            ? ('password' as const)
            : ('disabled' as const),
        }
      : {
          apiVersion: 1 as const,
          authenticated: false as const,
          setupRequired: !options.auth.isConfigured(),
        };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    verifyOrigin(request, options.allowedOrigin);
    const session = await requireAuth(request, options.auth);
    verifyCsrf(request, session);
    if (!isAuthenticationRequired(options.auth)) {
      return {
        apiVersion: 1 as const,
        authenticated: true as const,
        csrfToken: session.csrfToken,
        authMode: 'disabled' as const,
      };
    }
    await options.auth.logout(session.id);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return {
      apiVersion: 1 as const,
      authenticated: false as const,
      setupRequired: !options.auth.isConfigured(),
    };
  });
}
