import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { EventQuery, ExecutionEvent, MetricsSnapshot, ObservabilityReader } from '../types.js';

const RETENTION_DAYS = 30;
const MAX_EXECUTION_ROWS = 50_000;

interface EventRow {
  id: string;
  server_id: string;
  tool_name: string;
  started_at_utc: string;
  duration_ms: number;
  outcome: ExecutionEvent['outcome'];
  error_code: string | null;
  response_bytes: number | null;
  request_bytes: number | null;
  request_id: string;
}

interface CountRow {
  total_calls: number;
  successful_calls: number;
  tool_errors: number;
  transport_errors: number;
  timeouts: number;
  rejected_calls: number;
  average_latency_ms: number | null;
}

function clientFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function encodeCursor(row: Pick<EventRow, 'id' | 'started_at_utc'>): string {
  return Buffer.from(JSON.stringify({ id: row.id, at: row.started_at_utc }), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(value: string | undefined): { id: string | null; at: string | null } {
  if (!value) return { id: null, at: null };
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('id' in parsed) ||
      !('at' in parsed) ||
      typeof parsed.id !== 'string' ||
      typeof parsed.at !== 'string'
    ) {
      throw new Error('Invalid cursor');
    }
    return { id: parsed.id, at: parsed.at };
  } catch {
    throw new Error('INVALID_CURSOR');
  }
}

function eventFromRow(row: EventRow): ExecutionEvent {
  return {
    id: row.id,
    serverId: row.server_id,
    toolName: row.tool_name,
    outcome: row.outcome,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
    responseBytes: row.response_bytes,
    requestBytes: row.request_bytes,
    requestId: row.request_id,
    executedAt: row.started_at_utc,
  };
}

export class SqliteObservabilityStore implements ObservabilityReader {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;

