import { realpath } from 'node:fs/promises';
import { delimiter, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  ConsoleErrorCode,
  CredentialState,
  Health,
  McpRegistryEntry,
  RuntimeState,
} from '@mymcp/console-contracts';

import { getRegistryEntry } from './registry.js';
import { Semaphore } from './semaphore.js';
import { StderrRingBuffer } from './stderr-buffer.js';
import type {
  LoadedRegistry,
  McpCallResult,
  ResolvedRegistryEntry,
  RuntimeSnapshot,
  ServerInspection,
  ToolDefinition,
} from './types.js';

export interface ConnectionManagerOptions {
  connectTimeoutMs?: number;
  listToolsTimeoutMs?: number;
  callTimeoutMs?: number;
  maxCallTimeoutMs?: number;
  healthIntervalMs?: number;
  healthTimeoutMs?: number;
  perServerConcurrency?: number;
  globalConcurrency?: number;
  queueLimit?: number;
  shutdownGraceMs?: number;
  backoffBaseMs?: number;
  now?: () => Date;
}

export class McpClientError extends Error {
  readonly code: ConsoleErrorCode;
  override readonly cause?: unknown;

  constructor(code: ConsoleErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'McpClientError';
    this.code = code;
    this.cause = options?.cause;
  }
}

interface MutableStatus {
  runtimeState: RuntimeState;
  credentialState: CredentialState;
  health: Health;
  lastCheckedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  uptimeSince: string | null;
  pid: number | null;
  nextRetryAt: string | null;
}

interface ConnectionRecord {
  entry: ResolvedRegistryEntry;
  client: Client | null;
  transport: StdioClientTransport | null;
  connecting: Promise<ServerInspection> | null;
  tools: readonly ToolDefinition[] | undefined;
  status: MutableStatus;
  stderr: StderrRingBuffer;
  callSlots: Semaphore;
  intentionalClose: boolean;
  failureCount: number;
}

type StatusListener = (snapshot: RuntimeSnapshot) => void;

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  listToolsTimeoutMs: 10_000,
  callTimeoutMs: 20_000,
  maxCallTimeoutMs: 60_000,
  healthIntervalMs: 30_000,
  healthTimeoutMs: 5_000,
  perServerConcurrency: 2,
  globalConcurrency: 8,
  queueLimit: 20,
  shutdownGraceMs: 5_000,
  backoffBaseMs: 1_000,
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown MCP error';
}

