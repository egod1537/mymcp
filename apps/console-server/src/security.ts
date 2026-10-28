import type { FastifyRequest } from 'fastify';

import { HttpError } from './http-error.js';
import type { AuthProvider, AuthSession } from './types.js';

export const SESSION_COOKIE = 'mymcp_session';
export const CSRF_HEADER = 'x-csrf-token';

export function isAuthenticationRequired(auth: AuthProvider): boolean {
  return auth.isAuthenticationRequired?.() ?? true;
}

export function verifyOrigin(request: FastifyRequest, allowedOrigin: string): void {
  if (request.headers.origin !== allowedOrigin) {
    throw new HttpError({
      statusCode: 403,
      code: 'ORIGIN_FORBIDDEN',
      message: 'Request origin is not allowed.',
    });
  }
}

export async function getAuthSession(
  request: FastifyRequest,
  auth: AuthProvider,
): Promise<AuthSession | null> {
  if (!isAuthenticationRequired(auth)) return auth.getSession('authentication-disabled');
  const sessionId = request.cookies[SESSION_COOKIE];
  return sessionId ? auth.getSession(sessionId) : null;
}

export async function requireAuth(
  request: FastifyRequest,
  auth: AuthProvider,
): Promise<AuthSession> {
  const session = await getAuthSession(request, auth);
  if (!session) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
    });
  }
  return session;
}

export function verifyCsrf(request: FastifyRequest, session: AuthSession): void {
  if (request.headers[CSRF_HEADER] !== session.csrfToken) {
    throw new HttpError({
      statusCode: 403,
      code: 'CSRF_REQUIRED',
      message: 'A valid CSRF token is required.',
    });
  }
}