  constructor(options: { database: DatabaseSync; now?: () => Date }) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#migrate();
  }

  async recordExecution(event: {
    serverId: string;
    toolName: string;
    startedAt: string;
    durationMs: number;
    outcome: ExecutionEvent['outcome'];
    errorCode: string | null;
    responseBytes: number | null;
    requestBytes: number | null;
    isMcpToolError: boolean | null;
    requestId: string;
  }): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO execution_events
          (id, server_id, tool_name, started_at_utc, duration_ms, outcome, error_code,
           response_bytes, request_bytes, is_mcp_tool_error, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        event.serverId,
        event.toolName,
        event.startedAt,
        Math.max(0, Math.round(event.durationMs)),
        event.outcome,
        event.errorCode,
        event.responseBytes,
        event.requestBytes,
        event.isMcpToolError === null ? null : event.isMcpToolError ? 1 : 0,
        event.requestId,
      );
  }

  async recordHealth(event: {
    serverId: string;
    checkedAt: string;
    runtimeState: string;
    errorCode: string | null;
    durationMs?: number;
  }): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO health_events
          (id, server_id, checked_at_utc, runtime_state, error_code, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        event.serverId,
        event.checkedAt,
        event.runtimeState,
        event.errorCode,
        event.durationMs ?? null,
      );
  }

  async recordAuth(event: {
    outcome: 'success' | 'failure' | 'rate_limited';
    source: string;
    at: string;
  }): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO security_events
          (id, occurred_at_utc, event_type, outcome, client_fingerprint_hash)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), event.at, 'login', event.outcome, clientFingerprint(event.source));
  }

  async listEvents(query: EventQuery): Promise<{
    events: readonly ExecutionEvent[];
    nextCursor: string | null;
  }> {
    const cursor = decodeCursor(query.cursor);
    const search = query.q ? `%${query.q}%` : null;
    const rows = this.#database
      .prepare(
        `SELECT id, server_id, tool_name, started_at_utc, duration_ms, outcome, error_code,
                response_bytes, request_bytes, request_id
         FROM execution_events
         WHERE (? IS NULL OR server_id = ?)
           AND (? IS NULL OR tool_name = ?)
           AND (? IS NULL OR outcome = ?)
           AND (? IS NULL OR started_at_utc >= ?)
           AND (? IS NULL OR started_at_utc <= ?)
           AND (? IS NULL OR started_at_utc < ? OR (started_at_utc = ? AND id < ?))
           AND (? IS NULL OR server_id LIKE ? OR tool_name LIKE ? OR request_id LIKE ? OR error_code LIKE ?)
         ORDER BY started_at_utc DESC, id DESC
         LIMIT ?`,
      )
      .all(
        query.serverId ?? null,
        query.serverId ?? null,
        query.toolName ?? null,
        query.toolName ?? null,
        query.outcome ?? null,
        query.outcome ?? null,
        query.from ?? null,
        query.from ?? null,
        query.to ?? null,
        query.to ?? null,
        cursor.at,
        cursor.at,
        cursor.at,
        cursor.id,
        search,
        search,
        search,
        search,
        search,
        query.limit,
      ) as unknown as EventRow[];
    const last = rows.at(-1);
    return {
      events: rows.map(eventFromRow),
      nextCursor: rows.length === query.limit && last ? encodeCursor(last) : null,
    };
  }

  async getMetrics(range: '24h' | '7d' | '30d', serverId?: string): Promise<MetricsSnapshot> {
    const rangeMs = range === '24h' ? 86_400_000 : range === '7d' ? 604_800_000 : 2_592_000_000;
    const from = new Date(this.#now().getTime() - rangeMs).toISOString();
    const counts = this.#database
      .prepare(
        `SELECT
           SUM(CASE WHEN outcome != 'rejected' THEN 1 ELSE 0 END) AS total_calls,
           SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successful_calls,
           SUM(CASE WHEN outcome = 'tool_error' THEN 1 ELSE 0 END) AS tool_errors,
           SUM(CASE WHEN outcome = 'transport_error' THEN 1 ELSE 0 END) AS transport_errors,
           SUM(CASE WHEN outcome = 'timeout' THEN 1 ELSE 0 END) AS timeouts,
           SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected_calls,
           AVG(CASE WHEN outcome != 'rejected' THEN duration_ms END) AS average_latency_ms
         FROM execution_events
         WHERE started_at_utc >= ? AND (? IS NULL OR server_id = ?)`,
      )
      .get(from, serverId ?? null, serverId ?? null) as unknown as Partial<CountRow>;
    const mostUsed = this.#database
      .prepare(
        `SELECT server_id, tool_name, COUNT(*) AS count
         FROM execution_events
         WHERE started_at_utc >= ? AND outcome != 'rejected' AND (? IS NULL OR server_id = ?)
         GROUP BY server_id, tool_name
         ORDER BY count DESC, server_id, tool_name
         LIMIT 10`,
      )
      .all(from, serverId ?? null, serverId ?? null) as unknown as Array<{
      server_id: string;
      tool_name: string;
      count: number;
    }>;
    const failures = this.#database
      .prepare(
        `SELECT server_id, COUNT(*) AS count
         FROM execution_events
         WHERE started_at_utc >= ?
           AND outcome IN ('tool_error', 'transport_error', 'timeout')
           AND (? IS NULL OR server_id = ?)
         GROUP BY server_id
         ORDER BY count DESC, server_id
         LIMIT 10`,
      )
      .all(from, serverId ?? null, serverId ?? null) as unknown as Array<{
      server_id: string;
      count: number;
    }>;
    return {
      totalCalls: counts.total_calls ?? 0,
      successfulCalls: counts.successful_calls ?? 0,
      toolErrors: counts.tool_errors ?? 0,
      transportErrors: counts.transport_errors ?? 0,
      timeouts: counts.timeouts ?? 0,
      rejectedCalls: counts.rejected_calls ?? 0,
      averageLatencyMs: counts.average_latency_ms ?? null,
      medianLatencyMs: null,
      mostUsedTools: mostUsed.map((row) => ({
        serverId: row.server_id,
        toolName: row.tool_name,
        count: row.count,
      })),
      failuresByServer: failures.map((row) => ({ serverId: row.server_id, count: row.count })),
    };
  }

  async prune(retentionDays = RETENTION_DAYS): Promise<void> {
    const cutoff = new Date(this.#now().getTime() - retentionDays * 86_400_000).toISOString();
    this.#database.prepare('DELETE FROM execution_events WHERE started_at_utc < ?').run(cutoff);
    this.#database.prepare('DELETE FROM health_events WHERE checked_at_utc < ?').run(cutoff);
    this.#database.prepare('DELETE FROM security_events WHERE occurred_at_utc < ?').run(cutoff);
    this.#database
      .prepare(
        `DELETE FROM execution_events WHERE id IN (
           SELECT id FROM execution_events
           ORDER BY started_at_utc DESC, id DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(MAX_EXECUTION_ROWS);
  }

  async close(): Promise<void> {
    this.#database.close();
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS execution_events (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        started_at_utc TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('success','tool_error','transport_error','timeout','rejected')),
        error_code TEXT,
        response_bytes INTEGER,
        request_bytes INTEGER,
        is_mcp_tool_error INTEGER,
        request_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS execution_events_time
        ON execution_events(started_at_utc DESC, id DESC);
      CREATE INDEX IF NOT EXISTS execution_events_server_tool
        ON execution_events(server_id, tool_name, started_at_utc DESC);
      CREATE TABLE IF NOT EXISTS health_events (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL,
        checked_at_utc TEXT NOT NULL,
        runtime_state TEXT NOT NULL,
        error_code TEXT,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS health_events_time ON health_events(checked_at_utc DESC);
      CREATE TABLE IF NOT EXISTS security_events (
        id TEXT PRIMARY KEY,
        occurred_at_utc TEXT NOT NULL,
        event_type TEXT NOT NULL,
        outcome TEXT NOT NULL,
        client_fingerprint_hash TEXT
      );
      CREATE INDEX IF NOT EXISTS security_events_time ON security_events(occurred_at_utc DESC);
      PRAGMA user_version = 1;
    `);
  }
}

export async function createSqliteObservabilityStore(options: {
  databasePath: string;
}): Promise<SqliteObservabilityStore> {
  await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(options.databasePath);
  await chmod(options.databasePath, 0o600);
  const store = new SqliteObservabilityStore({ database });
  await store.prune();
  return store;
}
