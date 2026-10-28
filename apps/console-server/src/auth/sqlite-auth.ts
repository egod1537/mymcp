import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { AuthProvider, AuthSession } from '../types.js';
import { isArgon2idHash, verifyPassword } from './password.js';

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface SessionRow {
  csrf_token: string;
  expires_at: string;
  password_fingerprint: string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function token(): string {
  return randomBytes(32).toString('base64url');
}

export class SqliteAuthProvider implements AuthProvider {
  readonly #database: DatabaseSync;
  readonly #passwordHash: string | undefined;
  readonly #passwordFingerprint: string | undefined;
  readonly #sessionTtlMs: number;
  readonly #now: () => Date;

  constructor(options: {
    database: DatabaseSync;
    passwordHash: string | undefined;
    sessionTtlMs?: number;
    now?: () => Date;
  }) {
    this.#database = options.database;
    this.#passwordHash = options.passwordHash;
    this.#passwordFingerprint = options.passwordHash ? digest(options.passwordHash) : undefined;
    this.#sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.#now = options.now ?? (() => new Date());
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS console_sessions (
        token_hash TEXT PRIMARY KEY,
        csrf_token TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        password_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS console_sessions_expires_at
        ON console_sessions(expires_at);
    `);
  }

  isConfigured(): boolean {
    return isArgon2idHash(this.#passwordHash);
  }

  async login(password: string): Promise<AuthSession | null> {
    if (!this.#passwordHash || !this.#passwordFingerprint) return null;
    if (!(await verifyPassword(this.#passwordHash, password))) return null;
    this.#deleteExpired();
    const sessionToken = token();
    const csrfToken = token();
    const createdAt = this.#now();
    const expiresAt = new Date(createdAt.getTime() + this.#sessionTtlMs).toISOString();
    this.#database
      .prepare(
        `INSERT INTO console_sessions
          (token_hash, csrf_token, expires_at, password_fingerprint, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        digest(sessionToken),
        csrfToken,
        expiresAt,
        this.#passwordFingerprint,
        createdAt.toISOString(),
      );
    return { id: sessionToken, csrfToken, expiresAt };
  }

  async getSession(sessionId: string): Promise<AuthSession | null> {
    if (!this.#passwordFingerprint) return null;
    const tokenHash = digest(sessionId);
    const row = this.#database
      .prepare(
        `SELECT csrf_token, expires_at, password_fingerprint
         FROM console_sessions WHERE token_hash = ?`,
      )
      .get(tokenHash) as unknown as SessionRow | undefined;
    if (
      !row ||
      Date.parse(row.expires_at) <= this.#now().getTime() ||
      row.password_fingerprint !== this.#passwordFingerprint
    ) {
      if (row)
        this.#database.prepare('DELETE FROM console_sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return { id: sessionId, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }

  async logout(sessionId: string): Promise<void> {
    this.#database
      .prepare('DELETE FROM console_sessions WHERE token_hash = ?')
      .run(digest(sessionId));
  }

  async close(): Promise<void> {
    this.#database.close();
  }

  #deleteExpired(): void {
    this.#database
      .prepare('DELETE FROM console_sessions WHERE expires_at <= ?')
      .run(this.#now().toISOString());
  }
}

export async function createSqliteAuthProvider(options: {
  databasePath: string;
  passwordHash: string | undefined;
  sessionTtlMs?: number;
}): Promise<SqliteAuthProvider> {
  await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(options.databasePath);
  await chmod(options.databasePath, 0o600);
  return new SqliteAuthProvider({
    database,
    passwordHash: options.passwordHash,
    ...(options.sessionTtlMs === undefined ? {} : { sessionTtlMs: options.sessionTtlMs }),
  });
}