function looksLikeTimeout(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('timeout') || message.includes('timed out') || message.includes('abort');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicEntry(entry: ResolvedRegistryEntry): McpRegistryEntry {
  const value: Partial<ResolvedRegistryEntry> = { ...entry };
  delete value.resolvedArgs;
  delete value.resolvedCwd;
  return value as McpRegistryEntry;
}

export class ConnectionManager {
  readonly #registry: LoadedRegistry;
  readonly #records = new Map<string, ConnectionRecord>();
  readonly #listeners = new Set<StatusListener>();
  readonly #globalSlots: Semaphore;
  readonly #inFlight = new Set<Promise<unknown>>();
  readonly #settings: Required<ConnectionManagerOptions>;
  readonly #healthTimer: NodeJS.Timeout | undefined;
  #stopping = false;

  constructor(registry: LoadedRegistry, options: ConnectionManagerOptions = {}) {
    this.#registry = registry;
    this.#settings = {
      ...DEFAULTS,
      ...options,
      now: options.now ?? (() => new Date()),
    };
    this.#globalSlots = new Semaphore(this.#settings.globalConcurrency, this.#settings.queueLimit);

    for (const entry of registry.servers) {
      const credentialKeys = entry.permittedEnvironmentKeys.filter((key) =>
        /(?:_API_KEY|_TOKEN|_SECRET|_PASSWORD)$/u.test(key),
      );
      const configured = credentialKeys.every((key) => Boolean(process.env[key]));
      this.#records.set(entry.id, {
        entry,
        client: null,
        transport: null,
        connecting: null,
        tools: undefined,
        status: {
          runtimeState: 'not_started',
          credentialState:
            credentialKeys.length === 0 ? 'not_required' : configured ? 'configured' : 'missing',
          health: 'unknown',
          lastCheckedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          uptimeSince: null,
          pid: null,
          nextRetryAt: null,
        },
        stderr: new StderrRingBuffer(),
        callSlots: new Semaphore(this.#settings.perServerConcurrency, this.#settings.queueLimit),
        intentionalClose: false,
        failureCount: 0,
      });
    }

    if (this.#settings.healthIntervalMs > 0) {
      this.#healthTimer = setInterval(
        () => void this.#checkConnectedServers(),
        this.#settings.healthIntervalMs,
      );
      this.#healthTimer.unref();
    }
  }

  listRegistry(): readonly McpRegistryEntry[] {
    return this.#registry.servers.map(publicEntry);
  }

  getStatus(id: string): RuntimeSnapshot {
    getRegistryEntry(this.#registry, id);
    const record = this.#record(id);
    return { id, ...record.status };
  }

  getCachedTools(id: string): readonly ToolDefinition[] | undefined {
    getRegistryEntry(this.#registry, id);
    return this.#record(id).tools?.map((tool) => ({ ...tool }));
  }

  getStderr(id: string): ReturnType<StderrRingBuffer['list']> {
    getRegistryEntry(this.#registry, id);
    return this.#record(id).stderr.list();
  }

  onStatus(listener: StatusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async inspect(id: string, options: { forceRefresh?: boolean } = {}): Promise<ServerInspection> {
    this.#assertRunning();
    const record = this.#record(id);
    if (record.entry.catalogState !== 'supported') {
      this.#setStatus(record, {
        runtimeState: 'not_started',
        health: 'unknown',
        lastCheckedAt: this.#now(),
        lastErrorCode: 'NOT_VERIFIED',
        lastErrorMessage: 'Server is not verified for Console launch',
      });
      throw new McpClientError('NOT_VERIFIED', `Server is not verified: ${id}`);
    }
    if (record.connecting) return record.connecting;
    if (record.client && record.transport) {
      if (options.forceRefresh) await this.#refreshTools(record);
      return { status: this.getStatus(id), tools: record.tools ?? [] };
    }

    this.#assertBackoff(record);
    const connecting = this.#connect(record);
    record.connecting = connecting;
    this.#inFlight.add(connecting);
    try {
      return await connecting;
    } finally {
      this.#inFlight.delete(connecting);
      if (record.connecting === connecting) record.connecting = null;
    }
  }

  async callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number; requestId: string },
  ): Promise<McpCallResult> {
    this.#assertRunning();
    const operation = this.#callTool(id, toolName, args, options);
    this.#inFlight.add(operation);
    try {
      return await operation;
    } finally {
      this.#inFlight.delete(operation);
    }
  }

  async stopAll(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    if (this.#healthTimer) clearInterval(this.#healthTimer);

    if (this.#inFlight.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.#inFlight]),
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.#settings.shutdownGraceMs);
          timer.unref();
        }),
      ]);
    }

    await Promise.allSettled([...this.#records.values()].map((record) => this.#close(record)));
  }

  async #connect(record: ConnectionRecord): Promise<ServerInspection> {
    this.#setStatus(record, {
      runtimeState: 'connecting',
      health: 'unknown',
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    await this.#verifyEntrypoint(record);

    const client = new Client({ name: '@mymcp/console-server', version: '0.1.0' });
    const environment: Record<string, string> = Object.fromEntries(
      DEFAULT_INHERITED_ENV_VARS.map((key) => [key, '']),
    );
    environment.PATH = [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(
      delimiter,
    );
    environment.NODE_ENV = process.env.NODE_ENV === 'production' ? 'production' : 'development';
    for (const key of record.entry.permittedEnvironmentKeys) {
      const value = process.env[key];
      if (value) environment[key] = value;
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [...record.entry.resolvedArgs],
      cwd: record.entry.resolvedCwd,
      env: environment,
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk: Buffer | string) => record.stderr.append(chunk));
    record.client = client;
    record.transport = transport;
    record.intentionalClose = false;

    client.onerror = (error) => {
      this.#setStatus(record, {
        runtimeState: 'degraded',
        health: 'warning',
        lastErrorCode: 'MCP_PROTOCOL_ERROR',
        lastErrorMessage: error.message,
        lastCheckedAt: this.#now(),
      });
    };
    client.onclose = () => {
      record.stderr.flush();
      record.client = null;
      record.transport = null;
      const intentional = record.intentionalClose || this.#stopping;
      if (!intentional) this.#registerFailure(record);
      this.#setStatus(record, {
        runtimeState: intentional ? 'disconnected' : 'error',
        health: intentional ? 'unknown' : 'failing',
        lastCheckedAt: this.#now(),
        lastErrorCode: intentional ? null : 'MCP_DISCONNECTED',
        lastErrorMessage: intentional ? null : 'MCP child process disconnected unexpectedly',
        pid: null,
        uptimeSince: null,
      });
    };

    try {
      await client.connect(transport, {
        timeout: this.#settings.connectTimeoutMs,
        maxTotalTimeout: this.#settings.connectTimeoutMs,
      });
      record.status.pid = transport.pid;
      await this.#refreshTools(record);
      record.failureCount = 0;
      this.#setStatus(record, {
        runtimeState: 'ready',
        health: 'ok',
        lastCheckedAt: this.#now(),
        lastErrorCode: null,
        lastErrorMessage: null,
        nextRetryAt: null,
        uptimeSince: this.#now(),
        pid: transport.pid,
      });
      return { status: this.getStatus(record.entry.id), tools: record.tools ?? [] };
    } catch (error) {
      const code: ConsoleErrorCode = looksLikeTimeout(error) ? 'MCP_TIMEOUT' : 'MCP_CONNECT_FAILED';
      this.#registerFailure(record);
      record.intentionalClose = true;
      await client.close().catch(() => undefined);
      record.client = null;
      record.transport = null;
      this.#failStatus(record, code, errorMessage(error));
      throw new McpClientError(code, `Failed to connect to ${record.entry.id}`, { cause: error });
    }
  }

  async #refreshTools(record: ConnectionRecord): Promise<void> {
    if (!record.client) {
      throw new McpClientError('MCP_CONNECT_FAILED', 'MCP client is not connected');
    }
    try {
      const response = await record.client.listTools(undefined, {
        timeout: this.#settings.listToolsTimeoutMs,
        maxTotalTimeout: this.#settings.listToolsTimeoutMs,
      });
      record.tools = response.tools;
      this.#setStatus(record, {
        lastCheckedAt: this.#now(),
        runtimeState: 'ready',
        health: 'ok',
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    } catch (error) {
      const code: ConsoleErrorCode = looksLikeTimeout(error) ? 'MCP_TIMEOUT' : 'MCP_CONNECT_FAILED';
      this.#failStatus(record, code, errorMessage(error));
      throw new McpClientError(code, `Failed to list tools for ${record.entry.id}`, {
        cause: error,
      });
    }
  }

  async #callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { timeoutMs?: number; requestId: string },
  ): Promise<McpCallResult> {
    const timeoutMs = Math.min(
      options.timeoutMs ?? this.#settings.callTimeoutMs,
      this.#settings.maxCallTimeoutMs,
    );
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw new McpClientError('INVALID_REQUEST', 'timeoutMs must be a positive integer');
    }
    const inspection = await this.inspect(id);
    if (!inspection.tools.some((tool) => tool.name === toolName)) {
      throw new McpClientError('MCP_TOOL_NOT_FOUND', `Tool is not available: ${toolName}`);
    }
    const record = this.#record(id);
    const releaseServer = await record.callSlots.acquire();
    let releaseGlobal: (() => void) | undefined;
    try {
      releaseGlobal = await this.#globalSlots.acquire();
      this.#assertRunning();
      if (!record.client) throw new McpClientError('MCP_CONNECT_FAILED', 'MCP disconnected');
      const started = performance.now();
      try {
        const result = await record.client.callTool(
          { name: toolName, arguments: args },
          undefined,
          {
            timeout: timeoutMs,
            maxTotalTimeout: timeoutMs,
          },
        );
        const structuredContent = asRecord(result.structuredContent);
        const metadata = asRecord(result._meta);
        return {
          requestId: options.requestId,
          status: result.isError ? 'tool_error' : 'success',
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          content: Array.isArray(result.content) ? result.content : [],
          ...(structuredContent === undefined ? {} : { structuredContent }),
          ...(metadata === undefined ? {} : { _meta: metadata }),
        };
      } catch (error) {
        const code: ConsoleErrorCode = looksLikeTimeout(error) ? 'MCP_TIMEOUT' : 'MCP_CALL_FAILED';
        if (code === 'MCP_TIMEOUT') {
          this.#setStatus(record, {
            runtimeState: 'degraded',
            health: 'warning',
            lastCheckedAt: this.#now(),
            lastErrorCode: code,
            lastErrorMessage: errorMessage(error),
          });
        }
        throw new McpClientError(code, `Tool call failed: ${toolName}`, { cause: error });
      }
    } finally {
      releaseGlobal?.();
      releaseServer();
    }
  }

  async #checkConnectedServers(): Promise<void> {
    await Promise.allSettled(
      [...this.#records.values()].map(async (record) => {
        if (!record.client || record.status.runtimeState === 'connecting') return;
        try {
          await record.client.ping({
            timeout: this.#settings.healthTimeoutMs,
            maxTotalTimeout: this.#settings.healthTimeoutMs,
          });
          this.#setStatus(record, {
            health: 'ok',
            lastCheckedAt: this.#now(),
            lastErrorCode: null,
            lastErrorMessage: null,
          });
        } catch (error) {
          this.#setStatus(record, {
            runtimeState: 'degraded',
            health: 'warning',
            lastCheckedAt: this.#now(),
            lastErrorCode: looksLikeTimeout(error) ? 'MCP_TIMEOUT' : 'MCP_HEALTH_FAILED',
            lastErrorMessage: errorMessage(error),
          });
        }
      }),
    );
  }

  async #verifyEntrypoint(record: ConnectionRecord): Promise<void> {
    try {
      const canonical = await realpath(record.entry.resolvedArgs[0]);
      if (canonical !== record.entry.resolvedArgs[0]) {
        throw new Error('Entrypoint changed after registry validation');
      }
    } catch (error) {
      const code =
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'BUILD_REQUIRED'
          : 'REGISTRY_PATH_INVALID';
      this.#failStatus(record, code, errorMessage(error));
      throw new McpClientError(code, `Entrypoint is not launchable: ${record.entry.id}`, {
        cause: error,
      });
    }
  }

  async #close(record: ConnectionRecord): Promise<void> {
    record.intentionalClose = true;
    const client = record.client;
    record.client = null;
    record.transport = null;
    if (client) await client.close().catch(() => undefined);
    record.stderr.flush();
    this.#setStatus(record, {
      runtimeState: 'disconnected',
      health: 'unknown',
      pid: null,
      uptimeSince: null,
      lastCheckedAt: this.#now(),
    });
  }

  #record(id: string): ConnectionRecord {
    getRegistryEntry(this.#registry, id);
    const record = this.#records.get(id);
    if (!record) throw new McpClientError('REGISTRY_SERVER_NOT_FOUND', `Unknown server: ${id}`);
    return record;
  }

  #assertRunning(): void {
    if (this.#stopping) {
      throw new McpClientError('MCP_SHUTTING_DOWN', 'MCP manager is shutting down');
    }
  }

  #assertBackoff(record: ConnectionRecord): void {
    if (!record.status.nextRetryAt) return;
    if (this.#settings.now().getTime() < Date.parse(record.status.nextRetryAt)) {
      throw new McpClientError('MCP_BACKOFF', `Reconnect backoff active for ${record.entry.id}`);
    }
  }

  #registerFailure(record: ConnectionRecord): void {
    record.failureCount += 1;
    const delay = Math.min(
      30_000,
      this.#settings.backoffBaseMs * 2 ** Math.max(0, record.failureCount - 1),
    );
    record.status.nextRetryAt = new Date(this.#settings.now().getTime() + delay).toISOString();
  }

  #failStatus(record: ConnectionRecord, code: string, message: string): void {
    this.#setStatus(record, {
      runtimeState: 'error',
      health: 'failing',
      lastCheckedAt: this.#now(),
      lastErrorCode: code,
      lastErrorMessage: message,
      pid: null,
      uptimeSince: null,
    });
  }

  #setStatus(record: ConnectionRecord, patch: Partial<MutableStatus>): void {
    Object.assign(record.status, patch);
    const snapshot = this.getStatus(record.entry.id);
    for (const listener of this.#listeners) listener(snapshot);
  }

  #now(): string {
    return this.#settings.now().toISOString();
  }
}
