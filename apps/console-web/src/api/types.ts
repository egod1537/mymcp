import type { ServerSummary, ToolDefinitionDto } from '@mymcp/console-contracts';

export interface ServersResponse {
  apiVersion: 1;
  servers: ServerSummary[];
}

export interface ToolsResponse {
  apiVersion: 1;
  tools: ToolDefinitionDto[];
}
