import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { SqliteObservabilityStore } from '../src/observability/sqlite-store.js';
import type { ExecutionEvent } from '../src/types.js';

async function record(
  store: SqliteObservabilityStore,
  options: {
    requestId: string;
    startedAt: string;
    outcome: ExecutionEvent['outcome'];
    durationMs?: number;
    serverId?: string;
    toolName?: string;
  },
): Promise<void> {
  await store.recordExecution({
    serverId: options.serverId ?? 'example',
    toolName: options.toolName ?? 'echo',
    startedAt: options.startedAt,
    durationMs: options.durationMs ?? 10,
    outcome: options.outcome,
    errorCode: options.outcome === 'success' ? null : 'TEST_ERROR',
    responseBytes: 100,
    requestBytes: 20,
    isMcpToolError: options.outcome === 'tool_error',
    requestId: options.requestId,
  });
}

describe('SqliteObservabilityStore', () => {
  it('calculates actual call metrics and excludes rejected attempts', async () => {
    const store = new SqliteObservabilityStore({
      database: new DatabaseSync(':memory:'),
      now: () => new Date('2026-10-28T12:00:00.000Z'),
    });
    await record(store, {
      requestId: 'success',
      startedAt: '2026-10-28T11:00:00.000Z',
      outcome: 'success',
      durationMs: 10,
    });
    await record(store, {
      requestId: 'tool-error',
      startedAt: '2026-10-28T11:01:00.000Z',
      outcome: 'tool_error',
      durationMs: 20,
    });
    await record(store, {
      requestId: 'timeout',
      startedAt: '2026-10-28T11:02:00.000Z',
      outcome: 'timeout',
      durationMs: 30,
    });
    await record(store, {
      requestId: 'rejected',
      startedAt: '2026-10-28T11:03:00.000Z',
      outcome: 'rejected',
      durationMs: 1,
    });
    await store.recordHealth({
      serverId: 'example',
      checkedAt: '2026-10-28T11:04:00.000Z',
      runtimeState: 'ready',
      errorCode: null,
    });

    await expect(store.getMetrics('24h')).resolves.toMatchObject({
      totalCalls: 3,
      successfulCalls: 1,
      toolErrors: 1,
      transportErrors: 0,
      timeouts: 1,
      rejectedCalls: 1,
      averageLatencyMs: 20,
    });
    await store.close();
  });

  it('paginates newest-first with a stable cursor and no overlap', async () => {
    const store = new SqliteObservabilityStore({ database: new DatabaseSync(':memory:') });
    for (let index = 0; index < 5; index += 1) {
      await record(store, {
        requestId: `request-${index}`,
        startedAt: `2026-10-28T00:0${index}:00.000Z`,
        outcome: 'success',
      });
    }
    const first = await store.listEvents({ limit: 2 });
    const second = await store.listEvents({ limit: 2, cursor: first.nextCursor! });
    expect(first.events.map(({ requestId }) => requestId)).toEqual(['request-4', 'request-3']);
    expect(second.events.map(({ requestId }) => requestId)).toEqual(['request-2', 'request-1']);
    expect(new Set([...first.events, ...second.events].map(({ id }) => id)).size).toBe(4);
    await store.close();
  });

  it('prunes records older than 30 days and has no raw payload columns', async () => {
    const database = new DatabaseSync(':memory:');
    const store = new SqliteObservabilityStore({
      database,
      now: () => new Date('2026-10-31T00:00:00.000Z'),
    });
    await record(store, {
      requestId: 'expired',
      startedAt: '2026-09-01T00:00:00.000Z',
      outcome: 'success',
    });
    await record(store, {
      requestId: 'recent',
      startedAt: '2026-10-30T00:00:00.000Z',
      outcome: 'success',
    });
    await store.prune();
    const page = await store.listEvents({ limit: 50 });
    expect(page.events.map(({ requestId }) => requestId)).toEqual(['recent']);
    const columns = database.prepare('PRAGMA table_info(execution_events)').all() as Array<{
      name: string;
    }>;
    expect(columns.map(({ name }) => name)).not.toContain('arguments_raw');
    expect(columns.map(({ name }) => name)).not.toContain('response_raw');
    await store.close();
  });
});
