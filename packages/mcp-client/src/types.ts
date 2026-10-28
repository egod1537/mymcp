import type {
  CredentialState,
  Health,
  McpRegistryEntry,
  RuntimeState,
} from '@mymcp/console-contracts';

export interface ResolvedRegistryEntry extends McpRegistryEntry {
  resolvedArgs: readonly [string];
  resolvedCwd: string;
}

export interface LoadedRegistry {
  path: string;
  runtimeRoot: string;
  servers: readonly ResolvedRegistryEntry[];
}

export interface ToolDefinition {
  name: string;
  title?: string | undefined;
  description?: string | undefined;
  inputSchema: Record<string, unknown> & { type: 'object' };
  outputSchema?: (Record<string, unknown> & { type: 'object' }) | undefined;
  annotations?:
    | {
        title?: string | undefined;
        readOnlyHint?: boolean | undefined;
        destructiveHint?: boolean | undefined;
        idempotentHint?: boolean | undefined;
        openWorldHint?: boolean | undefined;
      }
    | undefined;
  _meta?: Record<string, unknown> | undefined;
}

export interface StderrLine {
  at: string;
  text: string;
  truncated: boolean;
}

export interface RuntimeSnapshot {
  id: string;
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

export interface ServerInspection {
  status: RuntimeSnapshot;
  tools: readonly ToolDefinition[];
}

export interface McpCallResult {
  requestId: string;
  status: 'success' | 'tool_error';
  durationMs: number;
  content: readonly unknown[];
  structuredContent?: Record<string, unknown> | undefined;
  _meta?: Record<string, unknown> | undefined;
}
