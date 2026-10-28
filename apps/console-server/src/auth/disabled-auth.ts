import { randomBytes } from 'node:crypto';

import type { AuthProvider, AuthSession } from '../types.js';

function token(): string {
  return randomBytes(32).toString('base64url');
}

export class DisabledAuthProvider implements AuthProvider {
  readonly #session: AuthSession = {
    id: 'authentication-disabled',
    csrfToken: token(),
    expiresAt: '9999-12-31T23:59:59.999Z',
  };

  isConfigured(): boolean {
    return true;
  }

  isAuthenticationRequired(): boolean {
    return false;
  }

  async login(password: string): Promise<AuthSession> {
    void password;
    return this.#session;
  }

  async getSession(sessionId: string): Promise<AuthSession> {
    void sessionId;
    return this.#session;
  }

  async logout(sessionId: string): Promise<void> {
    void sessionId;
  }
}
