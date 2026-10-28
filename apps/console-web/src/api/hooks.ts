import { useMutation, useQuery } from '@tanstack/react-query';
import type { CallToolRequest, CallToolResponse } from '@mymcp/console-contracts';

import { useAuth } from '../app/AuthContext.js';
import { apiRequest } from './client.js';
import type { ServersResponse, ToolsResponse } from './types.js';

export function useServers() {
  return useQuery({
    queryKey: ['servers'],
    queryFn: () => apiRequest<ServersResponse>('/api/servers'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

export function useTools(serverId: string, enabled = true) {
  return useQuery({
    queryKey: ['servers', serverId, 'tools'],
    queryFn: () => apiRequest<ToolsResponse>(`/api/servers/${encodeURIComponent(serverId)}/tools`),
    enabled: Boolean(serverId) && enabled,
    retry: false,
  });
}

export function useCallTool(serverId: string, toolName: string) {
  const { csrfToken } = useAuth();
  return useMutation({
    mutationFn: (body: CallToolRequest) =>
      apiRequest<CallToolResponse>(
        `/api/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/call`,
        { method: 'POST', body: JSON.stringify(body) },
        csrfToken,
      ),
  });
}
