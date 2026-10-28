import { randomUUID } from 'node:crypto';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  SavedTestCase,
  SavedTestRunResult,
  TestAssertion,
  TestAssertionResult,
} from '@mymcp/console-contracts';

import type { PersistedTestCaseInput, SavedTestStore } from '../types.js';

interface CaseRow {
  id: string;
  name: string;
  description: string;
  server_id: string;
  tool_name: string;
  arguments_json: string;
  expected_is_error: number | null;
  assertions_json: string;
  created_at_utc: string;
  updated_at_utc: string;
  schema_snapshot_hash: string;
  enabled: number;
  source: SavedTestCase['source'];
  sensitive_data: number;
}

interface RunRow {
  id: string;
  test_case_id: string;
  status: SavedTestRunResult['status'];
  duration_ms: number | null;
  reason: string | null;
  request_id: string | null;
  assertion_results_json: string;
  ran_at_utc: string;
}

function runFromRow(row: RunRow): SavedTestRunResult {
  return {
    id: row.id,
    testCaseId: row.test_case_id,
    status: row.status,
    durationMs: row.duration_ms,
    reason: row.reason,
    requestId: row.request_id,
    assertionResults: JSON.parse(row.assertion_results_json) as TestAssertionResult[],
    ranAtUtc: row.ran_at_utc,
  };
}

export class SqliteSavedTestStore implements SavedTestStore {
  readonly #database: DatabaseSync;
  readonly #now: () => Date;

  constructor(options: { database: DatabaseSync; now?: () => Date }) {
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#migrate();
  }

  async listCases(
    filter: { serverId?: string | undefined; q?: string | undefined } = {},
  ): Promise<SavedTestCase[]> {
    const search = filter.q ? `%${filter.q}%` : null;
    const rows = this.#database
      .prepare(
        `SELECT id, name, description, server_id, tool_name, arguments_json,
                expected_is_error, assertions_json, created_at_utc, updated_at_utc,
                schema_snapshot_hash, enabled, source, sensitive_data
         FROM saved_test_cases
         WHERE (? IS NULL OR server_id = ?)
           AND (? IS NULL OR name LIKE ? OR description LIKE ? OR tool_name LIKE ?)
         ORDER BY updated_at_utc DESC, id DESC`,
      )
      .all(
        filter.serverId ?? null,
        filter.serverId ?? null,
        search,
        search,
        search,
        search,
      ) as unknown as CaseRow[];
    return rows.map((row) => this.#caseFromRow(row));
  }

  async getCase(id: string): Promise<SavedTestCase | null> {
    const row = this.#database
      .prepare(
        `SELECT id, name, description, server_id, tool_name, arguments_json,
                expected_is_error, assertions_json, created_at_utc, updated_at_utc,
                schema_snapshot_hash, enabled, source, sensitive_data
         FROM saved_test_cases WHERE id = ?`,
      )
      .get(id) as unknown as CaseRow | undefined;
    return row ? this.#caseFromRow(row) : null;
  }

  async createCase(
    input: PersistedTestCaseInput,
    schemaSnapshotHash: string,
  ): Promise<SavedTestCase> {
    const id = randomUUID();
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `INSERT INTO saved_test_cases
          (id, name, description, server_id, tool_name, arguments_json, expected_is_error,
           assertions_json, created_at_utc, updated_at_utc, schema_snapshot_hash, enabled,
           source, sensitive_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.serverId,
        input.toolName,
        JSON.stringify(input.arguments),
        input.expectedIsError === undefined ? null : input.expectedIsError ? 1 : 0,
        JSON.stringify(input.assertions),
        now,
        now,
        schemaSnapshotHash,
        input.enabled ? 1 : 0,
        input.source,
        input.sensitiveData ? 1 : 0,
      );
    return (await this.getCase(id))!;
  }

  async updateCase(
    id: string,
    input: PersistedTestCaseInput,
    schemaSnapshotHash: string,
  ): Promise<SavedTestCase | null> {
    const result = this.#database
      .prepare(
        `UPDATE saved_test_cases SET
           name = ?, description = ?, server_id = ?, tool_name = ?, arguments_json = ?,
           expected_is_error = ?, assertions_json = ?, updated_at_utc = ?,
           schema_snapshot_hash = ?, enabled = ?, source = ?, sensitive_data = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.description,
        input.serverId,
        input.toolName,
        JSON.stringify(input.arguments),
        input.expectedIsError === undefined ? null : input.expectedIsError ? 1 : 0,
        JSON.stringify(input.assertions),
        this.#now().toISOString(),
        schemaSnapshotHash,
        input.enabled ? 1 : 0,
        input.source,
        input.sensitiveData ? 1 : 0,
        id,
      );
    return result.changes === 0 ? null : this.getCase(id);
  }

