import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { DisabledAuthProvider } from '../src/auth/disabled-auth.js';
import { hashPassword } from '../src/auth/password.js';
import { SqliteAuthProvider } from '../src/auth/sqlite-auth.js';

describe('SqliteAuthProvider', () => {
  it('fails closed without an Argon2id hash', async () => {
    const provider = new SqliteAuthProvider({
      database: new DatabaseSync(':memory:'),
      passwordHash: undefined,
    });
    expect(provider.isConfigured()).toBe(false);
    await expect(provider.login('any-password')).resolves.toBeNull();
    await provider.close();
  });

  it('stores only a session token hash and supports reuse and logout', async () => {
    const database = new DatabaseSync(':memory:');
    const encoded = await hashPassword('a-secure-test-password');
    const provider = new SqliteAuthProvider({ database, passwordHash: encoded });

    await expect(provider.login('wrong-password')).resolves.toBeNull();
    const session = await provider.login('a-secure-test-password');
    expect(session).not.toBeNull();
    const persisted = database
      .prepare('SELECT token_hash, csrf_token FROM console_sessions')
      .get() as Record<string, string>;
    expect(persisted.token_hash).not.toBe(session!.id);
    expect(JSON.stringify(persisted)).not.toContain(session!.id);
    await expect(provider.getSession(session!.id)).resolves.toMatchObject({
      csrfToken: session!.csrfToken,
    });

    await provider.logout(session!.id);
    await expect(provider.getSession(session!.id)).resolves.toBeNull();
    await provider.close();
  });

  it('expires sessions based on the configured clock', async () => {
    let now = new Date('2026-10-28T00:00:00.000Z');
    const provider = new SqliteAuthProvider({
      database: new DatabaseSync(':memory:'),
      passwordHash: await hashPassword('another-secure-password'),
      sessionTtlMs: 1_000,
      now: () => now,
    });
    const session = await provider.login('another-secure-password');
    now = new Date('2026-10-28T00:00:01.001Z');
    await expect(provider.getSession(session!.id)).resolves.toBeNull();
    await provider.close();
  });
});

describe('DisabledAuthProvider', () => {
  it('provides an anonymous session with a process-local CSRF token', async () => {
    const provider = new DisabledAuthProvider();
    expect(provider.isConfigured()).toBe(true);
    expect(provider.isAuthenticationRequired()).toBe(false);
    const session = await provider.getSession('');
    expect(session.csrfToken).toHaveLength(43);
    await expect(provider.getSession('anything')).resolves.toEqual(session);
  });
});
