import type { FastifyRequest } from 'fastify';
import type {
  SavedTestCase,
  SavedTestCaseInput,
  SavedTestRunResult,
} from '@mymcp/console-contracts';
import type { ConnectionManager } from '@mymcp/mcp-client';

export type McpManager = Pick<
  ConnectionManager,
  'listRegistry' | 'getStatus' | 'getCachedTools' | 'getStderr' | 'inspect' | 'callTool' | 'stopAll'
>;

export interface AuthSession {
  id: string;
  csrfToken: string;
  expiresAt: string;
}

export interface AuthProvider {
  isConfigured(): boolean;
  isAuthenticationRequired?(): boolean;
  login(password: string): Promise<AuthSession | null>;
  getSession(sessionId: string): Promise<AuthSession | null>;
  logout(sessionId: string): Promise<void>;
  close?(): Promise<void>;
}

export interface ExecutionEvent {
  id: string;
  serverId: string;
  toolName: string;
  outcome: 'success' | 'tool_error' | 'transport_error' | 'timeout' | 'rejected';
  durationMs: number;
  errorCode: string | null;
  responseBytes: number | null;
  requestBytes: number | null;
  requestId: string;
  executedAt: string;
}

export interface EventQuery {
  serverId?: string | undefined;
  toolName?: string | undefined;
  outcome?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  q?: string | undefined;
  limit: number;
}

export interface MetricsSnapshot {
  totalCalls: number;
  successfulCalls: number;
  toolErrors: number;
  transportErrors: number;
  timeouts: number;
  rejectedCalls: number;
  averageLatencyMs: number | null;
  medianLatencyMs: null;
  mostUsedTools: Array<{ serverId: string; toolName: string; count: number }>;
  failuresByServer: Array<{ serverId: string; count: number }>;
}

export interface ObservabilityReader {
  listEvents(query: EventQuery): Promise<{
    events: readonly ExecutionEvent[];
    nextCursor: string | null;
  }>;
  getMetrics(range: '24h' | '7d' | '30d', serverId?: string): Promise<MetricsSnapshot>;
  recordExecution?(event: {
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
  }): Promise<void>;
  close?(): Promise<void>;
}

export type PersistedTestCaseInput = Omit<SavedTestCaseInput, 'confirmSensitive'>;

export interface SavedTestStore {
  listCases(filter?: {
    serverId?: string | undefined;
    q?: string | undefined;
  }): Promise<readonly SavedTestCase[]>;
  getCase(id: string): Promise<SavedTestCase | null>;
  createCase(input: PersistedTestCaseInput, schemaSnapshotHash: string): Promise<SavedTestCase>;
  updateCase(
    id: string,
    input: PersistedTestCaseInput,
    schemaSnapshotHash: string,
  ): Promise<SavedTestCase | null>;
  deleteCase(id: string): Promise<boolean>;
  recordRun(result: Omit<SavedTestRunResult, 'id' | 'ranAtUtc'>): Promise<SavedTestRunResult>;
  close?(): Promise<void>;
}

export interface ConsoleAppOptions {
  auth: AuthProvider;
  manager: McpManager;
  allowedOrigin: string;
  secureCookies?: boolean;
  observability?: ObservabilityReader;
  testCases?: SavedTestStore;
  securityAudit?: {
    recordAuth(event: {
      outcome: 'success' | 'failure' | 'rate_limited';
      source: string;
      at: string;
    }): Promise<void>;
  };
  webRoot?: string;
  logger?: boolean;
}

export type ConsoleRequest = FastifyRequest;