  async deleteCase(id: string): Promise<boolean> {
    return this.#database.prepare('DELETE FROM saved_test_cases WHERE id = ?').run(id).changes > 0;
  }

  async recordRun(
    result: Omit<SavedTestRunResult, 'id' | 'ranAtUtc'>,
  ): Promise<SavedTestRunResult> {
    const stored: SavedTestRunResult = {
      ...result,
      id: randomUUID(),
      ranAtUtc: this.#now().toISOString(),
    };
    this.#database
      .prepare(
        `INSERT INTO saved_test_runs
          (id, test_case_id, status, duration_ms, reason, request_id,
           assertion_results_json, ran_at_utc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        stored.id,
        stored.testCaseId,
        stored.status,
        stored.durationMs,
        stored.reason,
        stored.requestId,
        JSON.stringify(stored.assertionResults),
        stored.ranAtUtc,
      );
    return stored;
  }

  async close(): Promise<void> {
    this.#database.close();
  }

  #caseFromRow(row: CaseRow): SavedTestCase {
    const latest = this.#database
      .prepare(
        `SELECT id, test_case_id, status, duration_ms, reason, request_id,
                assertion_results_json, ran_at_utc
         FROM saved_test_runs WHERE test_case_id = ?
         ORDER BY ran_at_utc DESC, id DESC LIMIT 1`,
      )
      .get(row.id) as unknown as RunRow | undefined;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      serverId: row.server_id,
      toolName: row.tool_name,
      arguments: JSON.parse(row.arguments_json) as Record<string, unknown>,
      ...(row.expected_is_error === null ? {} : { expectedIsError: row.expected_is_error === 1 }),
      assertions: JSON.parse(row.assertions_json) as TestAssertion[],
      createdAtUtc: row.created_at_utc,
      updatedAtUtc: row.updated_at_utc,
      schemaSnapshotHash: row.schema_snapshot_hash,
      enabled: row.enabled === 1,
      source: row.source,
      sensitiveData: row.sensitive_data === 1,
      latestResult: latest ? runFromRow(latest) : null,
    };
  }

  #migrate(): void {
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS saved_test_cases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        server_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        expected_is_error INTEGER,
        assertions_json TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT NOT NULL,
        schema_snapshot_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('synthetic','user-provided')),
        sensitive_data INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS saved_test_cases_server
        ON saved_test_cases(server_id, updated_at_utc DESC);
      CREATE TABLE IF NOT EXISTS saved_test_runs (
        id TEXT PRIMARY KEY,
        test_case_id TEXT NOT NULL REFERENCES saved_test_cases(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('passed','failed','skipped','errored')),
        duration_ms INTEGER,
        reason TEXT,
        request_id TEXT,
        assertion_results_json TEXT NOT NULL,
        ran_at_utc TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS saved_test_runs_case
        ON saved_test_runs(test_case_id, ran_at_utc DESC, id DESC);
      PRAGMA user_version = 2;
    `);
  }
}

export async function createSqliteSavedTestStore(options: {
  databasePath: string;
}): Promise<SqliteSavedTestStore> {
  await mkdir(dirname(options.databasePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(options.databasePath);
  await chmod(options.databasePath, 0o600);
  return new SqliteSavedTestStore({ database });
}
